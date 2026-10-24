import type { DetectedExtension } from '@/bridge';
import { desktopExtension } from '@/desktop/desktopBridge';
import { queryClient } from '@/lib/queryClient';

/**
 * The browser build asked whether its companion extension was installed. The
 * desktop app *is* that companion (src/desktop/desktopBridge.ts), so it is
 * always present. The query cache entry is kept because code outside React
 * reads it (getBridge, the player, history reporting).
 */
export type ExtensionStatus =
  | { state: 'checking' }
  | { state: 'missing' }
  | { state: 'present'; extension: DetectedExtension };

export const extensionQueryKey = ['extension', 'detect'] as const;

queryClient.setQueryDefaults(extensionQueryKey, { staleTime: Infinity, gcTime: Infinity });
queryClient.setQueryData(extensionQueryKey, desktopExtension);

const PRESENT: ExtensionStatus = { state: 'present', extension: desktopExtension };

export function useExtension(): ExtensionStatus {
  return PRESENT;
}
