import type { RestartClock } from '../../../src/views/Settings/restartClock.js';

/**
 * A restart clock the test steps by hand (Task 5 fix round 1, important 3): nothing runs until `advance`, which runs
 * every timer due within the step in order. `scheduled(n)` resolves once `n` timers in all have been set, so a test
 * waits on the watch setting its next poll (an event), never on time.
 */
export function manualClock() {
  let now = 0;
  let seq = 0;
  let sets = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const waiters: Array<{ n: number; resolve: () => void }> = [];
  const clock: RestartClock = {
    after(ms, run) {
      seq += 1;
      const id = seq;
      timers.set(id, { at: now + ms, run });
      sets += 1;
      for (const w of waiters.filter((x) => sets >= x.n)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
      return () => {
        timers.delete(id);
      };
    },
  };
  return {
    clock,
    scheduled: (n: number): Promise<void> =>
      sets >= n ? Promise.resolve() : new Promise<void>((resolve) => waiters.push({ n, resolve })),
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        let next: [number, { at: number; run: () => void }] | null = null;
        for (const entry of timers)
          if (entry[1].at <= end && (next === null || entry[1].at < next[1].at)) next = entry;
        if (next === null) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].run();
      }
      now = end;
    },
    /** The timers set and not yet run or cancelled. */
    pending: (): number => timers.size,
    /** Every timer ever set. */
    sets: (): number => sets,
  };
}
