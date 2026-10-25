// `gmt status` prints the app's own report beside the local facts (brief WP18 Task 18.5), and `gmt setup` offers the test
// email at its end (Task 18.3). The worked example only; no network: the app is an in-memory stub.
import { parseEnv } from 'node:util';
import type { apiContract } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { runCli } from '../../src/cli.js';
import type { HttpRequest } from '../../src/deps.js';
import { offeredFor, TEST_EMAIL_QUESTION, TEST_EMAIL_WORDS } from '../../src/setup/testEmail.js';
import { scriptedAsk, stubHttp, testIo } from '../support/deps.js';
import { machine } from '../support/machine.js';

type Report = z.input<typeof apiContract.statusResponseSchema>;
type Check = Report['checks'][number];
const ENV = '/Users/op/.config/get-me-there/app.env';

const check = (over: Partial<Check> = {}): Check => ({
  id: 'worker',
  area: 'worker',
  providerId: null,
  label: null,
  state: 'ok',
  summary: 'reachable',
  note: null,
  offReason: null,
  fix: null,
  ...over,
});
const report = (checks: Check[]): Report => ({
  generatedAt: '2026-10-24T09:30:00.000Z',
  mode: 'native',
  version: 'abc1234',
  checks,
});
const okRoutes = {
  'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
  'GET /api/health': () => ({ status: 200, body: { ok: true, degraded: false } }),
};

async function installed(
  checks: Check[] | 'down',
  extra: Record<string, () => { status: number; body: unknown }> = {},
) {
  const http = stubHttp({
    ...okRoutes,
    'GET /api/status': () =>
      checks === 'down' ? { error: 'connection refused' } : { status: 200, body: report(checks) },
    ...extra,
  });
  const m = machine({ http });
  m.fs.file('/work/a.json', '{}', 0o600);
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  m.io.stdout = '';
  m.io.stderr = '';
  http.requests.length = 0;
  return { m, http };
}
const password = (m: ReturnType<typeof machine>) =>
  parseEnv(m.fs.read(ENV) ?? '').APP_BASIC_AUTH_PASS ?? 'missing';

describe('gmt status: the app report beside the local facts (brief Task 18.5)', () => {
  it('reads GET /api/status with the basic auth of app.env, never in an argv, and prints one row per check and the bar line', async () => {
    const { m, http } = await installed([
      check({
        id: 'schedule',
        area: 'schedule',
        state: 'fail',
        summary: 'schedule blocked since 2026-10-22',
        fix: { text: 'restart the app', command: 'pnpm gmt restart' },
      }),
      check({
        id: 'email',
        area: 'email',
        state: 'ok',
        summary: 'configured',
        note: 'since the app started',
      }),
    ]);
    expect(await runCli(['status'], m.deps)).toBe(1);
    const req = http.requests.find((r) => r.url.endsWith('/api/status'));
    expect(req?.headers.Authorization).toBe(
      `Basic ${Buffer.from(`operator:${password(m)}`).toString('base64')}`,
    );
    expect(m.runner.calls.map((c) => c.argv.join(' ')).join('\n')).not.toContain(password(m));
    expect(m.io.stdout).toMatch(/schedule +fail +schedule blocked since 2026-10-22/);
    expect(m.io.stdout).toContain('fix: pnpm gmt restart (restart the app)');
    expect(m.io.stdout).toMatch(/email +ok +configured/);
    expect(m.io.stdout).toContain('note: since the app started');
    expect(m.io.stdout).toContain('Status: schedule failing');
    expect(m.io.stdout).toMatch(/service app +ok +running/);
    expect(m.io.stdout).not.toContain(password(m));
  });

  it('exits 0 with only ok, off and warn checks, and says so in the bar line', async () => {
    const { m } = await installed([
      check({
        id: 'price-sources',
        area: 'provider',
        state: 'warn',
        summary: 'No price source is set up, so searches find nothing',
        fix: { text: 'add Travelpayouts', command: null },
      }),
      check({
        id: 'consent',
        area: 'consent',
        state: 'off',
        offReason: 'not-set-up',
        summary: 'browser provider not enabled',
      }),
    ]);
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('Status: provider to check');
    expect(m.io.stdout).toContain('fix: add Travelpayouts');
  });

  it('a clean report says nothing is to be checked', async () => {
    const { m } = await installed([check()]);
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('Status: nothing to check');
  });

  it('--only filters the report to one area and leaves the local facts out; a fail elsewhere does not count', async () => {
    const { m } = await installed([
      check({
        id: 'schedule',
        area: 'schedule',
        state: 'fail',
        summary: 'schedule blocked since 2026-10-22',
      }),
      check({ id: 'email', area: 'email', state: 'ok', summary: 'configured' }),
    ]);
    expect(await runCli(['status', '--only', 'email'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/email +ok +configured/);
    expect(m.io.stdout).not.toContain('schedule blocked');
    expect(m.io.stdout).not.toMatch(/service app/);
    expect(await runCli(['status', '--only', 'schedule'], m.deps)).toBe(1);
    expect(await runCli(['status', '--only', 'nowhere'], m.deps)).toBe(64);
    expect(m.io.stderr).toContain('unknown area for --only: nowhere');
  });

  it('--json prints the response as JSON and nothing else on stdout', async () => {
    const { m } = await installed([check({ id: 'email', area: 'email', summary: 'configured' })]);
    expect(await runCli(['status', '--json'], m.deps)).toBe(0);
    const parsed: unknown = JSON.parse(m.io.stdout);
    expect(parsed).toMatchObject({ mode: 'native', version: 'abc1234', checks: [{ id: 'email' }] });
  });

  it('with the app not answering it says so, still prints the local facts and exits 1', async () => {
    const { m } = await installed('down');
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('the app is not answering: no answer from the app on port 3000');
    expect(m.io.stdout).toMatch(/service app +ok +running/);
  });

  it('shows the worker refusal beside the report when the app is down', async () => {
    const { m } = await installed('down');
    m.fs.file(
      '/Users/op/.local/state/get-me-there/camoufox/start-refusal.json',
      JSON.stringify({ reason: 'consent-expired', at: '2026-10-24T08:00:00.000Z' }),
    );
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stdout).toContain('the consent record has expired: capture again');
  });

  it.each([
    ['a status other than 200', () => ({ status: 503, body: 'no' }), 'the app answered 503'],
    ['an answer that is not JSON', () => ({ status: 200, body: 'plain' }), 'the app’s answer was not JSON'],
    [
      'an answer that is not the report',
      () => ({ status: 200, body: { hello: 1 } }),
      'the app’s answer was not the status report',
    ],
  ])('%s is "not answering" with its reason', async (_n, route, reason) => {
    const { m } = await installed('down', { 'GET /api/status': route });
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain(`the app is not answering: ${reason}`);
  });

  it('with the app down the local facts and the worker refusal still print under --json and --only (V9)', async () => {
    const { m } = await installed('down');
    m.fs.file(
      '/Users/op/.local/state/get-me-there/camoufox/start-refusal.json',
      JSON.stringify({ reason: 'consent-expired', at: '2026-10-24T08:00:00.000Z' }),
    );
    expect(await runCli(['status', '--only', 'worker'], m.deps)).toBe(1);
    expect(m.io.stdout).toMatch(/service app +ok +running/);
    expect(m.io.stdout).toContain('the consent record has expired: capture again');
    m.io.stdout = '';
    expect(await runCli(['status', '--json'], m.deps)).toBe(1);
    const parsed: unknown = JSON.parse(m.io.stdout);
    expect(parsed).toMatchObject({
      appAnswering: false,
      reason: 'no answer from the app on port 3000',
      checks: expect.arrayContaining([expect.objectContaining({ name: 'worker' })]),
    });
  });

  it('a service that is running but silent says so and points at the log; one that is stopped says to start it (V9)', async () => {
    const { m } = await installed('down');
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain(
      'the service is running but the app does not answer on port 3000: pnpm gmt logs shows why; pnpm gmt restart tries again',
    );
    m.running.clear();
    m.io.stderr = '';
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('the app is not running: pnpm gmt start');
  });

  it('a bad --only is a usage error before anything is read', async () => {
    const { m, http } = await installed([check()]);
    expect(await runCli(['status', '--only', 'nowhere'], m.deps)).toBe(64);
    expect(http.requests).toEqual([]);
  });

  it('with no app.env there is nothing to ask', async () => {
    const m = machine();
    expect(await runCli(['status'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('there is no app.env yet: run pnpm gmt setup');
  });

  it('a local fail fails the command beside an ok report', async () => {
    const { m } = await installed([check()]);
    m.running.clear();
    expect(await runCli(['status'], m.deps)).toBe(1);
  });

  it('on a fresh install it exits 0 with backups ok (first backup present, no due note) and price-sources warn', async () => {
    const { m } = await installed([
      check({ id: 'backups', area: 'backups', state: 'ok', summary: 'newest daily backup 2026-10-24 09:30' }),
      check({
        id: 'price-sources',
        area: 'provider',
        state: 'warn',
        summary: 'No price source is set up, so searches find nothing',
      }),
    ]);
    expect(await runCli(['status'], m.deps)).toBe(0);
    expect(m.io.stdout).toMatch(/backups +ok +newest daily backup/);
    expect(m.io.stdout).not.toContain('first daily backup due');
    expect(m.io.stdout).toMatch(/provider +warn +No price source is set up/);
  });
});

describe('gmt setup offers the test email at its end (brief Task 18.3)', () => {
  const EMAIL = {
    email: {
      host: 'smtp.example.com',
      port: 465,
      tls: 'implicit',
      user: 'u',
      pass: 'smtp-pass-0123456789',
      to: 'a@example.com',
      from: 'b@example.com',
    },
  };
  async function withEmail(
    testEmail: (() => { status: number; body: unknown }) | null,
    asks: Array<string | boolean>,
  ) {
    const http = stubHttp({
      ...okRoutes,
      ...(testEmail === null ? {} : { 'POST /api/alerts/test-email': testEmail }),
    });
    const m = machine({ http });
    m.fs.file('/work/a.json', JSON.stringify(EMAIL), 0o600);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    const ask = scriptedAsk(asks);
    const io = testIo({ tty: true });
    m.deps.ask = ask;
    m.deps.io = io;
    http.requests.length = 0;
    return { m, http, ask, io };
  }
  const posts = (http: { requests: HttpRequest[] }) => http.requests.filter((r) => r.method === 'POST');

  it('yes posts the test email with the app.env basic auth and the mutating-route headers, and prints sent', async () => {
    const { m, http, ask, io } = await withEmail(
      () => ({ status: 200, body: { result: 'sent', at: '2026-10-24T09:30:00.000Z' } }),
      [true, false],
    );
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(ask.asked).toEqual([TEST_EMAIL_QUESTION, 'Open the app in your browser now?']);
    const req = posts(http)[0];
    expect(req?.url).toBe('http://127.0.0.1:3000/api/alerts/test-email');
    expect(req?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from(`operator:${password(m)}`).toString('base64')}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'get-me-there',
    });
    const text = io.stdout;
    expect(text).toContain(TEST_EMAIL_WORDS.sent);
    expect(text.indexOf('get-me-there is running at')).toBeLessThan(text.indexOf(TEST_EMAIL_WORDS.sent));
    expect(text).not.toContain(password(m));
  });

  it('the default is no: nothing is posted', async () => {
    const { m, http } = await withEmail(
      () => ({ status: 200, body: { result: 'sent', at: '2026-10-24T09:30:00.000Z' } }),
      [false, false],
    );
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(posts(http)).toHaveLength(0);
  });

  it.each([
    [
      'failed',
      () => ({ status: 200, body: { result: 'failed', at: '2026-10-24T09:30:00.000Z' } }),
      TEST_EMAIL_WORDS.failed,
    ],
    [
      'refused',
      () => ({
        status: 429,
        body: { error: { code: 'email_limit', message: 'smtp said: 421 secret-detail' } },
      }),
      TEST_EMAIL_WORDS.refused,
    ],
    [
      'not set up',
      () => ({ status: 409, body: { error: { code: 'email_not_configured', message: 'x' } } }),
      TEST_EMAIL_WORDS.notConfigured,
    ],
    ['an unreadable answer', () => ({ status: 200, body: { hello: 1 } }), TEST_EMAIL_WORDS.silent],
    ['not JSON', () => ({ status: 200, body: 'plain' }), TEST_EMAIL_WORDS.silent],
    ['an unexpected status', () => ({ status: 500, body: 'boom secret-detail' }), TEST_EMAIL_WORDS.silent],
  ])('prints the next step for %s and never the server text', async (_n, route, words) => {
    const { m, io } = await withEmail(route, [true, false]);
    expect(await runCli(['setup'], m.deps)).toBe(0);
    const text = io.stdout;
    expect(text).toContain(words);
    expect(text).not.toContain('secret-detail');
  });

  it('an app that does not answer is said plainly', async () => {
    const { m, io } = await withEmail(null, [true, false]);
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(io.stdout).toContain(TEST_EMAIL_WORDS.silent);
  });

  it('is offered on a full setup and on --reconfigure email, and on no other reconfigure (V9)', async () => {
    const full = await withEmail(
      () => ({ status: 200, body: { result: 'sent', at: '2026-10-24T09:30:00.000Z' } }),
      [false, false],
    );
    expect(await runCli(['setup'], full.m.deps)).toBe(0);
    expect(full.ask.asked).toContain(TEST_EMAIL_QUESTION);
    expect(offeredFor(null)).toBe(true);
    expect(offeredFor('email')).toBe(true);
    for (const group of ['travelpayouts', 'password', 'linger', 'port', 'timezone'] as const) {
      const other = await withEmail(
        () => ({ status: 200, body: {} }),
        Array.from({ length: 14 }, () => ''),
      );
      expect(offeredFor(group)).toBe(false);
      await runCli(['setup', '--reconfigure', group], other.m.deps);
      expect(other.ask.asked, group).not.toContain(TEST_EMAIL_QUESTION);
    }
  });

  it('is never offered without email, without a terminal, or with --non-interactive', async () => {
    const plainAsk = scriptedAsk(['', '', '', '', '', '', '', false]);
    const plain = machine({ ask: plainAsk, io: testIo({ tty: true }) });
    expect(await runCli(['setup'], plain.deps)).toBe(0);
    expect(plainAsk.asked).not.toContain(TEST_EMAIL_QUESTION);
    const { m, http, ask } = await withEmail(() => ({ status: 200, body: {} }), []);
    m.deps.io = testIo({ tty: false });
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(ask.asked).toEqual([]);
    expect(posts(http)).toHaveLength(0);
  });
});
