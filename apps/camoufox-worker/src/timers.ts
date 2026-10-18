/**
 * Every wait the worker makes goes through this module (brief WP14 §10, TS2-16): `sleep` for the readiness polls and
 * the bounded `finally` steps, `deadline` for the one page deadline. Tests replace it with test/support/timers.ts, a fake
 * over core's fixedClock, so no test waits in real time. Nothing here is randomised (spec §2: spacing is never jittered).
 */

/** The page deadline passed (or the wait was aborted). */
export class DeadlineExceeded extends Error {
  constructor(message = 'page deadline') {
    super(message);
    this.name = 'DeadlineExceeded';
  }
}

/** One page deadline (spec §2 CAMOUFOX_PAGE_TIMEOUT_SECONDS): its expiry aborts `signal` and runs every `onExpire`. */
export interface Deadline {
  readonly signal: AbortSignal;
  /** Milliseconds left, never negative: the `timeout` every Playwright call takes (PIE-R2-06). */
  remaining(): number;
  expired(): boolean;
  /** Runs `fn` at expiry (at once if already expired); the session closes the page here, rejecting pending calls. */
  onExpire(fn: () => void): void;
  /** `p`, or DeadlineExceeded at expiry; a no-op catch is attached to `p` so the loser is never unhandled. */
  race<T>(p: Promise<T>): Promise<T>;
  clear(): void;
}

export interface Timers {
  /** Epoch milliseconds (durations and step timings). */
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  deadline(ms: number): Deadline;
}

/** Races `p` against `signal`; the losing promise is caught so it can never surface as an unhandled rejection. */
export function raceSignal<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  p.catch(() => undefined);
  if (signal.aborted) return Promise.reject(new DeadlineExceeded());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DeadlineExceeded());
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

/** The real timers: setTimeout, cleared as soon as they are not needed so nothing holds the process open. */
export const realTimers: Timers = {
  now: () => Date.now(),
  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new DeadlineExceeded('aborted'));
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(t);
        reject(new DeadlineExceeded('aborted'));
      };
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
  deadline(ms: number): Deadline {
    const ctl = new AbortController();
    const end = Date.now() + ms;
    const listeners: Array<() => void> = [];
    const t = setTimeout(() => {
      ctl.abort(new DeadlineExceeded());
      for (const l of listeners) l();
    }, ms);
    return {
      signal: ctl.signal,
      remaining: () => Math.max(0, end - Date.now()),
      expired: () => ctl.signal.aborted,
      onExpire: (fn) => {
        if (ctl.signal.aborted) fn();
        else listeners.push(fn);
      },
      race: (p) => raceSignal(p, ctl.signal),
      clear: () => clearTimeout(t),
    };
  },
};

/**
 * Brief §7 "Deadlines": a `finally` step (the SOCS read-back, the page close) under its own bound. A step that
 * overruns, or throws, reports `overran: true`; the caller then discards the browser context.
 */
export async function bounded<T>(
  step: () => Promise<T>,
  ms: number,
  timers: Timers,
): Promise<{ overran: false; value: T } | { overran: true }> {
  const ctl = new AbortController();
  let p: Promise<T>;
  try {
    p = step();
  } catch {
    return { overran: true };
  }
  p.catch(() => undefined);
  const timeout = timers.sleep(ms, ctl.signal).then(
    () => ({ overran: true }) as const,
    () => ({ overran: true }) as const,
  );
  const result = await Promise.race([
    p.then(
      (value) => ({ overran: false, value }) as const,
      () => ({ overran: true }) as const,
    ),
    timeout,
  ]);
  ctl.abort();
  return result;
}
