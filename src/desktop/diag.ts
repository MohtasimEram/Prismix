import { invoke } from './tauri';

/**
 * One line into the app's log file (Rust's `diag_log`), next to the session
 * lines Rust writes itself. Never pass anything secret: names and statuses only.
 */
export function diagLog(level: 'info' | 'warn', message: string): void {
  void invoke('diag_log', { level, message: message.slice(0, 400) }).catch(() => undefined);
}
