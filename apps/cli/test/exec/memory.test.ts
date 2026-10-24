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
    await ex.run(runAction(['sh', '-c', 'cat'], '/r', { stdin: 'marker' }));
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
});
