import { describe, expect, it } from 'vitest';
import * as barrel from '../../src/index.js';
import {
  compareAges,
  effectiveAge,
  formatAgeCompact,
  formatAgeFull,
  formatAgeShort,
  formatDuration,
  hoursSince,
  isStale,
  withAssumedBound,
  worstCaseAgeHours,
} from '../../src/labels/age.js';
import { asIsoDateTime } from '../../src/types/ids.js';

const now = asIsoDateTime('2026-10-14T15:00:00.000Z');
const at = asIsoDateTime;

describe('effectiveAge (spec §3)', () => {
  it('uses providerObservedAt when present', () => {
    expect(
      effectiveAge(
        {
          fetchedAt: at('2026-10-14T13:00:00.000Z'),
          providerObservedAt: at('2026-10-14T12:00:00.000Z'),
          maxAgeHours: 48,
        },
        now,
      ),
    ).toEqual({ kind: 'observed', fetchedHours: 2, observedHours: 3 });
  });
  it('bounds by maxAgeHours otherwise', () => {
    expect(effectiveAge({ fetchedAt: at('2026-10-14T13:00:00.000Z'), maxAgeHours: 168 }, now)).toEqual({
      kind: 'bounded',
      fetchedHours: 2,
      maxAgeHours: 168,
    });
  });
  it("is unknown when maxAgeHours is 'unknown'", () => {
    expect(effectiveAge({ fetchedAt: at('2026-10-14T13:00:00.000Z'), maxAgeHours: 'unknown' }, now)).toEqual({
      kind: 'unknown',
      fetchedHours: 2,
    });
  });
  it('clamps a future timestamp to 0 (review focus 2)', () => {
    expect(
      effectiveAge(
        {
          fetchedAt: at('2026-10-14T16:00:00.000Z'),
          providerObservedAt: at('2026-10-14T17:00:00.000Z'),
          maxAgeHours: 1,
        },
        now,
      ),
    ).toEqual({ kind: 'observed', fetchedHours: 0, observedHours: 0 });
  });
  it('fractions of an hour round down', () => {
    expect(
      effectiveAge({ fetchedAt: at('2026-10-14T13:10:00.000Z'), maxAgeHours: 1 }, now).fetchedHours,
    ).toBe(1);
  });
});

describe('formatting', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('just now');
    expect(formatDuration(1)).toBe('1h');
    expect(formatDuration(2)).toBe('2h');
    expect(formatDuration(24)).toBe('24h');
    expect(formatDuration(47)).toBe('47h');
    expect(formatDuration(48)).toBe('2d');
    expect(formatDuration(13 * 24)).toBe('13d');
    expect(formatDuration(14 * 24)).toBe('2w');
    expect(formatDuration(168)).toBe('7d');
  });
  it('full and compact forms match spec §3 examples', () => {
    const b = { kind: 'bounded', fetchedHours: 2, maxAgeHours: 168 } as const;
    expect(formatAgeFull(b)).toBe('fetched 2h ago · provider age unknown (≤7d before that)');
    expect(formatAgeCompact(b)).toBe('2h ago · ≤7d');
    const o = { kind: 'observed', fetchedHours: 2, observedHours: 3 } as const;
    expect(formatAgeFull(o)).toBe('fetched 2h ago · observed 3h ago');
    expect(formatAgeCompact(o)).toBe('2h ago · obs 3h');
    const u = { kind: 'unknown', fetchedHours: 2 } as const;
    expect(formatAgeFull(u)).toBe("fetched 2h ago · vendor's cache age unknown");
    expect(formatAgeCompact(u)).toBe('2h ago · age unknown');
    expect(formatAgeCompact({ kind: 'bounded', fetchedHours: 0, maxAgeHours: 24 })).toBe('just now · ≤24h');
    expect(formatAgeCompact({ kind: 'bounded', fetchedHours: 1, maxAgeHours: 24 })).toBe('1h ago · ≤24h');
    expect(formatAgeFull({ kind: 'observed', fetchedHours: 1, observedHours: 1 })).toBe(
      'fetched 1h ago · observed 1h ago',
    );
    expect(formatAgeFull({ kind: 'observed', fetchedHours: 0, observedHours: 0 })).toBe(
      'fetched just now · observed just now',
    );
  });
  it('a zero bound (interactive search at request time) shows no bound clause (spec §8.3)', () => {
    expect(formatAgeFull({ kind: 'bounded', fetchedHours: 5, maxAgeHours: 0 })).toBe('fetched 5h ago');
    expect(formatAgeCompact({ kind: 'bounded', fetchedHours: 5, maxAgeHours: 0 })).toBe('5h ago');
  });
});

describe('formatAgeShort: the face form of the calendar day and the phone (ruling 3, decision 67)', () => {
  it.each([
    [{ kind: 'observed', fetchedHours: 0, observedHours: 120 }, '5d old'],
    [{ kind: 'observed', fetchedHours: 0, observedHours: 0 }, 'just now'],
    [{ kind: 'observed', fetchedHours: 1, observedHours: 1 }, '1h old'],
    [{ kind: 'observed', fetchedHours: 3, observedHours: 3 }, '3h old'],
    [{ kind: 'bounded', fetchedHours: 2, maxAgeHours: 48 }, '≤2d old'],
    [{ kind: 'bounded', fetchedHours: 0, maxAgeHours: 24 }, '≤24h old'],
    [{ kind: 'bounded', fetchedHours: 5, maxAgeHours: 0 }, '5h old'],
    [{ kind: 'bounded', fetchedHours: 0, maxAgeHours: 0 }, 'just now'],
    [{ kind: 'unknown', fetchedHours: 2 }, 'age unknown'],
  ] as const)('%o reads %s', (a, text) => {
    expect(formatAgeShort(a)).toBe(text);
  });
  it('is on the barrel', () => {
    expect(barrel.formatAgeShort).toBe(formatAgeShort);
  });
});

describe('an assumed bound reads as an assumption on every form (N4, pie-007)', () => {
  const p = {
    fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'),
    maxAgeHours: 24,
    maxAgeAssumed: true as const,
  };
  it('effectiveAge carries the flag; a stated bound has none', () => {
    expect(effectiveAge(p, now)).toEqual({
      kind: 'bounded',
      fetchedHours: 2,
      maxAgeHours: 24,
      assumed: true,
    });
    expect(effectiveAge({ fetchedAt: p.fetchedAt, maxAgeHours: 48 }, now)).toEqual({
      kind: 'bounded',
      fetchedHours: 2,
      maxAgeHours: 48,
    });
  });
  it('withAssumedBound marks a positive numeric bound from a provider whose bound is assumed, and nothing else', () => {
    const base = { fetchedAt: p.fetchedAt, maxAgeHours: 24 } as const;
    expect(withAssumedBound(base, { maxAgeAssumed: true })).toEqual({ ...base, maxAgeAssumed: true });
    expect(withAssumedBound(base, { maxAgeAssumed: false })).toBe(base);
    expect(withAssumedBound(base, undefined)).toBe(base);
    const unknown = { fetchedAt: p.fetchedAt, maxAgeHours: 'unknown' } as const;
    expect(withAssumedBound(unknown, { maxAgeAssumed: true })).toBe(unknown);
    const zero = { fetchedAt: p.fetchedAt, maxAgeHours: 0 } as const;
    expect(withAssumedBound(zero, { maxAgeAssumed: true })).toBe(zero);
    expect(barrel.withAssumedBound).toBe(withAssumedBound);
  });
  it('a grid-cell row is assumed from its own facts, with camoufox in list mode or off (fix round 1, PA I2)', () => {
    const grid = { fetchedAt: p.fetchedAt, maxAgeHours: 24, returnDateSource: 'grid-cell' } as const;
    expect(withAssumedBound(grid, undefined)).toEqual({ ...grid, maxAgeAssumed: true });
    expect(withAssumedBound(grid, { maxAgeAssumed: false })).toEqual({ ...grid, maxAgeAssumed: true });
    const asked = { fetchedAt: p.fetchedAt, maxAgeHours: 24, returnDateSource: 'asked' } as const;
    expect(withAssumedBound(asked, undefined)).toBe(asked);
    const gridZero = { fetchedAt: p.fetchedAt, maxAgeHours: 0, returnDateSource: 'grid-cell' } as const;
    expect(withAssumedBound(gridZero, undefined)).toBe(gridZero);
  });
  it('short, compact and full forms say "assumed", never a plain "≤"', () => {
    const a = effectiveAge(p, now);
    expect(formatAgeShort(a)).toBe('assumed ≤26h');
    expect(formatAgeCompact(a)).toBe('2h ago · assumed ≤24h');
    expect(formatAgeFull(a)).toBe('fetched 2h ago · provider age assumed ≤24h (undocumented) before that');
    for (const w of formatAgeShort(a).split(' ')) expect(w.length).toBeLessThanOrEqual(7); // the 45 px phone column
  });
});

describe('ordering (spec §8.1: unknown loses to any known age)', () => {
  it('worstCaseAgeHours', () => {
    expect(worstCaseAgeHours({ kind: 'observed', fetchedHours: 2, observedHours: 3 })).toBe(3);
    expect(worstCaseAgeHours({ kind: 'bounded', fetchedHours: 2, maxAgeHours: 48 })).toBe(50);
    expect(worstCaseAgeHours({ kind: 'unknown', fetchedHours: 2 })).toBe(2); // spec rev 23: the fetch age alone
  });
  it('compareAges', () => {
    const known = { kind: 'bounded', fetchedHours: 100, maxAgeHours: 48 } as const;
    const unknown = { kind: 'unknown', fetchedHours: 0 } as const;
    expect(compareAges(known, unknown)).toBeLessThan(0);
    expect(compareAges(unknown, known)).toBeGreaterThan(0);
    expect(compareAges(unknown, unknown)).toBe(0);
    // why: an unknown vendor age loses even with a smaller fetch age than the known one
    expect(
      compareAges(
        { kind: 'unknown', fetchedHours: 0 },
        { kind: 'bounded', fetchedHours: 5, maxAgeHours: 48 },
      ),
    ).toBeGreaterThan(0);
    expect(compareAges({ kind: 'observed', fetchedHours: 1, observedHours: 1 }, known)).toBeLessThan(0);
    expect(compareAges(known, known)).toBe(0);
  });
});

describe('isStale (spec §3, plan decisions 44, 54, 55: the one staleness rule)', () => {
  const at = (hoursAgo: number) =>
    asIsoDateTime(new Date(Date.parse(now) - hoursAgo * 3_600_000).toISOString());
  it('a known bound adds to the fetch age; stale only strictly past the threshold', () => {
    expect(isStale({ fetchedAt: at(150), maxAgeHours: 42 }, now, 192)).toBe(false); // 192, not past
    expect(isStale({ fetchedAt: at(151), maxAgeHours: 42 }, now, 192)).toBe(true);
  });
  it('an observed age wins over the bound, and is never younger than the fetch age (decision 58)', () => {
    expect(isStale({ fetchedAt: at(1), providerObservedAt: at(200), maxAgeHours: 0 }, now, 192)).toBe(true);
    expect(isStale({ fetchedAt: at(150), providerObservedAt: at(180), maxAgeHours: 168 }, now, 192)).toBe(
      false,
    );
    // an observed time after the fetch is a vendor error: the 300 h fetch age stands
    expect(isStale({ fetchedAt: at(300), providerObservedAt: at(10), maxAgeHours: 168 }, now, 192)).toBe(
      true,
    );
    expect(
      effectiveAge({ fetchedAt: at(300), providerObservedAt: at(10), maxAgeHours: 0 }, now),
    ).toMatchObject({
      observedHours: 300,
    });
    expect(
      effectiveAge({ fetchedAt: at(50), providerObservedAt: at(50), maxAgeHours: 0 }, now),
    ).toMatchObject({
      fetchedHours: 50,
      observedHours: 50,
    });
  });
  it('an unknown vendor age counts the fetch age alone: never stale on that account', () => {
    expect(isStale({ fetchedAt: at(191), maxAgeHours: 'unknown' }, now, 192)).toBe(false);
    expect(isStale({ fetchedAt: at(193), maxAgeHours: 'unknown' }, now, 192)).toBe(true);
  });
});

describe('hoursSince (plan decision 59: the one whole-hour age helper the api and the alerts share)', () => {
  const now = asIsoDateTime('2026-10-14T15:00:00.000Z');
  it('counts whole hours, rounding down', () => {
    expect(hoursSince(asIsoDateTime('2026-10-14T13:00:00.000Z'), now)).toBe(2);
    expect(hoursSince(asIsoDateTime('2026-10-14T13:00:00.001Z'), now)).toBe(1);
    expect(hoursSince(now, now)).toBe(0);
  });

  it('is never negative: an instant after now reads as 0', () => {
    expect(hoursSince(asIsoDateTime('2026-10-14T18:00:00.000Z'), now)).toBe(0);
  });

  it('is exported from the core barrel', () => {
    expect(barrel.hoursSince).toBe(hoursSince);
  });
});
