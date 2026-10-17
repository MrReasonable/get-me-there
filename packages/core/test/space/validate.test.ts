import { describe, expect, it } from 'vitest';
import { type AirportLookup, type ValidationResult, validateSearchSpace } from '../../src/space/validate.js';
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '../../src/text/bannedWords.js';
import { asIsoDate, iataSchema } from '../../src/types/ids.js';
import { iatas, key } from '../helpers/space.js';

const today = asIsoDate('2026-10-14');
const MAX = 50_000;

// The airports table as the lookup sees it: four worked-example airports, the two metro codes
// they belong to, and the synthetic AAA, which is both an airport and a metro code.
// airportsOfMetro returns codes sorted, as WP3's AirportsRepo does (ORDER BY iata).
const AIRPORTS = new Set(['LHR', 'LGW', 'JFK', 'EWR', 'AAA']);
const METROS: Record<string, string[]> = { LON: ['LGW', 'LHR'], NYC: ['EWR', 'JFK'], AAA: ['AAA', 'BBB'] };
const lookup: AirportLookup = {
  exists: (c) => AIRPORTS.has(c),
  metroOf: (c) => Object.entries(METROS).find(([, a]) => a.includes(c))?.[0] ?? null,
  airportsOfMetro: (c) => iatas(...(METROS[c] ?? [])),
};

type Input = Parameters<typeof validateSearchSpace>[0];

const base: Input = {
  origins: iatas('LHR', 'LGW'),
  destinations: iatas('JFK', 'EWR'),
  window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
  minNights: 10,
  maxNights: 21,
  verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
};

// Every operator-facing string any test produces, checked against spec §11 at the end.
const copy: string[] = [];
function run(input: Input, max = MAX): ValidationResult {
  const r = validateSearchSpace(input, today, lookup, max);
  if (r.ok) copy.push(...r.notes);
  else copy.push(...r.errors.map((e) => e.message));
  return r;
}
const fields = (input: Input, max = MAX) => {
  const r = run(input, max);
  return r.ok ? [] : r.errors;
};
const policy = (p: Partial<Input['verification']>): Input => ({
  ...base,
  verification: { ...base.verification, ...p },
});

describe('validateSearchSpace (spec §6.1, §6.7 policy bounds)', () => {
  it('accepts the worked example and returns the resolved space', () => {
    expect(run(base)).toEqual({
      ok: true,
      resolved: {
        origins: ['LHR', 'LGW'],
        destinations: ['JFK', 'EWR'],
        departureFrom: '2026-10-21',
        departureTo: '2027-04-20',
        minNights: 10,
        maxNights: 21,
      },
      clamped: false,
      notes: [],
    });
  });

  describe('review focus 1: lowercase and metropolitan codes', () => {
    it('upstream: iataSchema upper-cases operator input at the boundary (lhr → LHR)', () => {
      expect(iataSchema.parse('lhr')).toBe('LHR');
      expect(iataSchema.parse(' lgw ')).toBe('LGW');
      expect(iataSchema.safeParse('LHRX').success).toBe(false);
    });

    it('accepts the upper-cased code the schema produced', () => {
      const origins = ['lhr', 'lgw'].map((c) => iataSchema.parse(c));
      expect(run({ ...base, origins }).ok).toBe(true);
    });

    it('upper-cases nothing itself: a lowercase code that bypassed the schema is a format error', () => {
      const origins: string[] = ['lhr', 'LGW'];
      // why: a plain string[] is not Iata[]; this is a row written around the schema, passed untyped by Reflect.apply.
      expect(Reflect.apply(fields, undefined, [{ ...base, origins }])).toEqual([
        { field: 'origins.0', message: 'lhr is not a three-letter upper-case IATA code' },
      ]);
    });

    it('rejects a metro code with a message naming it a city code and listing its airports', () => {
      expect(fields({ ...base, origins: iatas('LON') })).toEqual([
        { field: 'origins.0', message: 'LON is a city code; use one of LGW, LHR' },
      ]);
      expect(fields({ ...base, destinations: iatas('JFK', 'NYC') })).toEqual([
        { field: 'destinations.1', message: 'NYC is a city code; use one of EWR, JFK' },
      ]);
    });

    it('rejects an unknown code as absent from the airports table', () => {
      expect(fields({ ...base, destinations: iatas('XYZ') })).toEqual([
        { field: 'destinations.0', message: 'XYZ is not in the airports table' },
      ]);
    });

    it('accepts a code that is both an airport and a metro code (existence wins)', () => {
      expect(run({ ...base, destinations: iatas('AAA') }).ok).toBe(true);
    });
  });

  it('requires at least one origin and one destination', () => {
    expect(fields({ ...base, origins: [], destinations: [] })).toEqual([
      { field: 'origins', message: 'at least one origin is required' },
      { field: 'destinations', message: 'at least one destination is required' },
    ]);
  });

  it('rejects a code listed twice and an airport that is both origin and destination', () => {
    expect(fields({ ...base, origins: iatas('LHR', 'LHR') })).toEqual([
      { field: 'origins.1', message: 'LHR is listed twice' },
    ]);
    expect(fields({ ...base, destinations: iatas('JFK', 'LHR') })).toEqual([
      { field: 'destinations.1', message: 'LHR is both an origin and a destination' },
    ]);
  });

  it.each([
    [{ minNights: -1 }, 'minNights', 'minNights must be a whole number of 0 or more'],
    [{ minNights: 1.5, maxNights: 2 }, 'minNights', 'minNights must be a whole number of 0 or more'],
    [{ maxNights: 91 }, 'maxNights', 'maxNights must be a whole number no greater than 90'],
    [{ maxNights: 20.5 }, 'maxNights', 'maxNights must be a whole number no greater than 90'],
    [{ minNights: 12, maxNights: 11 }, 'maxNights', 'maxNights must be at least minNights'],
  ])('rejects nights %j', (patch, field, message) => {
    expect(fields({ ...base, ...patch })).toContainEqual({ field, message });
  });

  it('accepts 0 ≤ minNights = maxNights ≤ 90 at both ends', () => {
    expect(run({ ...base, minNights: 0, maxNights: 0 }).ok).toBe(true);
    expect(run({ ...base, minNights: 90, maxNights: 90 }).ok).toBe(true);
  });

  it('rejects startOffsetDays = 0', () => {
    expect(fields({ ...base, window: { kind: 'relative', startOffsetDays: 0, lengthDays: 182 } })).toEqual([
      {
        field: 'window.startOffsetDays',
        message: 'startOffsetDays must be at least 1 (the window starts tomorrow at the earliest)',
      },
    ]);
  });

  it.each([401, 3_000_000, 10.5])(
    'rejects startOffsetDays %d with a field error instead of throwing (the resolved window would be unrepresentable)',
    (startOffsetDays) => {
      const errs = fields({ ...base, window: { kind: 'relative', startOffsetDays, lengthDays: 10 } });
      expect(errs.map((e) => e.field)).toEqual(['window.startOffsetDays']);
    },
  );

  it('accepts startOffsetDays at the 400-day bound', () => {
    expect(run({ ...base, window: { kind: 'relative', startOffsetDays: 400, lengthDays: 400 } }).ok).toBe(
      true,
    );
  });

  it.each([0, 401, 10.5])('rejects lengthDays %d', (lengthDays) => {
    expect(fields({ ...base, window: { kind: 'relative', startOffsetDays: 7, lengthDays } })).toEqual([
      { field: 'window.lengthDays', message: 'lengthDays must be a whole number from 1 to 400' },
    ]);
  });

  it('rejects an absolute window ending before it starts, and one longer than 400 days', () => {
    expect(
      fields({
        ...base,
        window: { kind: 'absolute', from: asIsoDate('2027-03-02'), to: asIsoDate('2027-03-01') },
      }),
    ).toEqual([{ field: 'window.to', message: 'the window must end on or after the day it starts' }]);
    // 2027-01-01 .. 2028-02-04 is 400 days (2028 is a leap year); one more day is 401.
    const ok400 = { kind: 'absolute', from: asIsoDate('2027-01-01'), to: asIsoDate('2028-02-04') } as const;
    expect(run({ ...base, minNights: 1, maxNights: 1, window: ok400 }).ok).toBe(true);
    expect(fields({ ...base, window: { ...ok400, to: asIsoDate('2028-02-05') } })).toEqual([
      { field: 'window.to', message: 'the window must be at most 400 days long' },
    ]);
  });

  it('rejects a zero-cell window (absolute, wholly in the past)', () => {
    expect(
      fields({
        ...base,
        window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-10-14') },
      }),
    ).toEqual([
      { field: 'window', message: 'the window resolves to no departure days: it ends before 2026-10-15' },
    ]);
  });

  it('clamps an absolute window that starts today or earlier, and says so accurately', () => {
    for (const from of ['2026-10-01', '2026-10-14']) {
      expect(
        run({ ...base, window: { kind: 'absolute', from: asIsoDate(from), to: asIsoDate('2026-10-31') } }),
      ).toMatchObject({
        ok: true,
        clamped: true,
        resolved: { departureFrom: '2026-10-15', departureTo: '2026-10-31' },
        notes: ['window start moved to 2026-10-15 (tomorrow); searches start tomorrow at the earliest'],
      });
    }
  });

  it('enforces MAX_CELLS_PER_DEFINITION and names the factors (2 × 2 × 182 × 12 = 8,736)', () => {
    expect(run(base, 8_736).ok).toBe(true);
    expect(fields(base, 8_735)).toEqual([
      {
        field: 'window',
        message:
          'the space has 8,736 cells (2 origins × 2 destinations × 182 days × 12 night lengths); the limit MAX_CELLS_PER_DEFINITION is 8,735. Shorten the window, narrow the nights or remove an airport.',
      },
    ]);
  });

  it('uses singular factor names for a factor of one (1 × 1 × 3 × 1 = 3 cells)', () => {
    const tiny: Input = {
      ...base,
      origins: iatas('LHR'),
      destinations: iatas('JFK'),
      window: { kind: 'absolute', from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-03') },
      minNights: 7,
      maxNights: 7,
    };
    expect(fields(tiny, 2)).toEqual([
      {
        field: 'window',
        message:
          'the space has 3 cells (1 origin × 1 destination × 3 days × 1 night length); the limit MAX_CELLS_PER_DEFINITION is 2. Shorten the window, narrow the nights or remove an airport.',
      },
    ]);
  });

  it('requires alwaysInclude members inside the resolved space and names the first failing condition', () => {
    const inside = key('LHR', 'JFK', '2026-11-01', '2026-11-15'); // 14 nights, in window
    expect(
      fields(
        policy({
          alwaysInclude: [
            inside,
            key('LHR', 'JFK', '2026-10-20', '2026-11-01'),
            key('LHR', 'JFK', '2027-04-21', '2027-05-01'),
            key('LHR', 'JFK', '2026-11-01', '2026-11-10'),
            key('LHR', 'JFK', '2026-11-01', '2026-11-23'),
            key('LHR', 'AAA', '2026-11-01', '2026-11-15'),
            key('AAA', 'JFK', '2026-11-01', '2026-11-15'),
          ],
        }),
      ),
    ).toEqual([
      {
        field: 'verification.alwaysInclude.1',
        message: 'LHR→JFK 2026-10-20–2026-11-01: departs before the window starts (2026-10-21)',
      },
      {
        field: 'verification.alwaysInclude.2',
        message: 'LHR→JFK 2027-04-21–2027-05-01: departs after the window ends (2027-04-20)',
      },
      {
        field: 'verification.alwaysInclude.3',
        message: 'LHR→JFK 2026-11-01–2026-11-10: 9 nights is outside 10–21',
      },
      {
        field: 'verification.alwaysInclude.4',
        message: 'LHR→JFK 2026-11-01–2026-11-23: 22 nights is outside 10–21',
      },
      {
        field: 'verification.alwaysInclude.5',
        message: "LHR→AAA 2026-11-01–2026-11-15: AAA is not one of this definition's destinations",
      },
      {
        field: 'verification.alwaysInclude.6',
        message: "AAA→JFK 2026-11-01–2026-11-15: AAA is not one of this definition's origins",
      },
    ]);
  });

  describe('selection policy bounds (spec §6.7: maxCells is the spend upper bound)', () => {
    it.each([
      [{ maxCells: -1, topN: 0 }, 'verification.maxCells', 'maxCells must be a whole number of 0 or more'],
      [{ maxCells: 2.5, topN: 0 }, 'verification.maxCells', 'maxCells must be a whole number of 0 or more'],
      [{ topN: -1 }, 'verification.topN', 'topN must be a whole number of 0 or more'],
      [{ topN: 1.5 }, 'verification.topN', 'topN must be a whole number of 0 or more'],
      [{ maxCells: 3, topN: 4 }, 'verification.topN', 'topN must be no greater than maxCells (3)'],
      [
        { perDepartureDateBest: -1 },
        'verification.perDepartureDateBest',
        'perDepartureDateBest must be a whole number of 0 or more',
      ],
      [
        { perDepartureDateBest: 0.5 },
        'verification.perDepartureDateBest',
        'perDepartureDateBest must be a whole number of 0 or more',
      ],
    ])('rejects %j', (patch, field, message) => {
      expect(fields(policy(patch))).toEqual([{ field, message }]);
    });

    it('rejects more distinct alwaysInclude cells than maxCells, counting duplicates once', () => {
      const a = key('LHR', 'JFK', '2026-11-01', '2026-11-15');
      const b = key('LHR', 'JFK', '2026-11-02', '2026-11-16');
      expect(run(policy({ maxCells: 2, topN: 2, alwaysInclude: [a, b, a] })).ok).toBe(true);
      expect(fields(policy({ maxCells: 1, topN: 1, alwaysInclude: [a, b, a] }))).toEqual([
        {
          field: 'verification.alwaysInclude',
          message: 'alwaysInclude lists 2 distinct cells; maxCells is 1',
        },
      ]);
    });

    it('accepts maxCells 0, topN 0 and perDepartureDateBest 0', () => {
      expect(run(policy({ maxCells: 0, topN: 0, perDepartureDateBest: 0 })).ok).toBe(true);
    });
  });

  // why: self-contained, so the check does not depend on test order. It runs a table of invalid inputs
  // itself and also covers the strings the tests above collected.
  it('every message and note is free of banned words (spec §11)', () => {
    const invalid: Input[] = [
      { ...base, origins: iatas('LON'), destinations: iatas('JFK', 'NYC') },
      { ...base, destinations: iatas('XYZ') },
      { ...base, origins: [], destinations: [] },
      { ...base, destinations: iatas('LHR') },
      { ...base, minNights: -1, maxNights: 200 },
      { ...base, minNights: 9, maxNights: 8 },
      { ...base, window: { kind: 'relative', startOffsetDays: 0, lengthDays: 0 } },
      { ...base, window: { kind: 'relative', startOffsetDays: 401, lengthDays: 401 } },
      { ...base, window: { kind: 'absolute', from: asIsoDate('2027-03-05'), to: asIsoDate('2027-03-01') } },
      { ...base, window: { kind: 'absolute', from: asIsoDate('2026-01-01'), to: asIsoDate('2026-02-01') } },
      policy({ maxCells: -1, topN: 1.5, perDepartureDateBest: -2 }),
      policy({ maxCells: 3, topN: 4 }),
    ];
    const local = invalid.flatMap((input) => {
      const r = validateSearchSpace(input, today, lookup, MAX);
      return r.ok ? r.notes : r.errors.map((e) => e.message);
    });
    local.push(
      ...(() => {
        const r = validateSearchSpace(base, today, lookup, 10);
        return r.ok ? r.notes : r.errors.map((e) => e.message);
      })(),
    );
    expect(local.length).toBeGreaterThanOrEqual(12);
    for (const s of [...local, ...copy]) expect(findBannedWords(s, BANNED_WORD_ALLOWLIST), s).toEqual([]);
  });
});
