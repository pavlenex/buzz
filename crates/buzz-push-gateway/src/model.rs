//! Closed wire types for the stateless gateway.

use serde::{Deserialize, Serialize};

pub const MAX_REQUEST_BYTES: usize = 8 * 1024;
pub const MAX_GRANT_BYTES: usize = 4096;
pub const FALLBACK_TEXT: &str = "New activity";
pub const WIRE_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppProfile {
    BuzzIosProduction,
    BuzzIosSandbox,
}
impl AppProfile {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BuzzIosProduction => "buzz-ios-production",
            Self::BuzzIosSandbox => "buzz-ios-sandbox",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryClass {
    Silent,
    Default,
    TimeSensitive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wake {
    pub v: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant: Option<String>,
}

/// Relay request. `endpoint_grant` is opaque authenticated ciphertext minted by
/// the gateway sealing key and persisted with the relay-owned lease.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeliveryRequest {
    pub v: u8,
    pub endpoint_grant: String,
    pub request_id: uuid::Uuid,
    pub class: DeliveryClass,
    pub expires_at: i64,
    pub wake: Wake,
}

/// Authenticated grant plaintext. It is never accepted outside the AEAD envelope.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndpointGrant {
    pub v: u8,
    pub endpoint: String,
    pub relay_pubkey: String,
    pub app_profile: AppProfile,
    pub max_class: DeliveryClass,
    pub generation: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status", deny_unknown_fields)]
pub enum DeliveryResponse {
    Accepted,
    InvalidEndpoint {
        generation: i64,
        invalid_at: Option<i64>,
    },
    Retry {
        retry_after_seconds: Option<i64>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub error: &'static str,
}
