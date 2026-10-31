import { describe, expect, it } from 'vitest';
import { DEFAULT_CRON, definitionDefaults } from '../../src/types/definitionDefaults.js';

describe('definitionDefaults (spec §11 form defaults, shared by api and web)', () => {
  it('states the spec defaults', () => {
    expect(definitionDefaults()).toEqual({
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
      minNights: 10,
      maxNights: 21,
      cabin: 'economy',
      constraints: { maxJourneyMinutes: 1500 },
      verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
      scheduleCron: null,
      enabled: false,
    });
    // why: the weekly preset stays the schedule picker's first choice (Repeat weekly), not a default of a new search.
    expect(DEFAULT_CRON).toBe('0 5 * * 1');
  });

  it('gives a new search no arrival window and no schedule (spec rev 55 §8.2, design §4)', () => {
    const d = definitionDefaults();
    expect(d.constraints).toStrictEqual({ maxJourneyMinutes: 1500 });
    expect('arrivalWindowLocal' in d.constraints).toBe(false);
    expect(d.scheduleCron).toBeNull();
    expect(d.enabled).toBe(false);
  });

  it('returns a fresh object each call, so one caller cannot change another default', () => {
    const a = definitionDefaults();
    a.constraints.maxJourneyMinutes = 1;
    a.verification.topN = 1;
    expect(definitionDefaults().constraints.maxJourneyMinutes).toBe(1500);
    expect(definitionDefaults().verification.topN).toBe(10);
  });
});
