import {
  BridgeCallError,
  type Bridge,
  type BridgeEvent,
  type BridgeMethod,
  type CallOptions,
  type DetectedExtension,
  type ParamsOf,
  type ResultOf,
} from '@/bridge';
import * as discord from './discord';
import { nativeExchange } from './nativeFetch';
import { onSessionsChanged, signIn } from './session';
import * as spotify from './spotify';
import { isDesktop, NativeError } from './tauri';
import * as yt from './ytAuth';

/**
 * The desktop's answer to the browser extension: the same `Bridge` contract
 * (src/bridge/protocol.ts), served in-process by the Rust side instead of a
 * browser extension. Everything that read "is the extension installed?" now
 * always finds it, so the app's pages, hooks and player work unchanged.
 */

export const DESKTOP_VERSION = '1.1.1';

const STATS = /^https:\/\/(s|music|www)\.youtube\.com\/api\/stats\/(playback|watchtime|atr)(\?|$)/;
const IDENTITY_HEADERS = ['authorization', 'cookie', 'x-goog-authuser', 'x-goog-pageid', 'x-origin', 'origin', 'referer'];

const listeners = new Set<(event: BridgeEvent) => void>();
function emit(event: BridgeEvent): void {
  listeners.forEach((l) => {
    try {
      l(event);
    } catch (error) {
      console.error(error);
    }
  });
}

discord.onDiscordState((data) => emit({ event: 'discord.state', data }));

onSessionsChanged((_, changed) => {
  if (changed.includes('youtube')) {
    yt.invalidateAccounts();
    void yt.authState(true).then(
      (data) => emit({ event: 'yt.authState', data }),
      () => undefined,
    );
  }
  if (changed.includes('spotify')) {
    spotify.invalidateSession();
    void spotify.authState().then(
      (data) => emit({ event: 'spotify.authState', data }),
      () => undefined,
    );
  }
});

function strip(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (!IDENTITY_HEADERS.includes(key.toLowerCase())) out[key] = value;
  }
  return out;
}

async function serve<M extends BridgeMethod>(method: M, params: ParamsOf<M>, signal: AbortSignal | undefined): Promise<ResultOf<M>> {
  const p = params as never as Record<string, unknown>;
  type R = ResultOf<M>;
  switch (method) {
    case 'ping':
      return {
        version: DESKTOP_VERSION,
        protocol: 1,
        browser: 'chromium',
        capabilities: ['yt', 'yt.auth', 'yt.stats', 'addon', 'lyrics', 'spotify', 'discord'],
      } as R;
    case 'yt.fetch': {
      const request = params as ParamsOf<'yt.fetch'>;
      if (!request.auth) return (await nativeExchange(request, { ...(signal && { signal }) })) as R;
      const stats = STATS.test(request.url) && (request.method ?? 'GET') === 'GET';
      const identity = await yt.activeIdentity();
      if (!identity) throw new BridgeCallError('unauthenticated', 'Not signed in to YouTube Music.');
      return (await nativeExchange(
        { ...request, headers: strip(request.headers) },
        {
          auth: { kind: 'youtube', authUser: identity.authUser, pageId: identity.pageId, signAs: stats ? 'music' : null },
          ...(signal && { signal }),
        },
      )) as R;
    }
    case 'yt.authState':
      return (await yt.authState(!!p.refresh)) as R;
    case 'yt.selectChannel':
      return (await yt.selectChannel(String(p.channelId))) as R;
    case 'yt.setConnected':
      return (await yt.setConnected(!!p.connected)) as R;
    case 'addon.fetch':
    case 'lyrics.fetch':
      return (await nativeExchange(params as ParamsOf<'lyrics.fetch'>, { timeoutMs: 15_000, ...(signal && { signal }) })) as R;
    case 'lyrics.permissions':
      // A desktop app needs no per-host grant: Rust reaches every lyric host.
      return { granted: [...((p.origins as string[] | undefined) ?? [])] } as R;
    case 'lyrics.requestPermissions':
      return {} as R;
    case 'spotify.authState':
      if (p.refresh) spotify.invalidateSession();
      return (await spotify.authState()) as R;
    case 'spotify.setConnected':
      return (await spotify.setConnected(!!p.connected)) as R;
    case 'spotify.signIn':
      await signIn('spotify');
      return {} as R;
    case 'spotify.playlists':
      return (await spotify.playlists(Number(p.offset) || 0)) as R;
    case 'spotify.tracks':
      return (await spotify.tracks(String(p.playlistId), Number(p.offset) || 0)) as R;
    case 'spotify.playlist':
      return (await spotify.playlistInfo(String(p.playlistId))) as R;
    case 'spotify.searchTracks':
      return (await spotify.searchTracks(String(p.query))) as R;
    case 'spotify.canvas':
      return { url: await spotify.canvas(String(p.trackId)) } as R;
    case 'discord.state':
      return (await discord.refresh()) as R;
    case 'discord.connect':
      await discord.connect();
      return {} as R;
    case 'discord.disconnect':
      return (await discord.disconnect()) as R;
    case 'discord.setEnabled':
      return (await discord.setEnabled(!!p.enabled)) as R;
    case 'discord.presence': {
      const { track, options } = params as ParamsOf<'discord.presence'>;
      await discord.setPresence(track, options);
      return {} as R;
    }
    default:
      throw new BridgeCallError('unsupported', `The desktop app doesn't serve ${String(method)}`);
  }
}

function asBridgeError(error: unknown): BridgeCallError {
  if (error instanceof BridgeCallError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof NativeError) {
    const known = ['forbidden', 'network', 'unauthenticated', 'internal', 'unavailable', 'timeout'] as const;
    return new BridgeCallError((known as readonly string[]).includes(error.code) ? (error.code as (typeof known)[number]) : 'internal', message);
  }
  if (code === 'unauthenticated' || code === 'forbidden' || code === 'permission') return new BridgeCallError(code, message);
  if (error instanceof TypeError) return new BridgeCallError('network', message);
  if (error instanceof DOMException && error.name === 'AbortError') return new BridgeCallError('timeout', 'Cancelled');
  return new BridgeCallError('internal', message);
}

const DEFAULT_TIMEOUT_MS = 30_000;

export const desktopBridge: Bridge = {
  transport: 'external',
  call<M extends BridgeMethod>(method: M, params: ParamsOf<M>, options: CallOptions = {}): Promise<ResultOf<M>> {
    if (!isDesktop()) return Promise.reject(new BridgeCallError('unavailable', 'Open Prismix with `npm run tauri dev`, not in a browser tab.'));
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<ResultOf<M>>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        fn();
      };
      const onAbort = () => {
        controller.abort();
        finish(() => reject(new BridgeCallError('timeout', 'Cancelled')));
      };
      const timer = setTimeout(() => {
        controller.abort();
        finish(() => reject(new BridgeCallError('timeout', `${method} took longer than ${timeoutMs} ms`)));
      }, timeoutMs);
      if (options.signal?.aborted) return onAbort();
      options.signal?.addEventListener('abort', onAbort, { once: true });
      serve(method, params, controller.signal).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(asBridgeError(error))),
      );
    });
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export const desktopExtension: DetectedExtension = {
  bridge: desktopBridge,
  info: {
    version: DESKTOP_VERSION,
    protocol: 1,
    browser: 'chromium',
    capabilities: ['yt', 'yt.auth', 'yt.stats', 'addon', 'lyrics', 'spotify', 'discord'],
  },
};
