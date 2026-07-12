//! Authenticated client for the public stateless push gateway.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_RESPONSE_BYTES: usize = 8 * 1024;

/// Closed gateway issuance request; authority is supplied only by NIP-98.
#[derive(Debug, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GrantIssueRequest<'a> {
    /// Wire version.
    pub v: u8,
    /// Exact APNs token (64 lowercase hex characters).
    pub endpoint: &'a str,
    /// Configured gateway application profile.
    pub app_profile: &'a str,
    /// Highest class authorized by the validated subscriptions.
    pub max_class: &'a str,
    /// Strictly increasing installation generation.
    pub generation: i64,
    /// Grant expiry, never later than the signed lease expiration.
    pub expires_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GrantIssueResponse {
    endpoint_grant: String,
}

/// Issue one opaque APNs endpoint grant through the exact configured boundary.
pub async fn issue_apns_grant(
    url: &url::Url,
    timeout: std::time::Duration,
    relay_keys: &Keys,
    request: &GrantIssueRequest<'_>,
) -> Result<String, String> {
    let body = serde_json::to_vec(request).map_err(|_| "encode issuance request".to_string())?;
    let payload = hex::encode(Sha256::digest(&body));
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .tags([
            Tag::parse(["u", url.as_str()]).map_err(|_| "build issuance auth".to_string())?,
            Tag::parse(["method", "POST"]).map_err(|_| "build issuance auth".to_string())?,
            Tag::parse(["payload", &payload]).map_err(|_| "build issuance auth".to_string())?,
        ])
        .sign_with_keys(relay_keys)
        .map_err(|_| "sign issuance auth".to_string())?;
    let auth = format!("Nostr {}", STANDARD.encode(event.as_json()));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "build issuance client".to_string())?;
    let response = client
        .post(url.clone())
        .header(reqwest::header::AUTHORIZATION, auth)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "gateway issuance unavailable".to_string())?;
    if !response.status().is_success() {
        return Err("gateway rejected issuance".to_string());
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "read issuance response".to_string())?;
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("issuance response too large".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let parsed: GrantIssueResponse =
        serde_json::from_slice(&bytes).map_err(|_| "invalid issuance response".to_string())?;
    if parsed.endpoint_grant.is_empty() || parsed.endpoint_grant.len() > 4096 {
        return Err("invalid issuance response".to_string());
    }
    Ok(parsed.endpoint_grant)
}
