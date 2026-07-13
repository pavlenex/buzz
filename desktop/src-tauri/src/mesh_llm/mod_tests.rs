//! Unit tests for `mesh_llm/mod.rs` private helpers (kept in a sibling file so
//! `mod.rs` stays under the 500-line budget; `#[path]`-included from there).
use super::{find_progressish_reason, looks_like_model_ref};
use serde_json::json;

#[test]
fn progressish_reads_typed_phase_not_whole_tree() {
    assert_eq!(
        find_progressish_reason(&json!({"phase": "downloading weights"})),
        Some("downloading model".to_string())
    );
    // Regression (Sami N1): an unrelated field mentioning a progress word must
    // not trip the badge — only the typed phase field counts.
    assert_eq!(
        find_progressish_reason(&json!({
            "phase": "ready",
            "model_name": "prepared-qwen-preparing"
        })),
        None
    );
    assert_eq!(find_progressish_reason(&json!({"foo": "bar"})), None);
}

#[test]
fn model_ref_is_family_agnostic() {
    assert!(looks_like_model_ref("hf://org/model"));
    assert!(looks_like_model_ref("some-model.gguf"));
    assert!(looks_like_model_ref("Some-Model.GGUF"));
    // Families that used to be hardcoded must route via the structured path,
    // not a name allowlist here (Sami N2):
    assert!(!looks_like_model_ref("Mistral-7B"));
    assert!(!looks_like_model_ref("Qwen3-35B"));
    assert!(!looks_like_model_ref(""));
}

#[test]
fn iroh_relay_mode_defaults_to_enabled() {
    // Default is ON: unset, empty, "1", and "default" all enable the SDK's
    // default iroh relays, so members connect regardless of NAT. Relays are
    // transport-only (ciphertext forwarding) — admission is a separate layer.
    use super::IrohRelayMode;
    assert_eq!(super::iroh_relay_mode_from(None), IrohRelayMode::Default);
    assert_eq!(
        super::iroh_relay_mode_from(Some("")),
        IrohRelayMode::Default
    );
    assert_eq!(
        super::iroh_relay_mode_from(Some("  ")),
        IrohRelayMode::Default
    );
    assert_eq!(
        super::iroh_relay_mode_from(Some("1")),
        IrohRelayMode::Default
    );
    assert_eq!(
        super::iroh_relay_mode_from(Some("default")),
        IrohRelayMode::Default
    );
}

#[test]
fn iroh_relay_mode_opt_out_and_custom() {
    use super::IrohRelayMode;
    // "0" is the explicit opt-out for metadata-conscious deployments.
    assert_eq!(
        super::iroh_relay_mode_from(Some("0")),
        IrohRelayMode::Disabled
    );
    // Anything else is a comma-separated custom relay list.
    assert_eq!(
        super::iroh_relay_mode_from(Some("https://relay1.example, https://relay2.example ,")),
        IrohRelayMode::Custom(vec![
            "https://relay1.example".to_string(),
            "https://relay2.example".to_string(),
        ])
    );
}

#[test]
fn normalized_roster_none_means_no_enforcement() {
    let identity = super::identity::OwnerIdentity {
        keystore_path: std::path::PathBuf::from("/tmp/ks.json"),
        owner_id: "owner-self".to_string(),
    };
    assert_eq!(super::normalized_roster(&None, &identity), None);
}

#[test]
fn normalized_roster_always_includes_self_and_dedupes() {
    let identity = super::identity::OwnerIdentity {
        keystore_path: std::path::PathBuf::from("/tmp/ks.json"),
        owner_id: "owner-self".to_string(),
    };
    // Empty roster (fresh relay, nobody published yet) still admits self —
    // otherwise the first sharer locks themselves out.
    assert_eq!(
        super::normalized_roster(&Some(vec![]), &identity),
        Some(vec!["owner-self".to_string()])
    );
    // Dedup + trim + sorted, self merged in.
    assert_eq!(
        super::normalized_roster(
            &Some(vec![
                "owner-b".to_string(),
                " owner-a ".to_string(),
                "owner-b".to_string(),
                "".to_string(),
                "owner-self".to_string(),
            ]),
            &identity
        ),
        Some(vec![
            "owner-a".to_string(),
            "owner-b".to_string(),
            "owner-self".to_string(),
        ])
    );
}

fn signed_reporter_status(reporter_secret: &str, owner_id: &str) -> nostr::Event {
    let keys = nostr::Keys::parse(reporter_secret).expect("valid reporter secret");
    super::coordinator::build_status_report_event(
        json!({ "ownerId": owner_id, "serveTargets": [] }),
    )
    .expect("status builder")
    .sign_with_keys(&keys)
    .expect("test event signs")
}

fn signed_membership_event(members: &[String]) -> nostr::Event {
    let keys = nostr::Keys::generate();
    let tags = members
        .iter()
        .map(|member| nostr::Tag::parse(["member", member]).expect("valid member tag"))
        .collect::<Vec<_>>();
    nostr::EventBuilder::new(nostr::Kind::Custom(13_534), "")
        .tags(tags)
        .sign_with_keys(&keys)
        .expect("test membership event signs")
}

#[test]
fn owner_ids_from_events_collects_sorted_deduped_roster() {
    let secret_a = "1".repeat(64);
    let secret_b = "2".repeat(64);
    let member_a = nostr::Keys::parse(&secret_a).unwrap().public_key().to_hex();
    let member_b = nostr::Keys::parse(&secret_b).unwrap().public_key().to_hex();
    let events = vec![
        signed_reporter_status(&secret_b, "owner-b"),
        signed_reporter_status(&secret_a, "owner-a"),
        signed_reporter_status(&secret_b, "owner-b"), // duplicate
        signed_membership_event(&[member_a, member_b]),
    ];
    assert_eq!(
        super::owner_ids_from_events(&events),
        vec!["owner-a".to_string(), "owner-b".to_string()]
    );
    assert_eq!(super::owner_ids_from_events(&[]), Vec::<String>::new());
}

#[test]
fn owner_roster_intersects_status_reporters_with_current_members() {
    let current_secret = "1".repeat(64);
    let removed_secret = "2".repeat(64);
    let nonmember_secret = "3".repeat(64);
    let current_member = nostr::Keys::parse(&current_secret)
        .unwrap()
        .public_key()
        .to_hex();
    let events = vec![
        signed_reporter_status(&current_secret, "owner-current"),
        signed_reporter_status(&removed_secret, "owner-removed"),
        signed_reporter_status(&nonmember_secret, "owner-nonmember"),
        signed_membership_event(std::slice::from_ref(&current_member)),
    ];

    assert_eq!(
        super::owner_ids_from_events(&events),
        vec!["owner-current".to_string()]
    );
}

#[test]
fn owner_roster_without_membership_list_fails_closed() {
    let events = vec![
        signed_reporter_status(&"1".repeat(64), "owner-a"),
        signed_reporter_status(&"2".repeat(64), "owner-b"),
    ];

    assert!(super::owner_ids_from_events(&events).is_empty());
}
