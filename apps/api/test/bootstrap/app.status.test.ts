// The bootstrap's wiring of the Status report (brief WP18 §5): HOME and the build's version reach the report, and the
// test email goes through the email notifier only when SMTP is configured.
import { join } from 'node:path';
import { apiContract, FIXTURE_OPT_IN_PHRASE } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { bootApp, type RunningApp } from '../../src/bootstrap/app.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH, SENTINEL_SMTP, silentLog } from '../helpers/env.js';
import { basic } from '../helpers/harness.js';
import { tempDir } from '../helpers/tmp.js';

const BOOT_TIMEOUT_MS = 30_000;

async function boot(extra: Record<string, string>, version?: string): Promise<RunningApp> {
  return bootApp({
    config: loadConfigFromEnv(
      cleanEnv({
        NODE_ENV: 'production',
        DATABASE_PATH: join(tempDir('gmt-status-'), 's.fixture.db'),
        BIND_ADDRESS: '127.0.0.1',
        PORT: '3000',
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
        ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE,
        LOG_LEVEL: 'error',
        ...extra,
      }),
    ),
    log: silentLog,
    listen: false,
    assets: assetPaths(),
    home: tempDir('gmt-home-'),
    ...(version === undefined ? {} : { version }),
  });
}
const call = (r: RunningApp, path: string, method: 'GET' | 'POST' = 'GET') =>
  r.app.request(`http://localhost:3000${path}`, {
    method,
    headers: {
      host: 'localhost:3000',
      authorization: basic('operator', SENTINEL_AUTH),
      ...(method === 'POST'
        ? { 'content-type': 'application/json', 'x-requested-with': 'get-me-there' }
        : {}),
    },
  });

describe('the app bootstrap and the Status report', { timeout: BOOT_TIMEOUT_MS }, () => {
  it('shows the build version it was given, "unknown" otherwise, and a started-at of now', async () => {
    const withVersion = await boot({}, 'abc1234');
    const body = apiContract.statusResponseSchema.parse(
      await (await call(withVersion, '/api/status')).json(),
    );
    await withVersion.close();
    expect(body).toMatchObject({ version: 'abc1234', mode: 'native' });
    expect(body.checks.find((c) => c.id === 'app')?.summary).toContain('version abc1234');
    const plain = await boot({});
    const unknown = apiContract.statusResponseSchema.parse(await (await call(plain, '/api/status')).json());
    await plain.close();
    expect(unknown.version).toBe('unknown');
  });

  it('the test email is 409 without SMTP, and with SMTP goes to the email notifier (a closed loopback port fails by class)', async () => {
    const without = await boot({});
    expect((await call(without, '/api/alerts/test-email', 'POST')).status).toBe(409);
    await without.close();
    const withSmtp = await boot({
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '1',
      SMTP_TLS: 'none',
      SMTP_USER: 'alerts',
      SMTP_PASS: SENTINEL_SMTP,
      ALERT_EMAIL_TO: 'operator@example.com',
      ALERT_EMAIL_FROM: 'get-me-there@example.com',
    });
    const res = await call(withSmtp, '/api/alerts/test-email', 'POST');
    const text = await res.text();
    await withSmtp.close();
    expect(res.status).toBe(200);
    expect(apiContract.testEmailResponseSchema.parse(JSON.parse(text)).result).toBe('failed');
    expect(text).not.toContain('ECONNREFUSED');
  });
});
