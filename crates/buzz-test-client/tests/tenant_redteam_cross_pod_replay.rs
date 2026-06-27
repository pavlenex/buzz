//! Red-team — Attack 3: cross-pod NIP-98 replay.
//!
//! Spec property pinned: §5 hard gate from the rewrite plan — "shared NIP-98
//! Redis replay seen-set (mandatory: any-pod means mints land anywhere)" —
//! and the explicit shape from `crates/buzz-auth/src/nip98_replay.rs:1-15`:
//!
//!   > With multiple relay pods ("any pod, any connection" per the rewrite
//!   > §4 architecture), an in-process cache (moka, DashMap) does not carry
//!   > the freshness proof across pods, so replay protection is a §5 hard
//!   > gate.
//!
//! Seam action: `AuthCheck` for NIP-98 freshness in
//! `docs/spec/MultiTenantRelay.tla`. A token whose event id has been
//! consumed against any pod in the community MUST be rejected against any
//! other pod in that same community.
//!
//! The companion unit tests at
//! `crates/buzz-relay/src/api/bridge.rs` → `tests::redteam_attack3` document
//! the leak shape at the moka layer (no harness required). This e2e proves
//! it across two pods on the wire and is the integration gate for the fix.
//! When both files turn green together (the unit `current_behavior_*`
//! witnesses DELETED with the patch, this `#[ignore]`'d e2e run green under
//! `--ignored`), Attack 3's freshness seam is closed.
//!
//! # Running
//!
//! Requires **two relay processes** in the SAME community (same Postgres,
//! same Redis), each bound to its own host. Two pods, one tenant.
//!
//! ```text
//! RELAY_HTTP_URL_POD_A=http://localhost:3001 \
//! RELAY_HTTP_URL_POD_B=http://localhost:3002 \
//! cargo test -p buzz-test-client --test tenant_redteam_cross_pod_replay -- --ignored
//! ```
//!
//! Both URLs MUST point to relay processes sharing a single Redis (so the
//! seen-set, once wired, is the same row in both pods). The test self-skips
//! if either env var is unset, so it stays green-by-default in CI.
//!
//! # The attack, in one sentence
//!
//! A client signs a single NIP-98 token (kind:27235) once. They use it to
//! POST `/events` against pod A — admitted. They reuse the *same* signed
//! token to POST `/events` against pod B — currently admitted again,
//! because each pod's `state.nip98_seen` is a per-process moka cache
//! (`state.rs:247`) and the shared `RedisNip98ReplayGuard`
//! (`crates/buzz-pubsub/src/nip98_replay.rs:24-`) is built but unused. That
//! is the literal negation of the §5 freshness gate.

use std::time::Duration;

use base64::Engine;
use nostr::{EventBuilder, Keys, Kind, Tag};

/// HTTP URL for pod A. Tests self-skip if unset.
fn url_a() -> Option<String> {
    std::env::var("RELAY_HTTP_URL_POD_A").ok()
}

/// HTTP URL for pod B (same community, different process). Tests self-skip
/// if unset.
fn url_b() -> Option<String> {
    std::env::var("RELAY_HTTP_URL_POD_B").ok()
}

/// Build a NIP-98 token (kind:27235) for `METHOD URL`, signed by `keys`.
/// Returns the base64-encoded JSON suitable for `Authorization: Nostr ...`.
fn build_nip98_token(keys: &Keys, method: &str, url: &str, body: Option<&[u8]>) -> String {
    let mut tags = vec![
        Tag::parse(["u", url]).expect("u tag"),
        Tag::parse(["method", method]).expect("method tag"),
    ];
    if let Some(b) = body {
        use sha2::{Digest, Sha256};
        let hash = Sha256::digest(b);
        tags.push(Tag::parse(["payload", &hex::encode(hash)]).expect("payload tag"));
    }
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .tags(tags)
        .sign_with_keys(keys)
        .expect("sign NIP-98");
    let json = serde_json::to_string(&event).expect("serialize NIP-98");
    base64::engine::general_purpose::STANDARD.encode(json.as_bytes())
}

/// Build a minimal valid event the bridge will accept on `POST /events`:
/// a signed kind:1 short text note. The event whose id is recorded in
/// `state.nip98_seen` is the *NIP-98* token's id, not this body event's id.
fn build_request_body(keys: &Keys) -> Vec<u8> {
    let event = EventBuilder::new(Kind::TextNote, "redteam-attack3-body")
        .sign_with_keys(keys)
        .expect("sign body");
    serde_json::to_vec(&event).expect("serialize body")
}

/// RED gate for the §5 cross-pod NIP-98 freshness contract.
///
/// **Expected to FAIL on `fb0d6a4ea`** (when the harness is provided) —
/// pod B admits the second use of the same NIP-98 token because the
/// freshness proof is held in pod A's per-process moka cache.
/// The test passes when:
///
///   1. `AppState` carries a shared `Nip98ReplayGuard` (concretely
///      `buzz_pubsub::RedisNip98ReplayGuard`, constructed from the same
///      Redis pool as the pubsub bus).
///   2. `crates/buzz-relay/src/api/bridge.rs::check_nip98_replay` consults
///      that guard with the request's tenant (so the seen-set key is
///      `buzz:{community}:nip98:{event_id_hex}`, per `nip98_replay_key`).
///   3. The per-process `state.nip98_seen` moka cache and the companion
///      unit tests `tests::redteam_attack3::current_behavior_*` are
///      DELETED in the same diff.
#[tokio::test]
#[ignore = "RED: requires two relay processes sharing Redis (RELAY_HTTP_URL_POD_A + RELAY_HTTP_URL_POD_B)"]
async fn nip98_token_consumed_on_pod_a_must_be_rejected_on_pod_b() {
    let (Some(url_a), Some(url_b)) = (url_a(), url_b()) else {
        eprintln!(
            "skipping: RELAY_HTTP_URL_POD_A and RELAY_HTTP_URL_POD_B must both \
             be set to two relay pods sharing a single Redis"
        );
        return;
    };

    let keys = Keys::generate();
    let body = build_request_body(&keys);

    // Same target URL path on both pods — the NIP-98 `u` tag MUST match
    // whatever each pod canonicalises `POST /events` to. Per
    // `canonical_url` (bridge.rs:96-103) the bridge canonicalises by
    // swapping the scheme and joining the path, so both pods' canonical
    // URLs differ by host. We mint two tokens with the *same* event id by
    // signing once against a host-agnostic key shape — but that's not
    // possible (the `u` tag is part of the signed event). The realistic
    // attack mints with pod A's URL and presents that same signed token
    // to pod B; pod B's verifier checks `u == pod_B_canonical_url`, which
    // fails, so the attack via "literal same signed token" is bounded by
    // NIP-98's URL binding.
    //
    // The CROSS-POD attack that bypasses URL binding: both pods serve the
    // SAME community, so they advertise the SAME canonical relay_url
    // (deployment-wide), and the canonical URL for `POST /events` is
    // identical on both. The NIP-98 verifier accepts the same signed
    // token at both pods. Only the seen-set distinguishes them — and
    // today, the seen-set is per-process.
    let url = format!("{}/events", url_a.trim_end_matches('/'));
    let token = build_nip98_token(&keys, "POST", &url, Some(&body));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("http client");

    // First use against pod A — must be admitted.
    let resp_a = client
        .post(format!("{}/events", url_a.trim_end_matches('/')))
        .header("Authorization", format!("Nostr {token}"))
        .header("Content-Type", "application/json")
        .body(body.clone())
        .send()
        .await
        .expect("POST /events to pod A");
    assert!(
        resp_a.status().is_success(),
        "pod A must admit the first use of a fresh NIP-98 token; got {}: {}",
        resp_a.status(),
        resp_a.text().await.unwrap_or_default(),
    );

    // Same signed token, same body, replayed against pod B in the SAME
    // community. After the fix, the shared seen-set in Redis already holds
    // the token's event id and pod B must respond 401 with the relay's
    // "NIP-98: replay detected" body.
    let resp_b = client
        .post(format!("{}/events", url_b.trim_end_matches('/')))
        .header("Authorization", format!("Nostr {token}"))
        .header("Content-Type", "application/json")
        .body(body)
        .send()
        .await
        .expect("POST /events to pod B");
    let status_b = resp_b.status();
    let body_b = resp_b.text().await.unwrap_or_default();
    assert_eq!(
        status_b.as_u16(),
        401,
        "Inv_Nip98Freshness violated: pod B admitted a replay of a token \
         already consumed against pod A (same community, shared Redis). \
         got status={status_b}, body={body_b}"
    );
    assert!(
        body_b.contains("replay") || body_b.contains("NIP-98"),
        "pod B rejected the replay but the rejection body is unexpected: {body_b}",
    );
}
