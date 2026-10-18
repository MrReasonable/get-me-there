// Fake timers over core's fixedClock (brief §10, TS2-16): `sleep` advances the clock and resolves on the next
// macrotask, so pending microtasks (a fake page answering) always win a race against it; a deadline fires when the
// clock passes its end, or when a test calls `runOut()` while something never resolves. No test waits in real time.
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { type Deadline, DeadlineExceeded, type Timers } from '../../src/timers.js';

interface Pending {
  end: number;
  fire: () => void;
  done: boolean;
}

export type FakeTimers = Timers & {
  clock: ReturnType<typeof fixedClock>;
  /** Advances to the earliest pending deadline and fires it (for a call that never resolves). */
  runOut(): void;
  /** Every sleep requested, in order, in ms. */
  sleeps: number[];
};

export const T0 = '2026-10-18T05:00:00.000Z';

/** Lets every queued microtask and one macrotask run. */
export function flush(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

export function fakeTimers(clock = fixedClock(asIsoDateTime(T0))): FakeTimers {
  const pending: Pending[] = [];
  const now = (): number => Date.parse(clock.now());
  const fireDue = (): void => {
    for (const p of pending) if (!p.done && now() >= p.end) p.fire();
  };
  const timers: FakeTimers = {
    clock,
    sleeps: [],
    now,
    sleep(ms: number, signal?: AbortSignal): Promise<void> {
      timers.sleeps.push(ms);
      // why: the clock moves only when the sleep completes, so a sleep that loses a race (a bounded step that
      // answered in time) leaves fake time where it was.
      return new Promise((resolve, reject) =>
        setImmediate(() => {
          if (signal?.aborted) {
            reject(new DeadlineExceeded('aborted'));
            return;
          }
          clock.advance(ms);
          fireDue();
          resolve();
        }),
      );
    },
    deadline(ms: number): Deadline {
      const ctl = new AbortController();
      const listeners: Array<() => void> = [];
      const entry: Pending = {
        end: now() + ms,
        done: false,
        fire: () => {
          entry.done = true;
          ctl.abort(new DeadlineExceeded('page deadline'));
          for (const l of listeners) l();
        },
      };
      pending.push(entry);
      return {
        signal: ctl.signal,
        remaining: () => Math.max(0, entry.end - now()),
        expired: () => ctl.signal.aborted,
        onExpire: (fn) => {
          if (ctl.signal.aborted) fn();
          else listeners.push(fn);
        },
        race: <T>(p: Promise<T>): Promise<T> => raceSignal(p, ctl.signal),
        clear: () => {
          entry.done = true;
        },
      };
    },
    runOut(): void {
      const next = pending.filter((p) => !p.done).sort((a, b) => a.end - b.end)[0];
      if (next === undefined) return;
      clock.set(asIsoDateTime(new Date(next.end).toISOString()));
      next.fire();
    },
  };
  return timers;
}

/** The same race the real deadline uses: the losing promise gets a no-op catch, so nothing goes unhandled. */
function raceSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  p.catch(() => undefined);
  if (signal.aborted) return Promise.reject(new DeadlineExceeded('page deadline'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DeadlineExceeded('page deadline'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
