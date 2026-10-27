import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDir } from './test-tempdirs.mjs';

// why: Ian's rule (PR #11): install-e2e waits on the app's "listening" log line, an event, never a poll; this helper
// follows the log from where it stands, runs the trigger, and ends on the next such line (a timeout only as backstop).
const SCRIPT = join(import.meta.dirname, 'after-app-listening.mjs');
const started = [];
afterEach(() => {
  // why: a test that fails or times out must not leave its script (or the script's follower) running
  for (const c of started.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
});
const run = async (log, trigger, env = {}) => {
  const c = spawn(process.execPath, [SCRIPT, '--', ...trigger], {
    env: { ...process.env, RUNNER_OS: 'macOS', APP_LOG: log, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  started.push(c);
  let err = '';
  c.stderr.on('data', (b) => {
    err += b;
  });
  const [code] = await once(c, 'exit');
  return { code, err };
};

describe.skipIf(process.platform === 'win32')('scripts/after-app-listening.mjs', { timeout: 30_000 }, () => {
  it('ends when the trigger makes the app log "listening" after the point it started from', async () => {
    const d = tempDir('gmt-listen-');
    const log = join(d, 'app.log');
    // an earlier "listening" line is not the event
    writeFileSync(log, '{"level":30,"msg":"listening"}\n');
    const append = `require('fs').appendFileSync(${JSON.stringify(log)}, '{"level":30,"msg":"booting"}\\n{"level":30,"msg":"listening"}\\n')`;
    expect((await run(log, [process.execPath, '-e', append])).code).toBe(0);
  });
  it('fails when the trigger fails, and when no new line comes within the backstop', async () => {
    const d = tempDir('gmt-listen-');
    const log = join(d, 'app.log');
    writeFileSync(log, '{"msg":"listening"}\n');
    const failed = await run(log, [process.execPath, '-e', 'process.exit(3)']);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain('exited with 3');
    const quiet = await run(log, [process.execPath, '-e', '0'], { BACKSTOP_MS: '300' });
    expect(quiet.code).toBe(1);
    expect(quiet.err).toContain('no "listening" line');
  });
  // stand-in followers on PATH (with /bin for sh): the script finds tail or journalctl there
  const fakeBin = (name, body) => {
    const d = tempDir('gmt-bin-');
    writeFileSync(join(d, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(d, name), 0o755);
    return `${d}:/bin:/usr/bin`;
  };
  it('a follower that cannot start fails at once, saying so (no backstop wait)', async () => {
    const d = tempDir('gmt-listen-');
    const r = await run(join(d, 'app.log'), [process.execPath, '-e', '0'], { PATH: d, BACKSTOP_MS: '60000' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('could not follow the app log');
  });
  it('a follower that ends early fails at once with its exit, not the backstop’s message', async () => {
    const d = tempDir('gmt-listen-');
    const r = await run(join(d, 'app.log'), [process.execPath, '-e', '0'], {
      PATH: fakeBin('tail', 'exit 2'),
      BACKSTOP_MS: '60000',
    });
    expect(r.code).toBe(1);
    expect(r.err).toContain('the app log follower ended early (2)');
    expect(r.err).not.toContain('no "listening" line');
  });
  it('on Linux the journal is read from now, in UTC to the millisecond, so an earlier line in the same second is not replayed', async () => {
    const d = tempDir('gmt-listen-');
    const args = join(d, 'args');
    const r = await run(join(d, 'unused'), [process.execPath, '-e', '0'], {
      RUNNER_OS: 'Linux',
      PATH: fakeBin(
        'journalctl',
        `printf '%s\\n' "$@" > ${JSON.stringify(args)}; echo '{"msg":"listening"}'; exec tail -f /dev/null`,
      ),
    });
    expect(r.code).toBe(0);
    const a = readFileSync(args, 'utf8').trim().split('\n');
    const since = a[a.indexOf('--since') + 1];
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC$/);
    expect(a.slice(0, 6)).toEqual(['--user', '-u', 'get-me-there-app.service', '-f', '-o', 'cat']);
  });
});
