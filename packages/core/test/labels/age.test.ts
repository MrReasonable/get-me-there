import { describe, expect, it } from 'vitest';
import {
  compareAges,
  effectiveAge,
  formatAgeCompact,
  formatAgeFull,
  formatDuration,
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
    expect(formatAgeFull(u)).toBe('fetched 2h ago · provider age unknown');
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

describe('ordering (spec §8.1: unknown loses to any known age)', () => {
  it('worstCaseAgeHours', () => {
    expect(worstCaseAgeHours({ kind: 'observed', fetchedHours: 2, observedHours: 3 })).toBe(3);
    expect(worstCaseAgeHours({ kind: 'bounded', fetchedHours: 2, maxAgeHours: 48 })).toBe(50);
    expect(worstCaseAgeHours({ kind: 'unknown', fetchedHours: 2 })).toBe('unknown');
  });
  it('compareAges', () => {
    const known = { kind: 'bounded', fetchedHours: 100, maxAgeHours: 48 } as const;
    const unknown = { kind: 'unknown', fetchedHours: 0 } as const;
    expect(compareAges(known, unknown)).toBeLessThan(0);
    expect(compareAges(unknown, known)).toBeGreaterThan(0);
    expect(compareAges(unknown, unknown)).toBe(0);
    expect(compareAges({ kind: 'observed', fetchedHours: 1, observedHours: 1 }, known)).toBeLessThan(0);
    expect(compareAges(known, known)).toBe(0);
  });
});
