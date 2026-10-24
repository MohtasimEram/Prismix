import type { BridgeError, BridgeEvent, BridgeMethod, ParamsOf, ResultOf } from './protocol';

/**
 * The contract the app talks to for everything a web page can't do itself.
 * In the browser build an extension served it; in the desktop app it is
 * served in-process by src/desktop/desktopBridge.ts on top of Rust commands.
 */
export interface Bridge {
  readonly transport: 'external' | 'relay';
  call<M extends BridgeMethod>(method: M, params: ParamsOf<M>, options?: CallOptions): Promise<ResultOf<M>>;
  /** Pushed state changes (sign-in, sign-out, Discord). Returns the unsubscribe. */
  subscribe(listener: (event: BridgeEvent) => void): () => void;
}

export interface CallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class BridgeCallError extends Error {
  readonly code: BridgeError['code'] | 'timeout' | 'unavailable';

  constructor(code: BridgeCallError['code'], message: string) {
    super(message);
    this.name = 'BridgeCallError';
    this.code = code;
  }
}

export interface DetectedExtension {
  bridge: Bridge;
  info: ResultOf<'ping'>;
}
