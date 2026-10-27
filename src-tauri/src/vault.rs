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

    /// The generation of a service's saved session (0 when there is none).
    pub fn generation(&self, service: Service) -> u64 {
        self.with(|s| s.entry(service).generation)
    }

    /// Folds the cookies a response set into the saved session, so the rotated
    /// ones Google hands out (the `__Secure-*PSIDTS` family) aren't lost; a
    /// session that never takes them in stops being accepted after a while.
    /// Only applies while the session is still the one the request went out
    /// with (`generation`), and never moves the generation: nothing signed in
    /// or out, so the page has nothing to re-read.
    pub fn merge_cookies(&self, service: Service, generation: u64, host: &str, set_cookies: &[String]) {
        if set_cookies.is_empty() {
            return;
        }
        self.with(|stored| {
            let entry = stored.entry(service);
            if entry.generation != generation {
                return;
            }
            let Some(existing) = entry.cookies.as_deref() else { return };
            let Some(merged) = merge_set_cookies(existing, set_cookies, host) else { return };
            entry.cookies = Some(merged);
            if let Err(error) = self.persist(stored) {
                log::warn!("couldn't save the refreshed session cookies: {error}");
            }
        });
    }

    pub fn sessions(&self) -> Sessions {
        self.with(|s| sessions_of(s))
    }
}

fn sessions_of(stored: &Stored) -> Sessions {
    let of = |e: &Entry| ServiceSession { signed_in: e.cookies.is_some(), generation: e.generation };
    Sessions { youtube: of(&stored.youtube), spotify: of(&stored.spotify) }
}

const MAX_COOKIE_HEADER: usize = 16 * 1024;
/// A response may not delete these: a stray answer must not be able to sign the app out.
const KEEP_COOKIES: [&str; 3] = ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID"];

fn cookie_name_ok(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && name.bytes().all(|b| b.is_ascii_graphic() && !b"()<>@,;:\\\"/[]?={}".contains(&b))
}

fn cookie_value_ok(value: &str) -> bool {
    value.len() <= 4096 && value.bytes().all(|b| b.is_ascii_graphic() && b != b';' && b != b',' && b != b'\\')
}

/// Whether a cookie scoped to `domain` may be taken from a response of `host`: it covers the host, and stays under Google's or YouTube's own domains.
fn domain_ok(domain: &str, host: &str) -> bool {
    let domain = domain.trim_start_matches('.').to_ascii_lowercase();
    let host = host.to_ascii_lowercase();
    let covers = host == domain || host.ends_with(&format!(".{domain}"));
    let ours = ["google.com", "youtube.com"].iter().any(|root| domain == *root || domain.ends_with(&format!(".{root}")));
    covers && ours
}

/// [existing] (a `Cookie` header) with the `Set-Cookie` lines of one response applied; `None` when nothing changes.
pub fn merge_set_cookies(existing: &str, set_cookies: &[String], host: &str) -> Option<String> {
    let mut pairs: Vec<(String, String)> = existing
        .split(';')
        .filter_map(|part| part.trim().split_once('=').map(|(k, v)| (k.trim().to_owned(), v.trim().to_owned())))
        .filter(|(k, _)| !k.is_empty())
        .collect();
    let before = pairs.clone();

    for line in set_cookies.iter().take(64) {
        let mut parts = line.split(';');
        let Some((name, value)) = parts.next().and_then(|first| first.split_once('=')) else { continue };
        let (name, value) = (name.trim(), value.trim().trim_matches('"'));
        if !cookie_name_ok(name) || !cookie_value_ok(value) {
            continue;
        }
        let mut expired = value.is_empty();
        let mut allowed = true;
        for attribute in parts {
            let (key, val) = attribute.trim().split_once('=').unwrap_or((attribute.trim(), ""));
            match key.to_ascii_lowercase().as_str() {
                "domain" if !domain_ok(val, host) => allowed = false,
                "max-age" if val.trim().parse::<i64>().is_ok_and(|n| n <= 0) => expired = true,
                "expires" if val.contains("1970") || val.contains("1601") => expired = true,
                _ => {}
            }
        }
        if !allowed {
            continue;
        }
        if expired {
            if !KEEP_COOKIES.contains(&name) {
                pairs.retain(|(k, _)| k != name);
            }
            continue;
        }
        match pairs.iter_mut().find(|(k, _)| k == name) {
            Some(slot) => slot.1 = value.to_owned(),
            None => pairs.push((name.to_owned(), value.to_owned())),
        }
    }

    if pairs == before {
        return None;
    }
    let merged = pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; ");
    (merged.len() <= MAX_COOKIE_HEADER).then_some(merged)
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
    fn merges_rotated_cookies() {
        let host = "music.youtube.com";
        let existing = "SID=a; SAPISID=s; __Secure-1PSIDTS=old";
        let lines = vec![
            "__Secure-1PSIDTS=new; Domain=.youtube.com; Path=/; Secure; HttpOnly".to_owned(),
            "NEWONE=1; Path=/".to_owned(),
        ];
        assert_eq!(merge_set_cookies(existing, &lines, host).unwrap(), "SID=a; SAPISID=s; __Secure-1PSIDTS=new; NEWONE=1");
        // Nothing changed: nothing to save.
        assert!(merge_set_cookies(existing, &["SID=a; Path=/".to_owned()], host).is_none());
        // Deleted cookies go, except the signing ones.
        let gone = vec!["SID=; Max-Age=0".to_owned(), "SAPISID=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT".to_owned()];
        assert_eq!(merge_set_cookies(existing, &gone, host).unwrap(), "SAPISID=s; __Secure-1PSIDTS=old");
        // A domain that isn't ours, or doesn't cover the host, is ignored.
        assert!(merge_set_cookies(existing, &["X=1; Domain=evil.example".to_owned()], host).is_none());
        assert!(merge_set_cookies(existing, &["X=1; Domain=www.youtube.com".to_owned()], host).is_none());
        // Malformed lines are skipped.
        assert!(merge_set_cookies(existing, &["bad cookie".to_owned(), "a b=1".to_owned()], host).is_none());
    }

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
