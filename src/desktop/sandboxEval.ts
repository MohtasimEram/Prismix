/**
 * `new Function(code)()` in a dedicated worker (evalWorker.ts), with a
 * deadline. Falls back to the page only if workers are unavailable.
 */
const DEADLINE_MS = 10_000;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./evalWorker.ts', import.meta.url), { type: 'module', name: 'prismix-eval' });
  } catch {
    return null;
  }
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    clearTimeout(entry.timer);
    if (event.data.ok) entry.resolve(event.data.value);
    else entry.reject(new Error(event.data.error ?? 'eval failed'));
  };
  worker.onerror = () => restart(new Error('The eval worker crashed'));
  return worker;
}

function restart(reason: Error): void {
  worker?.terminate();
  worker = null;
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(reason);
    pending.delete(id);
  }
}

/** Set once the worker proves unusable (CSP, crash on load) so we stop retrying. */
let pageOnly = false;

function evalInPage<T>(code: string): T {
  return new Function(code)() as T;
}

function evalInWorker<T>(w: Worker, code: string): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => restart(new Error('YouTube player script took too long')), DEADLINE_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    w.postMessage({ id, code });
  });
}

export async function sandboxEval<T>(code: string): Promise<T> {
  const w = pageOnly ? null : getWorker();
  if (!w) return evalInPage<T>(code);
  try {
    return await evalInWorker<T>(w, code);
  } catch (error) {
    if (error instanceof Error && error.message === 'The eval worker crashed') {
      // The worker never came up (or died on load) — run in the page instead.
      pageOnly = true;
      return evalInPage<T>(code);
    }
    throw error;
  }
}
