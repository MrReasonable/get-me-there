import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Spec §9 item 6: one smoke in fixture mode, run on a desktop browser and at the 375px phone width (ui-r1-014).
// Excluded from `pnpm test`; run with `pnpm --filter @gmt/web e2e`.
const API_PORT = 3100;
const WEB_PORT = 4173;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const DB_PATH = fileURLToPath(new URL('./e2e/.tmp/smoke.fixture.db', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // why: the run itself is polled for up to 90 s inside the test (toPass), longer than Playwright's 30 s default.
  timeout: 150_000,
  forbidOnly: process.env.CI === 'true',
  reporter: [['list']],
  use: { baseURL: WEB_ORIGIN, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, grepInvert: /@phone/ },
    // why: the phone project only checks layout on the run the desktop project made (it depends on it).
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } },
      dependencies: ['desktop'],
      grep: /@phone/,
    },
  ],
  webServer: [
    {
      name: 'api',
      command: 'node e2e/prepare-db.mjs && pnpm --filter @gmt/api start',
      url: `${API_ORIGIN}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      env: {
        // spec §5.5 fixture gate: development + the exact opt-in phrase + a .fixture.db path + not in a container
        NODE_ENV: 'development',
        ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake',
        DATABASE_PATH: DB_PATH,
        IN_CONTAINER: '',
        PORT: String(API_PORT),
        BIND_ADDRESS: '127.0.0.1',
        // why: the preview proxy keeps the browser's Host (no changeOrigin), so the api must allow the preview origin too.
        ALLOWED_HOSTS: `127.0.0.1:${API_PORT},127.0.0.1:${WEB_PORT}`,
        // why: the api requires an https APP_BASE_URL when set; the smoke sends no email, so it stays unset.
        APP_BASE_URL: '',
        APP_BASIC_AUTH_USER: '',
        APP_BASIC_AUTH_PASS: '',
        TRAVELPAYOUTS_TOKEN: '',
        SEARCHAPI_KEY: '',
        SMTP_HOST: '',
        AUTO_RESUME: 'false',
        SOFT_CONFIRM_PENCE: '100000',
        LOG_LEVEL: 'warn',
      },
    },
    {
      name: 'web',
      command: `pnpm exec vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { GMT_API_ORIGIN: API_ORIGIN },
    },
  ],
});
