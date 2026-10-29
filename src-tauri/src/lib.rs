//! Prismix desktop: the native side of the React app in `src/`.
//!
//! | Module      | What it does                                                        | Frontend          |
//! |-------------|---------------------------------------------------------------------|-------------------|
//! | `net`       | `fetch` made by Rust, with the YouTube/Spotify header rules          | nativeFetch.ts    |
//! | `netguard`  | public https hosts only (no LAN, no localhost)                       |                   |
//! | `rules`     | Origin/Referer rules and request signing                            |                   |
//! | `vault`     | the YouTube/Spotify cookies, encrypted at rest                       |                   |
//! | `auth`      | sign-in window and cookie import                                    | session.ts        |
//! | `keeper`    | keeps the YouTube session accepted (hidden visits to YouTube Music)  |                   |
//! | `ws`        | WebSockets for Listen Together                                      | nativeSocket.ts   |
//! | `discord`   | Rich Presence over the Discord app's local RPC socket                | discord.ts        |
//! | `prefs`     | close-to-tray and media-key preferences                             | window.ts         |
//! | `tray`      | tray icon and menu                                                  | media.ts          |
//! | `shortcuts` | global media keys                                                   | media.ts          |

mod auth;
mod diag;
mod discord;
mod download;
mod error;
mod keeper;
mod net;
mod netguard;
mod prefs;
mod rules;
mod shortcuts;
mod tray;
mod vault;
mod ws;

#[cfg(target_os = "macos")]
use tauri::RunEvent;
use tauri::{Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

use crate::prefs::Prefs;

/// Windows that never get their size/position remembered (the sign-in windows open centred).
const TRANSIENT_WINDOWS: [&str; 3] = ["auth-youtube", "auth-spotify", "auth-youtube-keeper"];

pub fn run() {
    // reqwest and tokio-tungstenite share rustls; make ring its process-wide crypto provider.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let app = tauri::Builder::default()
        // Must come first: a second launch just brings the running window forward.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| tray::show_main(app)))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                // Room for days of session diagnostics before the file rolls over.
                .max_file_size(1_000_000)
                // Third-party crates are chatty at debug level.
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("hyper_util", log::LevelFilter::Warn)
                .level_for("rustls", log::LevelFilter::Warn)
                .level_for("tungstenite", log::LevelFilter::Warn)
                .level_for("tokio_tungstenite", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Visibility is ours to decide (it may have been hidden in the tray at exit).
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .with_denylist(&TRANSIENT_WINDOWS)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(shortcuts::handler).build())
        .plugin(tauri_plugin_opener::init())
        // In-app updates: checks the GitHub release feed (tauri.conf.json › plugins › updater).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            let config_dir = app.path().app_config_dir()?;

            app.manage(vault::Vault::open(&data_dir)?);
            app.manage(net::Net::new()?);
            app.manage(ws::Sockets::default());
            app.manage(discord::Discord::new());
            let prefs = Prefs::load(&config_dir);
            let media_keys = prefs.get().global_media_keys;
            app.manage(prefs);

            if let Err(error) = tray::create(&handle) {
                // Some Linux desktops have no tray; the app still works, closing just quits.
                log::warn!("no system tray: {error}");
            }
            if media_keys {
                shortcuts::apply(&handle, true);
            }

            // The window is created hidden so the restored size/position shows without a flash.
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            // Renews the saved YouTube session now and then (keeper.rs), as a browser would.
            keeper::start(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let app = window.app_handle();
                    let to_tray = app.state::<Prefs>().get().close_to_tray && app.try_state::<tray::Tray>().is_some();
                    if to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                // The player is gone: take any sign-in window with it and quit.
                WindowEvent::Destroyed => window.app_handle().exit(0),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            auth::auth_sign_in,
            auth::auth_sign_out,
            auth::auth_import_cookies,
            diag::diag_log,
            net::net_fetch,
            net::net_abort,
            ws::ws_open,
            ws::ws_send,
            ws::ws_close,
            discord::discord_status,
            discord::discord_connect,
            discord::discord_disconnect,
            discord::discord_set_activity,
            download::save_download,
            download::delete_download,
            prefs::prefs_get,
            prefs::prefs_set,
            tray::tray_set_now_playing,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Prismix");

    app.run(|_app, _event| {
        // Clicking the Dock icon brings back a window that was closed to the tray.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = _event {
            tray::show_main(_app);
        }
    });
}
