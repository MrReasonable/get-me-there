import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRunner, systemRunner } from '../../src/exec/runner.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
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
        'process.stdin.pipe(process.stdout); process.stderr.write(process.cwd()); process.exitCode = 3',
      ],
      { cwd: d, stdin: 'in put', timeoutMs: 10_000 },
    );
    expect(r.code).toBe(3);
    expect(r.stdout).toBe('in put');
    expect(r.stderr.endsWith(d.split('/').pop() ?? '')).toBe(true);
  });

  it('passes the argv as words, never through a shell', async () => {
    const r = await systemRunner(
      [node, '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '$HOME', 'a b'],
      {
        cwd: tmp(),
        timeoutMs: 10_000,
      },
    );
    expect(r).toEqual({ code: 0, stdout: '["$HOME","a b"]\n', stderr: '' });
  });

  // why: macOS adds __CF_USER_TEXT_ENCODING to every process it starts; nothing the caller passed
  it('gives the child exactly env when env is given', async () => {
    const r = await systemRunner(
      [
        node,
        '-e',
        'console.log(Object.keys(process.env).filter((k) => !k.startsWith("__CF_")).sort().join(","))',
      ],
      {
        cwd: tmp(),
        timeoutMs: 10_000,
        env: { PATH: '/usr/bin:/bin', HOME: '/h' },
      },
    );
    expect(r.stdout.trim()).toBe('HOME,PATH');
  });

  it('a command that cannot start is 127; an empty argv is 127; a timeout is 124', async () => {
    expect((await systemRunner(['/no/such/command'], { cwd: tmp(), timeoutMs: 5000 })).code).toBe(127);
    expect((await systemRunner([], { cwd: tmp(), timeoutMs: 5000 })).code).toBe(127);
    const t = await systemRunner([node, '-e', 'setTimeout(() => {}, 10000)'], { cwd: tmp(), timeoutMs: 300 });
    expect(t.code).toBe(124);
    expect(t.stderr).toContain('timed out after 300 ms');
  });

  it('output past the buffer is its own failure, not a timeout (ca-b1-019)', async () => {
    const r = await makeRunner({ maxBufferBytes: 1024 })(
      [node, '-e', 'process.stdout.write("x".repeat(4096))'],
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
      const r = await systemRunner([node, '-e', 'process.kill(process.pid, "SIGKILL")'], {
        cwd: tmp(),
        timeoutMs: 10_000,
      });
      expect(r.code).toBe(137);
      expect(r.stderr).toContain('was stopped by SIGKILL');
      expect(r.stderr).not.toContain('cannot be started');
    },
  );
});
