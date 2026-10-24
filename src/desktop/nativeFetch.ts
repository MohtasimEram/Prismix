import type { HttpRequest, HttpResponse } from '@/bridge';
import { invoke, isDesktop } from './tauri';

/**
 * `fetch`, made by the Rust side (src-tauri/src/net.rs).
 *
 * A desktop webview is a page at tauri://localhost: YouTube, googlevideo,
 * Spotify and most lyric hosts either refuse its Origin or send no CORS
 * headers at all. In the browser build an extension rewrote those headers;
 * here Rust makes the request instead, with the same rules:
 *
 * - every request is anonymous (Rust keeps no cookie jar), https only, and
 *   never to a private/loopback address;
 * - the YouTube/Spotify/Apple/Musixmatch header rules are applied in Rust;
 * - a signed-in request only names *who* it should act as (`auth`): the
 *   cookies and the SAPISIDHASH are added in Rust and never reach this page.
 */

export type NativeAuth =
  | { kind: 'youtube'; authUser: string; pageId: string | null; signAs: 'music' | null }
  | { kind: 'spotify' };

export interface NativeOptions {
  auth?: NativeAuth;
  timeoutMs?: number;
}

interface NativeMeta {
  status: number;
  statusText: string;
  url: string;
  redirected: boolean;
  headers: [string, string][];
}

const pageFetch: typeof fetch = globalThis.fetch.bind(globalThis);

let nextId = 1;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const LOCAL_HOST = /^(localhost|.*\.localhost|tauri\.localhost|ipc\.localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

/** Whether a request should leave through Rust rather than the webview. */
export function goesNative(url: URL): boolean {
  return url.protocol === 'https:' && !LOCAL_HOST.test(url.hostname);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason instanceof Error || signal.reason instanceof DOMException
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function decode(raw: unknown): { meta: NativeMeta; body: ArrayBuffer } {
  let buffer: ArrayBuffer;
  if (raw instanceof ArrayBuffer) buffer = raw;
  else if (ArrayBuffer.isView(raw)) buffer = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice().buffer;
  else if (Array.isArray(raw)) buffer = Uint8Array.from(raw as number[]).buffer;
  else throw new TypeError('The native fetch answered with something unexpected');
  const metaLength = new DataView(buffer).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, metaLength))) as NativeMeta;
  return { meta, body: buffer.slice(4 + metaLength) };
}

/** A fetch made by Rust. Accepts everything `fetch` does; answers a real `Response`. */
export async function nativeFetch(input: RequestInfo | URL, init?: RequestInit, options: NativeOptions = {}): Promise<Response> {
  const request = new Request(input instanceof URL ? input.toString() : input, init);
  const { signal } = request;
  if (signal.aborted) throw abortError(signal);

  const method = request.method.toUpperCase();
  const headers: [string, string][] = [];
  request.headers.forEach((value, key) => headers.push([key, value]));
  let body: string | null = null;
  if (method !== 'GET' && method !== 'HEAD') {
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength) body = toBase64(bytes);
  }

  const id = nextId++;
  const call = invoke<unknown>('net_fetch', {
    request: {
      id,
      url: request.url,
      method,
      headers,
      body,
      auth: options.auth ?? null,
      timeoutMs: options.timeoutMs ?? null,
    },
  });

  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      void invoke('net_abort', { id }).catch(() => undefined);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  // A late native rejection after an abort must not surface as unhandled.
  call.catch(() => undefined);

  try {
    const { meta, body: payload } = decode(await Promise.race([call, aborted]));
    const responseHeaders = new Headers();
    for (const [key, value] of meta.headers) {
      try {
        responseHeaders.append(key, value);
      } catch {
        // A header name or value the Headers class won't hold; nothing reads those.
      }
    }
    const status = Math.min(599, Math.max(200, meta.status));
    const nullBody = method === 'HEAD' || [101, 204, 205, 304].includes(meta.status);
    const response = new Response(nullBody ? null : payload, {
      status,
      statusText: meta.statusText,
      headers: responseHeaders,
    });
    Object.defineProperty(response, 'url', { value: meta.url });
    Object.defineProperty(response, 'redirected', { value: meta.redirected });
    return response;
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    // fetch reports network failures as TypeError; callers (shaka, YouTube.js) rely on that.
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new TypeError(error instanceof Error ? error.message : String(error));
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** The bridge's serialised exchange (HttpRequest → HttpResponse), made natively. */
export async function nativeExchange(request: HttpRequest, options: NativeOptions & { signal?: AbortSignal } = {}): Promise<HttpResponse> {
  const body =
    request.body === undefined ? undefined : request.bodyEncoding === 'base64' ? fromBase64(request.body) : request.body;
  const response = await nativeFetch(
    request.url,
    { method: request.method ?? 'GET', headers: request.headers ?? {}, body: body ?? null, ...(options.signal && { signal: options.signal }) },
    options,
  );
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  const type = response.headers.get('content-type') ?? '';
  const textual = !type || /json|text|javascript|xml|html|protobuf/.test(type);
  return {
    status: response.status,
    headers,
    url: response.url,
    bodyEncoding: textual ? 'text' : 'base64',
    body: textual ? await response.text() : toBase64(new Uint8Array(await response.arrayBuffer())),
  };
}

let installed = false;

/**
 * Routes the page's own `fetch` calls for remote https hosts through Rust.
 * Must run before shaka-player or YouTube.js load (main.tsx imports this
 * first): shaka keeps a reference to `fetch` from when it loads.
 */
export function installNativeFetch(): void {
  if (installed || !isDesktop()) return;
  installed = true;
  const patched = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), location.href);
    } catch {
      return pageFetch(input, init);
    }
    return goesNative(url) ? nativeFetch(input, init) : pageFetch(input, init);
  };
  Object.defineProperty(globalThis, 'fetch', { value: patched, writable: true, configurable: true });
}
