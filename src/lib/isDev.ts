/**
 * Whether this is a development build. Written without relying on `vite/client`'s typings
 * (Vite still replaces `import.meta.env` when it builds).
 */
export const isDev: boolean = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
