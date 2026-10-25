import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// why: Ian's rule (PR #11): install-e2e waits on the app's "listening" log line, an event, never a poll; this helper
// follows the log from where it stands, runs the trigger, and ends on the next such line (a timeout only as backstop).
const SCRIPT = join(import.meta.dirname, '..', 'ci', 'after-app-listening.mjs');
const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const run = async (log, trigger, env = {}) => {
  const c = spawn(process.execPath, [SCRIPT, '--', ...trigger], {
    env: { ...process.env, RUNNER_OS: 'macOS', APP_LOG: log, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  c.stderr.on('data', (b) => {
    err += b;
  });
  const [code] = await once(c, 'exit');
  return { code, err };
};

describe.skipIf(process.platform === 'win32')('ci/after-app-listening.mjs', { timeout: 30_000 }, () => {
  it('ends when the trigger makes the app log "listening" after the point it started from', async () => {
    const d = mkdtempSync(join(tmpdir(), 'gmt-listen-'));
    dirs.push(d);
    const log = join(d, 'app.log');
    // an earlier "listening" line is not the event
    writeFileSync(log, '{"level":30,"msg":"listening"}\n');
    const append = `require('fs').appendFileSync(${JSON.stringify(log)}, '{"level":30,"msg":"booting"}\\n{"level":30,"msg":"listening"}\\n')`;
    expect((await run(log, [process.execPath, '-e', append])).code).toBe(0);
  });
  it('fails when the trigger fails, and when no new line comes within the backstop', async () => {
    const d = mkdtempSync(join(tmpdir(), 'gmt-listen-'));
    dirs.push(d);
    const log = join(d, 'app.log');
    writeFileSync(log, '{"msg":"listening"}\n');
    const failed = await run(log, [process.execPath, '-e', 'process.exit(3)']);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain('exited with 3');
    const quiet = await run(log, [process.execPath, '-e', '0'], { BACKSTOP_MS: '300' });
    expect(quiet.code).toBe(1);
    expect(quiet.err).toContain('no "listening" line');
  });
});
