import { describe, expect, it } from 'vitest';
import {
  definitionCreateRequestSchema,
  definitionUpdateRequestSchema,
} from '../../src/api-contract/definitions.js';
import {
  createAndStartRequestSchema,
  createAndStartResponseSchema,
  searchCardSchema,
  searchCardsResponseSchema,
  startRefusalCodes,
} from '../../src/api-contract/searches.js';
import { calendarFigure } from '../helpers/datePairs.js';
import {
  cardTrip,
  cardWindow,
  createAndStartBody,
  definitionResponse,
  LOWER_CHEAPEST,
  latestRun,
  lowerOnCalendar,
  PAIRING_450,
  searchCard,
  VERIFIED_600,
  verifiedDetail,
} from '../helpers/searches.js';

/** The paths of the issues `searchCardSchema` reports for `card` ([] when it parses). */
const paths = (card: unknown): string[] => {
  const r = searchCardSchema.safeParse(card);
  return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
};

describe("a card's trips (Ruling 7)", () => {
  it('carries the trips with their figures, dates and nights, the verified details, the read dates and the lower line', () => {
    const c = searchCardSchema.parse(searchCard());
    expect(
      c.trips.map((t) => [t.figure.basis, t.figure.price.pricePence, t.departureDate, t.nights]),
    ).toEqual([
      ['pairing', 45_000, '2027-03-14', 10],
      ['verified', 60_000, '2027-03-15', 10],
    ]);
    expect(c.trips[1]?.figure).toMatchObject({ origin: 'LHR', destination: 'JFK', fromEarlierSearch: false });
    expect(c.verifiedDetails).toEqual([verifiedDetail()]);
    expect(c.readDates).toBe(3);
    expect(c.lowerOnCalendar).toEqual({
      count: 3,
      cheapest: {
        price: {
          pricePence: 30_000,
          provenance: expect.objectContaining({ providerId: 'travelpayouts' }),
          stale: false,
          ageHours: 50,
          truncated: false,
        },
        departureDate: '2027-03-16',
        returnDate: '2027-03-26',
        origin: 'LHR',
        destination: 'JFK',
        kind: 'cached',
      },
    });
  });

  it('refuses a fourth trip', () => {
    const four = [cardTrip(), cardTrip(), cardTrip(), cardTrip()];
    const details = [verifiedDetail(), verifiedDetail(), verifiedDetail(), verifiedDetail()];
    expect(paths(searchCard({ trips: four, verifiedDetails: details }))).toContain('trips');
    expect(paths(searchCard({ trips: four.slice(1), verifiedDetails: details.slice(1) }))).toEqual([]);
  });

  it('refuses a calendar price, or a verified one not seen again, as a trip', () => {
    const calendar = cardTrip(calendarFigure({ price: { ...calendarFigure().price, pricePence: 30_000 } }));
    expect(paths(searchCard({ trips: [calendar], verifiedDetails: [] }))).toEqual(['trips.0.figure']);
    const gone = cardTrip({ ...VERIFIED_600, notSeenInLatest: { ageHours: 30 } });
    expect(paths(searchCard({ trips: [gone], verifiedDetails: [] }))).toEqual(['trips.0.figure']);
  });

  it("refuses a trip whose figure breaks the board's figure rules", () => {
    const pairing = cardTrip({ ...PAIRING_450, pairingRead: 'not-read' });
    expect(paths(searchCard({ trips: [pairing], verifiedDetails: [] }))).toContain(
      'trips.0.figure.pairingRead',
    );
  });

  it("carries a detail exactly for each verified trip, in order, its booking a seller's exactly with booking options", () => {
    expect(paths(searchCard({ verifiedDetails: [] }))).toEqual(['verifiedDetails']);
    expect(paths(searchCard({ verifiedDetails: [verifiedDetail(), verifiedDetail()] }))).toEqual([
      'verifiedDetails.1',
    ]);
    expect(paths(searchCard({ verifiedDetails: [verifiedDetail({ origin: 'LGW' })] }))).toEqual([
      'verifiedDetails.0',
    ]);
    expect(paths(searchCard({ verifiedDetails: [verifiedDetail({ booking: { kind: 'none' } })] }))).toEqual([
      'verifiedDetails.0.booking',
    ]);
    const bare = cardTrip({ ...VERIFIED_600, hasBookingOptions: false });
    expect(
      paths(searchCard({ trips: [bare], verifiedDetails: [verifiedDetail({ booking: { kind: 'none' } })] })),
    ).toEqual([]);
  });

  it('refuses fewer dates with flights read than trips', () => {
    expect(paths(searchCard({ readDates: 1 }))).toEqual(['readDates']);
    expect(paths(searchCard({ readDates: 2 }))).toEqual([]);
  });

  it('a card with no trip carries none, and no details', () => {
    expect(paths(searchCard({ trips: [], verifiedDetails: [], readDates: 0 }))).toEqual([]);
  });
});

describe("a card's lower-on-calendar line (Ruling 5, Ruling 7)", () => {
  it('is null when nothing looks lower', () => {
    expect(paths(searchCard({ lowerOnCalendar: null }))).toEqual([]);
  });

  it('refuses a bare-number minimum, a price without provenance, a count of zero', () => {
    const cheapest = (o: Record<string, unknown>) =>
      searchCard({ lowerOnCalendar: lowerOnCalendar({ cheapest: { ...LOWER_CHEAPEST, ...o } }) });
    expect(paths(cheapest({ price: 30_000 }))).toContain('lowerOnCalendar.cheapest.price');
    expect(paths(cheapest({ pricePence: 30_000 }))).toContain('lowerOnCalendar.cheapest');
    const { provenance: _p, ...noProvenance } = LOWER_CHEAPEST.price;
    expect(paths(cheapest({ price: noProvenance }))).toContain('lowerOnCalendar.cheapest.price.provenance');
    expect(paths(searchCard({ lowerOnCalendar: lowerOnCalendar({ count: 0 }) }))).toEqual([
      'lowerOnCalendar.count',
    ]);
  });

  it("names its label kind by the price's source: the Aviasales cache is cached, any other calendar is calendar", () => {
    const at = (kind: string, providerId?: string) => {
      const c = LOWER_CHEAPEST;
      const provenance =
        providerId === undefined
          ? c.price.provenance
          : {
              ...c.price.provenance,
              providerId,
              sourceKind: 'scraped-self',
              maxAgeHours: 0,
              pointOfSale: 'GB',
            };
      return searchCard({
        lowerOnCalendar: lowerOnCalendar({ cheapest: { ...c, price: { ...c.price, provenance }, kind } }),
      });
    };
    expect(paths(at('cached'))).toEqual([]);
    expect(paths(at('calendar'))).toEqual(['lowerOnCalendar.cheapest.kind']);
    expect(paths(at('calendar', 'camoufox'))).toEqual([]);
    expect(paths(at('cached', 'camoufox'))).toEqual(['lowerOnCalendar.cheapest.kind']);
    expect(paths(at('seller'))).toContain('lowerOnCalendar.cheapest.kind');
  });
});

describe("a card's latest run marks (Ruling 7)", () => {
  const marks = (o: Record<string, number>) => ({
    priced: 300,
    'no-price-shown': 84,
    'couldnt-read': 6,
    'not-reached': 5,
    'not-searched': 10,
    ...o,
  });
  const run = (o: Record<string, unknown>) =>
    searchCard({ latestRun: latestRun({ datePairsNeverSearched: 10, marks: marks({}), ...o }) });

  it('carries the five marks over the whole space, summing to the date pairs, and the browser-unavailable count', () => {
    const c = searchCardSchema.parse(run({ browserUnavailable: 3 }));
    expect(c.latestRun?.marks).toEqual(marks({}));
    expect(c.latestRun?.browserUnavailable).toBe(3);
  });

  it('refuses marks that do not sum to the date pairs, or a missing mark', () => {
    expect(paths(run({ marks: marks({ 'not-searched': 11 }) }))).toEqual(['latestRun.marks']);
    const { 'not-reached': _n, ...four } = marks({});
    expect(paths(run({ marks: four }))).toContain('latestRun.marks.not-reached');
  });

  it('refuses a searched count that is not the priced and no-price marks', () => {
    expect(paths(run({ datePairsSearched: 383 }))).toEqual(['latestRun.datePairsSearched']);
  });

  it('refuses more browser-unavailable date pairs than not reached', () => {
    expect(paths(run({ browserUnavailable: 5 }))).toEqual([]);
    expect(paths(run({ browserUnavailable: 6 }))).toEqual(['latestRun.browserUnavailable']);
  });
});

describe('searchCardsResponseSchema (spec rev 55 §10 GET /definitions/cards)', () => {
  it("parses the worked-example card, and one never run, with the install's point of sale", () => {
    expect(searchCardsResponseSchema.safeParse({ cards: [searchCard()], pointOfSale: 'GB' }).success).toBe(
      true,
    );
    const never = searchCard({
      latestRun: null,
      trips: [],
      verifiedDetails: [],
      readDates: 0,
      lowerOnCalendar: null,
    });
    expect(searchCardsResponseSchema.safeParse({ cards: [never], pointOfSale: 'unknown' }).success).toBe(
      true,
    );
  });

  // why: Task 6's card links fall back to the Google Flights search in the install's market, as /date-pairs does
  it('refuses a response without its point of sale, or with one that is not a country code', () => {
    expect(searchCardsResponseSchema.safeParse({ cards: [] }).success).toBe(false);
    expect(searchCardsResponseSchema.safeParse({ cards: [], pointOfSale: 'gb' }).success).toBe(false);
  });

  it('parses a scheduled card with a stopped run and its stop text', () => {
    const stop = { sentence: 'Stopped by you.', fix: { text: 'Search again', command: null } };
    const c = searchCard({
      schedule: { cron: '0 5 * * 1', tz: 'Europe/London' },
      latestRun: latestRun({ status: 'cancelled', stop, flights: null }),
    });
    expect(searchCardSchema.safeParse(c).success).toBe(true);
  });

  it('parses an absolute window, whose offsets are null', () => {
    const window = {
      kind: 'absolute',
      departureFrom: '2027-03-01',
      departureTo: '2027-04-30',
      startOffsetDays: null,
      lengthDays: null,
    };
    expect(searchCardSchema.safeParse(searchCard({ window })).success).toBe(true);
  });

  it('refuses a schedule with a cron but no time zone', () => {
    expect(searchCardSchema.safeParse(searchCard({ schedule: { cron: '0 5 * * 1' } })).success).toBe(false);
  });

  it('refuses more date pairs searched, or never searched, than the run has', () => {
    const over = (o: Record<string, unknown>) => searchCard({ latestRun: latestRun(o) });
    expect(
      searchCardSchema.safeParse(over({ datePairsSearched: 406, datePairsNeverSearched: 0 })).success,
    ).toBe(false);
    expect(
      searchCardSchema.safeParse(over({ datePairsSearched: 0, datePairsNeverSearched: 406 })).success,
    ).toBe(false);
    expect(
      searchCardSchema.safeParse(over({ datePairsSearched: 384, datePairsNeverSearched: 22 })).success,
    ).toBe(false);
    expect(
      searchCardSchema.safeParse(over({ datePairsSearched: 405, datePairsNeverSearched: 0 })).success,
    ).toBe(true);
  });

  it('carries the run’s flight counts as the execution read does, and refuses more in hand than planned (R-reading)', () => {
    const f = (x: Record<string, unknown>) =>
      searchCard({
        latestRun: latestRun({
          flights: {
            planned: 10,
            read: 3,
            reused: 2,
            failed: 1,
            ended: null,
            confirm: null,
            stopCause: null,
            ...x,
          },
        }),
      });
    expect(searchCardSchema.safeParse(f({})).success).toBe(true);
    expect(searchCardSchema.safeParse(f({ ended: 'window' })).success).toBe(true);
    expect(searchCardSchema.safeParse(f({ read: 8 })).success).toBe(false);
    // the old two-count shape says nothing of reused lists or why the step ended
    expect(
      searchCardSchema.safeParse(searchCard({ latestRun: latestRun({ flights: { planned: 10, read: 3 } }) }))
        .success,
    ).toBe(false);
  });

  it('refuses a window whose offsets do not match its kind, or that ends before it starts', () => {
    const w = (o: Record<string, unknown>) => searchCard({ window: cardWindow(o) });
    expect(searchCardSchema.safeParse(w({ lengthDays: null })).success).toBe(false);
    expect(searchCardSchema.safeParse(w({ startOffsetDays: null })).success).toBe(false);
    expect(searchCardSchema.safeParse(w({ lengthDays: 0 })).success).toBe(false);
    expect(searchCardSchema.safeParse(w({ kind: 'absolute' })).success).toBe(false);
    expect(searchCardSchema.safeParse(w({ departureTo: '2027-03-06' })).success).toBe(false);
  });

  it('refuses an unknown key on the card, its run, a trip and the lower line (no error_text ever travels)', () => {
    expect(searchCardSchema.safeParse(searchCard({ errorText: 'paused: error' })).success).toBe(false);
    const run = searchCard({ latestRun: latestRun({ errorText: 'x' }) });
    expect(searchCardSchema.safeParse(run).success).toBe(false);
    // why: the old single cheapest is gone (Ruling 7); a card naming it is refused, not read
    expect(searchCardSchema.safeParse(searchCard({ cheapest: null })).success).toBe(false);
    const trip = searchCard({ trips: [cardTrip(VERIFIED_600, { verdictClass: 'verified' })] });
    expect(searchCardSchema.safeParse(trip).success).toBe(false);
    const lower = searchCard({ lowerOnCalendar: lowerOnCalendar({ cheapestNow: 1 }) });
    expect(searchCardSchema.safeParse(lower).success).toBe(false);
    expect(searchCardsResponseSchema.safeParse({ cards: [], pointOfSale: 'GB', total: 0 }).success).toBe(
      false,
    );
  });
});

describe('createAndStartRequestSchema (spec rev 55 §10 POST /definitions/create-and-start)', () => {
  it('accepts the worked-example body, including confirmCalls 0 (a free search)', () => {
    const r = createAndStartRequestSchema.safeParse(createAndStartBody());
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ confirmCostPence: 0, confirmCalls: 0 });
  });

  // why: spec rev 55 §8.1 (ruling A5) — the run's page cap and flight-list allowance are the engine's, set at creation;
  // a request's budget never carries them, so a definition never stores them (dropped, as any unknown budget key is)
  it('a request budget drops the engine-owned allowances (providerMaxCalls, flightListPages), on every request shape', () => {
    const own = { maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 };
    const budget = { ...own, providerMaxCalls: { camoufox: 5 }, flightListPages: 10 };
    const {
      requestKey: _k,
      confirmCostPence: _p,
      confirmCalls: _c,
      ...create
    } = createAndStartBody({ budget });
    expect(createAndStartRequestSchema.parse(createAndStartBody({ budget })).budget).toEqual(own);
    expect(definitionCreateRequestSchema.parse(create).budget).toEqual(own);
    expect(definitionUpdateRequestSchema.parse({ budget }).budget).toEqual(own);
  });

  it("refuses the stored confirmation's old pair, so a press can never set a standing confirmation by name", () => {
    expect(createAndStartRequestSchema.safeParse(createAndStartBody({ confirmedCostPence: 0 })).success).toBe(
      false,
    );
    expect(createAndStartRequestSchema.safeParse(createAndStartBody({ confirmedCalls: 0 })).success).toBe(
      false,
    );
  });

  it('refuses a body missing the request key, or with one that is not a UUID', () => {
    const { requestKey: _k, ...noKey } = createAndStartBody();
    expect(createAndStartRequestSchema.safeParse(noKey).success).toBe(false);
    expect(createAndStartRequestSchema.safeParse(createAndStartBody({ requestKey: 'abc' })).success).toBe(
      false,
    );
  });

  it('refuses a body missing either figure of the confirmation', () => {
    const { confirmCalls: _c, ...noCalls } = createAndStartBody();
    expect(createAndStartRequestSchema.safeParse(noCalls).success).toBe(false);
    const { confirmCostPence: _p, ...noPence } = createAndStartBody();
    expect(createAndStartRequestSchema.safeParse(noPence).success).toBe(false);
  });

  it("keeps the create body's refinements (disjoint airports, nights in order)", () => {
    expect(createAndStartRequestSchema.safeParse(createAndStartBody({ destinations: ['LHR'] })).success).toBe(
      false,
    );
    expect(createAndStartRequestSchema.safeParse(createAndStartBody({ minNights: 22 })).success).toBe(false);
  });
});

describe('createAndStartResponseSchema', () => {
  it('has the six refusal codes', () => {
    expect(startRefusalCodes).toEqual(['cap', 'confirm', 'window', 'disabled', 'shutting-down', 'failed']);
  });

  it('parses a started run and a refused one', () => {
    const started = { definition: definitionResponse(), executionId: 'exec-1', refusal: null };
    expect(createAndStartResponseSchema.safeParse(started).success).toBe(true);
    for (const code of startRefusalCodes) {
      const refused = {
        definition: definitionResponse(),
        executionId: null,
        refusal: { code, estimatePence: 120, totalCalls: 3, resetsAt: null },
      };
      expect(createAndStartResponseSchema.safeParse(refused).success, code).toBe(true);
    }
  });

  it('refuses a code outside the six, and a message beside the code (the web words each code)', () => {
    const refusal = { code: 'paused', estimatePence: null, totalCalls: null, resetsAt: null };
    const r = { definition: definitionResponse(), executionId: null, refusal };
    expect(createAndStartResponseSchema.safeParse(r).success).toBe(false);
    const msg = { ...r, refusal: { ...refusal, code: 'confirm', message: 'engine text' } };
    expect(createAndStartResponseSchema.safeParse(msg).success).toBe(false);
  });

  it('refuses an answer with both a run and a refusal, or neither', () => {
    const refusal = {
      code: 'cap',
      estimatePence: null,
      totalCalls: null,
      resetsAt: '2027-03-31T23:00:00.000Z',
    };
    const both = { definition: definitionResponse(), executionId: 'exec-1', refusal };
    expect(createAndStartResponseSchema.safeParse(both).success).toBe(false);
    const neither = { definition: definitionResponse(), executionId: null, refusal: null };
    expect(createAndStartResponseSchema.safeParse(neither).success).toBe(false);
  });
});
