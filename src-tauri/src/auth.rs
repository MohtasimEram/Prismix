//! Signing in: the service's own login page in a separate window.
//!
//! The window loads Google's / Spotify's real sign-in (no IPC: capabilities
//! only cover the "main" window, so remote pages can't call any command).
//! A background task watches the window's cookies; once the session cookies
//! appear on music.youtube.com / open.spotify.com they're copied into the
//! encrypted vault, the window closes, and `auth://changed` tells the page.

use std::time::{Duration, Instant};

use tauri::webview::{PageLoadEvent, WebviewWindowBuilder};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::net::CHROME_UA;
use crate::vault::{Service, Sessions, Vault};

const YT_SIGN_IN: &str = "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const YT_ADD_ACCOUNT: &str = "https://accounts.google.com/AddSession?ltmpl=music&service=youtube&passive=true&continue=https%3A%2F%2Fmusic.youtube.com%2F";
const SPOTIFY_SIGN_IN: &str = "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F";

const YT_SIGNING: [&str; 3] = ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID"];
const MAX_COOKIE_HEADER: usize = 16 * 1024;
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(20 * 60);

fn label(service: Service) -> &'static str {
    match service {
        Service::Youtube => "auth-youtube",
        Service::Spotify => "auth-spotify",
    }
}

/// Hosts the sign-in window may show; anything else opens in the system browser.
fn allowed_in_sign_in(service: Service, url: &Url) -> bool {
    if url.scheme() == "about" {
        return true;
    }
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or("");
    let under = |root: &str| host == root || host.ends_with(&format!(".{root}"));
    match service {
        Service::Youtube => {
            under("google.com") || under("youtube.com") || under("gstatic.com") || under("googleusercontent.com") || under("google.co.in") || host.starts_with("accounts.google.")
        }
        Service::Spotify => under("spotify.com") || under("scdn.co") || under("google.com") || under("facebook.com") || under("apple.com") || under("appleid.apple.com"),
    }
}

#[derive(serde::Serialize, Clone)]
pub struct AuthChanged {
    #[serde(flatten)]
    sessions: Sessions,
}

pub fn emit_changed(app: &AppHandle, sessions: Sessions) {
    let _ = app.emit_to("main", "auth://changed", sessions);
}

#[tauri::command]
pub fn auth_status(vault: State<'_, Vault>) -> Sessions {
    vault.sessions()
}

/// Cookie header for the sign-in window's view of `url`, only `name=value` pairs.
async fn cookies_for(window: &WebviewWindow, url: &str) -> Option<Vec<(String, String)>> {
    let url = Url::parse(url).ok()?;
    let window = window.clone();
    // Reading cookies must not run on the main thread (it deadlocks on Windows).
    tauri::async_runtime::spawn_blocking(move || window.cookies_for_url(url).ok())
        .await
        .ok()
        .flatten()
        .map(|list| list.into_iter().map(|c| (c.name().to_owned(), c.value().to_owned())).collect())
}

fn header_of(pairs: &[(String, String)]) -> String {
    pairs.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("; ")
}

fn current_host(window: &WebviewWindow) -> Option<String> {
    window.url().ok().and_then(|u| u.host_str().map(str::to_owned))
}

async fn watch(app: AppHandle, window: WebviewWindow, service: Service) {
    let started = Instant::now();
    loop {
        tokio::time::sleep(Duration::from_millis(900)).await;
        // The user closed the window, or it timed out.
        if app.get_webview_window(window.label()).is_none() {
            return;
        }
        if started.elapsed() > SIGN_IN_TIMEOUT {
            let _ = window.close();
            return;
        }
        let host = current_host(&window).unwrap_or_default();
        let found = match service {
            Service::Youtube if host == "music.youtube.com" => cookies_for(&window, "https://music.youtube.com/")
                .await
                .filter(|c| c.iter().any(|(k, v)| YT_SIGNING.contains(&k.as_str()) && !v.is_empty()))
                .map(|c| header_of(&c)),
            Service::Spotify if host == "open.spotify.com" => cookies_for(&window, "https://open.spotify.com/")
                .await
                .and_then(|c| c.into_iter().find(|(k, v)| k == "sp_dc" && !v.is_empty()))
                .map(|(k, v)| format!("{k}={v}")),
            _ => None,
        };
        let Some(header) = found else { continue };
        if header.len() > MAX_COOKIE_HEADER {
            continue;
        }
        let vault = app.state::<Vault>();
        match vault.set(service, Some(header)) {
            Ok(sessions) => emit_changed(&app, sessions),
            Err(error) => log::error!("couldn't store the session: {error}"),
        }
        let _ = window.close();
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.set_focus();
        }
        return;
    }
}

#[tauri::command]
pub async fn auth_sign_in(app: AppHandle, vault: State<'_, Vault>, service: String, add_account: Option<bool>) -> AppResult<()> {
    let service = Service::parse(&service)?;
    if let Some(existing) = app.get_webview_window(label(service)) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    let target = match (service, add_account.unwrap_or(false)) {
        (Service::Youtube, false) => YT_SIGN_IN,
        (Service::Youtube, true) => YT_ADD_ACCOUNT,
        (Service::Spotify, _) => SPOTIFY_SIGN_IN,
    };
    let target = Url::parse(target).map_err(|e| AppError::internal(e.to_string()))?;
    let clear = vault.take_clear_webview(service);

    let opener = app.clone();
    let title = match service {
        Service::Youtube => "Sign in to YouTube Music",
        Service::Spotify => "Sign in to Spotify",
    };
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(&app, label(service), WebviewUrl::External(Url::parse("about:blank").expect("about:blank")))
        .title(title)
        .inner_size(480.0, 720.0)
        .min_inner_size(380.0, 520.0)
        .center()
        .user_agent(CHROME_UA)
        .on_navigation(move |url| {
            if allowed_in_sign_in(service, url) {
                return true;
            }
            // Help links and the like go to the real browser, not this window.
            use tauri_plugin_opener::OpenerExt;
            let _ = opener.opener().open_url(url.as_str(), None::<&str>);
            false
        })
        .on_page_load(|_window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                log::debug!("sign-in window at {}", payload.url().host_str().unwrap_or(""));
            }
        });

    // Its own profile on Windows and Linux, apart from the player's webview.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let dir = app.path().app_local_data_dir().map_err(|e| AppError::internal(e.to_string()))?.join("sign-in-profile");
        builder = builder.data_directory(dir);
    }

    let window = builder.build()?;
    if clear {
        let _ = window.clear_all_browsing_data();
    }
    window.navigate(target)?;
    tauri::async_runtime::spawn(watch(app.clone(), window, service));
    Ok(())
}

#[tauri::command]
pub fn auth_sign_out(app: AppHandle, vault: State<'_, Vault>, service: String) -> AppResult<Sessions> {
    let service = Service::parse(&service)?;
    if let Some(window) = app.get_webview_window(label(service)) {
        let _ = window.close();
    }
    let sessions = vault.set(service, None)?;
    emit_changed(&app, sessions);
    Ok(sessions)
}

/// Checks and normalises a pasted Cookie header: `name=value` pairs, no control characters.
pub fn parse_cookie_header(service: Service, raw: &str) -> AppResult<String> {
    let raw = raw.trim().trim_start_matches("Cookie:").trim_start_matches("cookie:").trim();
    if raw.is_empty() || raw.len() > MAX_COOKIE_HEADER {
        return Err(AppError::invalid("Paste the whole Cookie header (it looks empty or far too long)"));
    }
    if raw.chars().any(|c| c.is_control()) {
        return Err(AppError::invalid("The cookie text has line breaks or control characters; copy just the header value"));
    }
    // Spotify: a bare sp_dc value is accepted too.
    if service == Service::Spotify && !raw.contains('=') {
        if raw.contains(';') || raw.contains(' ') {
            return Err(AppError::invalid("That doesn't look like an sp_dc value"));
        }
        return Ok(format!("sp_dc={raw}"));
    }
    let mut pairs: Vec<(String, String)> = Vec::new();
    for part in raw.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let Some((name, value)) = part.split_once('=') else { continue };
        let (name, value) = (name.trim(), value.trim());
        let valid_name = !name.is_empty() && name.bytes().all(|b| b.is_ascii_graphic() && !b"()<>@,;:\\\"/[]?={}".contains(&b));
        let valid_value = value.bytes().all(|b| b.is_ascii_graphic() && b != b';' && b != b',' && b != b'\\');
        if valid_name && valid_value && !value.is_empty() {
            pairs.retain(|(k, _)| k != name);
            pairs.push((name.to_owned(), value.trim_matches('"').to_owned()));
        }
    }
    match service {
        Service::Youtube => {
            if !pairs.iter().any(|(k, _)| YT_SIGNING.contains(&k.as_str())) {
                return Err(AppError::invalid("No SAPISID / __Secure-3PAPISID cookie found. Copy the Cookie header from a music.youtube.com request while signed in"));
            }
            Ok(header_of(&pairs))
        }
        Service::Spotify => {
            let sp_dc = pairs.into_iter().find(|(k, _)| k == "sp_dc").ok_or_else(|| AppError::invalid("No sp_dc cookie found. Copy it from open.spotify.com while signed in"))?;
            Ok(format!("sp_dc={}", sp_dc.1))
        }
    }
}

#[tauri::command]
pub fn auth_import_cookies(app: AppHandle, vault: State<'_, Vault>, service: String, cookie_header: String) -> AppResult<Sessions> {
    let service = Service::parse(&service)?;
    let header = parse_cookie_header(service, &cookie_header)?;
    let sessions = vault.set(service, Some(header))?;
    emit_changed(&app, sessions);
    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_youtube_cookies() {
        let h = parse_cookie_header(Service::Youtube, "Cookie: SID=a; SAPISID=b/c; junk; HSID=d").unwrap();
        assert_eq!(h, "SID=a; SAPISID=b/c; HSID=d");
        assert!(parse_cookie_header(Service::Youtube, "SID=a").is_err());
        assert!(parse_cookie_header(Service::Youtube, "SAPISID=a\r\nX: y").is_err());
    }

    #[test]
    fn parses_spotify_cookies() {
        assert_eq!(parse_cookie_header(Service::Spotify, "a=1; sp_dc=XYZ").unwrap(), "sp_dc=XYZ");
        assert_eq!(parse_cookie_header(Service::Spotify, "XYZ").unwrap(), "sp_dc=XYZ");
    }
}
