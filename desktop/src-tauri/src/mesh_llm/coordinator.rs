//! Runtime-owned shared-compute coordinator.
//!
//! Buzz publishes a client-signed, replaceable discovery note containing the
//! member's MeshLLM owner identity and current iroh endpoint. MeshLLM itself
//! performs transport (direct QUIC or its encrypted iroh relays) and admission.
//! The Buzz relay is only a generic Nostr store for membership and discovery;
//! it does not coordinate connections or require mesh-specific handlers.

use std::time::Duration;

use nostr::Tag;
use tauri::{AppHandle, Manager};

use crate::app_state::AppState;

/// Client-owned parameterized-replaceable discovery note. Intentionally local
/// to the desktop: relays handle it as an ordinary NIP-33 event.
pub const KIND_BUZZ_MESH_MEMBER_STATUS: u16 = 30_321;
const STATUS_D_TAG: &str = "buzz-mesh-member-status";
const ROSTER_POLL_INTERVAL: Duration = Duration::from_secs(60);
const STATUS_PUBLISH_INTERVAL: Duration = Duration::from_secs(15);

pub struct MeshCoordinator {
    _status_publisher: tokio::task::JoinHandle<()>,
    _roster_watcher: tokio::task::JoinHandle<()>,
}

/// Start the runtime-owned status publisher and admission-roster watcher.
/// Kept under the historical name to avoid a broad startup API churn.
pub async fn spawn_listener(app: AppHandle) {
    {
        let state = app.state::<AppState>();
        if state.mesh_coordinator.lock().await.is_some() {
            return;
        }
    }

    let publisher_app = app.clone();
    let status_publisher = tokio::spawn(async move {
        loop {
            publish_current_status_once(&publisher_app, "periodic").await;
            tokio::time::sleep(STATUS_PUBLISH_INTERVAL).await;
        }
    });
    let roster_app = app.clone();
    let roster_watcher = tokio::spawn(async move {
        loop {
            tokio::time::sleep(ROSTER_POLL_INTERVAL).await;
            let state = roster_app.state::<AppState>();
            if let Err(error) = reconcile_roster(&state).await {
                eprintln!("buzz-mesh: roster reconcile failed: {error}");
            }
        }
    });

    let state = app.state::<AppState>();
    let mut guard = state.mesh_coordinator.lock().await;
    if guard.is_none() {
        *guard = Some(MeshCoordinator {
            _status_publisher: status_publisher,
            _roster_watcher: roster_watcher,
        });
    } else {
        status_publisher.abort();
        roster_watcher.abort();
    }
}

async fn reconcile_roster(state: &AppState) -> Result<(), String> {
    let current_request = {
        let runtime = state.mesh_llm_runtime.lock().await;
        match runtime.as_ref() {
            Some(runtime) => runtime.start_request().clone(),
            None => return Ok(()),
        }
    };
    let Some(current_owners) = current_request.trusted_owner_ids.as_ref() else {
        return Ok(());
    };
    let fresh = crate::commands::mesh_llm::resolve_trusted_owner_ids(state).await;
    if &fresh == current_owners {
        return Ok(());
    }

    let mut request = current_request;
    request.trusted_owner_ids = Some(fresh);
    let mut guard = state.mesh_llm_runtime.lock().await;
    let Some(running) = guard.take() else {
        return Ok(());
    };
    eprintln!("buzz-mesh: membership roster changed; restarting mesh node with fresh allowlist");
    if let Err(error) = running.stop().await {
        eprintln!("buzz-mesh: stopping mesh node for roster restart failed: {error}");
    }
    let replacement = crate::mesh_llm::DesktopMeshRuntime::start(request)
        .await
        .map_err(|error| format!("mesh node restart after roster change failed: {error}"))?;
    *guard = Some(replacement);
    Ok(())
}

pub(crate) async fn publish_current_status_once(app: &AppHandle, reason: &str) {
    let state = app.state::<AppState>();
    if let Err(error) = publish_current_status_for_state(&state).await {
        eprintln!("buzz-mesh: status report after {reason} failed: {error}");
    }
}

pub(crate) async fn publish_stopped_status_once(app: &AppHandle, reason: &str) {
    let state = app.state::<AppState>();
    if let Err(error) = publish_stopped_status_for_state(&state).await {
        eprintln!("buzz-mesh: stopped status report after {reason} failed: {error}");
    }
}

async fn publish_current_status_for_state(state: &AppState) -> Result<(), String> {
    let owner_id = super::ensure_owner_identity()
        .map_err(|error| format!("failed to load mesh owner identity: {error}"))?
        .owner_id;
    let payload = {
        let runtime = state.mesh_llm_runtime.lock().await;
        match runtime.as_ref() {
            Some(runtime) => runtime
                .status_report_payload()
                .await
                .map_err(|error| error.to_string())?,
            None => stopped_status_payload(&owner_id),
        }
    };
    publish_status_report(state, payload).await
}

async fn publish_stopped_status_for_state(state: &AppState) -> Result<(), String> {
    let owner_id = super::ensure_owner_identity()
        .map_err(|error| format!("failed to load mesh owner identity: {error}"))?
        .owner_id;
    publish_status_report(state, stopped_status_payload(&owner_id)).await
}

fn stopped_status_payload(owner_id: &str) -> serde_json::Value {
    serde_json::json!({
        "ownerId": owner_id,
        "serveTargets": [],
        "models": [],
    })
}

pub(crate) fn build_status_report_event(
    payload: serde_json::Value,
) -> Result<nostr::EventBuilder, String> {
    let d = Tag::parse(["d", STATUS_D_TAG]).map_err(|error| error.to_string())?;
    let k = Tag::parse(["k", "buzz-mesh-status"]).map_err(|error| error.to_string())?;
    Ok(nostr::EventBuilder::new(
        nostr::Kind::Custom(KIND_BUZZ_MESH_MEMBER_STATUS),
        payload.to_string(),
    )
    .tags([d, k]))
}

pub(crate) async fn publish_status_report(
    state: &AppState,
    payload: serde_json::Value,
) -> Result<(), String> {
    crate::relay::submit_event(build_status_report_event(payload)?, state)
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use nostr::JsonUtil;

    use super::*;

    #[test]
    fn stopped_status_advertises_identity_without_targets() {
        assert_eq!(
            stopped_status_payload("owner-test"),
            serde_json::json!({
                "ownerId": "owner-test",
                "serveTargets": [],
                "models": [],
            })
        );
    }

    #[test]
    fn status_is_an_ordinary_client_replaceable_event() {
        let keys = nostr::Keys::generate();
        let event = build_status_report_event(serde_json::json!({"ownerId":"owner"}))
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(
            event.kind,
            nostr::Kind::Custom(KIND_BUZZ_MESH_MEMBER_STATUS)
        );
        assert_eq!(event.pubkey, keys.public_key());
        assert!(event.as_json().contains(STATUS_D_TAG));
    }
}
