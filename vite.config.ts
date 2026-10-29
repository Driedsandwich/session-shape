import { defineConfig } from 'vite';
export default defineConfig({
  base: '/session-shape/',
  // Vite's preload polyfill uses fetch; a single bundled entry needs no polyfill.
  build: { modulePreload: false },
  server: { hmr: false },
});
