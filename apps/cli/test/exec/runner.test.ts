import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRunner, systemRunner } from '../../src/exec/runner.js';
import { guarded, killTracked, running } from '../support/children.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  expect(killTracked()).toEqual([]);
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'gmt-runner-'));
  dirs.push(d);
  return d;
};
const node = process.execPath;

describe('systemRunner (the one execFile wrapper)', { timeout: 30_000 }, () => {
  it('runs the argv in cwd with stdin, and returns code, stdout and stderr', async () => {
    const d = tmp();
    const r = await systemRunner(
      [
        node,
        '-e',
        guarded(
          'process.stdin.pipe(process.stdout); process.stderr.write(process.cwd()); process.exitCode = 3',
        ),
      ],
      { cwd: d, stdin: 'in put', timeoutMs: 10_000 },
    );
    expect(r.code).toBe(3);
    expect(r.stdout).toBe('in put');
    expect(r.stderr.endsWith(d.split('/').pop() ?? '')).toBe(true);
  });

  it('passes the argv as words, never through a shell', async () => {
    const r = await systemRunner(
      [node, '-e', guarded('console.log(JSON.stringify(process.argv.slice(1)))'), '$HOME', 'a b'],
      {
        cwd: tmp(),
        timeoutMs: 10_000,
      },
    );
    expect(r).toEqual({ code: 0, stdout: '["$HOME","a b"]\n', stderr: '' });
  });

  // why: macOS adds __CF_USER_TEXT_ENCODING to every process it starts, and on Windows libuv adds the system variables a
  // process needs (its fixed list below); nothing else, and nothing from this process, reaches the child
  const WINDOWS_ADDED = new Set([
    'HOMEDRIVE',
    'HOMEPATH',
    'LOGONSERVER',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'USERDOMAIN',
    'USERNAME',
    'USERPROFILE',
    'WINDIR',
  ]);
  it('gives the child exactly env when env is given, on every platform (CodeRabbit, PR #11)', async () => {
    process.env.GMT_RUNNER_PARENT_ONLY = 'from-the-parent';
    try {
      const r = await systemRunner(
        [node, '-e', guarded('console.log(JSON.stringify(Object.keys(process.env)))')],
        {
          cwd: tmp(),
          timeoutMs: 10_000,
          env: { PATH: process.platform === 'win32' ? 'C:\\Windows' : '/usr/bin:/bin', HOME: '/h' },
        },
      );
      const keys: unknown = JSON.parse(r.stdout);
      expect(Array.isArray(keys)).toBe(true);
      const own = (Array.isArray(keys) ? keys.map(String) : [])
        .filter((k) => !k.startsWith('__CF_'))
        .filter((k) => process.platform !== 'win32' || !WINDOWS_ADDED.has(k.toUpperCase()))
        .map((k) => (process.platform === 'win32' ? k.toUpperCase() : k))
        .sort();
      expect(own).toEqual(['HOME', 'PATH']);
    } finally {
      delete process.env.GMT_RUNNER_PARENT_ONLY;
    }
  });

  it('a command that cannot start is 127; an empty argv is 127; a timeout is 124', async () => {
    expect((await systemRunner(['/no/such/command'], { cwd: tmp(), timeoutMs: 5000 })).code).toBe(127);
    expect((await systemRunner([], { cwd: tmp(), timeoutMs: 5000 })).code).toBe(127);
    const t = await systemRunner([node, '-e', guarded('setTimeout(() => {}, 10000)')], {
      cwd: tmp(),
      timeoutMs: 300,
    });
    expect(t.code).toBe(124);
    expect(t.stderr).toContain('timed out after 300 ms');
  });

  it('output past the buffer is its own failure, not a timeout (ca-b1-019)', async () => {
    const r = await makeRunner({ maxBufferBytes: 1024 })(
      [node, '-e', guarded('process.stdout.write("x".repeat(4096))')],
      {
        cwd: tmp(),
        timeoutMs: 10_000,
      },
    );
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('printed more than 1024 bytes; stopped');
    expect(r.stderr).not.toContain('timed out');
  });

  it.skipIf(process.platform === 'win32')(
    'a child stopped by a signal is 128 + its number, naming the signal, never "cannot be started" (ca-b1-019)',
    async () => {
      const r = await systemRunner([node, '-e', guarded('process.kill(process.pid, "SIGKILL")')], {
        cwd: tmp(),
        timeoutMs: 10_000,
      });
      expect(r.code).toBe(137);
      expect(r.stderr).toContain('was stopped by SIGKILL');
      expect(r.stderr).not.toContain('cannot be started');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'a timeout kills the child, even one that ignores SIGTERM: its pid is gone afterwards (PR #11 orphans)',
    async () => {
      const d = tmp();
      const pidFile = join(d, 'pid');
      const t = await systemRunner(
        [
          node,
          '-e',
          guarded(
            `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`,
          ),
        ],
        { cwd: d, timeoutMs: 1000 },
      );
      expect(t.code).toBe(124);
      const pid = Number(readFileSync(pidFile, 'utf8'));
      await new Promise((r) => setTimeout(r, 200));
      expect(running(pid)).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'a guarded child whose parent is killed exits by itself (the teardown cannot run in a killed worker)',
    async () => {
      const d = tmp();
      const pidFile = join(d, 'pid');
      const child = guarded(
        `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); process.stdin.resume(); setInterval(() => {}, 1000)`,
      );
      // the parent starts the child with its stdin open, waits for its pid, then dies at once
      const parent = `const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: ['pipe', 'ignore', 'ignore'] }); const t = setInterval(() => { if (require('fs').existsSync(${JSON.stringify(pidFile)})) process.kill(process.pid, 'SIGKILL'); }, 20);`;
      await systemRunner([node, '-e', parent], { cwd: d, timeoutMs: 10_000 });
      const pid = Number(readFileSync(pidFile, 'utf8'));
      for (let i = 0; i < 50 && running(pid); i++) await new Promise((r) => setTimeout(r, 100));
      expect(running(pid)).toBe(false);
    },
  );
});
