use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{collections::HashMap, net::SocketAddr, path::PathBuf};
use thiserror::Error;
#[derive(Debug, Clone)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub health_addr: SocketAddr,
    pub public_delivery_url: url::Url,
    pub grant_key: Vec<u8>,
    pub apns_key_path: PathBuf,
    pub apns_key_id: String,
    pub apns_team_id: String,
    pub apns_topic: String,
}
#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("invalid environment variable {0}")]
    Invalid(&'static str),
}
impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_map(&std::env::vars().collect())
    }
    pub fn from_map(e: &HashMap<String, String>) -> Result<Self, ConfigError> {
        fn req<'a>(
            e: &'a HashMap<String, String>,
            k: &'static str,
        ) -> Result<&'a str, ConfigError> {
            e.get(k)
                .map(String::as_str)
                .filter(|v| !v.is_empty())
                .ok_or(ConfigError::Missing(k))
        }
        let grant_key = STANDARD
            .decode(req(e, "BUZZ_PUSH_GRANT_KEY")?)
            .map_err(|_| ConfigError::Invalid("BUZZ_PUSH_GRANT_KEY"))?;
        if grant_key.len() != 32 {
            return Err(ConfigError::Invalid("BUZZ_PUSH_GRANT_KEY"));
        }
        let public_delivery_url = req(e, "BUZZ_PUSH_PUBLIC_DELIVERY_URL")?
            .parse::<url::Url>()
            .map_err(|_| ConfigError::Invalid("BUZZ_PUSH_PUBLIC_DELIVERY_URL"))?;
        if public_delivery_url.scheme() != "https"
            || public_delivery_url.path() != "/v1/deliveries/apns"
        {
            return Err(ConfigError::Invalid("BUZZ_PUSH_PUBLIC_DELIVERY_URL"));
        }
        Ok(Self {
            bind_addr: e
                .get("BUZZ_PUSH_BIND_ADDR")
                .map(String::as_str)
                .unwrap_or("0.0.0.0:8080")
                .parse()
                .map_err(|_| ConfigError::Invalid("BUZZ_PUSH_BIND_ADDR"))?,
            health_addr: e
                .get("BUZZ_PUSH_HEALTH_ADDR")
                .map(String::as_str)
                .unwrap_or("0.0.0.0:8081")
                .parse()
                .map_err(|_| ConfigError::Invalid("BUZZ_PUSH_HEALTH_ADDR"))?,
            public_delivery_url,
            grant_key,
            apns_key_path: req(e, "BUZZ_PUSH_APNS_KEY_PATH")?.into(),
            apns_key_id: req(e, "BUZZ_PUSH_APNS_KEY_ID")?.to_owned(),
            apns_team_id: req(e, "BUZZ_PUSH_APNS_TEAM_ID")?.to_owned(),
            apns_topic: req(e, "BUZZ_PUSH_APNS_TOPIC")?.to_owned(),
        })
    }
}
