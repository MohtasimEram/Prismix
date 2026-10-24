# In-app updates

Prismix checks GitHub for a newer release (8 seconds after launch, then every 6 hours, and from
Settings › Updates › Check for Updates), downloads the signed installer and restarts into it.

## One-time setup

1. **Make a signing key** (this is what makes updates safe; keep the private one secret):

   ```
   npx tauri signer generate -w "$HOME/.tauri/prismix.key"
   ```

   It prints a **public key** and saves the private key to that file. A password is optional.

2. **Public key into the app:** paste the public key (the long `dW50cnVzdGVkIGNvbW1lbnQ6…` text)
   over `PASTE_YOUR_PUBLIC_KEY_HERE` in `src-tauri/tauri.conf.json` › `plugins` › `updater` › `pubkey`.

3. **Private key into GitHub:** repo › Settings › Secrets and variables › Actions › New secret:
   - `TAURI_SIGNING_PRIVATE_KEY`: the full contents of the private key file
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password (leave empty if you set none)

   Back the private key up somewhere safe. If you lose it, installed copies can't be updated any more.

4. `npm install` (adds the two updater packages to `package-lock.json`).

## Releasing from now on

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
   (and `DESKTOP_VERSION` in `src/desktop/desktopBridge.ts`).
2. Commit and push, then tag and push the tag:

   ```
   git tag v1.0.2
   git push origin v1.0.2
   ```

3. GitHub Actions builds, signs and publishes the release (installer + `latest.json`).
   Paste your notes into the release description; the updater shows them in Settings.

Installed copies pick it up on their next check.

## Notes

- The first build that includes the updater (v1.0.1) has to be installed by hand once. Copies of
  v1.0.0 can't update themselves.
- Building locally with `npm run desktop:build` also needs `TAURI_SIGNING_PRIVATE_KEY` set
  (`$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$HOME\.tauri\prismix.key" -Raw` in PowerShell),
  because the config asks for update artifacts.
- The workflow builds Windows only. Add `macos-latest` / `ubuntu-22.04` to a matrix to build those.
- The update check only runs in installed (production) builds, never in `npm run desktop:dev`.
