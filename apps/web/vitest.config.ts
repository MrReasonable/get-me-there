import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { gmtAliases } from '../../vitest.aliases.js';

/** Provenance and booking safety components and the URL parsers: a gap here is a provenance or link gap (spec §9 item 6). */
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };
/** WP10's pure view-model modules carry their own floor above the package's (review TS-8). */
const VIEW_MODEL = { lines: 95, branches: 85, functions: 95, statements: 95 };

// Package thresholds from the design spec §9 (web 70% lines, 60% branches); the safety-critical files are held at 100%.
// Coverage counts src/ only; barrels and the browser entry point are excluded.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: gmtAliases(fileURLToPath(new URL('../..', import.meta.url))) },
  test: {
    name: 'web',
    include: ['test/**/*.test.tsx', 'test/**/*.test.ts'],
    environment: 'jsdom',
    // why: an absolute origin, so the client's new URL(path, origin) gives msw an interceptable absolute URL.
    environmentOptions: { jsdom: { url: 'http://localhost:3000/' } },
    // why: Vitest 5's default, pinned (review arch2-003): each worker is its own Node process, where assigning
    // process.env.TZ re-detects the zone; 'threads' would ignore it (vitest v5.0.3 docs/config/pool.md).
    pool: 'forks',
    // why: the Playwright smoke lives in e2e/ and runs only through `pnpm --filter @gmt/web e2e` (spec §9 item 6).
    exclude: ['e2e/**', 'node_modules/**'],
    // why: setup-tz first so the zone is set before anything touches Date; setup-charts sizes Recharts in jsdom.
    setupFiles: ['test/setup-tz.ts', 'test/setup.ts', 'test/setup-charts.ts'],
    // why: review T3 — above testing-library's 5 s wait (test/setup.ts), so a findBy that never matches reports its
    // own error rather than a test timeout, and a test with several waits has room on a loaded machine
    testTimeout: 15_000,
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
        'src/state/{urlState,resultsState,calendarState}.ts': FULL,
        'src/lib/**': VIEW_MODEL,
        'src/views/{Calendar,Duration,History}/*.ts': VIEW_MODEL,
      },
    },
  },
});
