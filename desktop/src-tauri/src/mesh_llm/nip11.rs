//! NIP-11 fetch helper specialised for mesh-LLM bootstrapping.
//!
//! At session start the desktop queries the connected Sprout relay's
//! NIP-11 document and reads the `iroh_relay_url` field
//! ([`sprout_relay::nip11::RelayInfo::iroh_relay_url`]). When set, this is
//! the URL the desktop signs NIP-98 bearer tokens against and dials iroh
//! connections through.
//!
//! Unreachable relays / malformed responses / missing field all return
//! `Ok(None)` — the desktop falls back to "mesh-LLM disabled for this
//! relay", same UX as a relay that simply doesn't host iroh.

use std::time::Duration;

const NIP11_TIMEOUT: Duration = Duration::from_secs(5);

/// Errors that bubble up only for *infrastructural* failures the caller
/// should surface (e.g. a malformed user-provided URL). Network and
/// "field-not-present" cases collapse to `Ok(None)` because mesh-LLM is
/// optional.
#[derive(Debug, thiserror::Error)]
pub enum Nip11Error {
    /// The provided relay URL doesn't start with `ws://` or `wss://`.
    #[error("not a ws:// or wss:// URL: {0}")]
    NotWebsocketUrl(String),
    /// The `reqwest` client failed to construct.
    #[error("http client init: {0}")]
    ClientBuild(String),
}

/// Convert a Nostr `ws(s)://` relay URL to its `http(s)://` NIP-11 base.
fn to_http_base(relay_url: &str) -> Result<String, Nip11Error> {
    if let Some(rest) = relay_url.strip_prefix("wss://") {
        Ok(format!("https://{rest}"))
    } else if let Some(rest) = relay_url.strip_prefix("ws://") {
        Ok(format!("http://{rest}"))
    } else {
        Err(Nip11Error::NotWebsocketUrl(relay_url.to_string()))
    }
}

/// Fetch the relay's NIP-11 document and extract `iroh_relay_url`.
///
/// Returns:
/// - `Ok(Some(url))` — the relay advertises an iroh-relay endpoint.
/// - `Ok(None)` — relay is reachable but does not advertise `iroh_relay_url`,
///   OR the relay is unreachable / returned a malformed doc. Mesh-LLM is
///   silently disabled in both cases (same UX).
/// - `Err(_)` — the *caller* gave us something un-fixable (e.g. a non-ws
///   URL). Should be surfaced as a developer error, not a runtime fallback.
pub async fn fetch_iroh_relay_url(relay_url: &str) -> Result<Option<String>, Nip11Error> {
    let http_url = to_http_base(relay_url)?;

    let client = reqwest::Client::builder()
        .timeout(NIP11_TIMEOUT)
        .build()
        .map_err(|e| Nip11Error::ClientBuild(e.to_string()))?;

    let resp = match client
        .get(&http_url)
        .header("Accept", "application/nostr+json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return Ok(None), // unreachable — graceful no-mesh
    };

    let json: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Ok(None), // malformed — graceful no-mesh
    };

    Ok(json
        .get("iroh_relay_url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_base_strips_ws_prefix() {
        assert_eq!(
            to_http_base("wss://relay.example.com/iroh").unwrap(),
            "https://relay.example.com/iroh",
        );
        assert_eq!(
            to_http_base("ws://localhost:3000").unwrap(),
            "http://localhost:3000",
        );
    }

    #[test]
    fn http_base_rejects_non_ws() {
        assert!(matches!(
            to_http_base("https://relay.example.com"),
            Err(Nip11Error::NotWebsocketUrl(_))
        ));
        assert!(matches!(
            to_http_base("relay.example.com"),
            Err(Nip11Error::NotWebsocketUrl(_))
        ));
    }
}
