//! Authenticated, expiring endpoint grants. The gateway is stateless: relays
//! retain the opaque ciphertext and present it on each delivery attempt.
use crate::model::{EndpointGrant, MAX_GRANT_BYTES};
use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use thiserror::Error;

const AAD: &[u8] = b"buzz-stateless-push-grant-v1";
#[derive(Clone)]
pub struct GrantKey(Aes256Gcm);
#[derive(Debug, Error)]
pub enum GrantError {
    #[error("invalid endpoint grant")]
    Invalid,
}
impl GrantKey {
    pub fn new(key: &[u8]) -> Result<Self, GrantError> {
        Ok(Self(
            Aes256Gcm::new_from_slice(key).map_err(|_| GrantError::Invalid)?,
        ))
    }
    pub fn seal(&self, grant: &EndpointGrant) -> Result<String, GrantError> {
        let plaintext = serde_json::to_vec(grant).map_err(|_| GrantError::Invalid)?;
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let mut out = nonce.to_vec();
        out.extend(
            self.0
                .encrypt(
                    Nonce::from_slice(&nonce),
                    aes_gcm::aead::Payload {
                        msg: &plaintext,
                        aad: AAD,
                    },
                )
                .map_err(|_| GrantError::Invalid)?,
        );
        Ok(URL_SAFE_NO_PAD.encode(out))
    }
    pub fn open(&self, encoded: &str) -> Result<EndpointGrant, GrantError> {
        if encoded.len() > MAX_GRANT_BYTES {
            return Err(GrantError::Invalid);
        }
        let bytes = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| GrantError::Invalid)?;
        if bytes.len() < 13 {
            return Err(GrantError::Invalid);
        }
        let plaintext = self
            .0
            .decrypt(
                Nonce::from_slice(&bytes[..12]),
                aes_gcm::aead::Payload {
                    msg: &bytes[12..],
                    aad: AAD,
                },
            )
            .map_err(|_| GrantError::Invalid)?;
        crate::strict_json::from_slice(&plaintext).map_err(|_| GrantError::Invalid)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    #[test]
    fn sealed_grants_round_trip_and_tampering_fails() {
        let key = GrantKey::new(&[7; 32]).unwrap();
        let g = EndpointGrant {
            v: 1,
            endpoint: "00".repeat(32),
            relay_pubkey: "11".repeat(32),
            app_profile: AppProfile::BuzzIosProduction,
            max_class: DeliveryClass::Default,
            generation: 2,
            expires_at: 99,
        };
        let a = key.seal(&g).unwrap();
        let b = key.seal(&g).unwrap();
        assert_ne!(a, b);
        assert_eq!(key.open(&a).unwrap(), g);
        let mut bad = a.into_bytes();
        let n = bad.len() - 1;
        bad[n] = if bad[n] == b'A' { b'B' } else { b'A' };
        assert!(key.open(std::str::from_utf8(&bad).unwrap()).is_err());
    }
}
