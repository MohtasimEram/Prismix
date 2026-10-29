/// Every command the page may call. Listing them turns on Tauri's access
/// control for app commands: a window can only call what its capability
/// grants (capabilities/default.json → permissions/prismix.toml), so the
/// sign-in windows, which show remote pages, can call nothing at all.
const COMMANDS: &[&str] = &[
    "auth_status",
    "auth_sign_in",
    "auth_sign_out",
    "auth_import_cookies",
    "diag_log",
    "net_fetch",
    "net_abort",
    "ws_open",
    "ws_send",
    "ws_close",
    "discord_status",
    "discord_connect",
    "discord_disconnect",
    "discord_set_activity",
    "save_download",
    "prefs_get",
    "prefs_set",
    "tray_set_now_playing",
];

fn main() {
    println!("cargo:rerun-if-env-changed=PRISMIX_DISCORD_CLIENT_ID");
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("failed to run tauri-build");
}
