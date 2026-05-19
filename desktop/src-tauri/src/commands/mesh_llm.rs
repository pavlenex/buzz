//! Tauri commands for the mesh-LLM frontend surface.
//!
//! All commands deal with *the local user's own* mesh-LLM state:
//! - the persisted iroh endpoint id,
//! - the persisted compute-sharing preferences (the avatar-menu sliders),
//! - explicit toggle/save calls invoked when the user changes the prefs.
//!
//! Discovering and connecting to *other* members' offers happens through the
//! existing relay WebSocket pipeline, not these commands.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::mesh_llm;

/// Result type for mesh-LLM commands: errors are surfaced as user-facing
/// strings by the frontend.
type CmdResult<T> = Result<T, String>;

/// Stable identifier of the local iroh endpoint, in iroh's canonical
/// Display form. Returned to the frontend so the user can see *which*
/// machine identity they're publishing under (useful when one user has
/// multiple devices each running Sprout).
#[derive(Debug, Clone, Serialize)]
pub struct MeshEndpointInfo {
    /// Iroh endpoint id (= public key) as displayed by `iroh-base`.
    pub endpoint_id: String,
}

/// Returns the local mesh-LLM iroh endpoint id, creating + persisting the
/// keypair on first call.
#[tauri::command]
pub fn mesh_get_endpoint_id(app: AppHandle) -> CmdResult<MeshEndpointInfo> {
    let key = mesh_llm::load_or_create_endpoint_key(&app).map_err(|e| e.to_string())?;
    Ok(MeshEndpointInfo {
        endpoint_id: key.public().to_string(),
    })
}

/// Returns the persisted compute-sharing preferences for the avatar menu.
#[tauri::command]
pub fn mesh_get_sharing_prefs(app: AppHandle) -> CmdResult<mesh_llm::ComputeSharingPrefs> {
    mesh_llm::offer::load_prefs(&app).map_err(|e| e.to_string())
}

/// Replaces the persisted compute-sharing preferences. The caller is
/// responsible for republishing or deleting the kind:31990 offer to reflect
/// the change — this command only touches local state.
#[tauri::command]
pub fn mesh_set_sharing_prefs(
    app: AppHandle,
    prefs: mesh_llm::ComputeSharingPrefs,
) -> CmdResult<()> {
    mesh_llm::offer::save_prefs(&app, &prefs).map_err(|e| e.to_string())
}

/// Probe the connected relay's NIP-11 for an `iroh_relay_url`.
///
/// Returns:
/// - `Ok(Some(url))` if the relay advertises one,
/// - `Ok(None)` if it doesn't, or if the relay is unreachable / malformed.
/// - `Err(_)` only for caller-side errors (e.g. bad WS URL shape).
#[tauri::command]
pub async fn mesh_relay_iroh_url(
    _state: State<'_, AppState>,
    relay_ws_url: String,
) -> CmdResult<Option<String>> {
    mesh_llm::fetch_iroh_relay_url(&relay_ws_url)
        .await
        .map_err(|e| e.to_string())
}
