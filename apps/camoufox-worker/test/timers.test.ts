import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeadlineExceeded, raceSignal, realTimers } from '../src/timers.js';

beforeEach(() => {
  expect.hasAssertions();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('realTimers (vitest fake timers: no real waiting)', () => {
  it('sleep resolves after its time and rejects when aborted, before or during', async () => {
    const p = realTimers.sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
    const ctl = new AbortController();
    const q = realTimers.sleep(1000, ctl.signal);
    ctl.abort();
    await expect(q).rejects.toBeInstanceOf(DeadlineExceeded);
    await expect(realTimers.sleep(1, ctl.signal)).rejects.toThrow('aborted');
  });
  it('a deadline reports what remains, fires its listeners at expiry and rejects a pending race', async () => {
    const d = realTimers.deadline(5000);
    const fired: string[] = [];
    d.onExpire(() => fired.push('a'));
    const pending = d.race(new Promise<never>(() => undefined));
    vi.advanceTimersByTime(2000);
    expect(d.remaining()).toBe(3000);
    expect(d.expired()).toBe(false);
    vi.advanceTimersByTime(3000);
    await expect(pending).rejects.toBeInstanceOf(DeadlineExceeded);
    expect(d.expired()).toBe(true);
    expect(d.remaining()).toBe(0);
    d.onExpire(() => fired.push('late'));
    expect(fired).toEqual(['a', 'late']);
    await expect(d.race(Promise.resolve(1))).rejects.toThrow('page deadline');
  });
  it('a race won before expiry resolves, a rejection passes through, clear stops the timer', async () => {
    const d = realTimers.deadline(5000);
    await expect(d.race(Promise.resolve(7))).resolves.toBe(7);
    await expect(d.race(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    d.clear();
    vi.advanceTimersByTime(10_000);
    expect(d.expired()).toBe(false);
    expect(realTimers.now()).toBe(Date.now());
  });
  it('raceSignal on an aborted signal rejects at once', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(raceSignal(Promise.resolve(1), ctl.signal)).rejects.toBeInstanceOf(DeadlineExceeded);
  });
});
