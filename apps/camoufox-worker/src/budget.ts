import type { Deadline, Timers } from './timers.js';

/**
 * A page's deadlines (operator ruling of 2026-10-18): `d` starts as the first view's CAMOUFOX_PAGE_TIMEOUT_SECONDS;
 * `next()` retires it and starts the Cheapest flow's own, the same again from now, capped so the page never runs past
 * twice that from `started`. Each `onExpire` handler (the page close) is carried to the next deadline.
 */
export interface PageBudget {
  d: Deadline;
  next(): Deadline;
  onExpire(fn: () => void): void;
}

export function pageBudget(timers: Timers, pageTimeoutMs: number, started: number): PageBudget {
  const handlers: Array<() => void> = [];
  const self: PageBudget = {
    d: timers.deadline(pageTimeoutMs),
    next: () => {
      const left = Math.max(1, Math.min(pageTimeoutMs, 2 * pageTimeoutMs - (timers.now() - started)));
      const n = timers.deadline(left);
      for (const h of handlers) n.onExpire(h);
      self.d.clear();
      self.d = n;
      return n;
    },
    onExpire: (fn) => {
      handlers.push(fn);
      self.d.onExpire(fn);
    },
  };
  return self;
}
