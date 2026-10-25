import { describe, expect, it } from 'vitest';
import { MemoryFs, memoryExecutor } from '../../src/exec/memory.js';
import type { Action, Plan } from '../../src/plan/action.js';
import { apply } from '../../src/plan/apply.js';
import { describeResult } from '../../src/plan/describe.js';

/** A toy planner over a MemoryFs: each wanted path not yet present is one action, in order (decision 72's re-run rule). */
function planFor(fs: MemoryFs): Plan {
  const wanted: Action[] = [
    { kind: 'mkdir', path: '/h/a', mode: 0o700 },
    { kind: 'writeFile', path: '/h/a/one', contents: '1\n', mode: 0o644, secret: false },
    { kind: 'writeFile', path: '/h/a/two', contents: '2\n', mode: 0o600, secret: true },
    { kind: 'mkdir', path: '/h/b', mode: 0o755 },
    { kind: 'writeFile', path: '/h/b/three', contents: '3\n', mode: 0o644, secret: false },
  ];
  const missing = wanted.filter((a) =>
    a.kind !== 'mkdir' && a.kind !== 'writeFile' ? true : fs.mode(a.path) === null,
  );
  return { command: 'toy', actions: missing, notes: [] };
}

describe('apply (decision 72: plan and apply, no journal)', () => {
  it('runs every action in order on the memory executor', async () => {
    const fs = new MemoryFs();
    const ex = memoryExecutor(fs);
    const plan = planFor(fs);
    const r = await apply(plan, ex);
    expect(r.failed).toBeNull();
    expect(r.done).toEqual(plan.actions);
    expect(r.notRun).toEqual([]);
    expect(ex.log).toEqual(plan.actions);
    expect(fs.read('/h/a/two')).toBe('2\n');
    expect(fs.mode('/h/a/two')).toBe(0o600);
    expect(fs.mode('/h/a')).toBe(0o700);
  });

  it('stops at the third action when it throws: done holds 1–2, failed 3, notRun the rest', async () => {
    const fs = new MemoryFs();
    const ex = memoryExecutor(fs, { fail: (_a, i) => i === 2 });
    const plan = planFor(fs);
    const r = await apply(plan, ex);
    expect(r.done).toEqual(plan.actions.slice(0, 2));
    expect(r.failed?.action).toEqual(plan.actions[2]);
    expect(r.failed?.error).toContain('injected failure');
    expect(r.notRun).toEqual(plan.actions.slice(3));
    expect(ex.log).toHaveLength(3);
    // the failed action and everything after it took no effect
    expect(fs.read('/h/a/two')).toBeNull();
    expect(fs.isDir('/h/b')).toBe(false);
  });

  it('a re-run of the planner after actions 1–2 took effect plans only 3 onwards', async () => {
    const fs = new MemoryFs();
    const first = planFor(fs);
    await apply(first, memoryExecutor(fs, { fail: (_a, i) => i === 2 }));
    const again = planFor(fs);
    expect(again.actions).toEqual(first.actions.slice(2));
    const r = await apply(again, memoryExecutor(fs));
    expect(r.failed).toBeNull();
    expect(planFor(fs).actions).toEqual([]);
  });

  it('the report names what was done, what failed and what did not run', async () => {
    const fs = new MemoryFs();
    const r = await apply(planFor(fs), memoryExecutor(fs, { fail: (_a, i) => i === 2 }));
    const text = describeResult('toy', r);
    expect(text).toContain('stopped at a failed step; nothing was undone');
    expect(text).toMatch(/done: {4}make directory \/h\/a/);
    expect(text).toMatch(/failed: {2}write \/h\/a\/two \(0600, 1 lines, values hidden\): injected failure/);
    expect(text).toMatch(/not run: make directory \/h\/b/);
    expect(describeResult('toy', { done: [], outputs: [], failed: null, notRun: [] })).toBe(
      'toy: done (0 steps)\n',
    );
  });

  it('a thrown non-Error is reported as text', async () => {
    const r = await apply(
      { command: 'x', actions: [{ kind: 'remove', path: '/x', recursive: false }], notes: [] },
      {
        run: async () => {
          throw 'plain';
        },
      },
    );
    expect(r.failed?.error).toBe('plain');
  });
});
