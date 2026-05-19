//! End-to-end tests for kind:31990 mesh-LLM compute-offer discovery.
//!
//! These tests require a running relay instance. By default they are marked
//! `#[ignore]` so that `cargo test` does not fail in CI when the relay is not
//! available.
//!
//! # Running
//!
//! Start the relay, then run:
//!
//! ```text
//! cargo test --test e2e_mesh_llm_discovery -- --ignored
//! ```
//!
//! Override the relay URL with the `RELAY_URL` environment variable:
//!
//! ```text
//! RELAY_URL=ws://relay.example.com cargo test --test e2e_mesh_llm_discovery -- --ignored
//! ```

use std::time::Duration;

use nostr::{EventBuilder, Filter, Keys, Kind, Tag, Timestamp};
use sprout_core::kind::KIND_MESH_LLM_DISCOVERY;
use sprout_core::mesh_llm::{MeshLlmOffer, ModelOffer, ResourceCaps};
use sprout_test_client::SproutTestClient;

fn relay_url() -> String {
    std::env::var("RELAY_URL").unwrap_or_else(|_| "ws://localhost:3000".to_string())
}

fn sub_id(name: &str) -> String {
    format!("e2e-mesh-{name}-{}", uuid::Uuid::new_v4())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn sample_offer(d_tag: &str, expires_at: u64) -> MeshLlmOffer {
    MeshLlmOffer {
        v: 1,
        d_tag: d_tag.to_string(),
        endpoint_id: "endpoint-id-test".to_string(),
        iroh_relay_url: "https://relay.example.com/iroh".to_string(),
        expires_at,
        caps: ResourceCaps {
            max_vram_mb: Some(8192),
            max_ram_mb: Some(16_000),
            max_concurrency: Some(1),
        },
        models: vec![ModelOffer {
            id: "test/model-1".to_string(),
            label: Some("Test Model".to_string()),
            context_tokens: Some(4096),
        }],
        extra: None,
    }
}

fn build_offer_event(keys: &Keys, offer: &MeshLlmOffer) -> nostr::Event {
    let content = serde_json::to_string(offer).expect("serialise offer");
    let tags = vec![Tag::parse(&["d", &offer.d_tag]).expect("d tag")];
    EventBuilder::new(Kind::Custom(KIND_MESH_LLM_DISCOVERY as u16), content, tags)
        .sign_with_keys(keys)
        .expect("sign event")
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// kind:31990 events with a far-future `expires_at` are accepted by the
/// relay and retrievable by a subsequent REQ scoped to that kind + author.
#[tokio::test]
#[ignore]
async fn test_offer_publish_then_retrieve() {
    let url = relay_url();
    let keys = Keys::generate();
    let mut client = SproutTestClient::connect(&url, &keys)
        .await
        .expect("connect");

    let d_tag = format!("offer-{}", uuid::Uuid::new_v4().simple());
    let offer = sample_offer(&d_tag, now_secs() + 600);
    let event = build_offer_event(&keys, &offer);
    let event_id = event.id;

    let ok = client.send_event(event).await.expect("send event");
    assert!(
        ok.accepted,
        "relay should accept kind:31990 (well-formed offer): {}",
        ok.message,
    );

    // Pull it back via REQ scoped to this author.
    let sid = sub_id("retrieve");
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_MESH_LLM_DISCOVERY as u16))
        .author(keys.public_key());
    client
        .subscribe(&sid, vec![filter])
        .await
        .expect("subscribe");
    let events = client
        .collect_until_eose(&sid, Duration::from_secs(5))
        .await
        .expect("collect");

    assert!(
        events.iter().any(|e| e.id == event_id),
        "should find the published offer in query results",
    );

    // Deserialize and sanity-check the content survives the round trip.
    let stored = events.iter().find(|e| e.id == event_id).unwrap();
    let parsed: MeshLlmOffer =
        serde_json::from_str(&stored.content).expect("offer round-trips through relay");
    assert_eq!(parsed.d_tag, d_tag);
    assert_eq!(parsed.expires_at, offer.expires_at);

    client.disconnect().await.expect("disconnect");
}

/// NIP-33 replace semantics: publishing a second event under the same
/// (pubkey, d_tag) replaces the first. The REQ that follows should
/// return only the latest version.
#[tokio::test]
#[ignore]
async fn test_offer_replace_by_d_tag() {
    let url = relay_url();
    let keys = Keys::generate();
    let mut client = SproutTestClient::connect(&url, &keys)
        .await
        .expect("connect");

    let d_tag = format!("replace-{}", uuid::Uuid::new_v4().simple());

    // Publish v1 — short TTL.
    let offer_v1 = sample_offer(&d_tag, now_secs() + 60);
    let event_v1 = build_offer_event(&keys, &offer_v1);
    let v1_id = event_v1.id;
    let ok = client.send_event(event_v1).await.expect("send v1");
    assert!(ok.accepted, "v1 accepted: {}", ok.message);

    // Wait a beat so created_at differs (NIP-33 tie-breaker).
    tokio::time::sleep(Duration::from_secs(1)).await;

    // Publish v2 — longer TTL, same d_tag → replaces v1.
    let mut offer_v2 = sample_offer(&d_tag, now_secs() + 600);
    offer_v2.endpoint_id = "endpoint-id-v2".to_string();
    let event_v2 = build_offer_event(&keys, &offer_v2);
    let v2_id = event_v2.id;
    let ok = client.send_event(event_v2).await.expect("send v2");
    assert!(ok.accepted, "v2 accepted: {}", ok.message);

    // Query — should see only the replacement.
    let sid = sub_id("replace");
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_MESH_LLM_DISCOVERY as u16))
        .author(keys.public_key());
    client
        .subscribe(&sid, vec![filter])
        .await
        .expect("subscribe");
    let events = client
        .collect_until_eose(&sid, Duration::from_secs(5))
        .await
        .expect("collect");

    let matching: Vec<_> = events
        .iter()
        .filter(|e| {
            e.tags.iter().any(|t| {
                t.as_slice().first().map(|s| s.as_str()) == Some("d")
                    && t.as_slice().get(1).map(|s| s.as_str()) == Some(d_tag.as_str())
            })
        })
        .collect();

    assert!(
        matching.iter().any(|e| e.id == v2_id),
        "v2 must be present after replace",
    );
    assert!(
        !matching.iter().any(|e| e.id == v1_id),
        "v1 must be replaced by v2 (NIP-33)",
    );
}

/// Empty-content kind:31990 with the same (pubkey, d_tag) is the
/// delete-by-replace tombstone the desktop publisher emits when the user
/// toggles compute-sharing off. Consumers see the empty content and drop
/// the offer from their cache.
#[tokio::test]
#[ignore]
async fn test_offer_delete_by_empty_replace() {
    let url = relay_url();
    let keys = Keys::generate();
    let mut client = SproutTestClient::connect(&url, &keys)
        .await
        .expect("connect");

    let d_tag = format!("delete-{}", uuid::Uuid::new_v4().simple());

    // Publish a real offer.
    let offer = sample_offer(&d_tag, now_secs() + 600);
    let event = build_offer_event(&keys, &offer);
    let real_id = event.id;
    let ok = client.send_event(event).await.expect("send real");
    assert!(ok.accepted, "real offer accepted: {}", ok.message);

    tokio::time::sleep(Duration::from_secs(1)).await;

    // Publish the empty-content replacement (the tombstone).
    let tombstone = EventBuilder::new(
        Kind::Custom(KIND_MESH_LLM_DISCOVERY as u16),
        "",
        vec![Tag::parse(&["d", &d_tag]).unwrap()],
    )
    .sign_with_keys(&keys)
    .expect("sign tombstone");
    let tombstone_id = tombstone.id;
    let ok = client.send_event(tombstone).await.expect("send tombstone");
    assert!(ok.accepted, "tombstone accepted: {}", ok.message);

    // Query — only the tombstone should remain at this address.
    let sid = sub_id("delete");
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_MESH_LLM_DISCOVERY as u16))
        .author(keys.public_key());
    client
        .subscribe(&sid, vec![filter])
        .await
        .expect("subscribe");
    let events = client
        .collect_until_eose(&sid, Duration::from_secs(5))
        .await
        .expect("collect");

    let matching: Vec<_> = events
        .iter()
        .filter(|e| {
            e.tags.iter().any(|t| {
                t.as_slice().first().map(|s| s.as_str()) == Some("d")
                    && t.as_slice().get(1).map(|s| s.as_str()) == Some(d_tag.as_str())
            })
        })
        .collect();

    assert!(
        matching
            .iter()
            .any(|e| e.id == tombstone_id && e.content.is_empty()),
        "tombstone (empty content) must be the visible event at this address",
    );
    assert!(
        !matching.iter().any(|e| e.id == real_id),
        "real offer must be replaced by tombstone",
    );

    // Sanity: a consumer would treat the empty content as 'offer withdrawn'.
    // We don't enforce this at the relay; it's a consumer-side convention
    // pinned by the useMeshLlmOffers hook in desktop and by
    // MeshLlmOffer::is_publishable / is_expired in core.
}

/// kind:31990 is global (`is_global_only_kind`): a stray `h` tag must not
/// channel-scope the event. The relay should accept it; a query without
/// `#h` should find it.
#[tokio::test]
#[ignore]
async fn test_offer_stray_h_tag_is_ignored() {
    let url = relay_url();
    let keys = Keys::generate();
    let mut client = SproutTestClient::connect(&url, &keys)
        .await
        .expect("connect");

    let d_tag = format!("stray-h-{}", uuid::Uuid::new_v4().simple());
    let offer = sample_offer(&d_tag, now_secs() + 600);
    let content = serde_json::to_string(&offer).unwrap();
    let fake_channel = uuid::Uuid::new_v4().to_string();
    let event = EventBuilder::new(
        Kind::Custom(KIND_MESH_LLM_DISCOVERY as u16),
        content,
        vec![
            Tag::parse(&["d", &d_tag]).unwrap(),
            Tag::parse(&["h", &fake_channel]).unwrap(),
        ],
    )
    .custom_created_at(Timestamp::now())
    .sign_with_keys(&keys)
    .expect("sign");
    let event_id = event.id;

    let ok = client.send_event(event).await.expect("send");
    assert!(
        ok.accepted,
        "kind:31990 with stray h-tag should still be accepted (h-tag ignored): {}",
        ok.message,
    );

    // Query globally (no #h filter) — must find the offer.
    let sid = sub_id("stray-h");
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_MESH_LLM_DISCOVERY as u16))
        .author(keys.public_key());
    client
        .subscribe(&sid, vec![filter])
        .await
        .expect("subscribe");
    let events = client
        .collect_until_eose(&sid, Duration::from_secs(5))
        .await
        .expect("collect");

    assert!(
        events.iter().any(|e| e.id == event_id),
        "stray-h-tag offer must be retrievable via global query",
    );

    client.disconnect().await.expect("disconnect");
}
