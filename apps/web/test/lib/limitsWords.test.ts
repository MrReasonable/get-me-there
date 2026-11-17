import type { FlightLimits } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { limitsText, overLimitText, setLimits } from '../../src/lib/limitsWords.js';

// CodeRabbit CR43 (coordinator ruling): the over-limit line names the search's limits as a whole unless the journey
// limit is the only one set; the words are the Trip page's (`noneWithin`'s limits text).

const NONE: FlightLimits = {
  maxJourneyMinutes: null,
  maxStops: null,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
const JOURNEY: FlightLimits = { ...NONE, maxJourneyMinutes: 1500 };

describe('setLimits', () => {
  it('names the limits a search sets, journey, stops, departure, arrival', () => {
    expect(setLimits(NONE)).toEqual([]);
    expect(
      setLimits({
        maxJourneyMinutes: 1500,
        maxStops: 1,
        departureWindowLocal: { from: '06:00', to: '22:00' },
        arrivalWindowLocal: { from: '06:00', to: '23:00' },
      }),
    ).toEqual(['journey', 'stops', 'departure', 'arrival']);
    expect(setLimits({ ...NONE, maxStops: 0 })).toEqual(['stops']);
  });
});

describe('limitsText', () => {
  it('words the named limits as the Trip page does, else "your limits"', () => {
    expect(limitsText(['journey', 'stops'], { ...JOURNEY, maxStops: 1 })).toBe(
      'your 25h limit each way and your 1-change limit',
    );
    expect(limitsText(['stops'], { ...NONE, maxStops: 0 })).toBe('your direct-only limit');
    const windows = {
      ...NONE,
      departureWindowLocal: { from: '06:00', to: '22:00' },
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
    };
    expect(limitsText(['departure', 'arrival'], windows)).toBe(
      'your departure window and your arrival window',
    );
    // a limit named but not set says nothing of itself
    expect(limitsText(['journey', 'stops', 'departure', 'arrival'], NONE)).toBe('your limits');
    expect(limitsText([], NONE)).toBe('your limits');
  });
});

describe('overLimitText', () => {
  it('says the journey time when the journey limit is the only one set', () => {
    expect(overLimitText(2, JOURNEY)).toBe("2 dates' trips are over 25h each way.");
    expect(overLimitText(1, JOURNEY)).toBe("1 date's trips are over 25h each way.");
  });

  it('names the limits as a whole when another limit is set', () => {
    expect(overLimitText(2, { ...JOURNEY, arrivalWindowLocal: { from: '06:00', to: '23:00' } })).toBe(
      "2 dates' trips are outside your limits (your 25h limit each way and your arrival window).",
    );
    expect(overLimitText(3, { ...NONE, maxStops: 0 })).toBe(
      "3 dates' trips are outside your limits (your direct-only limit).",
    );
  });

  it('says nothing with no date over, or no limit set', () => {
    expect(overLimitText(0, JOURNEY)).toBeNull();
    expect(overLimitText(2, NONE)).toBeNull();
  });
});
