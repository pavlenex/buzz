//! Stateless delivery API and health routers.
use crate::{
    apns::{DeliveryOutcome, PushTransport},
    grant::GrantKeyring,
    model::*,
};
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use nostr::{
    nips::nip98::{verify_auth_header, HttpMethod},
    Event, JsonUtil, Timestamp,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tower::limit::ConcurrencyLimitLayer;
use tower_http::{limit::RequestBodyLimitLayer, timeout::TimeoutLayer};

#[derive(Clone)]
pub struct AppState {
    pub grant_keyring: GrantKeyring,
    pub transport: Arc<dyn PushTransport>,
    pub delivery_url: url::Url,
    pub accepting: Arc<AtomicBool>,
}
fn error(status: StatusCode, code: &'static str) -> Response {
    (status, Json(ErrorBody { error: code })).into_response()
}
fn valid_hex(v: &str, n: usize) -> bool {
    v.len() == n * 2
        && v.bytes()
            .all(|b| b.is_ascii_hexdigit() && (!b.is_ascii_alphabetic() || b.is_ascii_lowercase()))
}
fn auth_event_id(header: &str) -> Option<String> {
    let (prefix, encoded) = header.split_once(' ')?;
    if prefix != "Nostr" {
        return None;
    }
    Event::from_json(STANDARD.decode(encoded).ok()?)
        .ok()
        .map(|e| e.id.to_hex())
}
fn valid_wake(r: &DeliveryRequest) -> bool {
    r.v == WIRE_VERSION
        && r.wake.v == WIRE_VERSION
        && r.wake
            .grant
            .as_ref()
            .is_none_or(|g| g.len() <= MAX_GRANT_BYTES)
        && match r.class {
            DeliveryClass::Silent => r.wake.fallback.is_none(),
            _ => r.wake.fallback.as_deref() == Some(FALLBACK_TEXT),
        }
}
async fn deliver(State(s): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let r: DeliveryRequest = match crate::strict_json::from_slice(&body) {
        Ok(x) => x,
        Err(_) => return error(StatusCode::BAD_REQUEST, "invalid_request"),
    };
    if !valid_wake(&r) {
        return error(StatusCode::BAD_REQUEST, "invalid_request");
    }
    let auth = match headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        Some(x) => x,
        None => return error(StatusCode::UNAUTHORIZED, "invalid_auth"),
    };
    let _event = match auth_event_id(auth) {
        Some(x) => x,
        None => return error(StatusCode::UNAUTHORIZED, "invalid_auth"),
    };
    let relay = match verify_auth_header(
        auth,
        &s.delivery_url,
        HttpMethod::POST,
        Timestamp::now(),
        Some(&body),
    ) {
        Ok(x) => x.to_hex(),
        Err(_) => return error(StatusCode::UNAUTHORIZED, "invalid_auth"),
    };
    let grant = match s.grant_keyring.open(&r.endpoint_grant) {
        Ok(x) => x,
        Err(_) => return error(StatusCode::NOT_FOUND, "invalid_grant"),
    };
    let now = chrono::Utc::now().timestamp();
    if grant.v != WIRE_VERSION
        || !valid_hex(&grant.endpoint, 32)
        || !valid_hex(&grant.relay_pubkey, 32)
        || grant.relay_pubkey != relay
        || grant.generation < 1
        || grant.expires_at < now
        || r.expires_at < now
        || r.expires_at > grant.expires_at
        || r.class > grant.max_class
    {
        return error(StatusCode::NOT_FOUND, "invalid_grant");
    }
    match s
        .transport
        .send(&r, grant.app_profile, &grant.endpoint)
        .await
    {
        DeliveryOutcome::Accepted => {
            (StatusCode::OK, Json(DeliveryResponse::Accepted)).into_response()
        }
        DeliveryOutcome::InvalidEndpoint { unregistered_at } => (
            StatusCode::GONE,
            Json(DeliveryResponse::InvalidEndpoint {
                generation: grant.generation,
                invalid_at: unregistered_at,
            }),
        )
            .into_response(),
        DeliveryOutcome::Retry {
            retry_after_seconds,
        } => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(DeliveryResponse::Retry {
                retry_after_seconds,
            }),
        )
            .into_response(),
        DeliveryOutcome::RefreshCredential => {
            s.transport.refresh_credential();
            match s
                .transport
                .send(&r, grant.app_profile, &grant.endpoint)
                .await
            {
                DeliveryOutcome::Accepted => {
                    (StatusCode::OK, Json(DeliveryResponse::Accepted)).into_response()
                }
                DeliveryOutcome::InvalidEndpoint { unregistered_at } => (
                    StatusCode::GONE,
                    Json(DeliveryResponse::InvalidEndpoint {
                        generation: grant.generation,
                        invalid_at: unregistered_at,
                    }),
                )
                    .into_response(),
                DeliveryOutcome::Retry {
                    retry_after_seconds,
                } => (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(DeliveryResponse::Retry {
                        retry_after_seconds,
                    }),
                )
                    .into_response(),
                _ => error(StatusCode::SERVICE_UNAVAILABLE, "configuration_fault"),
            }
        }
        DeliveryOutcome::ConfigurationFault => {
            error(StatusCode::SERVICE_UNAVAILABLE, "configuration_fault")
        }
        DeliveryOutcome::PermanentRequestFault => error(StatusCode::BAD_REQUEST, "invalid_request"),
    }
}
async fn live() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status":"alive"}))
}
async fn ready(State(s): State<AppState>) -> Response {
    if s.accepting.load(Ordering::Relaxed) {
        Json(serde_json::json!({"status":"ready"})).into_response()
    } else {
        error(StatusCode::SERVICE_UNAVAILABLE, "not_ready")
    }
}
pub fn router(state: AppState) -> (Router, Router) {
    let public = Router::new()
        .route("/v1/deliveries/apns", post(deliver))
        .with_state(state.clone())
        .layer(RequestBodyLimitLayer::new(MAX_REQUEST_BYTES))
        .layer(ConcurrencyLimitLayer::new(256))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(20),
        ));
    let health = Router::new()
        .route("/_liveness", get(live))
        .route("/_readiness", get(ready))
        .with_state(state);
    (public, health)
}
