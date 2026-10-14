import { describe, expect, it } from 'vitest';
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
  it('systemClock produces the toISOString form and a London date', () => {
    expect(systemClock.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(systemClock.todayLondon()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
