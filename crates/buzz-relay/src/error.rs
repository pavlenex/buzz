//! Error types for the relay crate.

use thiserror::Error;

/// Top-level error type for relay operations.
#[derive(Debug, Error)]
pub enum RelayError {
    /// A WebSocket transport error occurred.
    #[error("WebSocket error: {0}")]
    WebSocket(String),

    /// A JSON serialization or deserialization error.
    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    /// A database operation failed.
    #[error("Database error: {0}")]
    Database(#[from] buzz_db::DbError),

    /// An authentication error from the auth service.
    #[error("Auth error: {0}")]
    Auth(#[from] buzz_auth::AuthError),

    /// A pub/sub error from the pubsub service.
    #[error("PubSub error: {0}")]
    PubSub(#[from] buzz_pubsub::PubSubError),

    /// The relay has reached its maximum number of concurrent connections.
    #[error("Connection limit reached")]
    ConnectionLimitReached,

    /// The client has exceeded the allowed request rate.
    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    /// The client attempted an operation that requires authentication.
    #[error("Not authenticated")]
    NotAuthenticated,

    /// The connection host does not map to any community.
    ///
    /// Fail-closed tenant resolution (conformance row-zero): an unmapped host is
    /// rejected outright — there is no default-community fallthrough. The message
    /// is deliberately generic so it cannot be used as a cross-tenant existence
    /// oracle (which hosts are configured).
    #[error("Host not mapped to a community")]
    HostNotMapped,

    /// The client sent a message that could not be parsed.
    #[error("Invalid message format: {0}")]
    InvalidMessage(String),

    /// An unexpected internal error occurred.
    #[error("Internal error: {0}")]
    Internal(String),
}

/// Convenience alias for relay operation results.
pub type Result<T> = std::result::Result<T, RelayError>;
