import type { Deadline, Timers } from './timers.js';

/**
 * A page's deadlines (operator ruling of 2026-10-18): `d` starts as the first view's CAMOUFOX_PAGE_TIMEOUT_SECONDS;
 * `next()` retires it and starts the Cheapest flow's own, the same again from now, capped so the page never runs past
 * twice that from `started`. Each `onExpire` handler (the page close) is carried to the next deadline.
 */
export interface PageBudget {
  d: Deadline;
  next(): Deadline;
  /**
   * WP15 ruling 10: retires the current deadline and starts one of `ms` (a grid move's own budget), never past the
   * page's overall cap from `started`.
   */
  nextFor(ms: number): Deadline;
  onExpire(fn: () => void): void;
}

/** `capMs`: the page's overall cap from `started` (twice the page timeout unless a grid page sets its own). */
export function pageBudget(
  timers: Timers,
  pageTimeoutMs: number,
  started: number,
  capMs: number = 2 * pageTimeoutMs,
): PageBudget {
  const handlers: Array<() => void> = [];
  const replace = (ms: number): Deadline => {
    const n = timers.deadline(Math.max(1, ms));
    for (const h of handlers) n.onExpire(h);
    self.d.clear();
    self.d = n;
    return n;
  };
  const self: PageBudget = {
    d: timers.deadline(pageTimeoutMs),
    next: () => replace(Math.min(pageTimeoutMs, 2 * pageTimeoutMs - (timers.now() - started))),
    nextFor: (ms) => replace(Math.min(ms, capMs - (timers.now() - started))),
    onExpire: (fn) => {
      handlers.push(fn);
      self.d.onExpire(fn);
    },
  };
  return self;
}
