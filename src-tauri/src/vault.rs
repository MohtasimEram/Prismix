//! The session vault: the YouTube and Spotify cookies, encrypted at rest.
//!
//! The file (`<app data>/vault.bin`) is AES-256-GCM; its key lives in the OS
//! credential store (Windows Credential Manager, macOS Keychain, Secret
//! Service on Linux). Where no credential store is reachable, the key falls
//! back to a 0600 file beside the vault. Cookies never cross into the webview:
//! the page only sees `{ signedIn, generation }`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

const KEYRING_SERVICE: &str = "app.prismix.desktop";
const KEYRING_USER: &str = "session-vault-key";
const VAULT_FILE: &str = "vault.bin";
const KEY_FILE: &str = "vault.key";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Service {
    Youtube,
    Spotify,
}

impl Service {
    pub fn parse(value: &str) -> AppResult<Self> {
        match value {
            "youtube" => Ok(Self::Youtube),
            "spotify" => Ok(Self::Spotify),
            _ => Err(AppError::invalid("Unknown service")),
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Entry {
    cookies: Option<String>,
    generation: u64,
    /// Set on sign-out: the sign-in window's browsing data is wiped before it's next used.
    #[serde(default)]
    clear_webview: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct Stored {
    youtube: Entry,
    spotify: Entry,
}

impl Stored {
    fn entry(&mut self, service: Service) -> &mut Entry {
        match service {
            Service::Youtube => &mut self.youtube,
            Service::Spotify => &mut self.spotify,
        }
    }
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ServiceSession {
    signed_in: bool,
    generation: u64,
}

#[derive(Serialize, Clone, Copy)]
pub struct Sessions {
    youtube: ServiceSession,
    spotify: ServiceSession,
}

pub struct Vault {
    path: PathBuf,
    key: Zeroizing<[u8; 32]>,
    data: Mutex<Stored>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

fn decode_key(encoded: &str) -> Option<Zeroizing<[u8; 32]>> {
    let bytes = Zeroizing::new(base64::engine::general_purpose::STANDARD.decode(encoded.trim()).ok()?);
    let mut key = Zeroizing::new([0u8; 32]);
    if bytes.len() != 32 {
        return None;
    }
    key.copy_from_slice(&bytes);
    Some(key)
}

fn new_key() -> Zeroizing<[u8; 32]> {
    let mut key = Zeroizing::new([0u8; 32]);
    OsRng.fill_bytes(key.as_mut());
    key
}

/// The vault key: the OS credential store first, a private file only as a fallback.
fn load_key(dir: &Path) -> Zeroizing<[u8; 32]> {
    let key_file = dir.join(KEY_FILE);
    if let Ok(encoded) = fs::read_to_string(&key_file) {
        if let Some(key) = decode_key(&encoded) {
            return key;
        }
    }
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        match entry.get_password() {
            Ok(encoded) => {
                if let Some(key) = decode_key(&encoded) {
                    return key;
                }
            }
            Err(keyring::Error::NoEntry) => {
                let key = new_key();
                let encoded = Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(key.as_ref()));
                if entry.set_password(&encoded).is_ok() {
                    return key;
                }
            }
            Err(error) => log::warn!("credential store unavailable ({error}); using a key file"),
        }
    }
    let key = new_key();
    let encoded = Zeroizing::new(base64::engine::general_purpose::STANDARD.encode(key.as_ref()));
    if let Err(error) = write_private(&key_file, encoded.as_bytes()) {
        log::error!("couldn't save the vault key: {error}");
    }
    key
}

impl Vault {
    pub fn open(dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(dir)?;
        let key = load_key(dir);
        let path = dir.join(VAULT_FILE);
        let data = fs::read(&path).ok().and_then(|bytes| decrypt(&key, &bytes)).unwrap_or_default();
        Ok(Self { path, key, data: Mutex::new(data) })
    }

    fn with<R>(&self, f: impl FnOnce(&mut Stored) -> R) -> R {
        let mut guard = self.data.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut guard)
    }

    fn persist(&self, stored: &Stored) -> AppResult<()> {
        let plain = Zeroizing::new(serde_json::to_vec(stored).map_err(|e| AppError::internal(e.to_string()))?);
        let cipher = Aes256Gcm::new_from_slice(self.key.as_ref()).map_err(|_| AppError::internal("bad vault key"))?;
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let sealed = cipher.encrypt(Nonce::from_slice(&nonce), plain.as_slice()).map_err(|_| AppError::internal("couldn't encrypt the vault"))?;
        let mut out = Vec::with_capacity(12 + sealed.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        write_private(&self.path, &out)?;
        Ok(())
    }

    pub fn cookie_header(&self, service: Service) -> Option<String> {
        self.with(|s| s.entry(service).cookies.clone())
    }

    /// Stores (or with `None`, forgets) a session; the generation always moves on.
    pub fn set(&self, service: Service, cookies: Option<String>) -> AppResult<Sessions> {
        self.with(|stored| {
            let entry = stored.entry(service);
            entry.generation = (entry.generation + 1).max(now_ms());
            entry.clear_webview = cookies.is_none();
            entry.cookies = cookies;
            self.persist(stored)?;
            Ok(sessions_of(stored))
        })
    }

    /// Whether the sign-in window must start from a clean slate (after a sign-out); clears the flag.
    pub fn take_clear_webview(&self, service: Service) -> bool {
        self.with(|stored| {
            let entry = stored.entry(service);
            let clear = entry.clear_webview;
            if clear {
                entry.clear_webview = false;
                let _ = self.persist(stored);
            }
            clear
        })
    }

    pub fn sessions(&self) -> Sessions {
        self.with(|s| sessions_of(s))
    }
}

fn sessions_of(stored: &Stored) -> Sessions {
    let of = |e: &Entry| ServiceSession { signed_in: e.cookies.is_some(), generation: e.generation };
    Sessions { youtube: of(&stored.youtube), spotify: of(&stored.spotify) }
}

fn decrypt(key: &[u8; 32], bytes: &[u8]) -> Option<Stored> {
    if bytes.len() < 12 + 16 {
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let plain = Zeroizing::new(cipher.decrypt(Nonce::from_slice(&bytes[..12]), &bytes[12..]).ok()?);
    serde_json::from_slice(&plain).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let key = new_key();
        let dir = std::env::temp_dir().join(format!("prismix-vault-test-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let vault = Vault { path: dir.join(VAULT_FILE), key: key.clone(), data: Mutex::new(Stored::default()) };
        vault.set(Service::Youtube, Some("SAPISID=abc".into())).unwrap();
        let bytes = fs::read(dir.join(VAULT_FILE)).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("SAPISID"));
        let stored = decrypt(&key, &bytes).unwrap();
        assert_eq!(stored.youtube.cookies.as_deref(), Some("SAPISID=abc"));
        assert!(decrypt(&new_key(), &bytes).is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
