//! Event storage and retrieval.
//!
//! AUTH events (kind 22242) are never stored — they carry bearer tokens.
//! Ephemeral events (kinds 20000–29999) are never stored — Redis pub/sub only.
//! Deduplication is application-layer: ON CONFLICT DO NOTHING.

use chrono::{DateTime, Utc};
use nostr::Event;
use sqlx::{PgPool, QueryBuilder, Row};
use uuid::Uuid;

use buzz_core::kind::{
    event_kind_i32, is_ephemeral, is_parameterized_replaceable, KIND_AUTH, KIND_EVENT_REMINDER,
};
use buzz_core::StoredEvent;

use crate::error::{DbError, Result};

/// Optional filters for [`query_events`].
#[derive(Debug, Default, Clone)]
pub struct EventQuery {
    /// Restrict results to this channel.
    pub channel_id: Option<Uuid>,
    /// Restrict results to these kind values (stored as `i32` in Postgres).
    pub kinds: Option<Vec<i32>>,
    /// Restrict results to events from this pubkey.
    pub pubkey: Option<Vec<u8>>,
    /// Return events created at or after this time.
    pub since: Option<DateTime<Utc>>,
    /// Return events created at or before this time.
    pub until: Option<DateTime<Utc>>,
    /// Maximum number of events to return.
    pub limit: Option<i64>,
    /// Number of events to skip (for pagination).
    pub offset: Option<i64>,
    /// Restrict to events with a `p` tag mentioning this hex pubkey.
    /// Joins against `event_mentions` table (indexed).
    pub p_tag_hex: Option<String>,
    /// Restrict to events with this exact `d_tag` value (NIP-33).
    /// Pushed into SQL via the `idx_events_parameterized` index.
    pub d_tag: Option<String>,
    /// Restrict to events with any of these `d_tag` values (multi-value NIP-33 pushdown).
    /// Used when a filter has multiple `#d` values and targets only NIP-33 kinds.
    pub d_tags: Option<Vec<String>>,
    /// Composite keyset cursor: exclude events at or "after" this (created_at, id) pair.
    /// Used with `until` for stable pagination: events where
    /// `created_at < until OR (created_at = until AND id > before_id)`.
    /// When set, `until` must also be set.
    pub before_id: Option<Vec<u8>>,
    /// When true, restricts results to global events (`channel_id IS NULL`).
    /// Use for endpoints that serve non-channel data (e.g. kind:1 notes) to
    /// defensively prevent leaking channel-scoped events if the ingest
    /// invariant (`is_global_only_kind`) ever changes.
    /// Mutually exclusive with `channel_id`.
    pub global_only: bool,
    /// Restrict results to events from any of these pubkeys (multi-author `IN` pushdown).
    pub authors: Option<Vec<Vec<u8>>>,
    /// Restrict results to events with any of these IDs (multi-id `IN` pushdown).
    pub ids: Option<Vec<Vec<u8>>>,
    /// Restrict results to events with an `e` tag referencing any of these event IDs (hex).
    /// Uses JSONB containment (`tags @> ...`) against the `tags` column.
    pub e_tags: Option<Vec<String>>,
    /// Restrict results to events in any of these channels (multi-channel `IN` pushdown).
    /// Used by NIP-45 COUNT to enforce channel access without fetching all rows.
    pub channel_ids: Option<Vec<uuid::Uuid>>,
    /// Override the default limit clamp (1000). Used by COUNT fallback path
    /// which needs to fetch all matching events for post-filter counting.
    /// When None, the default clamp of 1000 applies.
    pub max_limit: Option<i64>,
}

/// Maximum length for a `d_tag` value (bytes). NIP-33 d-tags are short identifiers;
/// anything beyond this is either a bug or abuse.
pub const D_TAG_MAX_LEN: usize = 1024;

/// Extract the `d_tag` value for storage.
///
/// For NIP-33 parameterized replaceable events (kind 30000–39999): returns the first
/// `d` tag's value, or `""` if no `d` tag is present (per NIP-33 spec).
/// For all other events: returns `None` (column stays NULL).
pub fn extract_d_tag(event: &Event) -> Option<String> {
    let kind_u32 = event.kind.as_u16() as u32;
    if !is_parameterized_replaceable(kind_u32) {
        return None;
    }
    let val = event
        .tags
        .iter()
        .find_map(|tag| {
            let parts = tag.as_slice();
            if parts.len() >= 2 && parts[0] == "d" {
                Some(parts[1].to_string())
            } else {
                None
            }
        })
        .unwrap_or_default(); // Missing d tag → empty string per NIP-33
    Some(val)
}

/// Extract the `not_before` timestamp for materialization in the `events` table.
///
/// Only applies to `kind:30300` (NIP-ER event reminders). Returns the first
/// valid `not_before` tag value as an `i64` Unix timestamp, or `None` if the
/// event is not a reminder or has no `not_before` tag.
pub fn extract_not_before(event: &Event) -> Option<i64> {
    let kind_u32 = event.kind.as_u16() as u32;
    if kind_u32 != KIND_EVENT_REMINDER {
        return None;
    }
    event.tags.iter().find_map(|tag| {
        let parts = tag.as_slice();
        if parts.len() >= 2 && parts[0] == "not_before" {
            parts[1].parse::<i64>().ok()
        } else {
            None
        }
    })
}

/// Insert a Nostr event. Rejects AUTH and ephemeral kinds.
///
/// Returns `(StoredEvent, was_inserted)` — `was_inserted` is `false` on duplicate.
pub async fn insert_event(
    pool: &PgPool,
    event: &Event,
    channel_id: Option<Uuid>,
) -> Result<(StoredEvent, bool)> {
    let kind_u16 = event.kind.as_u16();
    let kind_u32 = u32::from(kind_u16);

    if kind_u32 == KIND_AUTH {
        return Err(DbError::AuthEventRejected);
    }
    if is_ephemeral(kind_u32) {
        return Err(DbError::EphemeralEventRejected(kind_u16));
    }

    let id_bytes = event.id.as_bytes();
    let pubkey_bytes = event.pubkey.to_bytes();
    let sig_bytes = event.sig.serialize();
    let tags_json = serde_json::to_value(&event.tags)?;
    // Cast chain: nostr Kind (u16) → i32 (Postgres INT column). Safe: all Buzz kinds fit in i32.
    let kind_i32 = event_kind_i32(event);
    let created_at_secs = event.created_at.as_secs() as i64;
    let created_at = DateTime::from_timestamp(created_at_secs, 0)
        .ok_or(DbError::InvalidTimestamp(created_at_secs))?;
    let received_at = Utc::now();
    let d_tag = extract_d_tag(event);
    let not_before = extract_not_before(event);
    let result = sqlx::query(
        r#"
        INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id, d_tag, not_before)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(id_bytes.as_slice())
    .bind(pubkey_bytes.as_slice())
    .bind(created_at)
    .bind(kind_i32)
    .bind(&tags_json)
    .bind(&event.content)
    .bind(sig_bytes.as_slice())
    .bind(received_at)
    .bind(channel_id)
    .bind(d_tag.as_deref())
    .bind(not_before)
    .execute(pool)
    .await?;

    let was_inserted = result.rows_affected() > 0;

    Ok((
        StoredEvent::with_received_at(event.clone(), received_at, channel_id, true),
        was_inserted,
    ))
}

/// Query events with optional filters. Results ordered by `created_at DESC`.
///
/// Uses `QueryBuilder` for dynamic filter composition — avoids string concatenation
/// while keeping all user values in bind parameters.
pub async fn query_events(pool: &PgPool, q: &EventQuery) -> Result<Vec<StoredEvent>> {
    // Composite cursor requires both halves.
    if q.before_id.is_some() && q.until.is_none() {
        return Err(DbError::InvalidData(
            "before_id requires until to be set".to_string(),
        ));
    }

    // global_only and channel_id are mutually exclusive.
    if q.global_only && q.channel_id.is_some() {
        return Err(DbError::InvalidData(
            "global_only and channel_id are mutually exclusive".to_string(),
        ));
    }

    // Empty list means "match nothing" — return empty immediately.
    if q.kinds.as_deref().is_some_and(|k| k.is_empty()) {
        return Ok(vec![]);
    }
    if q.authors.as_deref().is_some_and(|a| a.is_empty()) {
        return Ok(vec![]);
    }
    if q.ids.as_deref().is_some_and(|i| i.is_empty()) {
        return Ok(vec![]);
    }
    if q.e_tags.as_deref().is_some_and(|e| e.is_empty()) {
        return Ok(vec![]);
    }

    let clamp = q.max_limit.unwrap_or(1000);
    let limit_val = q.limit.unwrap_or(100).min(clamp);
    let offset_val = q.offset.unwrap_or(0);

    let mut qb: QueryBuilder<sqlx::Postgres> = if let Some(ref p_hex) = q.p_tag_hex {
        // Join against event_mentions for #p-filtered queries (indexed).
        let mut b = QueryBuilder::new(
            "SELECT e.id, e.pubkey, e.created_at, e.kind, e.tags, e.content, \
             e.sig, e.received_at, e.channel_id \
             FROM events e \
             INNER JOIN event_mentions m ON e.id = m.event_id \
             WHERE e.deleted_at IS NULL AND m.pubkey_hex = ",
        );
        b.push_bind(p_hex.to_ascii_lowercase());
        b
    } else {
        QueryBuilder::new(
            "SELECT id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id \
             FROM events WHERE deleted_at IS NULL",
        )
    };

    // Use unqualified column names when no join, qualified when joined.
    let col_prefix = if q.p_tag_hex.is_some() { "e." } else { "" };

    if let Some(ch) = q.channel_id {
        qb.push(format!(" AND {col_prefix}channel_id = "))
            .push_bind(ch);
    } else if q.global_only {
        qb.push(format!(" AND {col_prefix}channel_id IS NULL"));
    }

    // Multi-channel IN pushdown: restrict to events in any of these channels
    // OR global events (channel_id IS NULL). Used by NIP-45 COUNT to enforce
    // channel access at the SQL level without fetching all rows.
    //
    // SECURITY: Some(empty vec) means "user has access to NO channels" —
    // only global events (channel_id IS NULL) should be returned.
    if let Some(ref ch_ids) = q.channel_ids {
        if ch_ids.is_empty() {
            // No channel access — only global (non-channel) events visible.
            qb.push(format!(" AND {col_prefix}channel_id IS NULL"));
        } else {
            qb.push(format!(
                " AND ({col_prefix}channel_id IS NULL OR {col_prefix}channel_id IN ("
            ));
            let mut sep = qb.separated(", ");
            for ch in ch_ids {
                sep.push_bind(*ch);
            }
            qb.push("))");
        }
    }

    if let Some(ks) = q.kinds.as_deref().filter(|k| !k.is_empty()) {
        qb.push(format!(" AND {col_prefix}kind IN ("));
        let mut sep = qb.separated(", ");
        for k in ks {
            sep.push_bind(*k);
        }
        qb.push(")");
    }

    if let Some(ref pk) = q.pubkey {
        qb.push(format!(" AND {col_prefix}pubkey = "))
            .push_bind(pk.clone());
    }

    // Multi-author IN pushdown (mutually exclusive with single pubkey in practice).
    if let Some(ref authors) = q.authors {
        if !authors.is_empty() {
            qb.push(format!(" AND {col_prefix}pubkey IN ("));
            let mut sep = qb.separated(", ");
            for a in authors {
                sep.push_bind(a.clone());
            }
            qb.push(")");
        }
    }

    // Multi-id IN pushdown.
    if let Some(ref ids) = q.ids {
        if !ids.is_empty() {
            qb.push(format!(" AND {col_prefix}id IN ("));
            let mut sep = qb.separated(", ");
            for id in ids {
                sep.push_bind(id.clone());
            }
            qb.push(")");
        }
    }

    // e-tag pushdown via JSONB containment: tags @> '[["e","<hex>"]]'.
    // Multiple e-tags use OR (any match). No GIN index yet — acceptable at
    // current scale; add `CREATE INDEX ... USING gin(tags)` if this becomes hot.
    if let Some(ref e_tags) = q.e_tags {
        if !e_tags.is_empty() {
            qb.push(" AND (");
            for (i, hex_id) in e_tags.iter().enumerate() {
                if i > 0 {
                    qb.push(" OR ");
                }
                // Build the JSONB literal: [["e","<hex>"]]
                let containment = serde_json::json!([["e", hex_id]]);
                qb.push(format!("{col_prefix}tags @> "));
                qb.push_bind(containment);
            }
            qb.push(")");
        }
    }

    if let Some(s) = q.since {
        qb.push(format!(" AND {col_prefix}created_at >= "))
            .push_bind(s);
    }
    if let Some(u) = q.until {
        if let Some(ref bid) = q.before_id {
            // Composite keyset cursor for stable pagination.
            // With ORDER BY created_at DESC, id ASC, "next page" means:
            //   created_at < cursor_ts OR (created_at = cursor_ts AND id > cursor_id)
            qb.push(format!(" AND ({col_prefix}created_at < "));
            qb.push_bind(u);
            qb.push(format!(" OR ({col_prefix}created_at = "));
            qb.push_bind(u);
            qb.push(format!(" AND {col_prefix}id > "));
            qb.push_bind(bid.clone());
            qb.push("))");
        } else {
            qb.push(format!(" AND {col_prefix}created_at <= "))
                .push_bind(u);
        }
    }

    if let Some(ref d) = q.d_tag {
        qb.push(format!(" AND {col_prefix}d_tag = "))
            .push_bind(d.clone());
    } else if let Some(ref ds) = q.d_tags {
        if !ds.is_empty() {
            qb.push(format!(" AND {col_prefix}d_tag IN ("));
            let mut sep = qb.separated(", ");
            for d in ds {
                sep.push_bind(d.clone());
            }
            qb.push(")");
        }
    }

    // Composite ordering for deterministic pagination across ALL callers of
    // query_events (WebSocket REQ, REST endpoints, canvas, notes, etc.).
    // The `id ASC` tiebreaker ensures stable results when events share the
    // same second.  No existing index covers this trailing column — Postgres
    // sorts in memory, which is fine at current scale.  If query performance
    // degrades, add a composite index like `(pubkey, kind, created_at DESC, id ASC)`.
    qb.push(format!(
        " ORDER BY {col_prefix}created_at DESC, {col_prefix}id ASC LIMIT "
    ));
    qb.push_bind(limit_val);
    qb.push(" OFFSET ").push_bind(offset_val);

    let rows = qb.build().fetch_all(pool).await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        if let Some(ev) = row_to_stored_event(row)? {
            out.push(ev);
        }
    }
    Ok(out)
}

pub(crate) fn row_to_stored_event(row: sqlx::postgres::PgRow) -> Result<Option<StoredEvent>> {
    let id_bytes: Vec<u8> = row.try_get("id")?;
    let pubkey_bytes: Vec<u8> = row.try_get("pubkey")?;
    let created_at: DateTime<Utc> = row.try_get("created_at")?;
    let kind_i32: i32 = row.try_get("kind")?;
    let tags_json: serde_json::Value = row.try_get("tags")?;
    let content: String = row.try_get("content")?;
    let sig_bytes: Vec<u8> = row.try_get("sig")?;
    let received_at: DateTime<Utc> = row.try_get("received_at")?;

    let channel_id: Option<Uuid> = row.try_get("channel_id")?;

    // kind is stored as i32 (Postgres INT) but Nostr uses u16. Values > 65535 are corrupt.
    let kind_u16 = u16::try_from(kind_i32)
        .map_err(|_| DbError::InvalidData(format!("kind out of u16 range: {kind_i32}")))?;

    let event_json = serde_json::json!({
        "id": hex::encode(&id_bytes),
        "pubkey": hex::encode(&pubkey_bytes),
        "created_at": created_at.timestamp(),
        "kind": kind_u16,
        "tags": tags_json,
        "content": content,
        "sig": hex::encode(&sig_bytes),
    });

    // Avoid the Value → String → parse round-trip: deserialize directly from the Value.
    let event: nostr::Event = match serde_json::from_value(event_json) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("failed to reconstruct event from DB row: {e}");
            return Ok(None);
        }
    };

    Ok(Some(StoredEvent::with_received_at(
        event,
        received_at,
        channel_id,
        true,
    )))
}

/// Count events matching the given query parameters (NIP-45 COUNT support).
///
/// Uses the same filter logic as `query_events` but returns only the count.
pub async fn count_events(pool: &PgPool, q: &EventQuery) -> Result<i64> {
    // Empty list means "match nothing" — return 0 immediately.
    if q.kinds.as_deref().is_some_and(|k| k.is_empty()) {
        return Ok(0);
    }
    if q.authors.as_deref().is_some_and(|a| a.is_empty()) {
        return Ok(0);
    }
    if q.ids.as_deref().is_some_and(|i| i.is_empty()) {
        return Ok(0);
    }
    if q.e_tags.as_deref().is_some_and(|e| e.is_empty()) {
        return Ok(0);
    }

    let mut qb: QueryBuilder<sqlx::Postgres> = if let Some(ref p_hex) = q.p_tag_hex {
        let mut b = QueryBuilder::new(
            "SELECT COUNT(*) as cnt FROM events e \
             INNER JOIN event_mentions m ON e.id = m.event_id \
             WHERE e.deleted_at IS NULL AND m.pubkey_hex = ",
        );
        b.push_bind(p_hex.to_ascii_lowercase());
        b
    } else {
        QueryBuilder::new("SELECT COUNT(*) as cnt FROM events WHERE deleted_at IS NULL")
    };

    let col_prefix = if q.p_tag_hex.is_some() { "e." } else { "" };

    if let Some(ch) = q.channel_id {
        qb.push(format!(" AND {col_prefix}channel_id = "))
            .push_bind(ch);
    } else if q.global_only {
        qb.push(format!(" AND {col_prefix}channel_id IS NULL"));
    }

    // Multi-channel IN pushdown for COUNT: restrict to accessible channels + global.
    // SECURITY: Some(empty vec) = no channel access → global events only.
    if let Some(ref ch_ids) = q.channel_ids {
        if ch_ids.is_empty() {
            qb.push(format!(" AND {col_prefix}channel_id IS NULL"));
        } else {
            qb.push(format!(
                " AND ({col_prefix}channel_id IS NULL OR {col_prefix}channel_id IN ("
            ));
            let mut sep = qb.separated(", ");
            for ch in ch_ids {
                sep.push_bind(*ch);
            }
            qb.push("))");
        }
    }

    if let Some(ks) = q.kinds.as_deref().filter(|k| !k.is_empty()) {
        qb.push(format!(" AND {col_prefix}kind IN ("));
        let mut sep = qb.separated(", ");
        for k in ks {
            sep.push_bind(*k);
        }
        qb.push(")");
    }

    if let Some(ref pk) = q.pubkey {
        qb.push(format!(" AND {col_prefix}pubkey = "))
            .push_bind(pk.clone());
    }

    if let Some(ref authors) = q.authors {
        if !authors.is_empty() {
            qb.push(format!(" AND {col_prefix}pubkey IN ("));
            let mut sep = qb.separated(", ");
            for a in authors {
                sep.push_bind(a.clone());
            }
            qb.push(")");
        }
    }

    if let Some(ref ids) = q.ids {
        if !ids.is_empty() {
            qb.push(format!(" AND {col_prefix}id IN ("));
            let mut sep = qb.separated(", ");
            for id in ids {
                sep.push_bind(id.clone());
            }
            qb.push(")");
        }
    }

    if let Some(ref e_tags) = q.e_tags {
        if !e_tags.is_empty() {
            qb.push(" AND (");
            for (i, hex_id) in e_tags.iter().enumerate() {
                if i > 0 {
                    qb.push(" OR ");
                }
                let containment = serde_json::json!([["e", hex_id]]);
                qb.push(format!("{col_prefix}tags @> "));
                qb.push_bind(containment);
            }
            qb.push(")");
        }
    }

    if let Some(s) = q.since {
        qb.push(format!(" AND {col_prefix}created_at >= "))
            .push_bind(s);
    }
    if let Some(u) = q.until {
        qb.push(format!(" AND {col_prefix}created_at <= "))
            .push_bind(u);
    }

    if let Some(ref d) = q.d_tag {
        qb.push(format!(" AND {col_prefix}d_tag = "))
            .push_bind(d.clone());
    } else if let Some(ref ds) = q.d_tags {
        if !ds.is_empty() {
            qb.push(format!(" AND {col_prefix}d_tag IN ("));
            let mut sep = qb.separated(", ");
            for d in ds {
                sep.push_bind(d.clone());
            }
            qb.push(")");
        }
    }

    let row = qb.build().fetch_one(pool).await?;
    let cnt: i64 = row.try_get("cnt")?;

    Ok(cnt)
}

/// Soft-delete an event by setting `deleted_at = NOW()`.
///
/// Returns `Ok(true)` if the event was deleted, `Ok(false)` if already deleted
/// or not found. Callers are responsible for decrementing thread reply counts
/// when the deleted event is a thread reply.
pub async fn soft_delete_event(pool: &PgPool, event_id: &[u8]) -> Result<bool> {
    let result =
        sqlx::query("UPDATE events SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL")
            .bind(event_id)
            .execute(pool)
            .await?;

    Ok(result.rows_affected() > 0)
}

/// Soft-delete the live row for an addressable coordinate
/// `(kind, pubkey, d_tag)` — the NIP-33 replacement key.
///
/// Used by `handle_a_tag_deletion` to honour NIP-09 a-tag deletions for any
/// parameterized-replaceable kind. The WHERE clause mirrors
/// `replace_parameterized_event` so the coordinate semantics stay consistent:
/// `channel_id` is intentionally NOT in the key (NIP-33 replacement is global
/// per the spec — `channel_id` is stored for query scoping, not identity).
///
/// Returns `Ok(true)` if a row was deleted, `Ok(false)` if no live row matched
/// (already deleted, or never existed).
pub async fn soft_delete_by_coordinate(
    pool: &PgPool,
    kind: i32,
    pubkey: &[u8],
    d_tag: &str,
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE events SET deleted_at = NOW() \
         WHERE kind = $1 AND pubkey = $2 AND d_tag = $3 AND deleted_at IS NULL",
    )
    .bind(kind)
    .bind(pubkey)
    .bind(d_tag)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Atomically soft-delete an event and decrement thread reply counters.
///
/// Wraps the delete + counter update in a single transaction so a crash between
/// them cannot leave counters permanently inflated. Returns `Ok(true)` if the
/// event was deleted this call.
pub async fn soft_delete_event_and_update_thread(
    pool: &PgPool,
    event_id: &[u8],
    parent_event_id: Option<&[u8]>,
    root_event_id: Option<&[u8]>,
) -> Result<bool> {
    let mut tx = pool.begin().await?;

    let result =
        sqlx::query("UPDATE events SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL")
            .bind(event_id)
            .execute(&mut *tx)
            .await?;

    let deleted = result.rows_affected() > 0;

    if deleted {
        if let Some(pid) = parent_event_id {
            sqlx::query(
                "UPDATE thread_metadata \
                 SET reply_count = GREATEST(reply_count - 1, 0) \
                 WHERE event_id = $1",
            )
            .bind(pid)
            .execute(&mut *tx)
            .await?;

            if let Some(root_id) = root_event_id {
                sqlx::query(
                    "UPDATE thread_metadata \
                     SET descendant_count = GREATEST(descendant_count - 1, 0) \
                     WHERE event_id = $1",
                )
                .bind(root_id)
                .execute(&mut *tx)
                .await?;
            }
        }
    }

    tx.commit().await?;
    Ok(deleted)
}

/// Returns the `created_at` timestamp of the most recent non-deleted event in a channel.
pub async fn get_last_message_at(
    pool: &PgPool,
    channel_id: uuid::Uuid,
) -> Result<Option<DateTime<Utc>>> {
    let row = sqlx::query(
        "SELECT created_at FROM events \
         WHERE channel_id = $1 AND deleted_at IS NULL \
         ORDER BY created_at DESC LIMIT 1",
    )
    .bind(channel_id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(r) => Ok(Some(r.try_get("created_at")?)),
        None => Ok(None),
    }
}

/// Bulk-fetch the most recent `created_at` for a set of channel IDs.
///
/// Returns a map of `channel_id → last_message_at`. Channels with no events are omitted.
/// Single query regardless of input size.
pub async fn get_last_message_at_bulk(
    pool: &PgPool,
    channel_ids: &[uuid::Uuid],
) -> Result<std::collections::HashMap<uuid::Uuid, DateTime<Utc>>> {
    if channel_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let mut qb: QueryBuilder<sqlx::Postgres> = QueryBuilder::new(
        "SELECT channel_id, MAX(created_at) as last_at FROM events \
         WHERE deleted_at IS NULL AND channel_id IN (",
    );
    let mut sep = qb.separated(", ");
    for id in channel_ids {
        sep.push_bind(*id);
    }
    qb.push(") GROUP BY channel_id");

    let rows = qb.build().fetch_all(pool).await?;

    let mut map = std::collections::HashMap::with_capacity(rows.len());
    for row in rows {
        let id: Uuid = row.try_get("channel_id")?;
        let last_at: DateTime<Utc> = row.try_get("last_at")?;
        map.insert(id, last_at);
    }
    Ok(map)
}

/// Fetches a single non-deleted event by its raw 32-byte ID.
///
/// Returns `None` if the event does not exist or has been soft-deleted.
/// Use [`get_event_by_id_including_deleted`] when you need to inspect
/// tombstoned rows (e.g. audit, undelete).
pub async fn get_event_by_id(pool: &PgPool, id_bytes: &[u8]) -> Result<Option<StoredEvent>> {
    let row = sqlx::query(
        "SELECT id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id \
         FROM events WHERE id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",
    )
    .bind(id_bytes)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(r) => row_to_stored_event(r),
        None => Ok(None),
    }
}

/// Fetches the latest global (non-channel, `channel_id IS NULL`) replaceable event
/// for a (kind, pubkey) pair.
///
/// Uses canonical NIP-16 ordering: `created_at DESC, id ASC LIMIT 1`.
/// This matches the write path's tie-breaking logic and handles historical
/// duplicate survivors where multiple live rows share the same timestamp.
pub async fn get_latest_global_replaceable(
    pool: &PgPool,
    kind: i32,
    pubkey_bytes: &[u8],
) -> Result<Option<StoredEvent>> {
    let row = sqlx::query(
        "SELECT id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id \
         FROM events \
         WHERE kind = $1 AND pubkey = $2 AND channel_id IS NULL AND deleted_at IS NULL \
         ORDER BY created_at DESC, id ASC \
         LIMIT 1",
    )
    .bind(kind)
    .bind(pubkey_bytes)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(r) => row_to_stored_event(r),
        None => Ok(None),
    }
}

/// Fetches a single event by its raw 32-byte ID, **including soft-deleted rows**.
///
/// Most callers should use [`get_event_by_id`] instead. This variant is needed
/// when the caller must distinguish "never existed" from "was deleted" (e.g.
/// audit trails, compliance queries).
pub async fn get_event_by_id_including_deleted(
    pool: &PgPool,
    id_bytes: &[u8],
) -> Result<Option<StoredEvent>> {
    let row = sqlx::query(
        "SELECT id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id \
         FROM events WHERE id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(id_bytes)
    .fetch_optional(pool)
    .await?;

    match row {
        Some(r) => row_to_stored_event(r),
        None => Ok(None),
    }
}

/// Batch-fetch non-deleted events by their raw 32-byte IDs.
///
/// Returns events in arbitrary order — callers reorder as needed.
/// Uses a single `WHERE id IN (...)` query regardless of input size.
pub async fn get_events_by_ids(pool: &PgPool, ids: &[&[u8]]) -> Result<Vec<StoredEvent>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    debug_assert!(ids.len() <= 500, "batch fetch should be bounded by caller");

    let mut qb: QueryBuilder<sqlx::Postgres> = QueryBuilder::new(
        "SELECT id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id \
         FROM events WHERE deleted_at IS NULL AND id IN (",
    );
    let mut sep = qb.separated(", ");
    for id in ids {
        sep.push_bind(id.to_vec());
    }
    qb.push(")");

    let rows = qb.build().fetch_all(pool).await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        if let Some(ev) = row_to_stored_event(row)? {
            out.push(ev);
        }
    }
    Ok(out)
}

/// Parameters for [`insert_event_with_thread_metadata`].
#[derive(Debug)]
pub struct ThreadMetadataParams<'a> {
    /// The Nostr event ID of this message.
    pub event_id: &'a [u8],
    /// When the event was created.
    pub event_created_at: DateTime<Utc>,
    /// The channel this event belongs to.
    pub channel_id: Uuid,
    /// Event ID of the direct parent, if this is a reply.
    pub parent_event_id: Option<&'a [u8]>,
    /// When the parent event was created.
    pub parent_event_created_at: Option<DateTime<Utc>>,
    /// Event ID of the thread root, if this is a nested reply.
    pub root_event_id: Option<&'a [u8]>,
    /// When the root event was created.
    pub root_event_created_at: Option<DateTime<Utc>>,
    /// Nesting depth (root = 0).
    pub depth: i32,
    /// Whether this reply is broadcast to the channel timeline.
    pub broadcast: bool,
}

/// Atomically insert an event AND its thread metadata in a single transaction.
///
/// This prevents the race condition where a concurrent delete between separate
/// `insert_event` and `insert_thread_metadata` calls could leave reply counters
/// permanently inflated (the metadata insert increments counters for an event
/// that was already soft-deleted).
///
/// Returns `(StoredEvent, was_inserted)`.
pub async fn insert_event_with_thread_metadata(
    pool: &PgPool,
    event: &Event,
    channel_id: Option<Uuid>,
    thread_meta: Option<ThreadMetadataParams<'_>>,
) -> Result<(StoredEvent, bool)> {
    let kind_u16 = event.kind.as_u16();
    let kind_u32 = u32::from(kind_u16);

    if kind_u32 == KIND_AUTH {
        return Err(DbError::AuthEventRejected);
    }
    if is_ephemeral(kind_u32) {
        return Err(DbError::EphemeralEventRejected(kind_u16));
    }

    let id_bytes = event.id.as_bytes();
    let pubkey_bytes = event.pubkey.to_bytes();
    let sig_bytes = event.sig.serialize();
    let tags_json = serde_json::to_value(&event.tags)?;
    let kind_i32 = event_kind_i32(event);
    let created_at_secs = event.created_at.as_secs() as i64;
    let created_at = DateTime::from_timestamp(created_at_secs, 0)
        .ok_or(DbError::InvalidTimestamp(created_at_secs))?;
    let received_at = Utc::now();
    let d_tag = extract_d_tag(event);
    let not_before = extract_not_before(event);
    let mut tx = pool.begin().await?;

    let result = sqlx::query(
        r#"
        INSERT INTO events (id, pubkey, created_at, kind, tags, content, sig, received_at, channel_id, d_tag, not_before)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(id_bytes.as_slice())
    .bind(pubkey_bytes.as_slice())
    .bind(created_at)
    .bind(kind_i32)
    .bind(&tags_json)
    .bind(&event.content)
    .bind(sig_bytes.as_slice())
    .bind(received_at)
    .bind(channel_id)
    .bind(d_tag.as_deref())
    .bind(not_before)
    .execute(&mut *tx)
    .await?;

    let was_inserted = result.rows_affected() > 0;

    if was_inserted {
        if let Some(ref meta) = thread_meta {
            let broadcast_val: bool = meta.broadcast;

            let tm_result = sqlx::query(
                r#"
                INSERT INTO thread_metadata
                    (event_created_at, event_id, channel_id,
                     parent_event_id, parent_event_created_at,
                     root_event_id, root_event_created_at,
                     depth, broadcast)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT DO NOTHING
                "#,
            )
            .bind(meta.event_created_at)
            .bind(meta.event_id)
            .bind(meta.channel_id)
            .bind(meta.parent_event_id)
            .bind(meta.parent_event_created_at)
            .bind(meta.root_event_id)
            .bind(meta.root_event_created_at)
            .bind(meta.depth)
            .bind(broadcast_val)
            .execute(&mut *tx)
            .await?;

            // Only bump reply counts if the metadata row was actually inserted.
            if tm_result.rows_affected() > 0 {
                if let Some(pid) = meta.parent_event_id {
                    // Ensure the parent has a thread_metadata row so the UPDATE
                    // below has something to hit. Root (depth=0) messages don't
                    // get a row on first insert, so we create a stub here.
                    let parent_ts = meta
                        .parent_event_created_at
                        .unwrap_or(meta.event_created_at);
                    sqlx::query(
                        r#"
                        INSERT INTO thread_metadata
                            (event_created_at, event_id, channel_id,
                             parent_event_id, parent_event_created_at,
                             root_event_id, root_event_created_at,
                             depth, broadcast)
                        VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, 0, false)
                        ON CONFLICT DO NOTHING
                        "#,
                    )
                    .bind(parent_ts)
                    .bind(pid)
                    .bind(meta.channel_id)
                    .execute(&mut *tx)
                    .await?;

                    // Ensure the root also has a row (may differ from parent for nested replies).
                    if let Some(root_id) = meta.root_event_id {
                        if root_id != pid {
                            let root_ts =
                                meta.root_event_created_at.unwrap_or(meta.event_created_at);
                            sqlx::query(
                                r#"
                                INSERT INTO thread_metadata
                                    (event_created_at, event_id, channel_id,
                                     parent_event_id, parent_event_created_at,
                                     root_event_id, root_event_created_at,
                                     depth, broadcast)
                                VALUES ($1, $2, $3, NULL, NULL, NULL, NULL, 0, false)
                                ON CONFLICT DO NOTHING
                                "#,
                            )
                            .bind(root_ts)
                            .bind(root_id)
                            .bind(meta.channel_id)
                            .execute(&mut *tx)
                            .await?;
                        }
                    }

                    sqlx::query(
                        r#"
                        UPDATE thread_metadata
                        SET reply_count = reply_count + 1, last_reply_at = NOW()
                        WHERE event_id = $1
                        "#,
                    )
                    .bind(pid)
                    .execute(&mut *tx)
                    .await?;

                    if let Some(root_id) = meta.root_event_id {
                        sqlx::query(
                            r#"
                            UPDATE thread_metadata
                            SET descendant_count = descendant_count + 1
                            WHERE event_id = $1
                            "#,
                        )
                        .bind(root_id)
                        .execute(&mut *tx)
                        .await?;
                    }
                }
            }
        }
    }

    tx.commit().await?;

    Ok((
        StoredEvent::with_received_at(event.clone(), received_at, channel_id, true),
        was_inserted,
    ))
}

/// A due reminder row returned by [`query_due_reminders`].
#[derive(Debug)]
pub struct DueReminder {
    /// The event's raw ID bytes.
    pub id: Vec<u8>,
    /// The event's pubkey bytes.
    pub pubkey: Vec<u8>,
    /// The event's `created_at` timestamp.
    pub created_at: DateTime<Utc>,
    /// The event's kind (always 30300).
    pub kind: i32,
    /// The event's JSONB tags.
    pub tags: serde_json::Value,
    /// The event's encrypted content.
    pub content: String,
    /// The event's signature bytes.
    pub sig: Vec<u8>,
    /// The channel ID (always None for reminders — global events).
    pub channel_id: Option<Uuid>,
}

/// Query due reminders: latest-per-address `kind:30300` rows where
/// `not_before <= now`, `deleted_at IS NULL`, `delivered_at IS NULL`.
///
/// Returns the latest head per `(pubkey, d_tag)` using canonical NIP-16
/// ordering (`created_at DESC, id ASC`).
pub async fn query_due_reminders(
    pool: &PgPool,
    now_secs: i64,
    batch_limit: i64,
) -> Result<Vec<DueReminder>> {
    let kind_i32 = KIND_EVENT_REMINDER as i32;
    let rows = sqlx::query(
        r#"
        SELECT DISTINCT ON (pubkey, d_tag)
            id, pubkey, created_at, kind, tags, content, sig, channel_id
        FROM events
        WHERE kind = $1
          AND not_before IS NOT NULL
          AND not_before <= $2
          AND deleted_at IS NULL
          AND delivered_at IS NULL
        ORDER BY pubkey, d_tag, created_at DESC, id ASC
        LIMIT $3
        "#,
    )
    .bind(kind_i32)
    .bind(now_secs)
    .bind(batch_limit)
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| DueReminder {
            id: row.get("id"),
            pubkey: row.get("pubkey"),
            created_at: row.get("created_at"),
            kind: row.get("kind"),
            tags: row.get("tags"),
            content: row.get("content"),
            sig: row.get("sig"),
            channel_id: row.get("channel_id"),
        })
        .collect();

    Ok(results)
}

/// Atomically claim a due reminder for delivery. Returns `Some(stamp)` if
/// this caller won the claim (the `delivered_at` value it wrote), or `None`
/// if another pod already claimed it. Mirrors the reaper's `archived_at IS
/// NULL` guard for cross-pod idempotency.
///
/// The returned stamp is the value the caller must pass to
/// [`rollback_reminder_claim`] if a subsequent side effect (e.g. Redis
/// publish) fails — the rollback guards on `delivered_at = stamp` so a
/// stale rollback can never clobber a fresh winner's claim.
///
/// The stamp is `Utc::now().timestamp_micros()` (microsecond epoch). Using
/// whole seconds would let two claims in the same wall-clock second share
/// a stamp and defeat the rollback guard — the very ABA bug the guard
/// exists to prevent. Microseconds fit in `BIGINT` and no other reader
/// interprets `delivered_at` as a whole-seconds count (it's only ever
/// checked `IS NULL`/`IS NOT NULL`).
pub async fn claim_due_reminder(
    pool: &PgPool,
    event_id: &[u8],
    event_created_at: DateTime<Utc>,
) -> Result<Option<i64>> {
    let stamp = Utc::now().timestamp_micros();
    let result = sqlx::query(
        r#"
        UPDATE events
        SET delivered_at = $1
        WHERE created_at = $2 AND id = $3 AND delivered_at IS NULL
        "#,
    )
    .bind(stamp)
    .bind(event_created_at)
    .bind(event_id)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        Ok(Some(stamp))
    } else {
        Ok(None)
    }
}

/// Best-effort rollback of a prior winning [`claim_due_reminder`] call.
///
/// Used when the caller won the claim but its follow-on side effect (e.g.
/// Redis publish) failed and it wants the reminder to be re-tried on a
/// subsequent scheduler tick. The `stamp` argument MUST be the value
/// returned by the original `claim_due_reminder` call — the SQL guard
/// `delivered_at = $stamp` is what prevents an ABA hazard where another pod
/// has since rewon the claim. Returns `Ok(true)` if the row was reverted,
/// `Ok(false)` if not (someone else holds a live claim now; leave it alone
/// — bounded duplicate fan-out is the worst case).
pub async fn rollback_reminder_claim(
    pool: &PgPool,
    event_id: &[u8],
    event_created_at: DateTime<Utc>,
    stamp: i64,
) -> Result<bool> {
    let result = sqlx::query(
        r#"
        UPDATE events
        SET delivered_at = NULL
        WHERE created_at = $1 AND id = $2 AND delivered_at = $3
        "#,
    )
    .bind(event_created_at)
    .bind(event_id)
    .bind(stamp)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn make_event_with_kind_and_tags(kind: u16, tags: Vec<Tag>) -> nostr::Event {
        let keys = Keys::generate();
        EventBuilder::new(Kind::Custom(kind), "test")
            .tags(tags)
            .sign_with_keys(&keys)
            .expect("sign")
    }

    #[test]
    fn extract_d_tag_from_nip33_event() {
        let event = make_event_with_kind_and_tags(
            30023,
            vec![Tag::parse(["d", "my-article-slug"]).unwrap()],
        );
        assert_eq!(extract_d_tag(&event), Some("my-article-slug".to_string()));
    }

    #[test]
    fn extract_d_tag_first_d_wins() {
        let event = make_event_with_kind_and_tags(
            30023,
            vec![
                Tag::parse(["d", "first"]).unwrap(),
                Tag::parse(["d", "second"]).unwrap(),
            ],
        );
        assert_eq!(extract_d_tag(&event), Some("first".to_string()));
    }

    #[test]
    fn extract_d_tag_missing_becomes_empty_string() {
        // NIP-33: "if there is no d tag, the d tag is considered to be ''"
        let event =
            make_event_with_kind_and_tags(30023, vec![Tag::parse(["p", "abc123"]).unwrap()]);
        assert_eq!(extract_d_tag(&event), Some(String::new()));
    }

    #[test]
    fn extract_d_tag_empty_value_preserved() {
        let event = make_event_with_kind_and_tags(30023, vec![Tag::parse(["d", ""]).unwrap()]);
        assert_eq!(extract_d_tag(&event), Some(String::new()));
    }

    #[test]
    fn extract_d_tag_non_nip33_returns_none() {
        // kind:1 (text note) — not parameterized replaceable
        let event =
            make_event_with_kind_and_tags(1, vec![Tag::parse(["d", "should-be-ignored"]).unwrap()]);
        assert_eq!(extract_d_tag(&event), None);
    }

    #[test]
    fn extract_d_tag_nip29_group_metadata() {
        // kind:39000 is in the 30000–39999 range — d_tag should be extracted
        let event =
            make_event_with_kind_and_tags(39000, vec![Tag::parse(["d", "group-id"]).unwrap()]);
        assert_eq!(extract_d_tag(&event), Some("group-id".to_string()));
    }

    #[test]
    fn extract_d_tag_boundary_kinds() {
        // kind:29999 — just below range
        let below = make_event_with_kind_and_tags(29999, vec![Tag::parse(["d", "val"]).unwrap()]);
        assert_eq!(extract_d_tag(&below), None);

        // kind:30000 — lower bound
        let lower = make_event_with_kind_and_tags(30000, vec![Tag::parse(["d", "val"]).unwrap()]);
        assert_eq!(extract_d_tag(&lower), Some("val".to_string()));

        // kind:39999 — upper bound
        let upper = make_event_with_kind_and_tags(39999, vec![Tag::parse(["d", "val"]).unwrap()]);
        assert_eq!(extract_d_tag(&upper), Some("val".to_string()));

        // kind:40000 — just above range
        let above = make_event_with_kind_and_tags(40000, vec![Tag::parse(["d", "val"]).unwrap()]);
        assert_eq!(extract_d_tag(&above), None);
    }

    #[test]
    fn extract_d_tag_single_element_d_tag_ignored() {
        // A d tag with only one element (no value) should not match — parts.len() < 2
        let event = make_event_with_kind_and_tags(30023, vec![Tag::parse(["d"]).unwrap()]);
        // No d tag with a value → empty string per NIP-33
        assert_eq!(extract_d_tag(&event), Some(String::new()));
    }

    #[test]
    fn extract_d_tag_preserves_full_value() {
        // extract_d_tag returns the full value — length enforcement is at the ingest layer.
        let long_val = "x".repeat(2048);
        let event =
            make_event_with_kind_and_tags(30023, vec![Tag::parse(["d", &long_val]).unwrap()]);
        let result = extract_d_tag(&event).unwrap();
        assert_eq!(result.len(), 2048);
        assert_eq!(result, long_val);
    }

    #[test]
    fn extract_not_before_from_reminder() {
        let event = make_event_with_kind_and_tags(
            KIND_EVENT_REMINDER as u16,
            vec![Tag::parse(["not_before", "1717000000"]).unwrap()],
        );
        assert_eq!(extract_not_before(&event), Some(1_717_000_000));
    }

    #[test]
    fn extract_not_before_absent_returns_none() {
        // A bookmark/terminal reminder carries no `not_before` tag.
        let event = make_event_with_kind_and_tags(
            KIND_EVENT_REMINDER as u16,
            vec![Tag::parse(["d", "abc"]).unwrap()],
        );
        assert_eq!(extract_not_before(&event), None);
    }

    #[test]
    fn extract_not_before_non_reminder_returns_none() {
        // Only kind:30300 materializes `not_before`; other kinds stay NULL.
        let event = make_event_with_kind_and_tags(
            30023,
            vec![Tag::parse(["not_before", "1717000000"]).unwrap()],
        );
        assert_eq!(extract_not_before(&event), None);
    }

    #[test]
    fn extract_not_before_non_numeric_returns_none() {
        // Malformed values are rejected by ingest; materialization just skips them.
        let event = make_event_with_kind_and_tags(
            KIND_EVENT_REMINDER as u16,
            vec![Tag::parse(["not_before", "not-a-number"]).unwrap()],
        );
        assert_eq!(extract_not_before(&event), None);
    }
}

/// Live-PG dedup tests for the NIP-ER reminder claim/rollback API.
///
/// Reuses the `#[ignore = "requires Postgres"]` + serial-on-fresh-schema
/// convention Sami's F1/F4 and Quinn's engine-layer audit landed (see
/// `crates/buzz-workflow/src/lib.rs` and `crates/buzz-db/src/workflow.rs`).
/// These pin the §5c reminder-scheduler invariants that the `claim FIRST →
/// publish SECOND → rollback on publish failure` shape in
/// `buzz-relay/src/main.rs` depends on.
#[cfg(test)]
mod claim_dedup_tests {
    use super::*;
    use buzz_core::kind::KIND_EVENT_REMINDER;
    use sqlx::PgPool;

    const TEST_DB_URL: &str = "postgres://buzz:buzz_dev@localhost:5432/buzz";

    async fn setup_pool() -> PgPool {
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .unwrap_or_else(|_| TEST_DB_URL.to_owned());

        PgPool::connect(&database_url)
            .await
            .expect("connect to test DB")
    }

    /// Insert a due reminder row directly: minimal columns to satisfy NOT
    /// NULL + the predicates `query_due_reminders` filters on
    /// (`kind = KIND_EVENT_REMINDER`, `not_before <= now`,
    /// `deleted_at IS NULL`, `delivered_at IS NULL`). Returns (id_bytes,
    /// created_at) — the composite PK the claim API targets.
    async fn insert_due_reminder(pool: &PgPool) -> (Vec<u8>, DateTime<Utc>) {
        // 32-byte id: two uuids concatenated for uniqueness.
        let id_bytes: Vec<u8> = Uuid::new_v4()
            .as_bytes()
            .iter()
            .chain(Uuid::new_v4().as_bytes().iter())
            .copied()
            .collect();
        let pubkey: Vec<u8> = vec![0xb1; 32];
        let created_at = Utc::now();
        let not_before = created_at.timestamp() - 1; // already due.

        sqlx::query(
            r#"
            INSERT INTO events
                (id, pubkey, created_at, kind, tags, content, sig, not_before)
            VALUES ($1, $2, $3, $4, '[]'::jsonb, '', $5, $6)
            "#,
        )
        .bind(&id_bytes)
        .bind(&pubkey)
        .bind(created_at)
        .bind(KIND_EVENT_REMINDER as i32)
        .bind(vec![0u8; 64])
        .bind(not_before)
        .execute(pool)
        .await
        .expect("insert due reminder");

        (id_bytes, created_at)
    }

    /// (§5c acceptance) Two concurrent `claim_due_reminder` calls for the
    /// same reminder must serialize: exactly one returns `Some(stamp)`, the
    /// other `None`. This is the cross-pod invariant the reorder relies on
    /// — without it the "claim first" ordering would still allow duplicate
    /// publishes.
    ///
    /// The DB-layer mechanism is `UPDATE ... WHERE delivered_at IS NULL`:
    /// Postgres serializes the row-level write under the partition,
    /// guaranteeing at most one UPDATE flips `delivered_at` from NULL to a
    /// stamp.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn two_concurrent_claims_yield_exactly_one_winner() {
        let pool = setup_pool().await;
        let (id, created_at) = insert_due_reminder(&pool).await;

        let pool_a = pool.clone();
        let id_a = id.clone();
        let pool_b = pool.clone();
        let id_b = id.clone();

        let (a, b) = tokio::join!(
            tokio::spawn(async move { claim_due_reminder(&pool_a, &id_a, created_at).await }),
            tokio::spawn(async move { claim_due_reminder(&pool_b, &id_b, created_at).await }),
        );
        let a = a.unwrap().expect("claim A succeeded");
        let b = b.unwrap().expect("claim B succeeded");

        // Exactly one Some(stamp), exactly one None.
        let winners = [a.is_some(), b.is_some()];
        assert_eq!(
            winners.iter().filter(|w| **w).count(),
            1,
            "exactly one of the two concurrent claims must win: a={a:?}, b={b:?}"
        );

        // A third claim must also lose — the claim row is the dedupe boundary.
        let third = claim_due_reminder(&pool, &id, created_at)
            .await
            .expect("third claim runs");
        assert_eq!(
            third, None,
            "third claim must lose; reminder already claimed"
        );
    }

    /// (§5c acceptance) The publish-failure rollback round-trip: a winner
    /// can revert its own claim with the stamp it was returned, and a
    /// subsequent `claim_due_reminder` then succeeds. This is the path the
    /// scheduler takes when Redis publish fails after a successful claim.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn rollback_with_matching_stamp_reverts_then_reclaim_wins() {
        let pool = setup_pool().await;
        let (id, created_at) = insert_due_reminder(&pool).await;

        let stamp = claim_due_reminder(&pool, &id, created_at)
            .await
            .expect("first claim runs")
            .expect("first claim wins");

        let reverted = rollback_reminder_claim(&pool, &id, created_at, stamp)
            .await
            .expect("rollback runs");
        assert!(reverted, "rollback with matching stamp must revert the row");

        // After rollback `delivered_at` is NULL again — a second claim wins.
        // The second claim's stamp differs from the first's because
        // `timestamp_micros()` distinguishes back-to-back calls; we don't
        // assert that here (the dedicated same-wall-clock-second test below
        // pins that invariant). What matters here is that the second claim
        // returns Some, not None.
        let _stamp_2 = claim_due_reminder(&pool, &id, created_at)
            .await
            .expect("second claim runs")
            .expect("second claim wins after rollback");
    }

    /// (§5c acceptance — the ABA guard, NOT a happy path) The rollback's
    /// `delivered_at = $stamp` guard must reject a stale stamp. Without
    /// this guard, a slow pod could win-rollback-rewon-rollback racing
    /// another pod's later claim and clobber it, producing a silent
    /// duplicate publish window. This test simulates the racy shape by
    /// hand: the first claim sets `delivered_at = stamp1`, the operator
    /// (or a second pod via DB write) replaces it with `stamp2`, and the
    /// first pod's late rollback with `stamp1` must return false WITHOUT
    /// reverting the row.
    ///
    /// Adversarial: drop the `AND delivered_at = $3` guard from
    /// `rollback_reminder_claim` and this test fails — the stale rollback
    /// silently clobbers the live claim.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn rollback_with_stale_stamp_does_not_clobber_live_claim() {
        let pool = setup_pool().await;
        let (id, created_at) = insert_due_reminder(&pool).await;

        let stamp_old = claim_due_reminder(&pool, &id, created_at)
            .await
            .expect("first claim runs")
            .expect("first claim wins");

        // Simulate the row's `delivered_at` advancing (operator manual
        // clear-then-reclaim, or any post-claim mutation). Any distinct
        // value triggers the guard; we use `stamp_old + 1` (1 microsecond
        // later) because the guard compares exact equality and a 1-µs
        // delta is the tightest distinct-stamp shape we can construct.
        let stamp_new = stamp_old + 1;
        sqlx::query(
            r#"
            UPDATE events SET delivered_at = $1
            WHERE created_at = $2 AND id = $3
            "#,
        )
        .bind(stamp_new)
        .bind(created_at)
        .bind(&id)
        .execute(&pool)
        .await
        .expect("advance delivered_at");

        let reverted = rollback_reminder_claim(&pool, &id, created_at, stamp_old)
            .await
            .expect("rollback runs");
        assert!(
            !reverted,
            "rollback with stale stamp must NOT revert — would clobber the live claim"
        );

        // Confirm the row's `delivered_at` is still `stamp_new`, not NULL.
        let current: Option<i64> =
            sqlx::query_scalar("SELECT delivered_at FROM events WHERE created_at = $1 AND id = $2")
                .bind(created_at)
                .bind(&id)
                .fetch_one(&pool)
                .await
                .expect("re-read delivered_at");
        assert_eq!(
            current,
            Some(stamp_new),
            "delivered_at must remain stamp_new — the stale rollback was correctly a no-op"
        );
    }

    /// (§5c acceptance — closes Eva [4]) The realistic ABA window: two
    /// claims that happen in the same wall-clock second must produce
    /// distinct stamps, so a stale rollback from the first cannot match
    /// (and clobber) the live second claim. This pins the actual race —
    /// without microsecond precision, `Utc::now().timestamp()` would
    /// return the same `i64` for both back-to-back claims, the rollback
    /// guard `delivered_at = $stamp_a` would falsely match the live
    /// `delivered_at = stamp_b` row, and the rollback would revert the
    /// live claim. A subsequent publish would then re-claim and re-fire,
    /// producing the silent duplicate-delivery this whole guard exists
    /// to prevent.
    ///
    /// Shape: claim → rollback (round-trip ok) → reclaim. The two real
    /// claims happen at machine speed with no `sleep` — they land in the
    /// same wall-clock second on any modern host. With microsecond
    /// stamps they differ by tens of µs; we assert `stamp_a != stamp_b`.
    /// Then a stale rollback with `stamp_a` against the live `stamp_b`
    /// row must return false.
    ///
    /// Adversarial: revert `claim_due_reminder` to `Utc::now().timestamp()`
    /// (whole seconds). On the same wall-clock second, `stamp_a == stamp_b`,
    /// the `stamp_a != stamp_b` assertion fails, AND the stale rollback
    /// returns true (silently clobbering the live claim). Verified by
    /// hand before commit.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn rollback_under_same_wall_clock_second_does_not_clobber() {
        let pool = setup_pool().await;
        let (id, created_at) = insert_due_reminder(&pool).await;

        // First claim — the "slow pod" whose publish will (notionally) fail.
        let stamp_a = claim_due_reminder(&pool, &id, created_at)
            .await
            .expect("first claim runs")
            .expect("first claim wins");

        // Round-trip the rollback (this is the slow pod's publish-failure
        // path completing successfully — but imagine its `rollback` call
        // hasn't reached the DB yet in the racy version).
        let reverted_a = rollback_reminder_claim(&pool, &id, created_at, stamp_a)
            .await
            .expect("rollback A runs");
        assert!(reverted_a, "first rollback must revert (stamps match)");

        // Second claim immediately after — the "fast pod" that wins next.
        // On the same wall-clock second as the first claim — no sleep.
        let stamp_b = claim_due_reminder(&pool, &id, created_at)
            .await
            .expect("second claim runs")
            .expect("second claim wins after rollback");

        // The forcing assertion: under microsecond stamps these MUST
        // differ. Under the old seconds-granularity bug, `stamp_a ==
        // stamp_b` (machine speed → same second), and this assertion
        // is what fails first when the fix is reverted.
        assert_ne!(
            stamp_a, stamp_b,
            "back-to-back claims must produce distinct stamps — \
             same-stamp collision is the ABA bug Eva [4] flagged. \
             stamp_a={stamp_a}, stamp_b={stamp_b}"
        );

        // Now the racy late rollback: slow pod fires its stale rollback
        // with `stamp_a` against the live `stamp_b` row. Must return
        // false — guard rejects the stale stamp.
        let reverted_stale = rollback_reminder_claim(&pool, &id, created_at, stamp_a)
            .await
            .expect("stale rollback runs");
        assert!(
            !reverted_stale,
            "stale rollback with stamp_a must NOT revert the live stamp_b row"
        );

        // Confirm the row's `delivered_at` is still `stamp_b`, not NULL.
        let current: Option<i64> =
            sqlx::query_scalar("SELECT delivered_at FROM events WHERE created_at = $1 AND id = $2")
                .bind(created_at)
                .bind(&id)
                .fetch_one(&pool)
                .await
                .expect("re-read delivered_at");
        assert_eq!(
            current,
            Some(stamp_b),
            "delivered_at must remain stamp_b — the stale rollback was correctly a no-op"
        );
    }
}
