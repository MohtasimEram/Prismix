import { create } from 'zustand';
import { isDesktop } from './tauri';

/**
 * In-app updates. Prismix asks GitHub's latest release for `latest.json`
 * (src-tauri/tauri.conf.json › plugins › updater), compares versions, and
 * installs a signed build over itself. The Tauri plugins are imported lazily so
 * the browser build never loads them.
 */

type Update = import('@tauri-apps/plugin-updater').Update;

export type UpdateStatus = 'idle' | 'checking' | 'uptodate' | 'available' | 'downloading' | 'installing' | 'error';

interface UpdaterState {
  status: UpdateStatus;
  /** The version on offer, once one is found. */
  version: string | null;
  /** The release notes GitHub carries for it. */
  notes: string | null;
  /** 0–1 while downloading; null when the size is unknown. */
  progress: number | null;
  error: string | null;
  /** "Remind me later" was chosen; the update stays available in Settings. */
  dismissed: boolean;
  /** Looks for an update. Quiet checks (on launch) stay silent when there is none or it fails. */
  check: (options?: { quiet?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

/** The plugin's handle on the update found; it is not serialisable, so it lives outside the store. */
let pending: Update | null = null;

const SNOOZE_KEY = 'prismix:update-snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Whether "Remind me later" was chosen for this version and its day hasn't passed. */
function snoozed(version: string): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw) as { version?: unknown; until?: unknown };
    return saved.version === version && typeof saved.until === 'number' && saved.until > Date.now();
  } catch {
    return false;
  }
}

function writeSnooze(version: string | null) {
  try {
    if (version) localStorage.setItem(SNOOZE_KEY, JSON.stringify({ version, until: Date.now() + SNOOZE_MS }));
    else localStorage.removeItem(SNOOZE_KEY);
  } catch {
    // Storage blocked: the reminder lasts for this run.
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useUpdater = create<UpdaterState>()((set, get) => ({
  status: 'idle',
  version: null,
  notes: null,
  progress: null,
  error: null,
  dismissed: false,

  async check({ quiet = false } = {}) {
    if (!isDesktop()) return;
    const { status } = get();
    if (status === 'checking' || status === 'downloading' || status === 'installing') return;
    set({ status: 'checking', error: null });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      pending = update;
      if (update) {
        // A manual check from Settings always shows it; a background one respects "Remind me later".
        if (!quiet) writeSnooze(null);
        set({ status: 'available', version: update.version, notes: update.body ?? null, dismissed: quiet && snoozed(update.version) });
      }
      else set({ status: 'uptodate', version: null, notes: null });
    } catch (error) {
      // A failed check on launch (offline, GitHub down) is not worth interrupting anyone for.
      if (quiet) set({ status: 'idle' });
      else set({ status: 'error', error: messageOf(error) });
    }
  },

  async install() {
    const update = pending;
    if (!update || get().status === 'downloading' || get().status === 'installing') return;
    set({ status: 'downloading', progress: 0, error: null });
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          set({ progress: total ? 0 : null });
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          if (total) set({ progress: Math.min(1, received / total) });
        } else {
          set({ status: 'installing', progress: 1 });
        }
      });
      // Windows quits for the installer by itself; elsewhere the app restarts here.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      set({ status: 'error', error: messageOf(error), progress: null });
    }
  },

  dismiss: () => {
    writeSnooze(get().version);
    set({ dismissed: true });
  },
}));

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Checks shortly after launch, then every few hours while the app stays open. Production builds only. */
export function startUpdateChecks(): () => void {
  if (!isDesktop() || !import.meta.env.PROD) return () => undefined;
  const first = setTimeout(() => void useUpdater.getState().check({ quiet: true }), 8000);
  const every = setInterval(() => void useUpdater.getState().check({ quiet: true }), SIX_HOURS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

/** The running app's version, from the build itself (null outside the desktop app). */
export async function appVersion(): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return null;
  }
}

// For browser-driven tests, next to __bcUi: `__bcUpdater.setState({ ... })` previews the update window.
if (import.meta.env.DEV) Object.assign(window, { __bcUpdater: useUpdater });
