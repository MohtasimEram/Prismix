import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * am-lyrics animates lyrics one character at a time and cuts text with
 * `x.split("")`, which tears Bangla vowel signs off their letters. This swaps
 * those calls for a cluster-aware split. (The app also repairs whatever is
 * rendered, see src/lyrics/clusters.ts, so this is the first of two layers.)
 */
const CLUSTER_SPLIT =
  'const __bcSplit=(s)=>{s=String(s);const m=s.match(/[\\s\\S][\\p{M}\\u200C\\u200D]*/gu)||[];const o=[];' +
  'for(const p of m){const l=o.length-1;if(l>=0&&/[\\u094D\\u09CD\\u0A4D\\u0ACD\\u0B4D\\u0BCD\\u0C4D\\u0CCD\\u0D4D\\u0DCA\\u200D]$/.test(o[l]))o[l]+=p;else o.push(p)}return o};\n';
function amLyricsClusters(): Plugin {
  return {
    name: 'prismix:am-lyrics-clusters',
    enforce: 'pre',
    transform(code, id) {
      if (!/@uimaxbai[\\/]am-lyrics/.test(id) || !/\.js($|\?)/.test(id)) return null;
      const patched = code.replace(/([A-Za-z_$][\w$.]*)\.split\(\s*(?:""|'')\s*\)/g, '__bcSplit($1)');
      return patched === code ? null : { code: CLUSTER_SPLIT + patched, map: null };
    },
  };
}

// Tauri expects a fixed dev-server port and serves the built `dist` folder in production.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [amLyricsClusters(), react(), tailwindcss()],
  // Left out of dependency pre-bundling so the plugin above sees its source.
  optimizeDeps: { exclude: ['@uimaxbai/am-lyrics'] },
  clearScreen: false,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5174 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // WebView2 (Chromium), WKWebView (Safari 15+) and WebKitGTK all handle ES2022.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome110' : 'safari15',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 4096,
  },
  worker: { format: 'es' },
});
