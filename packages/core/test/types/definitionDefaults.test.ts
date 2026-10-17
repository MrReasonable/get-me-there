import { describe, expect, it } from 'vitest';
import { DEFAULT_CRON, definitionDefaults } from '../../src/types/definitionDefaults.js';

describe('definitionDefaults (spec §11 form defaults, shared by api and web)', () => {
  it('states the spec defaults', () => {
    expect(definitionDefaults()).toEqual({
      window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
      minNights: 10,
      maxNights: 21,
      cabin: 'economy',
      constraints: { maxJourneyMinutes: 1500, arrivalWindowLocal: { from: '06:00', to: '23:00' } },
      verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
      scheduleCron: '0 5 * * 1',
      enabled: false,
    });
    expect(DEFAULT_CRON).toBe('0 5 * * 1');
  });

  it('returns a fresh object each call, so one caller cannot change another default', () => {
    const a = definitionDefaults();
    a.constraints.maxJourneyMinutes = 1;
    a.verification.topN = 1;
    expect(definitionDefaults().constraints.maxJourneyMinutes).toBe(1500);
    expect(definitionDefaults().verification.topN).toBe(10);
  });
});
