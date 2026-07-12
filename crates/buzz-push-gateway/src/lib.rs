//! Stateless, capability-gated APNs last hop for NIP-PL.
pub mod apns;
pub mod config;
pub mod grant;
pub mod http;
pub mod model;
pub(crate) mod strict_json;
pub use http::{router, AppState};
