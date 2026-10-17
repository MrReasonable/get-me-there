import { describe, expect, it } from 'vitest';
import { runPool } from '../src/pool.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 5));

describe('runPool (spec §8.1 bounded pool = provider CONCURRENCY)', () => {
  it('never runs more than `concurrency` workers at once and visits every item', async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7], 3, new AbortController().signal, async (x) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick();
      seen.push(x);
      inFlight -= 1;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('stops taking items once intake aborts and lets the workers already running finish (decision 25)', async () => {
    const c = new AbortController();
    const started: number[] = [];
    const finished: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, c.signal, async (x) => {
      started.push(x);
      if (x === 2) c.abort();
      await tick();
      finished.push(x);
    });
    expect(started).toEqual([1, 2]);
    expect(finished.sort()).toEqual([1, 2]);
  });
  it('rethrows the first error that escapes a worker after draining', async () => {
    await expect(
      runPool([1, 2, 3], 1, new AbortController().signal, async (x) => {
        if (x === 2) throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
  it('rejects a concurrency below 1 and resolves at once for no items', async () => {
    await expect(runPool([1], 0, new AbortController().signal, async () => undefined)).rejects.toThrow(
      RangeError,
    );
    await expect(
      runPool([], 2, new AbortController().signal, async () => undefined),
    ).resolves.toBeUndefined();
  });
});
