/**
 * Imported first by main.tsx: every module after it sees the patched fetch,
 * so YouTube.js, Shaka and the data layer reach the network through Rust.
 */
import { installNativeFetch } from './nativeFetch';
import { isDesktop, platform } from './tauri';

if (isDesktop()) {
  installNativeFetch();
  document.documentElement.dataset.desktop = platform();

  // The webview's own context menu (Reload, Inspect, Back) doesn't belong in an
  // app. Text fields and selected text keep theirs for copy and paste.
  window.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement | null;
    const editable = target?.closest('input, textarea, [contenteditable="true"]');
    const selection = window.getSelection()?.toString();
    if (!editable && !selection && !import.meta.env.DEV) event.preventDefault();
  });

  // Files dropped on the window would navigate the webview away from the app.
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', (event) => event.preventDefault());
}
