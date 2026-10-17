import { describe, expect, it, vi } from 'vitest';
import { fixedClock, londonDateOf, systemClock } from '../../src/ports/clock.js';
import { asIsoDateTime } from '../../src/types/ids.js';

describe('clock', () => {
  it('fixedClock returns the instant, advances and can be set', () => {
    const c = fixedClock(asIsoDateTime('2026-10-14T23:30:00.000Z'));
    expect(c.now()).toBe('2026-10-14T23:30:00.000Z');
    expect(c.todayLondon()).toBe('2026-10-15'); // BST: 23:30Z is 00:30 the next day in London
    c.advance(3_600_000);
    expect(c.now()).toBe('2026-10-15T00:30:00.000Z');
    c.set(asIsoDateTime('2026-01-01T00:00:00.000Z'));
    expect(c.now()).toBe('2026-01-01T00:00:00.000Z');
  });
  it('todayLondon in winter equals the UTC date', () => {
    expect(fixedClock(asIsoDateTime('2026-12-01T23:30:00.000Z')).todayLondon()).toBe('2026-12-01');
    expect(londonDateOf(asIsoDateTime('2026-12-01T23:30:00.000Z'))).toBe('2026-12-01');
  });
  it('systemClock reads Date.now in toISOString form and a London date', () => {
    // why: pinning the instant with fake timers keeps this off the real clock and lets it assert exact values.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-14T23:30:00.000Z'));
      expect(systemClock.now()).toBe('2026-10-14T23:30:00.000Z');
      expect(systemClock.todayLondon()).toBe('2026-10-15');
    } finally {
      vi.useRealTimers();
    }
  });
});
