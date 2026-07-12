use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{collections::HashMap, net::SocketAddr, path::PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantKeyConfig {
    pub id: String,
    pub key: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_addr: SocketAddr,
    pub health_addr: SocketAddr,
    pub public_delivery_url: url::Url,
    /// Ordered current key first, followed by decrypt-only predecessors.
    pub grant_keys: Vec<GrantKeyConfig>,
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
        let grant_keys = req(e, "BUZZ_PUSH_GRANT_KEYS")?
            .split(',')
            .map(|entry| {
                let (id, encoded) = entry
                    .split_once(':')
                    .filter(|(id, encoded)| !id.is_empty() && !encoded.is_empty())
                    .ok_or(ConfigError::Invalid("BUZZ_PUSH_GRANT_KEYS"))?;
                let key = STANDARD
                    .decode(encoded)
                    .map_err(|_| ConfigError::Invalid("BUZZ_PUSH_GRANT_KEYS"))?;
                if key.len() != 32 {
                    return Err(ConfigError::Invalid("BUZZ_PUSH_GRANT_KEYS"));
                }
                Ok(GrantKeyConfig {
                    id: id.to_owned(),
                    key,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if grant_keys.is_empty() {
            return Err(ConfigError::Invalid("BUZZ_PUSH_GRANT_KEYS"));
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
            grant_keys,
            apns_key_path: req(e, "BUZZ_PUSH_APNS_KEY_PATH")?.into(),
            apns_key_id: req(e, "BUZZ_PUSH_APNS_KEY_ID")?.to_owned(),
            apns_team_id: req(e, "BUZZ_PUSH_APNS_TEAM_ID")?.to_owned(),
            apns_topic: req(e, "BUZZ_PUSH_APNS_TOPIC")?.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> HashMap<String, String> {
        HashMap::from([
            (
                "BUZZ_PUSH_GRANT_KEYS".into(),
                format!(
                    "current:{},old:{}",
                    STANDARD.encode([1; 32]),
                    STANDARD.encode([2; 32])
                ),
            ),
            (
                "BUZZ_PUSH_PUBLIC_DELIVERY_URL".into(),
                "https://push.example/v1/deliveries/apns".into(),
            ),
            ("BUZZ_PUSH_APNS_KEY_PATH".into(), "/key.p8".into()),
            ("BUZZ_PUSH_APNS_KEY_ID".into(), "key".into()),
            ("BUZZ_PUSH_APNS_TEAM_ID".into(), "team".into()),
            ("BUZZ_PUSH_APNS_TOPIC".into(), "app".into()),
        ])
    }

    #[test]
    fn grant_keys_preserve_current_then_predecessor_order() {
        let config = Config::from_map(&base()).unwrap();
        assert_eq!(config.grant_keys[0].id, "current");
        assert_eq!(config.grant_keys[1].id, "old");
    }

    #[test]
    fn malformed_or_empty_keyrings_fail_startup() {
        for value in ["", "missing_separator", "id:bad-base64"] {
            let mut env = base();
            env.insert("BUZZ_PUSH_GRANT_KEYS".into(), value.into());
            assert!(Config::from_map(&env).is_err());
        }
    }
}
