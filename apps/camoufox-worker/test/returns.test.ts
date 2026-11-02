// Spec revision 56 §2 "The returns": the return reader over a return view's facts. Every name here is synthetic (the
// recorded name form on the worked example's airports, with the synthetic carrier QQ Air), never a recording's.
import { asIsoDate, type FlightLimits, listedReturnSchema } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ListFacts } from '../src/driver.js';
import { readReturns, returnDayOffset } from '../src/returns.js';

const LIMITS: FlightLimits = {
  maxJourneyMinutes: null,
  maxStops: 0,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
const REQ = {
  returnDate: asIsoDate('2027-11-15'),
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
  returnLimits: LIMITS,
};

/** A synthetic return name in the recorded form (JFK to Heathrow on the return day, one stop unless told). */
function ret(
  o: {
    pounds?: number | string;
    stops?: string;
    on?: string;
    arrivesOn?: string;
    from?: string;
    to?: string;
    operator?: string;
  } = {},
): string {
  const op = o.operator === undefined ? '' : ` Operated by ${o.operator}.`;
  return (
    `From ${o.pounds ?? 1180} British pounds round trip total. ${o.stops ?? '1 stop'} flight with QQ Air.${op} ` +
    `Leaves ${o.from ?? 'John F. Kennedy International Airport'} at 18:30 on ${o.on ?? 'Monday, November 15'} and ` +
    `arrives at ${o.to ?? 'Heathrow Airport'} at 9:45 on ${o.arrivesOn ?? 'Tuesday, November 16'}. Total duration ` +
    '10 hrs 15 min.   Select flight'
  );
}
const facts = (names: Array<string | null>, o: Partial<ListFacts> = {}): ListFacts => ({
  names,
  cheapestTabName: '',
  resultsStated: null,
  currencyName: 'Currency GBP',
  locationName: 'Location·United Kingdom',
  viewMore: false,
  ...o,
});

beforeEach(() => {
  expect.hasAssertions();
});

describe('returnDayOffset (spec rev 56 §2: calendar days from the return date, −1 to 3)', () => {
  it('the same day 0, the next day 1, the previous calendar day −1', () => {
    expect(returnDayOffset({ month: 11, day: 15 }, { month: 11, day: 15 }, asIsoDate('2027-11-15'))).toBe(0);
    expect(returnDayOffset({ month: 11, day: 15 }, { month: 11, day: 16 }, asIsoDate('2027-11-15'))).toBe(1);
    expect(returnDayOffset({ month: 11, day: 15 }, { month: 11, day: 14 }, asIsoDate('2027-11-15'))).toBe(-1);
    expect(returnDayOffset({ month: 11, day: 15 }, { month: 11, day: 18 }, asIsoDate('2027-11-15'))).toBe(3);
  });
  it('crosses a year end both ways: 31 Dec to 1 Jan is 1, 1 Jan to 31 Dec is −1', () => {
    expect(returnDayOffset({ month: 12, day: 31 }, { month: 1, day: 1 }, asIsoDate('2027-12-31'))).toBe(1);
    expect(returnDayOffset({ month: 1, day: 1 }, { month: 12, day: 31 }, asIsoDate('2028-01-01'))).toBe(-1);
  });
  it('is null outside −1..3 or for a date no calendar has', () => {
    expect(
      returnDayOffset({ month: 11, day: 15 }, { month: 11, day: 13 }, asIsoDate('2027-11-15')),
    ).toBeNull();
    expect(
      returnDayOffset({ month: 11, day: 15 }, { month: 11, day: 19 }, asIsoDate('2027-11-15')),
    ).toBeNull();
    expect(
      returnDayOffset({ month: 11, day: 15 }, { month: 2, day: 30 }, asIsoDate('2027-11-15')),
    ).toBeNull();
    expect(returnDayOffset({ month: 2, day: 30 }, { month: 3, day: 1 }, asIsoDate('2027-02-28'))).toBeNull();
  });
});

describe('readReturns (spec rev 56 §2: the pair’s returns, fitting ones first, cut to 30, in page order)', () => {
  // 35 options for the pair: the 31st cheapest by total (index 30 by price) the only nonstop (within maxStops 0)
  const pounds = Array.from({ length: 35 }, (_, i) => 1000 + i * 10);
  const fitting = 1300; // the 31st cheapest: the dearest 30 by price would drop it without R-returns30
  const pairNames = pounds.map((p) => ret({ pounds: p, stops: p === fitting ? 'Nonstop' : '1 stop' }));
  const names = [
    ...pairNames.slice(0, 10),
    ret({ pounds: 900, on: 'Tuesday, November 16' }),
    'From 1,000 British pounds round trip total. Gibberish',
    ...pairNames.slice(10, 20),
    ret({ pounds: 950, on: 'Sunday, November 14', arrivesOn: 'Monday, November 15' }),
    ret({ pounds: 980, from: 'Heathrow Airport', to: 'John F. Kennedy International Airport' }),
    ...pairNames.slice(20),
  ];

  it('keeps 30 returns, the fitting one first by total and inside them, in page order, with the counts', () => {
    const r = readReturns(facts(names), REQ);
    expect(r.listed).toBe('returns');
    expect(r.returns).toHaveLength(30);
    // the fitting one is kept; of the rest the 29 cheapest; the dearest five non-fitting dropped
    const kept = pounds.filter((p) => p === fitting || p < 1000 + 29 * 10);
    expect(r.returns.map((x) => x.fromMinor)).toEqual(kept.map((p) => p * 100));
    expect(r.returns.find((x) => x.stops === 0)?.fromMinor).toBe(fitting * 100);
    expect(r.returns.map((x) => x.fromMinor)).not.toContain(1340 * 100);
    expect(r).toMatchObject({
      optionsOtherCell: 3,
      optionsUnparsed: 1,
      parsedForThisCell: 35,
      currency: 'GBP',
      resultsStated: null,
      moreListed: false,
    });
    // each kept return named, aligned with the returns
    expect(r.names).toHaveLength(30);
    expect(r.names[0]).toBe(pairNames[0]);
    for (const x of r.returns) expect(listedReturnSchema.safeParse(x).success).toBe(true);
  });
  it('each return carries its "From" figure, its times and its day offset from the return date', () => {
    const r = readReturns(
      facts([
        ret({ pounds: '1,204', stops: 'Nonstop', operator: 'QQ Regional' }),
        ret({ pounds: 1250, arrivesOn: 'Sunday, November 14' }),
      ]),
      { ...REQ, returnLimits: { ...LIMITS, maxStops: null } },
    );
    expect(r.returns).toEqual([
      {
        departsLocal: '18:30',
        arrivesLocal: '09:45',
        arrivesDayOffset: 1,
        durationMinutes: 615,
        stops: 0,
        carriers: ['QQ Air'],
        operatedBy: 'QQ Regional',
        fromMinor: 120_400,
      },
      {
        departsLocal: '18:30',
        arrivesLocal: '09:45',
        arrivesDayOffset: -1,
        durationMinutes: 615,
        stops: 1,
        carriers: ['QQ Air'],
        operatedBy: null,
        fromMinor: 125_000,
      },
    ]);
  });
  it('an option the return schema refuses (a 120-character operator) counts unparsed', () => {
    const r = readReturns(facts([ret({ operator: 'O'.repeat(120) }), ret({ pounds: 1250 })]), REQ);
    expect(r.returns).toHaveLength(1);
    expect([r.optionsUnparsed, r.parsedForThisCell]).toEqual([1, 1]);
  });
  it('every option for another day: none-for-cell, no return', () => {
    const r = readReturns(
      facts([ret({ on: 'Tuesday, November 16' }), ret({ on: 'Wednesday, November 17' })]),
      REQ,
    );
    expect(r).toMatchObject({ listed: 'none-for-cell', returns: [], names: [], optionsOtherCell: 2 });
  });
  it('moreListed: a View more control, or more results stated than were read; false otherwise', () => {
    const two = [ret(), ret({ pounds: 1250 })];
    expect(readReturns(facts(two, { viewMore: true }), REQ).moreListed).toBe(true);
    expect(readReturns(facts(two, { resultsStated: 3 }), REQ).moreListed).toBe(true);
    expect(readReturns(facts(two, { resultsStated: 2 }), REQ).moreListed).toBe(false);
    expect(readReturns(facts(two), REQ).moreListed).toBe(false);
    // why: read + unparsed + other is every name the view listed
    expect(readReturns(facts([...two, 'Gibberish'], { resultsStated: 3 }), REQ).moreListed).toBe(false);
  });
  it('the currency as the page states it, null when it states none', () => {
    expect(readReturns(facts([ret()], { currencyName: 'Currency USD' }), REQ).currency).toBe('USD');
    expect(readReturns(facts([ret()], { currencyName: null }), REQ).currency).toBeNull();
  });
});
