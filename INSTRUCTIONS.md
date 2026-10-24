# Building Prismix (and making the `.exe`)

This guide takes you from a fresh Windows PC to a working `Prismix` installer and portable `.exe`.
macOS and Linux steps are at the bottom.

> **Time:** the first build downloads and compiles a lot of Rust code and takes **10–25 minutes**.
> Later builds take 1–3 minutes.

---

## 1. Install the prerequisites (Windows 10/11)

| Tool | Why | How |
|---|---|---|
| **Node.js 22 or newer** | Builds the React interface | https://nodejs.org (choose the LTS or newer) |
| **Rust (stable)** | Builds the native desktop shell | https://rustup.rs → run `rustup-init.exe`, accept the defaults |
| **Visual Studio C++ Build Tools** | Rust needs the MSVC linker on Windows | https://visualstudio.microsoft.com/visual-cpp-build-tools/ → tick **"Desktop development with C++"** |
| **WebView2 Runtime** | The web engine the app draws with | Already included in Windows 11 and up-to-date Windows 10. Otherwise: https://developer.microsoft.com/microsoft-edge/webview2/ |

Restart your terminal after installing, then check everything is found:

```powershell
node --version     # v22.x or higher
npm --version
rustc --version    # 1.77.2 or higher
cargo --version
```

---

## 2. Get the project ready

Open **PowerShell** in the project folder (the one that contains `package.json`):

```powershell
npm install
```

This installs the interface dependencies. You only need to repeat it when `package.json` changes.

---

## 3. Run it in development mode

```powershell
npm run tauri dev
```

This starts the Vite dev server and opens the Prismix window. Edits to files in `src/` reload instantly.
The first run compiles the Rust side, so be patient.

> `npm run dev` on its own opens the interface in a browser, but **native features do not work there**
> (sign-in, downloads, Discord, tray, Listen Together). Always use `npm run tauri dev` for real testing.

---

## 4. Build the `.exe` and the installer

### Discord Rich Presence

Discord needs an *application ID* to show "Listening to Prismix". Prismix reads it from
`src-tauri/.cargo/config.toml`, so every build includes it automatically and **you don't set anything by hand**.

To use your own Discord application instead:

1. Go to https://discord.com/developers/applications and create an application named **Prismix**.
2. Upload `src-tauri/icons/icon.png` as its app icon.
3. Copy the **Application ID** and paste it into `src-tauri/.cargo/config.toml`.

The ID is public, not a secret, and is built into the app. Users never need to enter one.

### Build

```powershell
npm run tauri build -- --bundles nsis
```

`--bundles nsis` produces the standard Windows setup installer and avoids the extra MSI tooling download.
(Plain `npm run tauri build` builds *every* format for your platform; on Windows that includes MSI,
which needs the WiX toolset and an internet connection on first use.)

### Where your files are

All outputs are inside `src-tauri\target\release\`:

| File | What it is |
|---|---|
| `bundle\nsis\Prismix_1.0.0_x64-setup.exe` | **The installer.** Share this one. Installs per-user, no admin rights needed. |
| `prismix-desktop.exe` | **The raw app executable** (a portable build). Runs on its own on any PC that has the WebView2 runtime. |
| `bundle\msi\Prismix_1.0.0_x64_en-US.msi` | MSI installer (only if you built without `--bundles nsis`). |

> The installer downloads the WebView2 runtime automatically if the target PC lacks it.
> The portable `prismix-desktop.exe` does **not**, so it needs WebView2 already installed (standard on Windows 11).

To change the version number, edit `"version"` in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json`.

---

## 5. Run the checks (recommended before releasing)

```powershell
npm run typecheck          # TypeScript
npm test                   # unit tests
cd src-tauri
cargo test                 # Rust tests (network guard, vault, websockets, ...)
```

`src/data/music/mappers.test.ts` needs a `fixtures/` folder of saved YouTube responses. If that folder is
not in your copy of the project, that one test file will fail. It is unrelated to your changes.

---

## 6. Where Prismix keeps things

- **Downloaded songs:** `Downloads\Prismix\`
- **Settings & sign-in data:** your user profile's app-data folder for `app.prismix.desktop`
  (cookies are stored encrypted, with the key in the Windows credential store).
- **Logs:** the OS log directory for `app.prismix.desktop`.

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| `link.exe not found` / `linker error` | Install the **Desktop development with C++** workload (step 1) and restart the terminal. |
| `error: could not find Cargo.toml` | You're in the wrong folder. Run `tauri` commands from the project root (where `package.json` is). |
| White window / nothing renders | WebView2 is missing or outdated. Install the runtime from the link in step 1. |
| First build seems stuck | It is compiling hundreds of Rust crates. Check Task Manager for `rustc` / `cl` activity. |
| `npm install` fails on Node version | Prismix needs Node **22+** (`node --version`). |
| MSI build fails downloading WiX | Build only the installer you need: `npm run tauri build -- --bundles nsis`. |
| Antivirus flags the `.exe` | Unsigned apps often trigger SmartScreen/AV warnings. Code-signing with a certificate removes them. |
| Sign-in or settings vanished after upgrading from BitChord | The app identifier changed to `app.prismix.desktop`, so it starts with fresh data. Sign in again. |
| Need to wipe a bad build | Delete `dist` and `src-tauri\target`, then build again. |

---

## 8. Other platforms

### macOS
```bash
xcode-select --install
npm install
npm run tauri build
```
Output: `src-tauri/target/release/bundle/dmg/` and `.../macos/Prismix.app`.
Unsigned apps need right-click → Open the first time.

### Linux (Debian/Ubuntu)
```bash
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  libssl-dev libdbus-1-dev build-essential libxdo-dev \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
npm install
npm run tauri build
```
Output: `src-tauri/target/release/bundle/deb/` and `.../appimage/`.
Notes: "Keep playing in the tray" is off by default (stock GNOME has no tray), and global media keys
need X11 (they don't work under Wayland).

---

## 9. Releasing updates

**Every change to the code needs a new build.** The `.exe` is a snapshot: it contains the compiled interface
and the Rust shell, so editing `src/` does nothing to an app someone already installed.

### How to ship an update today (manual)

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
   (for example `1.0.0` → `1.1.0`).
2. `npm run tauri build -- --bundles nsis`
3. Upload `Prismix_1.1.0_x64-setup.exe` to a **GitHub Release** (tag `v1.1.0`) and tell users to download it.
   Running the new installer over the old one upgrades it in place and keeps their settings.

### How to make updates automatic (recommended next step)

Tauri has an official updater plugin (`tauri-plugin-updater`). The flow:

1. Generate a signing key pair once: `npx tauri signer generate -w ~/.tauri/prismix.key`
   (keep the private key secret; put the public key in `tauri.conf.json`).
2. Add the updater plugin and point it at an `updates` JSON file hosted on GitHub Releases.
3. On each release, build with the private key set (`TAURI_SIGNING_PRIVATE_KEY`). Tauri produces the installer,
   a `.sig` signature and a `latest.json` describing the new version.
4. Upload those files to the GitHub Release. The app checks on launch, downloads the signed update, verifies the
   signature, and restarts into the new version.
5. A GitHub Actions workflow (`tauri-apps/tauri-action`) can do steps 3–4 for you every time you push a tag.

The interface and Rust code are updated together this way, as one installer. There is no way to update only the
web part without shipping a new build, and signing keeps users safe from tampered updates.

---

## Quick reference

```powershell
npm install                                   # once
npm run tauri dev                             # develop
npm run tauri build -- --bundles nsis         # make the installer + exe
```
