import { Channel } from '@tauri-apps/api/core';
import { invoke } from './tauri';

/**
 * A WebSocket whose connection lives in Rust (src-tauri/src/ws.rs).
 *
 * The party server only accepts browser Origins it knows, and a webview's
 * origin (tauri://localhost, http://tauri.localhost) is not one of them. The
 * Rust side dials as a native client (no Origin), which the server allows.
 * Only the subset of the WebSocket API the app uses is implemented.
 */

type SocketEvent =
  | { kind: 'open'; protocol: string | null }
  | { kind: 'message'; data: string }
  | { kind: 'close'; code: number; reason: string; wasClean: boolean }
  | { kind: 'error'; message: string };

export class NativeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState: number = NativeSocket.CONNECTING;
  protocol = '';

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;

  private id: Promise<number | null>;
  private closeRequested: { code: number; reason: string } | null = null;

  constructor(url: string, protocols: string[] = []) {
    this.url = url;
    const channel = new Channel<SocketEvent>();
    channel.onmessage = (event) => this.dispatch(event);
    this.id = invoke<number>('ws_open', { url, protocols, onEvent: channel }).then(
      (id) => {
        // close() was called before the socket even had an id.
        if (this.closeRequested) void invoke('ws_close', { id, ...this.closeRequested }).catch(() => undefined);
        return id;
      },
      (error: unknown) => {
        this.dispatch({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        this.dispatch({ kind: 'close', code: 1006, reason: '', wasClean: false });
        return null;
      },
    );
  }

  private dispatch(event: SocketEvent): void {
    if (this.readyState === NativeSocket.CLOSED) return;
    switch (event.kind) {
      case 'open':
        if (this.readyState !== NativeSocket.CONNECTING) return;
        this.readyState = NativeSocket.OPEN;
        this.protocol = event.protocol ?? '';
        this.onopen?.();
        break;
      case 'message':
        if (this.readyState === NativeSocket.OPEN) this.onmessage?.({ data: event.data });
        break;
      case 'error':
        this.onerror?.({ message: event.message });
        break;
      case 'close':
        this.readyState = NativeSocket.CLOSED;
        this.onclose?.({ code: event.code, reason: event.reason, wasClean: event.wasClean });
        break;
    }
  }

  send(text: string): void {
    if (this.readyState !== NativeSocket.OPEN) throw new Error('NativeSocket is not open');
    void this.id.then((id) => {
      if (id !== null) return invoke('ws_send', { id, text }).catch(() => undefined);
    });
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= NativeSocket.CLOSING) return;
    this.readyState = NativeSocket.CLOSING;
    this.closeRequested = { code, reason: reason.slice(0, 120) };
    void this.id.then((id) => {
      if (id !== null) return invoke('ws_close', { id, code, reason: reason.slice(0, 120) }).catch(() => undefined);
    });
  }
}
