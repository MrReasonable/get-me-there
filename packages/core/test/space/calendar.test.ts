import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countCells, generateCells } from '../../src/space/generate.js';
import { space, spaceCell } from '../helpers/space.js';

// Spec §6.1 / §9 item 1: windows spanning the March and October DST changes, run under
// TZ=Europe/London and TZ=UTC (plus two zones far from London, which catch an off-by-one day). The functions under test never touch Date, so the zone must make
// no difference; each block switches process.env.TZ at runtime (Node re-reads it on assignment;
// Vitest's default `forks` pool gives each file its own process) and first proves the switch
// took effect, so a silently ignored TZ fails the suite instead of passing it vacuously.
// `pnpm --filter @gmt/core test:tz` additionally runs the whole core suite under each zone.
const ZONES = [
  { tz: 'Europe/London', marchOffset: -60 }, // 2027-03-28 12:00 local is BST (UTC+1)
  { tz: 'UTC', marchOffset: 0 },
  { tz: 'America/Los_Angeles', marchOffset: 420 }, // PDT (UTC−7) since 2027-03-14
  { tz: 'Asia/Tokyo', marchOffset: -540 }, // JST (UTC+9), no DST
] as const;

describe.each(ZONES)('calendar edges under TZ=$tz', ({ tz, marchOffset }) => {
  const saved = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    // why: assigning undefined to process.env stores the string "undefined" (an invalid zone that
    // Node treats as UTC), so an originally unset TZ is restored by deleting the key.
    if (saved === undefined) Reflect.deleteProperty(process.env, 'TZ');
    else process.env.TZ = saved;
  });

  it('the process really is in the zone (guard)', () => {
    // why: Date is allowed in tests; this only checks the environment, not the code under test.
    expect(new Date(2027, 2, 28, 12).getTimezoneOffset()).toBe(marchOffset);
  });

  it('a window across the March change (2027-03-28, clocks forward) keeps every day and night', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-27', to: '2027-03-29', min: 1, max: 1 });
    expect(generateCells(s)).toEqual([
      spaceCell('LHR', 'JFK', '2027-03-27', '2027-03-28', 1),
      spaceCell('LHR', 'JFK', '2027-03-28', '2027-03-29', 1),
      spaceCell('LHR', 'JFK', '2027-03-29', '2027-03-30', 1),
    ]);
  });

  it('a window across the October change (2027-10-31, clocks back) neither repeats nor skips a day', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-10-30', to: '2027-11-01', min: 0, max: 0 });
    expect(generateCells(s).map((c) => c.departureDate)).toEqual(['2027-10-30', '2027-10-31', '2027-11-01']);
    expect(generateCells(s).every((c) => c.returnDate === c.departureDate)).toBe(true);
  });

  it('a 14-night stay departing before the March change returns 14 calendar days later', () => {
    const [c] = generateCells(
      space({ o: ['LHR'], d: ['JFK'], from: '2027-03-20', to: '2027-03-20', min: 14, max: 14 }),
    );
    expect(c).toEqual(spaceCell('LHR', 'JFK', '2027-03-20', '2027-04-03', 14));
  });

  it('crosses the leap day 2028-02-29 and the 2027→2028 boundary', () => {
    const leap = generateCells(
      space({ o: ['LHR'], d: ['JFK'], from: '2028-02-28', to: '2028-03-01', min: 1, max: 1 }),
    );
    expect(leap.map((c) => [c.departureDate, c.returnDate])).toEqual([
      ['2028-02-28', '2028-02-29'],
      ['2028-02-29', '2028-03-01'],
      ['2028-03-01', '2028-03-02'],
    ]);
    const nye = generateCells(
      space({ o: ['LHR'], d: ['JFK'], from: '2027-12-31', to: '2027-12-31', min: 1, max: 2 }),
    );
    expect(nye.map((c) => c.returnDate)).toEqual(['2028-01-01', '2028-01-02']);
  });
});

describe('generation shape (spec §6.1)', () => {
  it('min = max nights gives one cell per departure day', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-04', min: 10, max: 10 });
    expect(countCells(s)).toBe(4);
    expect(generateCells(s).map((c) => c.nights)).toEqual([10, 10, 10, 10]);
  });

  it('a single-day window gives one departure date', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-01', min: 10, max: 12 });
    expect(generateCells(s).map((c) => `${c.departureDate}+${c.nights}`)).toEqual([
      '2027-03-01+10',
      '2027-03-01+11',
      '2027-03-01+12',
    ]);
  });

  it('orders multi-origin × multi-destination by origin, destination, departure, nights (codes sorted)', () => {
    // Listed out of order on purpose: generation order must not depend on how the operator typed them.
    const s = space({
      o: ['LHR', 'LGW'],
      d: ['JFK', 'EWR'],
      from: '2027-03-01',
      to: '2027-03-02',
      min: 7,
      max: 8,
    });
    expect(
      generateCells(s).map((c) => `${c.origin}-${c.destination} ${c.departureDate} ${c.nights}`),
    ).toEqual([
      'LGW-EWR 2027-03-01 7',
      'LGW-EWR 2027-03-01 8',
      'LGW-EWR 2027-03-02 7',
      'LGW-EWR 2027-03-02 8',
      'LGW-JFK 2027-03-01 7',
      'LGW-JFK 2027-03-01 8',
      'LGW-JFK 2027-03-02 7',
      'LGW-JFK 2027-03-02 8',
      'LHR-EWR 2027-03-01 7',
      'LHR-EWR 2027-03-01 8',
      'LHR-EWR 2027-03-02 7',
      'LHR-EWR 2027-03-02 8',
      'LHR-JFK 2027-03-01 7',
      'LHR-JFK 2027-03-01 8',
      'LHR-JFK 2027-03-02 7',
      'LHR-JFK 2027-03-02 8',
    ]);
  });

  it('does not reorder the caller’s arrays', () => {
    const s = space({
      o: ['LHR', 'LGW'],
      d: ['JFK', 'EWR'],
      from: '2027-03-01',
      to: '2027-03-01',
      min: 7,
      max: 7,
    });
    generateCells(s);
    expect(s.origins).toEqual(['LHR', 'LGW']);
    expect(s.destinations).toEqual(['JFK', 'EWR']);
  });
});
