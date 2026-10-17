import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

/** Provenance and booking safety components and the URL parsers: a gap here is a provenance or link gap (spec §9 item 6). */
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };

// Package thresholds from the design spec §9 (web 70% lines, 60% branches); the safety-critical files are held at 100%.
// Coverage counts src/ only; barrels and the browser entry point are excluded.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: gmtAliases(new URL('../..', import.meta.url).pathname) },
  test: {
    name: 'web',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    environment: 'jsdom',
    // why: an absolute origin, so the client's new URL(path, origin) gives msw an interceptable absolute URL.
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts', 'src/main.tsx', 'src/vite-env.d.ts'],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
        'src/components/{Provenance,PriceCell,PriceBoundary,BookingAction}.tsx': FULL,
        'src/state/{urlState,resultsState}.ts': FULL,
      },
    },
  },
});
