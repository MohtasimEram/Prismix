import { invoke, onNative } from './tauri';

/**
 * Which sessions the Rust vault holds (src-tauri/src/auth.rs). Only presence
 * and a generation counter cross over: never a cookie. The generation changes
 * on every sign-in, so a token minted for an earlier session is never reused.
 */
export interface ServiceSession {
  signedIn: boolean;
  generation: number;
}

export interface Sessions {
  youtube: ServiceSession;
  spotify: ServiceSession;
}

export type Service = keyof Sessions;

let cached: Sessions | null = null;
let reading: Promise<Sessions> | null = null;
const listeners = new Set<(sessions: Sessions, changed: Service[]) => void>();

export function sessions(): Promise<Sessions> {
  if (cached) return Promise.resolve(cached);
  reading ??= invoke<Sessions>('auth_status')
    .then((s) => (cached = s))
    .finally(() => (reading = null));
  return reading;
}

function adopt(next: Sessions): void {
  const before = cached;
  cached = next;
  const changed = (['youtube', 'spotify'] as const).filter(
    (s) => !before || before[s].signedIn !== next[s].signedIn || before[s].generation !== next[s].generation,
  );
  if (changed.length) listeners.forEach((l) => l(next, changed));
}

/** Called with the services whose session changed (sign-in, sign-out, a new account). */
export function onSessionsChanged(listener: (sessions: Sessions, changed: Service[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

onNative<Sessions>('auth://changed', adopt);

/** Opens the service's own sign-in page in a separate, isolated window. Resolves once it's open. */
export function signIn(service: Service, addAccount = false): Promise<void> {
  return invoke('auth_sign_in', { service, addAccount });
}

/** Forgets the service's cookies (and clears the sign-in window's browsing data). */
export async function signOut(service: Service): Promise<void> {
  adopt(await invoke<Sessions>('auth_sign_out', { service }));
}

/** The fallback when the sign-in window is refused: a Cookie header copied from a browser. */
export async function importCookies(service: Service, cookieHeader: string): Promise<void> {
  adopt(await invoke<Sessions>('auth_import_cookies', { service, cookieHeader }));
}
