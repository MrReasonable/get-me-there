import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { gmtAliases } from '../../vitest.aliases.js';

/**
 * The SPA owns "/" with its state in search params; every core/api-contract route lives under /api
 * (spec §10), which is the one prefix the dev server proxies to the api on port 3000.
 * why: the same workspace aliases as vitest.config.ts, so `pnpm dev` and `vite build` read core from source.
 */
/**
 * The api the dev and preview servers proxy /api to. The Playwright smoke (WP10) points `vite preview` at its own
 * fixture-mode api with GMT_API_ORIGIN; dev keeps the default. preview.proxy inherits server.proxy.
 */
const API_ORIGIN = process.env.GMT_API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  server: {
    port: 5173,
    strictPort: true,
    // why: no changeOrigin, so the api sees Host localhost:5173, which spec §4 allowlists in development.
    proxy: { '/api': { target: API_ORIGIN } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
