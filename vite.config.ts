import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(__dirname, 'src/renderer');

// Strict CSP for the packaged pages. Added at build time only, because the dev
// server needs inline scripts for React Fast Refresh.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin: Plugin = {
  name: 'orbit-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
};

// One Vite project with two pages: the transparent overlay (menu.html) and the
// settings / menu editor (settings.html). Both load from file:// in production,
// hence the relative base.
export default defineConfig({
  root,
  base: './',
  plugins: [react(), cspPlugin],
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') },
  },
  server: { port: 5183, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        menu: resolve(root, 'menu.html'),
        settings: resolve(root, 'settings.html'),
      },
    },
  },
});
