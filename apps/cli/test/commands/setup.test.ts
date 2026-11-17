import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../../src/cli.js';
import type { Action } from '../../src/plan/action.js';
import { scriptedAsk, stubHttp, testIo } from '../support/deps.js';
import { machine } from '../support/machine.js';

const ENV = '/Users/op/.config/get-me-there/app.env';
const PASS = Buffer.alloc(24, 7).toString('base64url');
const show = (log: readonly Action[]) =>
  log.map((a) =>
    a.kind === 'run'
      ? `run ${a.describe}`
      : a.kind === 'waitHealthy'
        ? `wait ${a.url}`
        : `${a.kind} ${'path' in a ? a.path : ''}`,
  );
const answersFile = (m: ReturnType<typeof machine>, body: unknown) =>
  m.fs.file('/work/a.json', JSON.stringify(body), 0o600);

/** A machine that has been through one Enter-only setup. */
async function setUp(os: 'darwin' | 'linux' = 'darwin') {
  const m = machine({ os });
  answersFile(m, {});
  expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
  m.executor.log.length = 0;
  m.io.stdout = '';
  return m;
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('setup must not call fetch');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('setup on a clean machine (brief Task 16b.6)', () => {
  it('plans the directories, app.env, install and build, both services, the health wait and the first backup', async () => {
    const m = machine();
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual([
      'mkdir /Users/op/.config/get-me-there',
      'mkdir /Users/op/.local/share/get-me-there',
      'mkdir /Users/op/.local/share/get-me-there/backups',
      'mkdir /Users/op/.local/share/get-me-there/backups/daily',
      'mkdir /Users/op/.local/share/get-me-there/backups/update',
      'mkdir /Users/op/.local/state/get-me-there',
      'mkdir /Users/op/Library/Logs/get-me-there',
      'mkdir /Users/op/Library/LaunchAgents',
      `writeFile ${ENV}`,
      'writeFile /Users/op/.local/state/get-me-there/setup.json',
      'run pnpm install --frozen-lockfile',
      'run pnpm build',
      'writeFile /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'writeFile /Users/op/Library/LaunchAgents/local.get-me-there.backup.plist',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.backup.plist',
      'wait http://127.0.0.1:3000/api/health',
      'writeFile /Users/op/.local/state/get-me-there/setup.json',
      'run launchctl kickstart gui/501/local.get-me-there.backup',
    ]);
    for (const a of m.executor.log)
      if (a.kind === 'mkdir') expect(a.mode).toBe(a.path.endsWith('LaunchAgents') ? 0o755 : 0o700);
    const env = m.executor.log.find((a) => a.kind === 'writeFile' && a.path === ENV);
    expect(env).toMatchObject({ mode: 0o600, secret: true });
    expect(parseEnv(m.fs.read(ENV) ?? '')).toEqual({
      NODE_ENV: 'production',
      DATABASE_PATH: '/Users/op/.local/share/get-me-there/get-me-there.db',
      BIND_ADDRESS: '127.0.0.1',
      PORT: '3000',
      SCHEDULER_TIMEZONE: 'Europe/London',
      POINT_OF_SALE: 'GB',
    });
    expect(m.executor.log.find((a) => a.kind === 'waitHealthy')).toMatchObject({ timeoutSeconds: 240 });
  });

  it('on Linux: units, daemon-reload, enable --now, the oneshot backup, and linger', async () => {
    const m = machine({ os: 'linux' });
    answersFile(m, { linger: 'enable', port: 3917 });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    const runs = show(m.executor.log).filter((s) => s.startsWith('run '));
    expect(runs).toEqual([
      'run pnpm install --frozen-lockfile',
      'run pnpm build',
      'run systemctl --user daemon-reload',
      'run systemctl --user enable --now get-me-there-app.service',
      'run systemctl --user daemon-reload',
      'run systemctl --user enable --now get-me-there-backup.timer',
      'run systemctl --user start get-me-there-backup.service',
      'run loginctl enable-linger op',
    ]);
    expect(show(m.executor.log)).toContain('wait http://127.0.0.1:3917/api/health');
  });

  it('a failed first backup still finishes, saying so with pnpm gmt backup as the fix', async () => {
    const m = machine({ backupWrites: false });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain(
      'The first daily backup did not complete; take one with `pnpm gmt backup`.',
    );
  });

  it('a failing step stops setup with the report, exit 1', async () => {
    const m = machine({ fail: (a) => a[0] === 'pnpm' && a[1] === 'build' });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(1);
    expect(m.io.stderr).toContain('stopped at a failed step; nothing was undone');
    expect(m.io.stderr).toContain('failed:  run pnpm build');
    expect(m.executor.log.some((a) => a.kind === 'waitHealthy')).toBe(false);
  });

  it('every check runs before any action: an unmet prerequisite applies nothing', async () => {
    const m = machine({ extra: (a) => (a[0] === 'git' ? { code: 127 } : undefined) });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('git is not installed');
    expect(m.executor.log).toEqual([]);
  });

  it('a Node under a shim directory is refused before anything', async () => {
    const m = machine({ deps: { execPath: '/Users/op/.volta/bin/node' } });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('shim directory');
    expect(m.executor.log).toEqual([]);
  });

  it('a busy port 3000 makes the next free one the default', async () => {
    const m = machine({ deps: { portFree: async (p) => p !== 3000 } });
    answersFile(m, {});
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '').PORT).toBe('3001');
  });
  it('an answered port that is busy is refused with the next free one', async () => {
    const m = machine({ deps: { portFree: async (p) => p !== 3917 } });
    answersFile(m, { port: 3917 });
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('port 3917 is in use on 127.0.0.1');
    expect(m.io.stderr).toContain('choose 3918');
  });

  it('interactive: Enter through the prompts, the paste question before any action, then the browser offer', async () => {
    // why: WP17 Task 17.6: the browser provider's question (false) comes before the offer to open the app
    const ask = scriptedAsk(['', '', '', '', '', '', '', false, false]);
    const m = machine({ ask, io: testIo({ tty: true }) });
    const asked: number[] = [];
    const orig = ask.secret;
    ask.secret = async (q) => {
      asked.push(m.executor.log.length);
      return orig(q);
    };
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(ask.asked.filter((q) => q.startsWith('Paste a token now?'))).toHaveLength(1);
    expect(asked.at(-1)).toBe(0);
    expect(ask.asked.at(-1)).toBe('Open the app in your browser now?');
  });

  it('a pasted token is written as TRAVELPAYOUTS_TOKEN and the closing screen has a source', async () => {
    const ask = scriptedAsk(['', '', '', '', '', '', 'tp-token-0123456789', false, false]);
    const m = machine({ ask, io: testIo({ tty: true }) });
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '').TRAVELPAYOUTS_TOKEN).toBe('tp-token-0123456789');
    expect(m.io.stdout).not.toContain('No price source is set up yet');
    expect(m.io.stdout).toContain('Next: open http://127.0.0.1:3000 and use the new-search panel on Trips');
  });
});

describe('the closing screen (brief §6)', () => {
  it('with no price source its first line says so and points at Travelpayouts; with no password it says why and how to turn sign-in on', async () => {
    const m = machine();
    answersFile(m, {});
    await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps);
    const closing = m.io.stdout.slice(m.io.stdout.indexOf('No price source'));
    expect(closing.split('\n')[0]).toBe(
      'No price source is set up yet, so searches will find nothing. The no-cost source is Travelpayouts, which needs a free account: register at https://www.travelpayouts.com/, then copy the token from your Profile’s API token section (help: https://support.travelpayouts.com/hc/en-us/articles/203956083) and run `pnpm gmt setup --reconfigure travelpayouts`.',
    );
    expect(closing).not.toContain('User name');
    expect(closing).not.toContain('The password is in');
    for (const s of [
      'http://127.0.0.1:3000',
      'There is no password: only this machine can reach the app, and that means every account on it. On a machine other people log in to, or before another device or name reaches the app (docs/setup.md section 3), turn sign-in on with `pnpm gmt setup --reconfigure password`.',
      'Only if you want to reach it from another device: an SSH tunnel (ssh -L 3000:127.0.0.1:3000 <this machine>)',
      'docs/setup.md section 3',
      'plain HTTP',
      'Scheduled searches run while this machine is awake; a missed one is caught up once when it wakes, without the browser provider.',
      'Next: open http://127.0.0.1:3000 and use the new-search panel on Trips: enter From, To and the dates, review what the search will use, then press Search.',
      'Nothing runs on a schedule until you give a search one',
    ])
      expect(closing).toContain(s);
    expect(m.io.stdout).not.toContain(PASS);
  });
});

describe('a second setup (spec §16: the first failing test)', () => {
  it('over an app.env whose PORT differs from the plan’s reports the difference and plans no writeFile for it', async () => {
    const m = await setUp();
    answersFile(m, { port: 3917 });
    const before = m.fs.read(ENV);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(m.io.stdout).toContain('app.env differs from what setup would write: PORT');
    expect(m.io.stdout).toContain('pnpm gmt setup --reconfigure port');
    expect(m.executor.log.filter((a) => a.kind === 'writeFile' && a.path === ENV)).toEqual([]);
    expect(m.fs.read(ENV)).toBe(before);
    expect(show(m.executor.log)).toContain('wait http://127.0.0.1:3000/api/health');
  });

  it('a re-run on a fully set-up machine plans nothing but waitHealthy', async () => {
    const m = await setUp();
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(show(m.executor.log)).toEqual(['wait http://127.0.0.1:3000/api/health']);
    const l = await setUp('linux');
    expect(await runCli(['setup'], l.deps)).toBe(0);
    expect(show(l.executor.log)).toEqual(['wait http://127.0.0.1:3000/api/health']);
  });

  it('a re-run with a stopped app starts it', async () => {
    const m = await setUp();
    m.running.clear();
    await runCli(['setup'], m.deps);
    expect(show(m.executor.log)).toEqual([
      'run launchctl kickstart gui/501/local.get-me-there.app',
      'wait http://127.0.0.1:3000/api/health',
    ]);
  });

  it('--dry-run prints the plan with the literal launchctl commands and applies nothing', async () => {
    const m = machine();
    answersFile(m, {});
    expect(
      await runCli(['setup', '--dry-run', '--non-interactive', '--answers', '/work/a.json'], m.deps),
    ).toBe(0);
    expect(m.executor.log).toEqual([]);
    expect(m.io.stdout).toContain(
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    );
    expect(m.io.stdout).toContain(`write ${ENV} (0600, 8 lines, values hidden)`);
    expect(m.io.stdout).toContain('then: run launchctl kickstart gui/501/local.get-me-there.backup');
    expect(m.io.stdout).not.toContain(PASS);
  });
});

describe('--reconfigure <group>', () => {
  it('port replaces only that line, keeps lines it does not own, and restarts the app', async () => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}LOG_LEVEL=debug\n`, 0o600);
    const before = (m.fs.read(ENV) ?? '').split('\n');
    m.deps.ask = scriptedAsk(['3917']);
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['setup', '--reconfigure', 'port'], m.deps)).toBe(0);
    const after = (m.fs.read(ENV) ?? '').split('\n');
    expect(after.filter((l) => !before.includes(l))).toEqual(['PORT="3917"']);
    expect(before.filter((l) => !after.includes(l))).toEqual(['PORT="3000"']);
    expect(show(m.executor.log)).toEqual([
      `writeFile ${ENV}`,
      'run launchctl bootout gui/501/local.get-me-there.app',
      'waitGone ',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
      'wait http://127.0.0.1:3917/api/health',
    ]);
  });

  it.each([
    ['timezone', ['America/New_York'], ['SCHEDULER_TIMEZONE']],
    ['travelpayouts', ['tp-token-0123456789'], ['TRAVELPAYOUTS_TOKEN']],
    [
      'searchapi',
      ['40usd', 'sa-key-0123456789', '5'],
      ['SEARCHAPI_KEY', 'SEARCHAPI_PLAN', 'SEARCHAPI_BILLING_DAY'],
    ],
    [
      'email',
      [true, 'smtp.example.com', '', '', 'me', 'smtp-pass-0123', 'me@example.com', 'gmt@example.com', false],
      ['SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS', 'SMTP_USER', 'SMTP_PASS', 'ALERT_EMAIL_TO', 'ALERT_EMAIL_FROM'],
    ],
  ] as const)('%s touches only its lines', async (group, answers, names) => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}LOG_LEVEL=debug\n`, 0o600);
    const before = parseEnv(m.fs.read(ENV) ?? '');
    m.deps.ask = scriptedAsk([...answers]);
    m.deps.io = testIo({ tty: true });
    m.deps.randomBytes = (n) => Buffer.alloc(n, 9);
    expect(await runCli(['setup', '--reconfigure', group], m.deps)).toBe(0);
    const after = parseEnv(m.fs.read(ENV) ?? '');
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((k) => before[k] !== after[k])
      .sort();
    expect(changed).toEqual([...names].sort());
    expect(after.LOG_LEVEL).toBe('debug');
    expect(show(m.executor.log)).toContain(
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    );
    expect(m.io.stdout).not.toContain(after.APP_BASIC_AUTH_PASS ?? 'none');
  });

  it('refuses before a first setup', async () => {
    const m = machine();
    expect(await runCli(['setup', '--reconfigure', 'port'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('run pnpm gmt setup first');
  });

  const ACTIVE = {
    execution: {
      id: 'e1',
      definitionId: 'd1',
      definitionName: 'London to New York weekly',
      kind: 'run',
      startedAt: '2026-10-24T09:00:00.000Z',
      estimatedFinishAt: '2026-10-24T10:15:00.000Z',
    },
  };
  it('browser refuses while a run is active, naming it', async () => {
    const m = await setUp();
    m.deps.http = stubHttp({ 'GET /api/executions/active': () => ({ status: 200, body: ACTIVE }) });
    m.deps.ask = scriptedAsk([]);
    expect(await runCli(['setup', '--reconfigure', 'browser'], m.deps)).toBe(75);
    expect(m.io.stderr).toContain('a search is running in the app: London to New York weekly');
    expect(m.io.stderr).toContain('estimated to finish 2026-10-24T10:15:00.000Z');
    expect(m.executor.log).toEqual([]);
  });
  it('browser --force states the interruption first, asks row 9 with the current value, writes only CAMOUFOX_BROWSER_WINDOW and restarts the app only', async () => {
    const m = await setUp();
    const http = stubHttp({ 'GET /api/executions/active': () => ({ status: 200, body: ACTIVE }) });
    m.deps.http = http;
    // why: WP17 Task 17.6: row 9, then the browser provider's own question (no)
    m.deps.ask = scriptedAsk([true, false]);
    const io = testIo({ tty: true });
    m.deps.io = io;
    const before = parseEnv(m.fs.read(ENV) ?? '');
    expect(await runCli(['setup', '--reconfigure', 'browser', '--force'], m.deps)).toBe(0);
    expect(io.stdout).toContain('a search is running in the app: London to New York weekly');
    expect(io.stdout).toContain('Going ahead anyway (--force): the app stops within 30 s');
    expect(io.stdout).toContain('The new value applies when the run resumes.');
    expect(io.stdout.indexOf('Going ahead anyway')).toBeLessThan(io.stdout.indexOf('written'));
    const after = parseEnv(m.fs.read(ENV) ?? '');
    expect(after).toEqual({ ...before, CAMOUFOX_BROWSER_WINDOW: 'any' });
    expect(show(m.executor.log).filter((s) => s.startsWith('run '))).toEqual([
      'run launchctl bootout gui/501/local.get-me-there.app',
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    ]);
    // why: spec §4: the fresh install has no password, so the guard asks the app with no Authorization header
    expect(http.requests[0]?.headers).toEqual({});
  });
  it('browser asks an app with a password with its basic auth', async () => {
    const m = await setUp();
    m.deps.randomBytes = (n) => Buffer.alloc(n, 9);
    m.deps.http = stubHttp({
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
    });
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['setup', '--reconfigure', 'password'], m.deps)).toBe(0);
    const pass = parseEnv(m.fs.read(ENV) ?? '').APP_BASIC_AUTH_PASS ?? 'none';
    const http = stubHttp({
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
    });
    m.deps.http = http;
    m.deps.ask = scriptedAsk([false, false]);
    expect(await runCli(['setup', '--reconfigure', 'browser'], m.deps)).toBe(0);
    expect(http.requests[0]?.headers.Authorization).toBe(
      `Basic ${Buffer.from(`operator:${pass}`).toString('base64')}`,
    );
  });
  it('browser with no run active asks and writes scheduled for no', async () => {
    const m = await setUp();
    m.deps.http = stubHttp({
      'GET /api/executions/active': () => ({ status: 200, body: { execution: null } }),
    });
    m.deps.ask = scriptedAsk([false, false]);
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['setup', '--reconfigure', 'browser'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '').CAMOUFOX_BROWSER_WINDOW).toBe('scheduled');
  });
});

const ALLOW_TEXT =
  'There is no password because ALLOW_UNAUTHENTICATED is set in app.env, so every device that reaches this machine can use the app (docs/setup.md section 3). To turn sign-in on: `pnpm gmt setup --reconfigure password`.';
const NEEDS_TEXT =
  'app.env has no password, but its settings let something other than this machine reach the app, so the app refuses to start: run `pnpm gmt setup --reconfigure password`.';

describe('signing in (spec §4: no password while only this machine can reach the app)', () => {
  const GEN = Buffer.alloc(24, 9).toString('base64url');
  const turnOn = async (m: ReturnType<typeof machine>) => {
    m.deps.randomBytes = (n) => Buffer.alloc(n, 9);
    m.deps.io = testIo({ tty: true });
    return runCli(['setup', '--reconfigure', 'password'], m.deps);
  };

  it('a fresh loopback install writes no sign-in lines', async () => {
    const m = await setUp();
    const env = parseEnv(m.fs.read(ENV) ?? '');
    expect(env).not.toHaveProperty('APP_BASIC_AUTH_USER');
    expect(env).not.toHaveProperty('APP_BASIC_AUTH_PASS');
  });

  it('--reconfigure password writes both lines, turning sign-in on, and restarts the app', async () => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}LOG_LEVEL=debug\n`, 0o600);
    const before = parseEnv(m.fs.read(ENV) ?? '');
    expect(await turnOn(m)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '')).toEqual({
      ...before,
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: GEN,
    });
    expect(GEN).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(show(m.executor.log)).toContain(
      'run launchctl bootstrap gui/501 /Users/op/Library/LaunchAgents/local.get-me-there.app.plist',
    );
    expect(m.io.stdout).not.toContain(GEN);
  });

  it('--reconfigure password replaces an existing password, touching only its own line', async () => {
    const m = await setUp();
    expect(await turnOn(m)).toBe(0);
    const before = parseEnv(m.fs.read(ENV) ?? '');
    m.deps.randomBytes = (n) => Buffer.alloc(n, 4);
    expect(await runCli(['setup', '--reconfigure', 'password'], m.deps)).toBe(0);
    const after = parseEnv(m.fs.read(ENV) ?? '');
    expect(after).toEqual({ ...before, APP_BASIC_AUTH_PASS: Buffer.alloc(24, 4).toString('base64url') });
  });

  it('a re-run keeps an existing password, and keeps a file without one as it is', async () => {
    const m = await setUp();
    expect(await turnOn(m)).toBe(0);
    const withPassword = m.fs.read(ENV);
    m.executor.log.length = 0;
    m.deps.randomBytes = (n) => Buffer.alloc(n, 3);
    m.deps.io = m.io;
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(m.fs.read(ENV)).toBe(withPassword);
    expect(show(m.executor.log)).toEqual(['wait http://127.0.0.1:3000/api/health']);
    const bare = await setUp();
    const without = bare.fs.read(ENV);
    expect(await runCli(['setup'], bare.deps)).toBe(0);
    expect(bare.fs.read(ENV)).toBe(without);
    expect(bare.io.stdout).not.toContain('app.env differs');
  });

  it('a kept ALLOWED_HOSTS that is not this machine generates a password: the app would refuse to start without one', async () => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}ALLOWED_HOSTS=localhost:3000,laptop.tail1234.ts.net\n`, 0o600);
    m.deps.randomBytes = (n) => Buffer.alloc(n, 9);
    expect(await runCli(['setup'], m.deps)).toBe(0);
    const env = parseEnv(m.fs.read(ENV) ?? '');
    expect(env).toMatchObject({
      ALLOWED_HOSTS: 'localhost:3000,laptop.tail1234.ts.net',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: GEN,
    });
    expect(m.io.stdout).toContain('app.env has no password, which its settings need now; setup writes one');
    expect(show(m.executor.log)).toContain(`writeFile ${ENV}`);
    expect(m.io.stdout).not.toContain(GEN);
  });

  it.each([
    [
      'a kept BIND_ADDRESS beyond loopback',
      (t: string) => t.replace('BIND_ADDRESS="127.0.0.1"', 'BIND_ADDRESS="0.0.0.0"'),
      { BIND_ADDRESS: '0.0.0.0' },
    ],
    [
      'a non-loopback ALLOWED_HOSTS',
      (t: string) => `${t}ALLOWED_HOSTS=flights.example.com\n`,
      { ALLOWED_HOSTS: 'flights.example.com' },
    ],
    ['TRUST_PROXY=true', (t: string) => `${t}TRUST_PROXY=true\n`, { TRUST_PROXY: 'true' }],
  ] as const)(
    '--reconfigure password repairs a file with %s and no password, keeping it (the fix the app’s refusal names)',
    async (_l, edit, kept) => {
      const m = await setUp();
      m.fs.file(ENV, edit(m.fs.read(ENV) ?? ''), 0o600);
      const before = parseEnv(m.fs.read(ENV) ?? '');
      const io = testIo({ tty: true });
      m.deps.io = io;
      m.deps.randomBytes = (n) => Buffer.alloc(n, 9);
      expect(await runCli(['setup', '--reconfigure', 'password'], m.deps)).toBe(0);
      expect(parseEnv(m.fs.read(ENV) ?? '')).toEqual({
        ...before,
        ...kept,
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: GEN,
      });
      expect(io.stdout).toContain(
        'setup --reconfigure password: APP_BASIC_AUTH_USER, APP_BASIC_AUTH_PASS written; the app restarted',
      );
      expect(io.stdout + io.stderr).not.toContain(GEN);
    },
  );

  it('--reconfigure password repairs the same file (the fix the app’s refusal names)', async () => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}ALLOWED_HOSTS=flights.example.com\n`, 0o600);
    expect(await turnOn(m)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '')).toMatchObject({
      ALLOWED_HOSTS: 'flights.example.com',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: GEN,
    });
  });

  it('a kept BIND_ADDRESS beyond loopback generates a password too', async () => {
    const m = await setUp();
    m.fs.file(
      ENV,
      (m.fs.read(ENV) ?? '').replace('BIND_ADDRESS="127.0.0.1"', 'BIND_ADDRESS="0.0.0.0"'),
      0o600,
    );
    m.deps.randomBytes = (n) => Buffer.alloc(n, 9);
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '')).toMatchObject({
      BIND_ADDRESS: '0.0.0.0',
      APP_BASIC_AUTH_PASS: GEN,
    });
  });

  it('a re-run over an ALLOW_UNAUTHENTICATED file keeps it without a password and says why there is none', async () => {
    const m = await setUp();
    m.fs.file(
      ENV,
      `${m.fs.read(ENV)}ALLOW_UNAUTHENTICATED=true\nALLOWED_HOSTS=localhost:3000,laptop.tail1234.ts.net\n`,
      0o600,
    );
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '')).not.toHaveProperty('APP_BASIC_AUTH_PASS');
    expect(m.io.stdout).toContain(ALLOW_TEXT);
    expect(m.io.stdout).not.toContain('only this machine can reach the app');
  });

  it('a TRUST_PROXY=true file gets a password written: a proxy is in front', async () => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}TRUST_PROXY=true\n`, 0o600);
    m.deps.randomBytes = (n) => Buffer.alloc(n, 9);
    expect(await runCli(['setup'], m.deps)).toBe(0);
    expect(parseEnv(m.fs.read(ENV) ?? '')).toMatchObject({ TRUST_PROXY: 'true', APP_BASIC_AUTH_PASS: GEN });
  });

  it('a file with another fault is still refused, naming its fields', async () => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}ALLOWED_HOSTS=flights.example.com\nLOG_LEVEL=loud\n`, 0o600);
    expect(await runCli(['setup'], m.deps)).toBe(78);
    expect(m.io.stderr).toContain('would not pass the app’s settings check (ALLOWED_HOSTS, LOG_LEVEL)');
  });
});

describe('password', () => {
  it('prints the password to a terminal only, read with parseEnv; refuses a pipe and a missing app.env (CodeRabbit …k7n)', async () => {
    const m = await setUp();
    m.deps.randomBytes = (n) => Buffer.alloc(n, 7);
    m.deps.io = testIo({ tty: true });
    expect(await runCli(['setup', '--reconfigure', 'password'], m.deps)).toBe(0);
    const tty = testIo({ tty: true });
    m.deps.io = tty;
    expect(await runCli(['password'], m.deps)).toBe(0);
    expect(tty.stdout).toBe(`${PASS}\n`);
    const pipe = testIo({ tty: false });
    m.deps.io = pipe;
    expect(await runCli(['password'], m.deps)).toBe(78);
    expect(pipe.stdout).toBe('');
    expect(pipe.stderr).toContain('prints only to a terminal');
    const none = machine({ io: testIo({ tty: true }) });
    expect(await runCli(['password'], none.deps)).toBe(78);
    expect(none.io.stderr).toContain('run pnpm gmt setup first');
  });

  it('with none and ALLOW_UNAUTHENTICATED=true says that, not that only this machine can reach the app', async () => {
    const m = await setUp();
    m.fs.file(
      ENV,
      `${m.fs.read(ENV)}ALLOW_UNAUTHENTICATED=true\nALLOWED_HOSTS=localhost:3000,laptop.tail1234.ts.net\n`,
      0o600,
    );
    const tty = testIo({ tty: true });
    m.deps.io = tty;
    expect(await runCli(['password'], m.deps)).toBe(0);
    expect(tty.stderr).toBe(`${ALLOW_TEXT}\n`);
  });

  it('with none and settings that need one says the app refuses to start and names the fix (78)', async () => {
    const m = await setUp();
    m.fs.file(ENV, `${m.fs.read(ENV)}ALLOWED_HOSTS=flights.example.com\n`, 0o600);
    const tty = testIo({ tty: true });
    m.deps.io = tty;
    expect(await runCli(['password'], m.deps)).toBe(78);
    expect(tty.stderr).toBe(`${NEEDS_TEXT}\n`);
  });

  it('with none set (spec §4) says why on stderr and how to turn sign-in on, and succeeds', async () => {
    const m = await setUp();
    const tty = testIo({ tty: true });
    m.deps.io = tty;
    expect(await runCli(['password'], m.deps)).toBe(0);
    expect(tty.stdout).toBe('');
    expect(tty.stderr).toBe(
      'There is no password: only this machine can reach the app, and that means every account on it. On a machine other people log in to, or before another device or name reaches the app (docs/setup.md section 3), turn sign-in on with `pnpm gmt setup --reconfigure password`.\n',
    );
  });
});

describe('no secret reaches any output (spec §9 item 9, sentinel secrets)', () => {
  it('a full run with every secret set leaks none into stdout, stderr, plan text or rendered services, raw or base64url', async () => {
    const secrets = {
      tp: 'SENTINEL-tp-Zx81Lq0w',
      sa: 'SENTINEL-sa-Pq73Ns2k',
      smtp: 'SENTINEL-smtp-Rt55Jm',
    };
    const m = machine({ deps: { secretEnv: (n) => (n === 'SMTP_P' ? secrets.smtp : undefined) } });
    answersFile(m, {
      travelpayouts: { token: secrets.tp },
      searchApi: { plan: '40usd', key: secrets.sa },
      email: {
        host: 'smtp.example.com',
        port: 465,
        tls: 'implicit',
        user: 'u',
        pass: { fromEnv: 'SMTP_P' },
        to: 'a@example.com',
        from: 'b@example.com',
      },
    });
    expect(
      await runCli(['setup', '--dry-run', '--non-interactive', '--answers', '/work/a.json'], m.deps),
    ).toBe(0);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    expect(await runCli(['setup', '--non-interactive', '--answers', '/work/a.json'], m.deps)).toBe(0);
    const outputs = [
      m.io.stdout,
      m.io.stderr,
      ...m.executor.log.filter((a) => !(a.kind === 'writeFile' && a.secret)).map((a) => JSON.stringify(a)),
      ...m.runner.calls.map((c) => JSON.stringify(c.argv)),
    ];
    const pass = parseEnv(m.fs.read(ENV) ?? '').APP_BASIC_AUTH_PASS ?? 'missing';
    for (const s of [...Object.values(secrets), pass])
      for (const o of outputs) {
        expect(o).not.toContain(s);
        expect(o).not.toContain(Buffer.from(s).toString('base64url'));
      }
  });
});
