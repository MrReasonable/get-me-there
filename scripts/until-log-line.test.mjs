import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// why: the project's rule (Ian, PR #11): CI waits on events, never a poll or a fixed sleep. The docker job's
// "camoufox-worker absent" step waits for the run's own "execution: pass finished" log line through this helper,
// reading the container's log as it is written; a timeout is only a backstop.
const SCRIPT = join(import.meta.dirname, 'until-log-line.mjs');
const started = [];
afterEach(() => {
  // why: a test that fails or times out must not leave the script (or its follower) running
  for (const c of started.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
});
const run = async (args, env = {}) => {
  const c = spawn(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(c);
  let out = '';
  let err = '';
  c.stdout.on('data', (b) => {
    out += b;
  });
  c.stderr.on('data', (b) => {
    err += b;
  });
  const [code] = await once(c, 'exit');
  return { code, out, err };
};
/** A follower that prints these lines, then stays open as `docker compose logs --follow` does. */
const follower = (lines) => [
  process.execPath,
  '-e',
  `process.stdout.write(${JSON.stringify(lines.map((l) => `${l}\n`).join(''))}); setInterval(() => {}, 1 << 30)`,
];
const WANT = ['--msg', 'execution: pass finished', '--field', 'executionId=e-2'];

describe('scripts/until-log-line.mjs', { timeout: 30_000 }, () => {
  it('ends on the first JSON line with the message and every field, past other runs, other lines and non-JSON', async () => {
    const r = await run([
      ...WANT,
      '--',
      ...follower([
        'app-1 booting',
        '{"level":30,"msg":"execution: pass finished","executionId":"e-1"}',
        '{"level":30,"msg":"execution: child started","executionId":"e-2"}',
        '{"level":30,"msg":"execution: pass finished","executionId":"e-2","status":"completed"}',
      ]),
    ]);
    expect(r).toMatchObject({ code: 0, err: '' });
    expect(r.out).toBe('seen: execution: pass finished (executionId=e-2)\n');
  });
  it('a line split across writes still matches', async () => {
    const line = '{"msg":"execution: pass finished","executionId":"e-2"}\n';
    const r = await run([
      ...WANT,
      '--',
      process.execPath,
      '-e',
      // the second half is written once the first has been flushed
      `process.stdout.write(${JSON.stringify(line.slice(0, 20))}, () => process.stdout.write(${JSON.stringify(line.slice(20))})); setInterval(() => {}, 1 << 30)`,
    ]);
    expect(r.code).toBe(0);
  });
  it('a follower that ends before the line fails at once with its exit, not the backstop’s message', async () => {
    const r = await run(
      [...WANT, '--', process.execPath, '-e', 'console.log(\'{"msg":"listening"}\'); process.exit(2)'],
      {
        BACKSTOP_MS: '60000',
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain('the log follower ended before the line (2)');
  });
  it('a line the follower prints just before it ends still counts', async () => {
    const r = await run([
      ...WANT,
      '--',
      process.execPath,
      '-e',
      'console.log(\'{"msg":"execution: pass finished","executionId":"e-2"}\')',
    ]);
    expect(r.code).toBe(0);
  });
  it('a follower that cannot start fails at once, saying so', async () => {
    const r = await run([...WANT, '--', '/nonexistent/follower'], { BACKSTOP_MS: '60000' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('could not start the log follower');
  });
  it('fails when no such line comes within the backstop', async () => {
    const r = await run([...WANT, '--', ...follower(['{"msg":"listening"}'])], { BACKSTOP_MS: '300' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('no "execution: pass finished" line (executionId=e-2) within 300 ms');
  });
  it.each([
    [['--', process.execPath]],
    [['--msg', 'x']],
    [['--msg', 'x', '--field', 'novalue', '--', process.execPath]],
  ])('refuses a malformed command line with 64: %j', async (args) => {
    const r = await run(args);
    expect(r.code).toBe(64);
    expect(r.err).toContain('usage:');
  });
});
