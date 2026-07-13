//! Relay-level membership persistence (NIP-43).
//!
//! The `relay_members` table is community-scoped: its primary key is
//! `(community_id, pubkey)`. Every read, write, and list is bound to a single
//! `community_id` so that admitting a pubkey to community A never admits it to
//! community B (NIP-43 admission confinement). `pubkey` values are 64-char
//! lowercase hex strings.

use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row as _};

use crate::error::Result;
use crate::CommunityId;

/// A single relay member record.
#[derive(Debug, Clone)]
pub struct RelayMember {
    /// 64-char lowercase hex pubkey.
    pub pubkey: String,
    /// Role: `"owner"`, `"admin"`, or `"member"`.
    pub role: String,
    /// Hex pubkey of who added this member, or `None` for bootstrap entries.
    pub added_by: Option<String>,
    /// When the member was added.
    pub created_at: DateTime<Utc>,
    /// When the record was last updated.
    pub updated_at: DateTime<Utc>,
}

/// Returns `true` if `pubkey` (64-char hex) is a member of `community`.
pub async fn is_relay_member(pool: &PgPool, community: CommunityId, pubkey: &str) -> Result<bool> {
    let row = sqlx::query("SELECT 1 FROM relay_members WHERE community_id = $1 AND pubkey = $2")
        .bind(community.as_uuid())
        .bind(pubkey)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// Returns the relay member record for `pubkey` in `community`, or `None`.
pub async fn get_relay_member(
    pool: &PgPool,
    community: CommunityId,
    pubkey: &str,
) -> Result<Option<RelayMember>> {
    let row = sqlx::query(
        "SELECT pubkey, role, added_by, created_at, updated_at \
         FROM relay_members WHERE community_id = $1 AND pubkey = $2",
    )
    .bind(community.as_uuid())
    .bind(pubkey)
    .fetch_optional(pool)
    .await?;

    row.map(|r| -> std::result::Result<RelayMember, sqlx::Error> {
        Ok(RelayMember {
            pubkey: r.try_get("pubkey")?,
            role: r.try_get("role")?,
            added_by: r.try_get("added_by")?,
            created_at: r.try_get("created_at")?,
            updated_at: r.try_get("updated_at")?,
        })
    })
    .transpose()
    .map_err(crate::error::DbError::from)
}

/// Returns all relay members of `community` ordered by `created_at` ascending.
pub async fn list_relay_members(pool: &PgPool, community: CommunityId) -> Result<Vec<RelayMember>> {
    let rows = sqlx::query(
        "SELECT pubkey, role, added_by, created_at, updated_at \
         FROM relay_members WHERE community_id = $1 ORDER BY created_at ASC",
    )
    .bind(community.as_uuid())
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|r| -> std::result::Result<RelayMember, sqlx::Error> {
            Ok(RelayMember {
                pubkey: r.try_get("pubkey")?,
                role: r.try_get("role")?,
                added_by: r.try_get("added_by")?,
                created_at: r.try_get("created_at")?,
                updated_at: r.try_get("updated_at")?,
            })
        })
        .collect::<std::result::Result<Vec<_>, sqlx::Error>>()
        .map_err(crate::error::DbError::from)
}

/// Adds a new relay member to `community`.
///
/// Returns `true` if the row was actually inserted, `false` if the pubkey
/// already existed in this community (idempotent — `ON CONFLICT DO NOTHING` on
/// the `(community_id, pubkey)` primary key).
pub async fn add_relay_member(
    pool: &PgPool,
    community: CommunityId,
    pubkey: &str,
    role: &str,
    added_by: Option<&str>,
) -> Result<bool> {
    let result = sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, $3, $4) ON CONFLICT (community_id, pubkey) DO NOTHING",
    )
    .bind(community.as_uuid())
    .bind(pubkey)
    .bind(role)
    .bind(added_by)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// The result of a relay member removal attempt.
#[derive(Debug, PartialEq)]
pub enum RemoveResult {
    /// Member was successfully removed.
    Removed,
    /// The pubkey belongs to the relay owner — removal is forbidden.
    IsOwner,
    /// No member with the given pubkey exists.
    NotFound,
    /// The member exists but their role doesn't match the expected role.
    RoleMismatch,
}

/// Removes a relay member atomically, refusing to delete the owner.
///
/// Uses a single conditional `DELETE … WHERE role <> 'owner'` so the
/// owner-protection check and the deletion are one atomic operation —
/// no TOCTOU race between a separate read and delete.
pub async fn remove_relay_member(
    pool: &PgPool,
    community: CommunityId,
    pubkey: &str,
) -> Result<RemoveResult> {
    let result = sqlx::query(
        "DELETE FROM relay_members \
         WHERE community_id = $1 AND pubkey = $2 AND role <> 'owner'",
    )
    .bind(community.as_uuid())
    .bind(pubkey)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        return Ok(RemoveResult::Removed);
    }

    // rows_affected == 0: either not found or is owner.  One cheap read to
    // distinguish the two cases so callers can return the right error message.
    let exists = sqlx::query("SELECT 1 FROM relay_members WHERE community_id = $1 AND pubkey = $2")
        .bind(community.as_uuid())
        .bind(pubkey)
        .fetch_optional(pool)
        .await?;

    if exists.is_some() {
        Ok(RemoveResult::IsOwner)
    } else {
        Ok(RemoveResult::NotFound)
    }
}

/// Removes a relay member only if their current role matches `expected_role`.
///
/// The delete and the role check are collapsed into a single
/// `DELETE … WHERE pubkey = $1 AND role = $2`, making the operation atomic —
/// no TOCTOU race between a prior read and this delete.
///
/// Returns:
/// - `Removed` — row was deleted.
/// - `NotFound` — no member with that pubkey exists.
/// - `IsOwner` — member exists with role `"owner"` (cannot be removed).
/// - `RoleMismatch` — member exists but their role no longer matches
///   `expected_role` (e.g., they were promoted between the caller's read and
///   this delete).
pub async fn remove_relay_member_if_role(
    pool: &PgPool,
    community: CommunityId,
    pubkey: &str,
    expected_role: &str,
) -> Result<RemoveResult> {
    let result = sqlx::query(
        "DELETE FROM relay_members WHERE community_id = $1 AND pubkey = $2 AND role = $3",
    )
    .bind(community.as_uuid())
    .bind(pubkey)
    .bind(expected_role)
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        return Ok(RemoveResult::Removed);
    }

    // rows_affected == 0: either not found or role changed. One cheap read to
    // distinguish the cases so callers can return the right error message.
    let row = sqlx::query("SELECT role FROM relay_members WHERE community_id = $1 AND pubkey = $2")
        .bind(community.as_uuid())
        .bind(pubkey)
        .fetch_optional(pool)
        .await?;

    match row {
        None => Ok(RemoveResult::NotFound),
        Some(r) => {
            let role: String = r.try_get("role")?;
            if role == "owner" {
                Ok(RemoveResult::IsOwner)
            } else {
                // Role changed between the caller's check and this delete
                // (e.g., target was promoted to admin). Signal that the
                // caller no longer has authority to remove this target.
                Ok(RemoveResult::RoleMismatch)
            }
        }
    }
}

/// Updates the role of an existing relay member in `community`. Returns `true`
/// if updated.
pub async fn update_relay_member_role(
    pool: &PgPool,
    community: CommunityId,
    pubkey: &str,
    new_role: &str,
) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE relay_members SET role = $1, updated_at = now() \
         WHERE community_id = $2 AND pubkey = $3 AND role <> 'owner'",
    )
    .bind(new_role)
    .bind(community.as_uuid())
    .bind(pubkey)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Ensures the configured owner pubkey holds the `"owner"` role *in
/// `community`*, and demotes any other owners in that community to `"admin"`.
/// This handles owner rotation: if `RELAY_OWNER_PUBKEY` changes, the old owner
/// is automatically demoted. Scoped to one community — an owner of community A
/// is never bootstrapped into community B.
///
/// Runs in a single transaction. Safe to call at every startup — idempotent.
pub async fn bootstrap_owner(
    pool: &PgPool,
    community: CommunityId,
    owner_pubkey: &str,
) -> Result<()> {
    let pubkey = owner_pubkey.to_ascii_lowercase();
    let mut tx = pool.begin().await?;

    // 1. Upsert the configured owner for this community.
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, 'owner', NULL) \
         ON CONFLICT (community_id, pubkey) DO UPDATE SET role = 'owner', updated_at = now()",
    )
    .bind(community.as_uuid())
    .bind(&pubkey)
    .execute(&mut *tx)
    .await?;

    // 2. Demote any other owners in this community to admin.
    sqlx::query(
        "UPDATE relay_members SET role = 'admin', updated_at = now() \
         WHERE community_id = $1 AND role = 'owner' AND pubkey <> $2",
    )
    .bind(community.as_uuid())
    .bind(&pubkey)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// The result of a transfer-ownership attempt.
#[derive(Debug, PartialEq)]
pub enum TransferResult {
    /// Transfer completed: the new owner was upserted and the previous
    /// owner(s) demoted to `member`.
    Transferred {
        /// Pubkey of the previous sole owner, if exactly one existed.
        previous_owner: Option<String>,
    },
    /// The new owner pubkey is already the sole owner — nothing to do.
    AlreadyOwner,
    /// No owner row exists for this community (community may not exist).
    NoOwner,
}

/// Atomically transfers ownership of `community` to `new_owner_pubkey`.
///
/// Runs in a single transaction:
/// 1. Reads existing owner rows to detect no-op and error conditions.
/// 2. Upserts `new_owner_pubkey` as `owner` (insert or promote).
/// 3. Demotes every other owner in this community to `member` — **not**
///    `admin`, per product decision: the former owner retains no management
///    capabilities.
///
/// Scoped to one community — an ownership transfer in A never touches B.
pub async fn transfer_ownership(
    pool: &PgPool,
    community: CommunityId,
    new_owner_pubkey: &str,
) -> Result<TransferResult> {
    let pubkey = new_owner_pubkey.to_ascii_lowercase();
    let mut tx = pool.begin().await?;

    // 1. Read existing owners within the transaction so the check and the
    //    mutation are atomic — no TOCTOU window between reading and writing.
    let existing_owners: Vec<String> = sqlx::query_scalar(
        "SELECT pubkey FROM relay_members WHERE community_id = $1 AND role = 'owner'",
    )
    .bind(community.as_uuid())
    .fetch_all(&mut *tx)
    .await?;

    if existing_owners.is_empty() {
        tx.rollback().await?;
        return Ok(TransferResult::NoOwner);
    }

    // Already the sole owner — no transfer needed.
    if existing_owners.len() == 1 && existing_owners[0] == pubkey {
        tx.rollback().await?;
        return Ok(TransferResult::AlreadyOwner);
    }

    let previous_owner = if existing_owners.len() == 1 {
        Some(existing_owners[0].clone())
    } else {
        existing_owners.iter().find(|p| **p != pubkey).cloned()
    };

    // 2. Upsert the new owner.
    sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by) \
         VALUES ($1, $2, 'owner', NULL) \
         ON CONFLICT (community_id, pubkey) DO UPDATE SET role = 'owner', updated_at = now()",
    )
    .bind(community.as_uuid())
    .bind(&pubkey)
    .execute(&mut *tx)
    .await?;

    // 3. Demote all other owners to member (not admin).
    sqlx::query(
        "UPDATE relay_members SET role = 'member', updated_at = now() \
         WHERE community_id = $1 AND role = 'owner' AND pubkey <> $2",
    )
    .bind(community.as_uuid())
    .bind(&pubkey)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(TransferResult::Transferred { previous_owner })
}

/// Migrates existing `pubkey_allowlist` entries into `relay_members` for
/// `community` (the deployment's default community).
///
/// Converts BYTEA pubkeys to lowercase hex text and inserts them as members of
/// `community`. Returns the number of rows inserted, or 0 if:
/// - the `pubkey_allowlist` table doesn't exist, or
/// - `relay_members` already has rows for this community (migration ran in a
///   prior startup).
///
/// The empty-table guard prevents re-adding members that were intentionally
/// removed by an admin after the initial backfill.
pub async fn backfill_from_allowlist(pool: &PgPool, community: CommunityId) -> Result<u64> {
    // Check if pubkey_allowlist table exists.
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM information_schema.tables \
         WHERE table_schema = 'public' AND table_name = 'pubkey_allowlist')",
    )
    .fetch_one(pool)
    .await?;

    if !exists {
        return Ok(0);
    }

    // Only backfill if this community's relay_members is empty — once it has
    // rows (from a previous backfill or manual admin commands), we must not
    // re-add members that were intentionally removed.
    let has_members: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM relay_members WHERE community_id = $1)")
            .bind(community.as_uuid())
            .fetch_one(pool)
            .await?;

    if has_members {
        return Ok(0);
    }

    let result = sqlx::query(
        "INSERT INTO relay_members (community_id, pubkey, role, added_by, created_at) \
         SELECT $1, encode(pubkey, 'hex'), 'member', NULL, added_at \
         FROM pubkey_allowlist \
         WHERE community_id = $1 \
         ON CONFLICT (community_id, pubkey) DO NOTHING",
    )
    .bind(community.as_uuid())
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    const TEST_DB_URL: &str = "postgres://buzz:buzz_dev@localhost:5432/buzz";

    async fn setup_pool() -> PgPool {
        let database_url = std::env::var("BUZZ_TEST_DATABASE_URL")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .unwrap_or_else(|_| TEST_DB_URL.to_owned());
        PgPool::connect(&database_url)
            .await
            .expect("connect to test DB")
    }

    async fn make_test_community(pool: &PgPool) -> CommunityId {
        let id = Uuid::new_v4();
        let host = format!("relay-members-test-{}.example", id.simple());
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(id)
            .bind(host)
            .execute(pool)
            .await
            .expect("insert test community");
        CommunityId::from_uuid(id)
    }

    /// NIP-43 admission confinement: a pubkey admitted to community A is *not*
    /// admitted to community B. This is the exact mutation #1285 targets — a
    /// `WHERE pubkey = $1` membership check (no community predicate) would let an
    /// A-member authenticate against B. We add the pubkey only to A and assert
    /// every read path (`is_relay_member`, `get_relay_member`, `list_relay_members`)
    /// confines it to A.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn membership_is_confined_to_its_community() {
        let pool = setup_pool().await;
        let community_a = make_test_community(&pool).await;
        let community_b = make_test_community(&pool).await;
        // 64-char lowercase hex, unique per run so reruns don't collide.
        let pubkey = format!("{:064x}", Uuid::new_v4().as_u128());

        let inserted = add_relay_member(&pool, community_a, &pubkey, "member", None)
            .await
            .expect("add member to community A");
        assert!(inserted, "first insert into A should report inserted");

        // is_relay_member: member of A, NOT of B.
        assert!(
            is_relay_member(&pool, community_a, &pubkey)
                .await
                .expect("is_relay_member A"),
            "pubkey must be a member of community A"
        );
        assert!(
            !is_relay_member(&pool, community_b, &pubkey)
                .await
                .expect("is_relay_member B"),
            "pubkey admitted to A must NOT be a member of B (admission confinement)"
        );

        // get_relay_member (used by the NIP-OA owner check + admin role lookups):
        // resolves in A, absent in B.
        assert!(
            get_relay_member(&pool, community_a, &pubkey)
                .await
                .expect("get_relay_member A")
                .is_some(),
            "get_relay_member must resolve in community A"
        );
        assert!(
            get_relay_member(&pool, community_b, &pubkey)
                .await
                .expect("get_relay_member B")
                .is_none(),
            "get_relay_member must not resolve the A pubkey in community B"
        );

        // list_relay_members: B's list never contains A's member.
        let list_a = list_relay_members(&pool, community_a)
            .await
            .expect("list A");
        assert!(
            list_a.iter().any(|m| m.pubkey == pubkey),
            "community A list must contain the admitted pubkey"
        );
        let list_b = list_relay_members(&pool, community_b)
            .await
            .expect("list B");
        assert!(
            list_b.iter().all(|m| m.pubkey != pubkey),
            "community B list must not contain A's member"
        );
    }

    /// Owner bootstrap is community-scoped: bootstrapping the owner in A does not
    /// make that pubkey an owner (or member) of B. Guards against a global
    /// `INSERT ... (pubkey, role)` bootstrap leaking the owner across tenants.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn owner_bootstrap_is_confined_to_its_community() {
        let pool = setup_pool().await;
        let community_a = make_test_community(&pool).await;
        let community_b = make_test_community(&pool).await;
        let owner = format!("{:064x}", Uuid::new_v4().as_u128());

        bootstrap_owner(&pool, community_a, &owner)
            .await
            .expect("bootstrap owner in A");

        let in_a = get_relay_member(&pool, community_a, &owner)
            .await
            .expect("get owner A")
            .expect("owner exists in A");
        assert_eq!(in_a.role, "owner", "bootstrapped pubkey must be owner in A");

        assert!(
            !is_relay_member(&pool, community_b, &owner)
                .await
                .expect("is_relay_member B"),
            "owner bootstrapped in A must NOT be a member of B"
        );
    }

    /// Transfer ownership: upserts new owner, demotes previous owner to
    /// `member` (not `admin`), and returns the previous owner's pubkey.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn transfer_ownership_demotes_old_owner_to_member() {
        let pool = setup_pool().await;
        let community = make_test_community(&pool).await;
        let old_owner = format!("{:064x}", Uuid::new_v4().as_u128());
        let new_owner = format!("{:064x}", Uuid::new_v4().as_u128());

        bootstrap_owner(&pool, community, &old_owner)
            .await
            .expect("bootstrap initial owner");

        let result = transfer_ownership(&pool, community, &new_owner)
            .await
            .expect("transfer ownership");

        assert_eq!(
            result,
            TransferResult::Transferred {
                previous_owner: Some(old_owner.clone()),
            }
        );

        // New owner is owner.
        let new_role = get_relay_member(&pool, community, &new_owner)
            .await
            .expect("get new owner")
            .expect("new owner exists")
            .role;
        assert_eq!(new_role, "owner");

        // Old owner is member, not admin, not owner.
        let old_role = get_relay_member(&pool, community, &old_owner)
            .await
            .expect("get old owner")
            .expect("old owner still exists")
            .role;
        assert_eq!(old_role, "member");
    }

    /// Transferring to the current sole owner is a no-op (`AlreadyOwner`).
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn transfer_ownership_already_owner_is_noop() {
        let pool = setup_pool().await;
        let community = make_test_community(&pool).await;
        let owner = format!("{:064x}", Uuid::new_v4().as_u128());

        bootstrap_owner(&pool, community, &owner)
            .await
            .expect("bootstrap owner");

        let result = transfer_ownership(&pool, community, &owner)
            .await
            .expect("transfer ownership to self");

        assert_eq!(result, TransferResult::AlreadyOwner);

        // Still owner.
        let role = get_relay_member(&pool, community, &owner)
            .await
            .expect("get owner")
            .expect("owner exists")
            .role;
        assert_eq!(role, "owner");
    }

    /// Transferring a community with no owner row returns `NoOwner`.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn transfer_ownership_no_owner_returns_no_owner() {
        let pool = setup_pool().await;
        let community = make_test_community(&pool).await;
        let new_owner = format!("{:064x}", Uuid::new_v4().as_u128());

        // No bootstrap — community exists but has no owner row.

        let result = transfer_ownership(&pool, community, &new_owner)
            .await
            .expect("transfer ownership on empty community");

        assert_eq!(result, TransferResult::NoOwner);
    }

    /// Transfer ownership is community-scoped: transferring in A does not
    /// affect ownership in B.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn transfer_ownership_is_community_scoped() {
        let pool = setup_pool().await;
        let community_a = make_test_community(&pool).await;
        let community_b = make_test_community(&pool).await;
        let owner_a = format!("{:064x}", Uuid::new_v4().as_u128());
        let owner_b = format!("{:064x}", Uuid::new_v4().as_u128());
        let new_owner = format!("{:064x}", Uuid::new_v4().as_u128());

        bootstrap_owner(&pool, community_a, &owner_a)
            .await
            .expect("bootstrap owner A");
        bootstrap_owner(&pool, community_b, &owner_b)
            .await
            .expect("bootstrap owner B");

        transfer_ownership(&pool, community_a, &new_owner)
            .await
            .expect("transfer A");

        // A: new owner is owner, old owner is member.
        assert_eq!(
            get_relay_member(&pool, community_a, &new_owner)
                .await
                .expect("get new owner A")
                .expect("exists")
                .role,
            "owner"
        );
        assert_eq!(
            get_relay_member(&pool, community_a, &owner_a)
                .await
                .expect("get old owner A")
                .expect("exists")
                .role,
            "member"
        );

        // B: untouched — owner_b is still owner, new_owner is not a member.
        assert_eq!(
            get_relay_member(&pool, community_b, &owner_b)
                .await
                .expect("get owner B")
                .expect("exists")
                .role,
            "owner"
        );
        assert!(
            !is_relay_member(&pool, community_b, &new_owner)
                .await
                .expect("is_relay_member B"),
            "new owner of A must NOT be a member of B"
        );
    }

    /// Transfer ownership to someone who is already a member promotes them to
    /// owner and demotes the old owner to member.
    #[tokio::test]
    #[ignore = "requires Postgres"]
    async fn transfer_ownership_promotes_existing_member() {
        let pool = setup_pool().await;
        let community = make_test_community(&pool).await;
        let old_owner = format!("{:064x}", Uuid::new_v4().as_u128());
        let existing_member = format!("{:064x}", Uuid::new_v4().as_u128());

        bootstrap_owner(&pool, community, &old_owner)
            .await
            .expect("bootstrap owner");
        add_relay_member(&pool, community, &existing_member, "member", None)
            .await
            .expect("add member");

        let result = transfer_ownership(&pool, community, &existing_member)
            .await
            .expect("transfer to existing member");

        assert!(matches!(result, TransferResult::Transferred { .. }));

        assert_eq!(
            get_relay_member(&pool, community, &existing_member)
                .await
                .expect("get new owner")
                .expect("exists")
                .role,
            "owner"
        );
        assert_eq!(
            get_relay_member(&pool, community, &old_owner)
                .await
                .expect("get old owner")
                .expect("exists")
                .role,
            "member"
        );
    }
}
