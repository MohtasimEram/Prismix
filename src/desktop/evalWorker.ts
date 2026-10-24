/// <reference lib="webworker" />
/**
 * Runs YouTube's player-script functions (signature and n-parameter
 * deciphering) away from the page. A worker has no DOM and no Tauri IPC, so
 * code downloaded from YouTube can't reach the native side from here.
 */
// Some player-script helpers reference `window`; alias it to the worker scope.
(self as unknown as { window?: unknown }).window ??= self;

interface EvalRequest {
  id: number;
  code: string;
}

self.onmessage = (event: MessageEvent<EvalRequest>) => {
  const { id, code } = event.data;
  try {
    const value: unknown = new Function(code)();
    self.postMessage({ id, ok: true, value: JSON.parse(JSON.stringify(value ?? null)) as unknown });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
