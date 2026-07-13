//! Mesh owner identity for admission.
//!
//! Each machine gets a mesh-llm owner keypair (ed25519, distinct from the
//! Buzz/Nostr identity). The node presents a signed ownership attestation
//! binding `owner_id -> endpoint_id`, and serve nodes enforce an allowlist of
//! member owner ids (see `DesktopMeshRuntime::start`). The keystore lives at
//! mesh-llm's default path (`~/.mesh-llm/owner-keystore.json`) so a machine
//! has one owner identity whether mesh runs embedded in Buzz or standalone.

use std::path::PathBuf;
use std::sync::OnceLock;

use mesh_llm_host_runtime::crypto::{
    default_keystore_path, keystore_exists, load_keystore, save_keystore, OwnerKeypair,
};

#[derive(Debug, Clone)]
pub struct OwnerIdentity {
    pub keystore_path: PathBuf,
    pub owner_id: String,
    pub verifying_key_hex: String,
}

impl OwnerIdentity {
    /// Sign a Buzz-to-MeshLLM ownership binding. The member's Nostr signature
    /// authenticates the discovery event; this Ed25519 signature proves the
    /// advertised owner id is backed by the MeshLLM owner key itself.
    pub fn sign_member_binding(&self, member_pubkey: &str) -> anyhow::Result<String> {
        let keypair = load_keystore(&self.keystore_path, None).map_err(|error| {
            anyhow::anyhow!("failed to load mesh owner keystore for binding: {error}")
        })?;
        Ok(hex::encode(
            keypair.sign_bytes(&member_binding_bytes(member_pubkey)),
        ))
    }
}

pub fn member_binding_bytes(member_pubkey: &str) -> Vec<u8> {
    format!(
        "buzz-mesh-owner-binding-v1:{}",
        member_pubkey.trim().to_ascii_lowercase()
    )
    .into_bytes()
}

fn owner_identity(path: PathBuf, keypair: &OwnerKeypair) -> OwnerIdentity {
    OwnerIdentity {
        owner_id: keypair.owner_id(),
        verifying_key_hex: hex::encode(keypair.verifying_key().as_bytes()),
        keystore_path: path,
    }
}

/// Load-or-generate the machine's mesh owner identity. Cached for the process
/// lifetime — the keystore is stable once created.
pub fn ensure_owner_identity() -> anyhow::Result<OwnerIdentity> {
    static CACHE: OnceLock<Result<OwnerIdentity, String>> = OnceLock::new();
    CACHE
        .get_or_init(|| ensure_owner_identity_uncached().map_err(|error| format!("{error:#}")))
        .clone()
        .map_err(|error| anyhow::anyhow!(error))
}

fn ensure_owner_identity_uncached() -> anyhow::Result<OwnerIdentity> {
    let path = default_keystore_path()
        .map_err(|error| anyhow::anyhow!("cannot resolve mesh owner keystore path: {error}"))?;
    if keystore_exists(&path) {
        let keypair = load_keystore(&path, None).map_err(|error| {
            anyhow::anyhow!(
                "failed to load mesh owner keystore at {}: {error}",
                path.display()
            )
        })?;
        return Ok(owner_identity(path, &keypair));
    }
    let keypair = OwnerKeypair::generate();
    save_keystore(&path, &keypair, None, false).map_err(|error| {
        anyhow::anyhow!(
            "failed to save mesh owner keystore at {}: {error}",
            path.display()
        )
    })?;
    Ok(owner_identity(path, &keypair))
}
