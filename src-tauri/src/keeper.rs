//! Keeps the YouTube session accepted.
//!
//! Google signs a browser in with a handful of cookies, and a browser keeps them
//! valid by visiting Google's own pages: YouTube Music's page quietly swaps the
//! short-lived `__Secure-*PSIDTS` tokens for new ones every so often. Prismix
//! makes its YouTube requests itself (net.rs), so nothing ever did that visit,
//! and the cookies saved at sign-in went stale: about two hours later Google
//! stopped accepting them and deleted the login's cookies in its answer, and the
//! app asked for a new sign-in. (The log shows `changed` lists with only `SIDCC`
//! and friends, never a `PSIDTS`, and the first rejection two hours after sign-in.)
//!
//! This module does the visit. It opens a hidden window on the same browser
//! profile the sign-in window uses, loads YouTube Music so Google's own page does
//! the renewing, and copies the refreshed cookies into the vault:
//!
//! - once when the app starts, and then every 30 minutes while it runs;
//! - at once when Google rejects the session mid-run (net.rs), so a rejection
//!   renews the login instead of ending it, within a 5 minute cooldown.
//!
//! The window loads only Google and YouTube pages (the sign-in window's rule),
//! has no access to the app's commands (capabilities only name the "main"
//! window), and closes itself as soon as it has what it came for. If the
//! profile itself has been signed out, it says so in the log and stops trying
//! until the next sign-in; the page then asks for one, as before.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};
use url::Url;

use crate::auth::{allowed_in_sign_in, cookies_for, current_host, emit_changed, header_of, MAX_COOKIE_HEADER, YT_SIGNING};
use crate::error::{AppError, AppResult};
use crate::net::CHROME_UA;
use crate::vault::{Service, Vault};

const LABEL: &str = "auth-youtube-keeper";
const SIGN_IN_LABEL: &str = "auth-youtube";
const MUSIC: &str = "https://music.youtube.com/";
/// The token Google rotates; seeing it change means the page has done its renewing.
const ROTATING: &str = "__Secure-1PSIDTS";

const FIRST_RUN_AFTER: Duration = Duration::from_secs(2);
const EVERY: Duration = Duration::from_secs(30 * 60);
/// Longest a visit may take before the window is closed.
const GIVE_UP: Duration = Duration::from_secs(45);
/// After this long on a Google page instead of YouTube Music, the profile is taken to be signed out.
const BOUNCE_AFTER: Duration = Duration::from_secs(10);
/// How long to wait after the token changed for the rest of the cookies to land.
const SETTLE: Duration = Duration::from_secs(3);
/// A rejection asks for a renewal at most this often.
const COOLDOWN_SECS: u64 = 5 * 60;

static RUNNING: AtomicBool = AtomicBool::new(false);
/// Unix seconds when the last visit finished.
static LAST_RUN: AtomicU64 = AtomicU64::new(0);
/// The session generation whose profile was found signed out: not visited again until a new sign-in.
static SIGNED_OUT_GENERATION: AtomicU64 = AtomicU64::new(0);

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn value_of(pairs: &[(String, String)], name: &str) -> Option<String> {
    pairs.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone())
}

/// Starts the schedule: a visit just after launch, then one every 30 minutes.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_RUN_AFTER).await;
        loop {
            refresh(&app).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Google just rejected the saved session: renew it now rather than wait for the schedule.
pub fn renew_soon(app: &AppHandle) {
    if now_secs().saturating_sub(LAST_RUN.load(Ordering::Relaxed)) < COOLDOWN_SECS {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { refresh(&app).await });
}

async fn refresh(app: &AppHandle) {
    // One visit at a time; a request that arrives during one is covered by it.
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = run(app).await;
    LAST_RUN.store(now_secs(), Ordering::Relaxed);
    RUNNING.store(false, Ordering::SeqCst);
    if let Err(error) = result {
        log::warn!("YouTube session keeper: {error}");
    }
}

/// What the hidden window saw.
struct Seen {
    /// The profile's cookies for YouTube Music, once it had a signed-in set.
    cookies: Option<Vec<(String, String)>>,
    /// The rotating token changed while the page ran.
    rotated: bool,
    /// The page was sent to a Google sign-in instead: the profile is signed out.
    bounced: bool,
}

async fn run(app: &AppHandle) -> AppResult<()> {
    let vault = app.state::<Vault>();
    if vault.cookie_header(Service::Youtube).is_none() {
        return Ok(());
    }
    let generation = vault.generation(Service::Youtube);
    if SIGNED_OUT_GENERATION.load(Ordering::Relaxed) == generation {
        return Ok(());
    }
    // The sign-in window is open on this very profile and does the same job; and one leftover is enough.
    if app.get_webview_window(SIGN_IN_LABEL).is_some() || app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }

    // The same settings as the sign-in window's, so the two can share one profile.
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(Url::parse("about:blank").expect("about:blank")))
        .title("Prismix session")
        .visible(false)
        .skip_taskbar(true)
        .inner_size(480.0, 720.0)
        .user_agent(CHROME_UA)
        // Google and YouTube pages only; anything else is simply refused (nothing is opened for the user here).
        .on_navigation(|url| allowed_in_sign_in(Service::Youtube, url));
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        builder = builder.data_directory(crate::auth::sign_in_profile(app)?);
    }
    let window = builder.build()?;

    let started = Instant::now();
    let seen = visit(app, &window).await;
    let _ = window.close();

    if seen.bounced {
        SIGNED_OUT_GENERATION.store(generation, Ordering::Relaxed);
        log::warn!("YouTube session keeper: the sign-in profile is signed out too, so the session can't be renewed; sign in again");
        return Ok(());
    }
    let Some(pairs) = seen.cookies else {
        log::warn!("YouTube session keeper: no signed-in cookies after {}s on YouTube Music; will try again later", started.elapsed().as_secs());
        return Ok(());
    };
    let header = header_of(&pairs);
    if header.len() > MAX_COOKIE_HEADER {
        return Err(AppError::invalid("the profile's cookies are too large to keep"));
    }
    log::info!(
        "YouTube session keeper: visited YouTube Music in {}s, login tokens {}",
        started.elapsed().as_secs(),
        if seen.rotated { "renewed" } else { "unchanged" }
    );
    if let Some(sessions) = vault.adopt_fresh_cookies(Service::Youtube, generation, header) {
        // The login itself changed (it had been ended and is back): the page re-reads the account.
        emit_changed(app, sessions);
    }
    Ok(())
}

/// Loads YouTube Music in the hidden window and watches its cookies until the page has renewed them.
async fn visit(app: &AppHandle, window: &WebviewWindow) -> Seen {
    let mut seen = Seen { cookies: None, rotated: false, bounced: false };
    let before = cookies_for(window, MUSIC).await.map(|c| value_of(&c, ROTATING)).unwrap_or(None);
    let Ok(url) = Url::parse(MUSIC) else { return seen };
    if window.navigate(url).is_err() {
        return seen;
    }
    let started = Instant::now();
    let mut rotated_at: Option<Instant> = None;
    loop {
        tokio::time::sleep(Duration::from_millis(1000)).await;
        if app.get_webview_window(LABEL).is_none() || started.elapsed() > GIVE_UP {
            break;
        }
        let host = current_host(window).unwrap_or_default();
        if host != "music.youtube.com" {
            if started.elapsed() > BOUNCE_AFTER && host.ends_with("google.com") {
                seen.bounced = true;
                break;
            }
            continue;
        }
        let Some(now) = cookies_for(window, MUSIC).await else { continue };
        if !now.iter().any(|(k, v)| YT_SIGNING.contains(&k.as_str()) && !v.is_empty()) {
            continue;
        }
        let rotating = value_of(&now, ROTATING);
        seen.cookies = Some(now);
        if rotating != before {
            seen.rotated = true;
            match rotated_at {
                None => rotated_at = Some(Instant::now()),
                Some(at) if at.elapsed() >= SETTLE => break,
                Some(_) => {}
            }
        }
    }
    seen
}
