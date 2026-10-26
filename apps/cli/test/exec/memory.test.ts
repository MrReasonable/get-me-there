import { describe, expect, it } from 'vitest';
import { MemoryFs, memoryExecutor, memoryRunner } from '../../src/exec/memory.js';
import { runAction } from '../../src/plan/action.js';

describe('MemoryFs, memoryRunner and memoryExecutor', () => {
  it('applies every file action', async () => {
    const fs = new MemoryFs().file('/h/a/x', 'x', 0o644).file('/h/a/y/z', 'z');
    const ex = memoryExecutor(fs);
    await ex.run({ kind: 'mkdir', path: '/h/n/m', mode: 0o700 });
    expect(fs.mode('/h/n/m')).toBe(0o700);
    expect(fs.isDir('/h/n')).toBe(true);
    await ex.run({ kind: 'copy', from: '/h/a/x', to: '/h/n/x', mode: 0o600 });
    expect([fs.read('/h/n/x'), fs.mode('/h/n/x')]).toEqual(['x', 0o600]);
    await ex.run({ kind: 'rename', from: '/h/a', to: '/h/b' });
    expect(fs.read('/h/b/y/z')).toBe('z');
    expect(fs.read('/h/a/x')).toBeNull();
    await ex.run({ kind: 'remove', path: '/h/b/x', recursive: false });
    expect(fs.read('/h/b/x')).toBeNull();
    await ex.run({ kind: 'remove', path: '/h/b', recursive: true });
    expect(fs.paths().filter((p) => p.startsWith('/h/b'))).toEqual([]);
    await ex.run({ kind: 'download', url: 'https://example.invalid/a', to: '/h/d', sha256: 'a', bytes: 1 });
    expect(fs.read('/h/d')).toContain('downloaded');
    await ex.run({ kind: 'unpack', archive: '/h/d', sha256: 'a', to: '/h/u' });
    expect(fs.isDir('/h/u')).toBe(true);
    await expect(ex.run({ kind: 'rename', from: '/none', to: '/x' })).rejects.toThrow('does not exist');
    await expect(ex.run({ kind: 'copy', from: '/none', to: '/x', mode: 0o600 })).rejects.toThrow(
      'is not a file',
    );
    fs.chown('/h/d', 0);
    expect(fs.owner('/h/d')).toBe(0);
    fs.symlink('/l', '/h/d');
    expect(fs.owner('/l')).toBe(0);
    expect(fs.mode('/dangling')).toBeNull();
  });

  it('sends run actions to the runner with their stdin, and a non-zero exit throws naming the describe only', async () => {
    const fs = new MemoryFs();
    const runner = memoryRunner(fs, (argv) =>
      argv[0] === 'false' ? { code: 2, stderr: 'boom' } : undefined,
    );
    const ex = memoryExecutor(fs, { runner });
    await ex.run(runAction(['sh', '-c', 'cat'], '/r', { stdin: { text: 'marker', secret: false } }));
    expect(runner.calls[0]).toEqual({
      argv: ['sh', '-c', 'cat'],
      cwd: '/r',
      timeoutMs: 1000,
      stdin: 'marker',
      env: undefined,
    });
    await expect(ex.run(runAction(['false'], '/r', { describe: 'the false step' }))).rejects.toThrow(
      'the false step exited with 2',
    );
  });

  it('memoryRunner answers cat from the tree', async () => {
    const fs = new MemoryFs().file('/p', 'text');
    const run = memoryRunner(fs);
    expect(await run(['cat', '/p'], { cwd: '/', timeoutMs: 1 })).toEqual({
      code: 0,
      stdout: 'text',
      stderr: '',
    });
    expect((await run(['cat', '/q'], { cwd: '/', timeoutMs: 1 })).code).toBe(1);
    expect(await run(['true'], { cwd: '/', timeoutMs: 1 })).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('waitHealthy fails when the healthy stand-in says no', async () => {
    const ex = memoryExecutor(new MemoryFs(), { healthy: () => false });
    await expect(
      ex.run({ kind: 'waitHealthy', url: 'http://127.0.0.1:1/api/health', timeoutSeconds: 5 }),
    ).rejects.toThrow('did not answer healthy within 5 s');
    await memoryExecutor(new MemoryFs()).run({ kind: 'waitHealthy', url: 'u', timeoutSeconds: 1 });
  });

  it('waitState and waitUnlocked check once a simulated second: a bound of n seconds is n + 1 checks', async () => {
    const fs = new MemoryFs().file('/d/worker.lock', '77');
    let probes = 0;
    const runner = memoryRunner(fs, () => ({
      code: 0,
      stdout: ++probes < 3 ? 'deactivating\n' : 'inactive\n',
    }));
    const state = {
      kind: 'waitState' as const,
      argv: ['x'],
      describe: 'x',
      until: ['inactive'],
      timeoutSeconds: 4,
    };
    await memoryExecutor(fs, { runner }).run(state);
    expect(probes).toBe(3);
    probes = -100;
    await expect(memoryExecutor(fs, { runner }).run(state)).rejects.toThrow(
      'x still prints something else after 4 s',
    );
    expect(probes).toBe(-95);
    // a non-zero exit never counts, whatever it prints
    const failing = memoryRunner(fs, () => ({ code: 1, stdout: 'inactive' }));
    await expect(memoryExecutor(fs, { runner: failing }).run(state)).rejects.toThrow('after 4 s');
    const lock = {
      kind: 'waitUnlocked' as const,
      path: '/d/worker.lock',
      holder: 'the worker',
      timeoutSeconds: 4,
    };
    // no live pid by default: free at once
    await memoryExecutor(fs).run(lock);
    let asked = 0;
    await memoryExecutor(fs, { alive: () => ++asked < 3 }).run(lock);
    expect(asked).toBe(3);
    asked = 0;
    await expect(memoryExecutor(fs, { alive: () => ++asked > 0 }).run(lock)).rejects.toThrow(
      'the worker (pid 77) is still running and holds /d/worker.lock after 4 s',
    );
    expect(asked).toBe(5);
    expect(fs.paths()).toContain('/d/worker.lock');
  });

  it('waitWorkerAnswers asks once a simulated second (n + 1 times for n seconds) and fails naming the port and log', async () => {
    const fs = new MemoryFs();
    const wait = {
      kind: 'waitWorkerAnswers' as const,
      port: 8191,
      log: '/l/camoufox-worker.log',
      refusalFile: '/d/start-refusal.json',
      timeoutSeconds: 4,
    };
    // answers at once by default
    await memoryExecutor(fs).run(wait);
    const ports: number[] = [];
    await memoryExecutor(fs, { answers: (p) => ports.push(p) >= 3 }).run(wait);
    expect(ports).toEqual([8191, 8191, 8191]);
    let asked = 0;
    await expect(memoryExecutor(fs, { answers: () => ++asked < 0 }).run(wait)).rejects.toThrow(
      'the worker did not answer on 127.0.0.1:8191 within 4 s; its log: /l/camoufox-worker.log',
    );
    expect(asked).toBe(5);
    // a refusal file the worker left is named with its words; one this build cannot read is named as such
    fs.file('/d/start-refusal.json', '{"reason":"signed-in","at":"2026-10-24T09:30:00.000Z"}', 0o600);
    await expect(memoryExecutor(fs, { answers: () => false }).run(wait)).rejects.toThrow(
      '; its start refusal file /d/start-refusal.json (written 2026-10-24T09:30:00.000Z) says: refused, not retrying: the browser profile is signed in',
    );
    fs.unreadable('/d/start-refusal.json');
    await expect(memoryExecutor(fs, { answers: () => false }).run(wait)).rejects.toThrow(
      'its log: /l/camoufox-worker.log; its start refusal file /d/start-refusal.json is there but cannot be read',
    );
  });
});
