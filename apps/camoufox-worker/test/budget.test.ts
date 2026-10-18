// The page budget (operator ruling of 2026-10-18; WP15 ruling 10): the first view's deadline, the Cheapest flow's next
// one, and a grid move's own budget, never past the page's overall cap. Fake timers only.
import { beforeEach, describe, expect, it } from 'vitest';
import { pageBudget } from '../src/budget.js';
import { fakeTimers } from './support/timers.js';

beforeEach(() => {
  expect.hasAssertions();
});

describe('pageBudget.nextFor', () => {
  it('gives a move its own budget, carries the page close, and never passes the overall cap', () => {
    const t = fakeTimers();
    const start = t.now();
    const b = pageBudget(t, 90_000, start, 200_000);
    const closed: string[] = [];
    b.onExpire(() => closed.push('closed'));
    t.clock.advance(100_000);
    const m = b.nextFor(60_000);
    expect(m.remaining()).toBe(60_000);
    expect(b.d).toBe(m);
    t.clock.advance(60_000);
    // why: 160 s used of the 200 s cap: the next move gets only the 40 s left
    expect(b.nextFor(60_000).remaining()).toBe(40_000);
    t.runOut();
    expect(closed).toEqual(['closed']);
  });
  it('defaults the overall cap to twice the page timeout, as next() does', () => {
    const t = fakeTimers();
    const b = pageBudget(t, 90_000, t.now());
    t.clock.advance(170_000);
    expect(b.nextFor(60_000).remaining()).toBe(10_000);
  });
});
