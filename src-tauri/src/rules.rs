//! The header rules the Prismix extension applied with declarativeNetRequest
//! (web/extension/lib/rules.ts, lyricsFetch.ts), applied to native requests.

use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, COOKIE, ORIGIN, REFERER};
use reqwest::Method;
use sha1::{Digest, Sha1};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::vault::{Service, Vault};

/// Never taken from the page: the transport's own, or what only the rules may set.
pub const FORBIDDEN_REQUEST_HEADERS: &[&str] = &[
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "keep-alive",
    "upgrade",
    "te",
    "trailer",
    "expect",
    "accept-encoding",
    "cookie",
    "cookie2",
    "origin",
    "referer",
    "authorization-on-redirect",
    "x-goog-authuser",
    "x-goog-pageid",
    "x-origin",
    "dnt",
];

/// Never handed to the page.
pub const HIDDEN_RESPONSE_HEADERS: &[&str] = &["set-cookie", "set-cookie2"];

const MUSIC: &str = "https://music.youtube.com";
const WWW: &str = "https://www.youtube.com";

fn set(headers: &mut HeaderMap, name: reqwest::header::HeaderName, value: &str) {
    if let Ok(value) = HeaderValue::from_str(value) {
        headers.insert(name, value);
    }
}

fn impersonate(headers: &mut HeaderMap, origin: &str, x_origin: bool) {
    set(headers, ORIGIN, origin);
    set(headers, REFERER, &format!("{origin}/"));
    if x_origin {
        set(headers, reqwest::header::HeaderName::from_static("x-origin"), origin);
    }
}

/// Origin/Referer (and Musixmatch's cookie) by destination, as the extension's rules did.
pub fn apply_site_headers(url: &Url, headers: &mut HeaderMap) {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    let path = url.path();
    match host.as_str() {
        "music.youtube.com" => impersonate(headers, MUSIC, path.starts_with("/youtubei/")),
        "www.youtube.com" => impersonate(headers, WWW, path.starts_with("/youtubei/")),
        "s.youtube.com" => impersonate(headers, MUSIC, false),
        "amp-api.music.apple.com" => impersonate(headers, "https://music.apple.com", false),
        "open.spotify.com" | "api-partner.spotify.com" | "clienttoken.spotify.com" => impersonate(headers, "https://open.spotify.com", false),
        _ if host == "googlevideo.com" || host.ends_with(".googlevideo.com") => {
            // VISIONOS-minted URLs are fetched with no Origin/Referer at all; a web Origin gets a 403 mid-track.
            let visionos = url.query_pairs().any(|(k, v)| k == "c" && v == "VISIONOS");
            if !visionos {
                set(headers, ORIGIN, WWW);
                set(headers, REFERER, &format!("{WWW}/"));
            }
        }
        _ if host == "musixmatch.com" || host.ends_with(".musixmatch.com") => set(headers, COOKIE, "mxm_bab=AB"),
        _ => {}
    }
}

fn digits(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && value.bytes().all(|b| b.is_ascii_digit())
}

fn cookie_value<'a>(header: &'a str, name: &str) -> Option<&'a str> {
    header.split(';').map(str::trim).find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k.trim() == name && !v.is_empty()).then_some(v.trim())
    })
}

const SIGNING_COOKIES: [&str; 3] = ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID"];

/// `SAPISIDHASH <seconds>_<sha1(seconds + " " + secret + " " + origin)>`.
pub fn sapisid_hash(secret: &str, origin: &str, now_secs: u64) -> String {
    let mut hasher = Sha1::new();
    hasher.update(format!("{now_secs} {secret} {origin}").as_bytes());
    format!("SAPISIDHASH {now_secs}_{}", hex::encode(hasher.finalize()))
}

/// Which signed-in YouTube requests the page may make: InnerTube, play-reporting pings, and the home page (account discovery).
fn youtube_signable(url: &Url, method: &Method) -> bool {
    let host = url.host_str().unwrap_or("");
    let path = url.path();
    let innertube = matches!(host, "music.youtube.com" | "www.youtube.com") && path.starts_with("/youtubei/v1/") && matches!(*method, Method::GET | Method::POST);
    let stats = matches!(host, "s.youtube.com" | "music.youtube.com" | "www.youtube.com")
        && ["/api/stats/playback", "/api/stats/watchtime", "/api/stats/atr"].contains(&path)
        && *method == Method::GET;
    let home = host == "music.youtube.com" && path == "/" && *method == Method::GET;
    url.scheme() == "https" && url.port().is_none() && (innertube || stats || home)
}

pub fn sign_youtube(
    vault: &Vault,
    url: &Url,
    method: &Method,
    headers: &mut HeaderMap,
    auth_user: &str,
    page_id: Option<&str>,
    sign_as: Option<&str>,
) -> AppResult<()> {
    if !youtube_signable(url, method) {
        return Err(AppError::blocked("This URL can't be requested as the signed-in user"));
    }
    if !digits(auth_user, 2) || page_id.is_some_and(|p| !digits(p, 32)) {
        return Err(AppError::invalid("Bad account identity"));
    }
    let cookies = vault.cookie_header(Service::Youtube).ok_or_else(|| AppError::unauthenticated("Not signed in to YouTube Music"))?;
    let secret = SIGNING_COOKIES
        .iter()
        .find_map(|name| cookie_value(&cookies, name))
        .ok_or_else(|| AppError::unauthenticated("The saved YouTube session has no signing cookie; sign in again"))?
        .to_owned();
    let origin = match sign_as {
        Some("music") => MUSIC.to_owned(),
        None => url.origin().ascii_serialization(),
        Some(_) => return Err(AppError::invalid("Bad signing origin")),
    };
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    set(headers, COOKIE, &cookies);
    set(headers, AUTHORIZATION, &sapisid_hash(&secret, &origin, now));
    set(headers, reqwest::header::HeaderName::from_static("x-goog-authuser"), auth_user);
    set(headers, reqwest::header::HeaderName::from_static("x-origin"), &origin);
    match page_id {
        Some(id) => set(headers, reqwest::header::HeaderName::from_static("x-goog-pageid"), id),
        None => {
            headers.remove("x-goog-pageid");
        }
    }
    Ok(())
}

/// Only the web player's token endpoint ever sees Spotify's session cookie.
pub fn sign_spotify(vault: &Vault, url: &Url, method: &Method, headers: &mut HeaderMap) -> AppResult<()> {
    if !(url.scheme() == "https" && url.host_str() == Some("open.spotify.com") && url.port().is_none() && url.path() == "/api/token" && *method == Method::GET) {
        return Err(AppError::blocked("This URL can't be requested as the signed-in Spotify user"));
    }
    let cookies = vault.cookie_header(Service::Spotify).ok_or_else(|| AppError::unauthenticated("Not signed in to Spotify"))?;
    set(headers, COOKIE, &cookies);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_format() {
        let h = sapisid_hash("abc", "https://music.youtube.com", 1700000000);
        assert!(h.starts_with("SAPISIDHASH 1700000000_"));
        assert_eq!(h.len(), "SAPISIDHASH 1700000000_".len() + 40);
    }

    #[test]
    fn signable_urls() {
        let ok = |u: &str, m: Method| youtube_signable(&Url::parse(u).unwrap(), &m);
        assert!(ok("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", Method::POST));
        assert!(ok("https://music.youtube.com/", Method::GET));
        assert!(ok("https://s.youtube.com/api/stats/playback?x=1", Method::GET));
        assert!(!ok("https://music.youtube.com/watch?v=1", Method::GET));
        assert!(!ok("https://evil.example/youtubei/v1/browse", Method::POST));
        assert!(!ok("https://music.youtube.com:8443/youtubei/v1/browse", Method::POST));
    }

    #[test]
    fn reads_cookies() {
        assert_eq!(cookie_value("a=1; SAPISID=xyz; b=2", "SAPISID"), Some("xyz"));
        assert_eq!(cookie_value("a=1", "SAPISID"), None);
    }
}
