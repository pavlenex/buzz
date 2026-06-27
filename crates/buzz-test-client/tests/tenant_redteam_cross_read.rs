//! Red-team — Attack 4: cross-community read.
//!
//! Spec property pinned: `Inv_NonInterference` / `Inv_ReadConfinement` /
//! `Inv_LabelPropagation` from `docs/spec/MultiTenantRelay.tla` (lines
//! 985+). Mutation class M1/M3/M12 from the TLA+ header (lines 43-91).
//!
//! Seam action: `ReadMessageRows` for the *receiving* connection — the
//! relay must never deliver an event labelled `{B}` to a socket bound to
//! community `A` for any `A != B`.
//!
//! The companion unit test at
//! `crates/buzz-relay/src/handlers/event.rs` → `tests::redteam` proves the
//! gap at the function level (no harness required). This e2e proves it on
//! the wire and is the integration gate for Max's fix: when both files
//! turn green together (the unit RED un-ignored, this `#[ignore]`'d e2e
//! run green under `--ignored`), Attack 4's global-event seam is closed.
//!
//! # Running
//!
//! Requires a **single multi-tenant relay process** with two hosts mapped
//! to two distinct communities, sharing the same Postgres + Redis. Both
//! URLs MUST address the same pod — that is the whole point: one
//! `sub_registry`, two communities, provably isolated.
//!
//! ```text
//! RELAY_URL_A=ws://a.localhost:3000 \
//! RELAY_URL_B=ws://b.localhost:3000 \
//! cargo test -p buzz-test-client --test tenant_redteam_cross_read -- --ignored
//! ```
//!
//! # The attack, in one sentence
//!
//! A single Nostr pubkey authed on host A's WebSocket subscribes to its
//! own presence with a content-only predicate (`{"kinds":[10000],"#p":
//! "<self>"}`). The *same* pubkey publishes a presence event through host
//! B's WebSocket. With a same-pod multi-tenant relay, the B-side ingest
//! reaches `dispatch_persistent_event` → `fan_out_event_to_local_subscribers`
//! → `sub_registry.fan_out` matches the A-bound socket's #p sub →
//! `filter_fanout_by_access` short-circuits the channel-less path with no
//! tenant cross-check (event.rs:89-91). The A-bound socket receives a
//! community-B event. That is the literal negation of
//! `Inv_NonInterference`.

use std::time::Duration;

use buzz_test_client::{BuzzTestClient, RelayMessage};
use nostr::{
    Alphabet, EventBuilder, Filter, Keys, Kind, PublicKey, SingleLetterTag, Tag,
};

/// Community A host. Defaults to a local two-host relay fixture.
fn url_a() -> String {
    std::env::var("RELAY_URL_A").unwrap_or_else(|_| "ws://a.localhost:3000".to_string())
}

/// Community B host. Same pod, different `Host:` header.
fn url_b() -> String {
    std::env::var("RELAY_URL_B").unwrap_or_else(|_| "ws://b.localhost:3000".to_string())
}

const KIND_PRESENCE_UPDATE: u16 = 10000;

fn sub_id(name: &str) -> String {
    format!("redteam-{name}-{}", uuid::Uuid::new_v4())
}

/// Build a kind:10000 presence event tagged `#p = pubkey` for the
/// shared-pubkey fan-out path. The author and the `#p` target are the
/// same key — the standard pattern for "this user's own presence."
fn presence_for(keys: &Keys, status: &str) -> nostr::Event {
    let p_tag = Tag::parse(["p", &keys.public_key().to_hex()]).expect("p tag");
    EventBuilder::new(Kind::Custom(KIND_PRESENCE_UPDATE), status)
        .tags([p_tag])
        .sign_with_keys(keys)
        .expect("sign presence")
}

/// RED gate for `Inv_NonInterference` at the global-event fan-out seam.
///
/// **Expected to FAIL on `fb0d6a4ea`** — the A-bound socket currently
/// receives community-B's presence event because the fan-out path has no
/// per-connection tenant check. The test passes when the structural fix
/// lands:
///
///   1. `ConnEntry` (`crates/buzz-relay/src/state.rs`) carries
///      `community: CommunityId`, set when the socket's host resolves at
///      handshake (through `tenant::bind_community`, the only mint path).
///   2. `ConnectionManager` exposes `community_for_conn(conn_id)`.
///   3. `filter_fanout_by_access` (or a wrapper at every fan-out call
///      site) drops any match where `community_for_conn(conn_id) !=
///      Some(event_community)`.
///
/// The companion unit test
/// `handlers::event::tests::redteam::channel_less_event_must_drop_recipient_in_different_community`
/// in `crates/buzz-relay/src/handlers/event.rs` is the fast/local mirror
/// of this assertion. Both must turn green together for Attack 4's
/// global-event seam to be closed.
#[tokio::test]
#[ignore = "RED: requires a two-host multi-tenant relay (RELAY_URL_A + RELAY_URL_B)"]
async fn presence_published_on_host_b_must_not_reach_socket_authed_on_host_a() {
    // One Nostr keypair, two host bindings. The whole attack hinges on
    // the relay treating "same pubkey" as enough to fan out across
    // tenants — exactly what it does today.
    let keys = Keys::generate();
    let self_pk: PublicKey = keys.public_key();

    // Authenticate the same pubkey on both hosts. NIP-42 succeeds
    // independently in each community; the relay treats them as two
    // separate authenticated sessions, which is correct — Nostr
    // identities are global.
    let mut a_client = BuzzTestClient::connect(&url_a(), &keys)
        .await
        .expect("connect to host A");
    let mut b_client = BuzzTestClient::connect(&url_b(), &keys)
        .await
        .expect("connect to host B");

    // On host A: subscribe to my own presence updates with a content-only
    // predicate. This indexes the sub into the relay's *process-global*
    // `global_p_kind_index` keyed on `(kind=10000, p=self)` — with no
    // community in the key (subscription.rs:105-110).
    let presence_sub = sub_id("a-presence");
    a_client
        .subscribe(
            &presence_sub,
            vec![Filter::new()
                .kind(Kind::Custom(KIND_PRESENCE_UPDATE))
                .custom_tag(SingleLetterTag::lowercase(Alphabet::P), self_pk.to_hex())],
        )
        .await
        .expect("A subscribes to own presence");

    // Drain the EOSE / any historical hits so we measure only LIVE
    // fan-out below.
    loop {
        match a_client.recv_event(Duration::from_millis(500)).await {
            Ok(RelayMessage::Eose { .. }) => break,
            Ok(_) => continue,
            Err(_) => break, // timeout = no historical events, fine
        }
    }

    // On host B: publish a presence event for the same pubkey. The B
    // ingest path calls `dispatch_persistent_event` with `tenant.community()
    // = community_B`, which fans out same-pod. The A-bound socket's #p sub
    // is in the same process and matches the event by content.
    let event = presence_for(&keys, "online-from-B");
    let ok = b_client
        .send_event(event.clone())
        .await
        .expect("B publish presence");
    assert!(
        ok.accepted,
        "host B accepted the presence event ({}): {:?}",
        event.id, ok.message
    );

    // The assertion. Under the current code, the A-bound socket sees the
    // event. After the fix, it does not — the fan-out gate drops the
    // recipient because `conn_A.community != event.community`.
    match a_client.recv_event(Duration::from_secs(2)).await {
        Ok(RelayMessage::Event {
            subscription_id, ..
        }) if subscription_id == presence_sub => {
            panic!(
                "Inv_NonInterference violated: host-A socket received a presence \
                 event published on host B (same pubkey, different community). \
                 sub_id={subscription_id}, event_id={}",
                event.id
            );
        }
        Ok(other) => {
            panic!("unexpected message on A's socket while expecting silence: {other:?}");
        }
        Err(_) => {
            // Timeout — correct. The A-bound socket did NOT receive the
            // community-B event.
        }
    }
}
