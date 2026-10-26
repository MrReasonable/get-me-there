import { describe, expect, it } from 'vitest';
import { appEndpoint, dockerAppState, nativeEndpoint } from '../src/appEndpoint.js';
import type { RunHandler } from '../src/exec/memory.js';
import { machine } from './support/machine.js';

// The one "where is this machine's app" read (W1): the native app from app.env, the app in Docker from compose and the
// checkout's .env, or none with the reason. `gmt status` uses it, and so does any command that asks the running app.
const APP_ENV = '/Users/op/.config/get-me-there/app.env';
const DOT_ENV = '/repo/.env';
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
const docker =
  (ps: { code: number; stdout: string } | null, port: string | null = '127.0.0.1:3000'): RunHandler =>
  (a) => {
    if (a[0] !== 'docker') return undefined;
    if (a[1] === '--version') return ps === null ? { code: 127 } : { code: 0, stdout: 'Docker version 29\n' };
    if (a.includes('ps')) return ps ?? { code: 1 };
    if (a.includes('port'))
      return port === null ? { code: 1, stderr: 'no container' } : { code: 0, stdout: `${port}\n` };
    return undefined;
  };
const running = { code: 0, stdout: '{"Service":"app","State":"running"}\n' };

describe('appEndpoint', () => {
  it('the native app: app.env’s port and basic auth', async () => {
    const m = machine({ extra: docker(running) });
    m.fs.file(
      APP_ENV,
      'PORT=3917\nAPP_BASIC_AUTH_USER=operator\nAPP_BASIC_AUTH_PASS="pass-0123456789"\n',
      0o600,
    );
    const ep = await appEndpoint(m.deps);
    expect(ep).toEqual({
      kind: 'native',
      baseUrl: 'http://127.0.0.1:3917',
      port: 3917,
      creds: { port: 3917, user: 'operator', pass: 'pass-0123456789' },
      headers: { Authorization: basic('operator', 'pass-0123456789') },
    });
    // with app.env there, Docker is never asked
    expect(m.runner.calls.some((c) => c.argv[0] === 'docker')).toBe(false);
  });
  it('the Docker app with no native install: the published port, the .env basic auth, not .env’s PORT', async () => {
    const m = machine({ extra: docker(running, '127.0.0.1:3001') });
    m.fs.file(DOT_ENV, 'PORT=9999\nAPP_BASIC_AUTH_USER=op\nAPP_BASIC_AUTH_PASS=docker-pass-0123\n', 0o600);
    expect(await appEndpoint(m.deps)).toEqual({
      kind: 'docker',
      baseUrl: 'http://127.0.0.1:3001',
      port: 3001,
      creds: { port: 3001, user: 'op', pass: 'docker-pass-0123' },
      headers: { Authorization: basic('op', 'docker-pass-0123') },
    });
  });
  it('a Docker app with auth turned off (no .env lines) is read without credentials', async () => {
    const m = machine({ extra: docker(running) });
    expect(await appEndpoint(m.deps)).toMatchObject({ kind: 'docker', creds: null, headers: {} });
  });
  it.each([
    ['no docker command', docker(null), 'there is no app.env yet: run pnpm gmt setup'],
    ['no compose app', docker({ code: 0, stdout: '' }), 'there is no app.env yet: run pnpm gmt setup'],
    [
      'a stopped compose app',
      docker({ code: 0, stdout: '{"Service":"app","State":"exited"}\n' }),
      'the Docker app is not running',
    ],
    [
      'compose state unreadable',
      docker({ code: 0, stdout: 'not json\n' }),
      'there is no native install, and Docker’s compose state could not be read',
    ],
    [
      'no published port',
      docker(running, null),
      'compose did not say which host port the Docker app publishes',
    ],
    [
      'a published port that is not loopback',
      docker(running, '192.0.2.7:3000'),
      'compose publishes the Docker app on 192.0.2.7',
    ],
  ])('none, with the reason, for %s', async (_name, handler, reason) => {
    const m = machine({ extra: handler });
    m.fs.file(DOT_ENV, 'APP_BASIC_AUTH_USER=op\nAPP_BASIC_AUTH_PASS=docker-pass-0123\n', 0o600);
    const ep = await appEndpoint(m.deps);
    expect(ep.kind).toBe('none');
    expect(ep.kind === 'none' ? ep.reason : '').toContain(reason);
  });
  it('an unreadable app.env or .env is none with the reason, never a guess', async () => {
    const m = machine({ extra: docker(running) });
    m.fs.file(APP_ENV, '', 0o600).unreadable(APP_ENV);
    expect(nativeEndpoint(m.deps)).toEqual({
      kind: 'none',
      reason: 'app.env could not be read: check that it is yours and readable (chmod 600)',
    });
    const d = machine({ extra: docker(running) });
    d.fs.file(DOT_ENV, '', 0o600).unreadable(DOT_ENV);
    expect(await appEndpoint(d.deps)).toMatchObject({
      kind: 'none',
      reason: expect.stringContaining('.env could not be read'),
    });
  });
  it('a caller that read the service units decides what native means', async () => {
    const m = machine({ extra: docker(running) });
    expect(await appEndpoint(m.deps, { native: true })).toEqual({
      kind: 'none',
      reason: 'there is no app.env yet: run pnpm gmt setup',
    });
  });
  it('dockerAppState: running, stopped, absent, unknown on a failed or unreadable ps, null with no docker', async () => {
    const state = async (h: RunHandler) => dockerAppState(machine({ extra: h }).deps);
    expect(await state(docker(running))).toBe('running');
    expect(await state(docker({ code: 0, stdout: '[{"Service":"app","State":"exited"}]' }))).toBe('stopped');
    expect(await state(docker({ code: 0, stdout: '' }))).toBe('absent');
    expect(await state(docker({ code: 1, stdout: '' }))).toBe('unknown');
    expect(await state(docker({ code: 0, stdout: 'Cannot connect\n' }))).toBe('unknown');
    expect(await state(docker(null))).toBeNull();
  });
});
