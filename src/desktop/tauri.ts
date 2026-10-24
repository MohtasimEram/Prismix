import { invoke as tauriInvoke, isTauri as tauriIsTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * The one door to the Rust side. Everything native (network, secrets,
 * Discord, the window) goes through these typed helpers, so the rest of the
 * app never imports @tauri-apps directly.
 */

export function isDesktop(): boolean {
  try {
    return tauriIsTauri();
  } catch {
    return false;
  }
}

export class NativeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'NativeError';
    this.code = code;
  }
}

/** Rust commands answer errors as `{ code, message }` (src-tauri/src/error.rs). */
function asNativeError(error: unknown): NativeError {
  if (error instanceof NativeError) return error;
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const { code, message } = error as { code: unknown; message: unknown };
    return new NativeError(String(code), String(message));
  }
  return new NativeError('internal', typeof error === 'string' ? error : String(error));
}

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new NativeError('unavailable', 'Prismix must run inside its desktop app (npm run tauri dev).');
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw asNativeError(error);
  }
}

/** Calls a Rust command with raw bytes as its body (no JSON round trip), and `headers` beside them. */
export async function invokeRaw<T>(command: string, body: Uint8Array, headers: Record<string, string>): Promise<T> {
  if (!isDesktop()) throw new NativeError('unavailable', 'Prismix must run inside its desktop app (npm run tauri dev).');
  try {
    return await tauriInvoke<T>(command, body, { headers });
  } catch (error) {
    throw asNativeError(error);
  }
}

/** Subscribes to a Rust event; the returned function unsubscribes (safe to call before it resolved). */
export function onNative<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isDesktop()) return () => undefined;
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  void listen<T>(event, (e) => handler(e.payload)).then((fn) => {
    if (cancelled) fn();
    else unlisten = fn;
  });
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export type DesktopPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

export function platform(): DesktopPlatform {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'unknown';
}
