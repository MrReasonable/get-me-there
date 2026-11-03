// Spec revision 55 §2 "The flight-list read" (WP20 Task 20.7): the flights reader over a list page's facts. Every name
// here is synthetic (the feasibility form, on the worked example's airports, with QQ carriers), never a recording's.
import { asIsoDate, listedFlightSchema } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ListFacts } from '../src/driver.js';
import { cleanName, dayOffset, readFlights, splitCarriers } from '../src/flights.js';
import { readList } from '../src/list.js';

const REQ = {
  departureDate: asIsoDate('2027-11-05'),
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
};

/** A synthetic option name in the feasibility form. */
function name(
  o: {
    pounds?: number | string;
    stops?: string;
    carriers?: string;
    operator?: string;
    departs?: string;
    on?: string;
    arrives?: string;
    arrivesOn?: string;
    duration?: string;
  } = {},
): string {
  const op = o.operator === undefined ? '' : ` Operated by ${o.operator}.`;
  return (
    `From ${o.pounds ?? 478} British pounds round trip total. ${o.stops ?? 'Nonstop'} flight with ${o.carriers ?? 'QQ Air'}.${op} ` +
    `Leaves Heathrow Airport at ${o.departs ?? '9:05'} on ${o.on ?? 'Friday, November 5'} and arrives at ` +
    `John F. Kennedy International Airport at ${o.arrives ?? '12:10'} on ${o.arrivesOn ?? o.on ?? 'Friday, November 5'}. ` +
    `Total duration ${o.duration ?? '8 hrs 5 min'}.   Select flight`
  );
}
const facts = (names: Array<string | null>, o: Partial<ListFacts> = {}): ListFacts => ({
  names,
  cheapestTabName: 'Cheapest from 451 British pounds',
  resultsStated: names.length,
  currencyName: 'Currency GBP',
  locationName: 'Location·United Kingdom',
  ...o,
});

beforeEach(() => {
  expect.hasAssertions();
});

describe('dayOffset (spec rev 55 §2: the arrival day from the dates the name states)', () => {
  it('counts the days from the departure to the arrival, 0 to 3', () => {
    expect(dayOffset({ month: 11, day: 5 }, { month: 11, day: 5 }, asIsoDate('2027-11-05'))).toBe(0);
    expect(dayOffset({ month: 11, day: 5 }, { month: 11, day: 6 }, asIsoDate('2027-11-05'))).toBe(1);
    expect(dayOffset({ month: 11, day: 5 }, { month: 11, day: 8 }, asIsoDate('2027-11-05'))).toBe(3);
  });
  it('crosses a year end from the departure date’s year', () => {
    expect(dayOffset({ month: 12, day: 31 }, { month: 1, day: 1 }, asIsoDate('2026-12-31'))).toBe(1);
  });
  it('is null for an arrival before the departure or more than 3 days after it', () => {
    expect(dayOffset({ month: 11, day: 5 }, { month: 11, day: 4 }, asIsoDate('2027-11-05'))).toBeNull();
    expect(dayOffset({ month: 11, day: 5 }, { month: 11, day: 9 }, asIsoDate('2027-11-05'))).toBeNull();
  });
  it('is null for a date no calendar has', () => {
    expect(dayOffset({ month: 11, day: 5 }, { month: 2, day: 30 }, asIsoDate('2027-11-05'))).toBeNull();
    expect(dayOffset({ month: 11, day: 5 }, { month: 13, day: 1 }, asIsoDate('2027-11-05'))).toBeNull();
    // why: a date the calendar rolls over (30 February is 2 March) is none, on either side
    expect(dayOffset({ month: 2, day: 28 }, { month: 2, day: 30 }, asIsoDate('2027-02-28'))).toBeNull();
    expect(dayOffset({ month: 2, day: 29 }, { month: 3, day: 1 }, asIsoDate('2027-03-01'))).toBeNull();
    expect(dayOffset({ month: 2, day: 28 }, { month: 3, day: 1 }, asIsoDate('2027-02-28'))).toBe(1);
  });
  it('is null for a month or a day past the calendar’s end even where it rolls over to within three days', () => {
    // why: month 13 rolls over to the next January, and day 366 of January to the next 1 January; neither is a date
    expect(dayOffset({ month: 12, day: 31 }, { month: 13, day: 1 }, asIsoDate('2026-12-31'))).toBeNull();
    expect(dayOffset({ month: 1, day: 366 }, { month: 1, day: 367 }, asIsoDate('2026-12-31'))).toBeNull();
  });
  it('is null when either date is none, whatever the year (the first days either side of 1970 included)', () => {
    expect(dayOffset({ month: 1, day: 32 }, { month: 1, day: 2 }, asIsoDate('1970-01-01'))).toBeNull();
    expect(dayOffset({ month: 12, day: 30 }, { month: 12, day: 32 }, asIsoDate('1969-12-31'))).toBeNull();
  });
});

describe('cleanName (spec rev 55 §2; sec-004)', () => {
  it('a control character between two spaces leaves one space, never two or none', () => {
    expect(cleanName('QQ \u0007 Air')).toBe('QQ Air');
    expect(cleanName('\u202eQQ\t\n Air\u200b ')).toBe('QQ Air');
  });
});

describe('splitCarriers (spec rev 55 §2: the marketing carriers as named)', () => {
  it("splits on ', ' and ' and ', each trimmed and collapsed", () => {
    expect(splitCarriers('British Airways, American Airlines and Finnair')).toEqual([
      'British Airways',
      'American Airlines',
      'Finnair',
    ]);
    expect(splitCarriers('QQ   Air')).toEqual(['QQ Air']);
    expect(splitCarriers('QQ Air')).toEqual(['QQ Air']);
    expect(splitCarriers(' QQ Air and  QQ Two ')).toEqual(['QQ Air', 'QQ Two']);
  });
});

describe('readFlights (spec rev 55 §2: the 30 cheapest of the cell’s options, in page order)', () => {
  // 35 options for the cell, the cheapest at position 31 (index 30); 2 for another day; 1 the grammar refuses
  const cellPounds = Array.from({ length: 35 }, (_, i) => (i === 30 ? 300 : 400 + i));
  const names = [
    ...cellPounds.slice(0, 20).map((p) => name({ pounds: p })),
    name({ pounds: 250, on: 'Saturday, November 6' }),
    'From 478 British pounds round trip total. Gibberish',
    ...cellPounds.slice(20).map((p) => name({ pounds: p })),
    name({ pounds: 260, on: 'Saturday, November 6' }),
  ];
  const f = facts(names);

  it('keeps the 30 cheapest in page order, with the list read’s minimum, tab price and counts', () => {
    const r = readFlights(f, REQ);
    const list = readList(f, REQ);
    expect(r.listed).toBe('flights');
    expect(r.flights).toHaveLength(30);
    // the five dearest (429 and 431 to 434 pounds) are dropped; the cheapest, at position 31, is kept; page order kept
    const kept = cellPounds.filter((p) => p !== 434 && p !== 433 && p !== 432 && p !== 431 && p !== 429);
    expect(r.flights.map((x) => x.amountMinor)).toEqual(kept.map((p) => p * 100));
    expect(r.flights.map((x) => x.amountMinor)).toContain(30_000);
    expect(r.minMinor).toBe(30_000);
    expect(r.minMinor).toBe(list.minMinor);
    expect(r.tabMinor).toBe(list.tabMinor);
    expect(r.tabMinor).toBe(45_100);
    expect(r.optionsOtherCell).toBe(2);
    expect(r.optionsUnparsed).toBe(1);
    expect(r.parsedForThisCell).toBe(35);
    expect(r.resultsSeen).toBe(38);
    expect(r.currency).toBe('GBP');
    expect(r.pointOfSale).toBe('GB');
    // why: every option is a flight, another cell's, unparsed or dropped past 30
    expect(
      r.flights.length + r.optionsUnparsed + r.optionsOtherCell + (r.parsedForThisCell - r.flights.length),
    ).toBe(names.length);
  });
  // why: spec rev 56 §2 (WP21 Task 21.3): the return phase selects among every flight read for the cell and activates it
  // by its own name, so the reader keeps both, never in the answer
  it('reports every flight read with its name (parsed, before the cut) and the kept flights’ names aligned', () => {
    const r = readFlights(f, REQ);
    expect(r.parsed).toHaveLength(35);
    expect(r.parsed.map((p) => p.flight.amountMinor)).toEqual(cellPounds.map((p) => p * 100));
    expect(r.parsed[30]?.name).toBe(names[32]);
    expect(r.names).toHaveLength(30);
    r.flights.forEach((fl, i) => {
      const at = r.parsed.findIndex((p) => p.name === r.names[i]);
      expect(r.parsed[at]?.flight).toEqual(fl);
    });
  });
  it('each flight carries its pence, times, day offset, duration, stops, carriers and operator', () => {
    const r = readFlights(
      facts([
        name({ pounds: 478 }),
        name({
          pounds: '1,204',
          stops: '1 stop',
          carriers: 'QQ Air, QQ Two and QQ Three',
          operator: 'QQ Regional',
          departs: '21:40',
          arrives: '6:15',
          arrivesOn: 'Saturday, November 6',
          duration: '13 hrs 35 min',
        }),
      ]),
      REQ,
    );
    expect(r.flights).toEqual([
      {
        departsLocal: '09:05',
        arrivesLocal: '12:10',
        arrivesDayOffset: 0,
        durationMinutes: 485,
        stops: 0,
        carriers: ['QQ Air'],
        operatedBy: null,
        amountMinor: 47_800,
      },
      {
        departsLocal: '21:40',
        arrivesLocal: '06:15',
        arrivesDayOffset: 1,
        durationMinutes: 815,
        stops: 1,
        carriers: ['QQ Air', 'QQ Two', 'QQ Three'],
        operatedBy: 'QQ Regional',
        amountMinor: 120_400,
      },
    ]);
    for (const x of r.flights) expect(listedFlightSchema.safeParse(x).success).toBe(true);
  });
  it('an option with no day offset, or one the flight schema refuses, counts as unparsed; the others survive', () => {
    const r = readFlights(
      facts([
        name({ pounds: 478 }),
        name({ pounds: 300, arrivesOn: 'Wednesday, November 10' }),
        name({ pounds: 310, operator: `QQ ${'x'.repeat(117)}` }),
        name({ pounds: 320, carriers: 'Q1, Q2, Q3, Q4, Q5, Q6 and Q7' }),
        // why: a name whose leg sentence states no arrival date gives no day offset
        name({ pounds: 330 }).replace(' at 12:10 on Friday, November 5.', ' at 12:10.'),
        name({ pounds: 340 }).replace(' at 9:05 on', ' on'),
      ]),
      REQ,
    );
    expect(r.flights.map((x) => x.amountMinor)).toEqual([47_800]);
    expect(r.optionsUnparsed).toBe(5);
    // why: the five the grammar read for the cell but that are no flight are named for the worker's log, in page order
    expect(r.rejected.map((n) => /^From (\d+)/.exec(n)?.[1])).toEqual(['300', '310', '320', '330', '340']);
    expect(r.parsedForThisCell).toBe(1);
    expect(r.listed).toBe('flights');
    // why: the minimum is the list read's, over every option the grammar read for the cell
    expect(r.minMinor).toBe(30_000);
  });
  it("a page whose options are all for other days is 'none-for-cell', no flight", () => {
    const r = readFlights(
      facts([name({ on: 'Saturday, November 6' }), name({ on: 'Sunday, November 7' })]),
      REQ,
    );
    expect(r).toMatchObject({
      listed: 'none-for-cell',
      flights: [],
      optionsOtherCell: 2,
      optionsUnparsed: 0,
    });
  });
  it("cell options that all fail the flight read are 'none-for-cell' with their count unparsed, never 'flights' with none", () => {
    const r = readFlights(
      facts([
        name({ arrivesOn: 'Thursday, November 25' }),
        name({ pounds: 300, arrives: '25:10' }),
        name({ pounds: 310, operator: 'x'.repeat(120) }),
      ]),
      REQ,
    );
    expect(r).toMatchObject({
      listed: 'none-for-cell',
      flights: [],
      optionsUnparsed: 3,
      optionsOtherCell: 0,
    });
    expect(r.minMinor).toBe(30_000);
  });
  it('keeps the first of equally priced options past 30, in page order', () => {
    const r = readFlights(
      facts(
        Array.from({ length: 32 }, (_, i) =>
          name({ departs: `${10 + (i % 10)}:${String(i).padStart(2, '0')}` }),
        ),
      ),
      REQ,
    );
    expect(r.flights).toHaveLength(30);
    expect(r.flights.map((x) => x.departsLocal)).toEqual(
      Array.from({ length: 30 }, (_, i) => `${10 + (i % 10)}:${String(i).padStart(2, '0')}`),
    );
  });
  // why: 20.7 review finding 8: a byte-order mark is a format character, removed, never read as a space
  it('removes a U+FEFF inside a name rather than reading it as a space', () => {
    const r = readFlights(facts([name({ carriers: 'QQ\ufeffAir', operator: 'QQ \ufeff Regional' })]), REQ);
    expect(r.flights[0]?.carriers).toEqual(['QQAir']);
    expect(r.flights[0]?.operatedBy).toBe('QQ Regional');
  });
  it('collapses the spaces a stripped character leaves', () => {
    const r = readFlights(facts([name({ carriers: 'QQ \u202e Air' })]), REQ);
    expect(r.flights[0]?.carriers).toEqual(['QQ Air']);
  });
  it('collapses whitespace and strips control and format characters from the names it keeps', () => {
    const r = readFlights(
      facts([
        name({ carriers: 'QQ‮  Air and QQ​ Two', operator: 'QQ\tRegional\u0007' }),
        name({ pounds: 500, carriers: '‮‬' }),
      ]),
      REQ,
    );
    expect(r.flights).toHaveLength(1);
    expect(r.flights[0]?.carriers).toEqual(['QQ Air', 'QQ Two']);
    expect(r.flights[0]?.operatedBy).toBe('QQ Regional');
    // why: a carrier name of format characters only is empty once stripped: refused, counted unparsed
    expect(r.optionsUnparsed).toBe(1);
    for (const x of r.flights)
      for (const s of [...x.carriers, x.operatedBy ?? '']) expect(s).not.toMatch(/[\p{Cc}\p{Cf}]/u);
  });
  it('reads unreadable and empty names as unparsed, and the currency and point of sale as stated', () => {
    const r = readFlights(
      facts([null, '', name()], { currencyName: 'Currency EUR', locationName: null }),
      REQ,
    );
    expect(r).toMatchObject({
      optionsUnparsed: 2,
      currency: 'EUR',
      pointOfSale: 'unknown',
      listed: 'flights',
    });
  });
});
