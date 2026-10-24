// `import.meta.env`, declared here too so type-checking doesn't depend on `vite/client` resolving.
// The shapes match vite/client's, so the two merge without conflict.
export {};

declare global {
  interface ImportMetaEnv {
    readonly BASE_URL: string;
    readonly MODE: string;
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly SSR: boolean;
    readonly TAURI_ENV_PLATFORM?: string;
    readonly TAURI_ENV_DEBUG?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
