import { describe, expect, it } from 'vitest';
import { MemoryFs, memoryExecutor, memoryRunner } from '../../src/exec/memory.js';
import { runAction } from '../../src/plan/action.js';
import { apply } from '../../src/plan/apply.js';
import { describeAction } from '../../src/plan/describe.js';

// why: U4 (ca-b1-004): a step whose output feeds a later step (the backup printing its file) is an Action, so every
// executor records it and --dry-run describes the real plan; Executor.run returns the child's stdout.
describe('outputs through the plan', () => {
  it('apply returns each done action’s stdout, in order', async () => {
    const fs = new MemoryFs();
    const runner = memoryRunner(fs, (argv) =>
      argv[0] === 'backup' ? { code: 0, stdout: '{"ok":true}\n' } : undefined,
    );
    const r = await apply(
      {
        command: 'c',
        actions: [{ kind: 'mkdir', path: '/d', mode: 0o700 }, runAction(['backup'], '/')],
        notes: [],
      },
      memoryExecutor(fs, { runner }),
    );
    expect(r.outputs).toEqual(['', '{"ok":true}\n']);
  });
  it('a run’s stdin is one field with its secrecy; env, when given, is the child’s whole environment', async () => {
    const plain = runAction(['x'], '/', { stdin: { text: 'marker', secret: false } });
    const secret = runAction(['x'], '/', {
      stdin: { text: 'k', secret: true },
      env: { PATH: '/bin', HOME: '/h' },
    });
    expect(plain.stdin).toEqual({ text: 'marker', secret: false });
    expect(describeAction(plain)).toBe('run x (input on stdin)');
    expect(describeAction(secret)).toBe('run x (secret input on stdin)');
    expect(Object.keys(runAction(['x'], '/'))).toEqual(['kind', 'argv', 'cwd', 'describe']);
    const fs = new MemoryFs();
    const runner = memoryRunner(fs);
    await memoryExecutor(fs, { runner }).run(secret);
    expect(runner.calls[0]).toMatchObject({ stdin: 'k', env: { PATH: '/bin', HOME: '/h' } });
  });
});
