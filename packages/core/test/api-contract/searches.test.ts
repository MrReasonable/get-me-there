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
import {
  cardCheapest,
  cardWindow,
  createAndStartBody,
  definitionResponse,
  latestRun,
  searchCard,
} from '../helpers/searches.js';

describe("a card's cheapest figure takes the board's three bases (spec rev 56 §10)", () => {
  it("accepts basis 'pairing' (an offer's price, the flight list's provenance), refuses another word", () => {
    const pairing = cardCheapest({
      basis: 'pairing',
      pricePence: 118_000,
      provenance: {
        providerId: 'camoufox',
        sourceKind: 'scraped-self',
        fetchedAt: '2027-02-28T09:30:00.000Z',
        maxAgeHours: 0,
        fx: { converted: false },
        pointOfSale: 'GB',
        cabin: 'economy',
      },
    });
    expect(searchCardSchema.safeParse(searchCard({ cheapest: pairing })).success).toBe(true);
    expect(
      searchCardSchema.safeParse(searchCard({ cheapest: cardCheapest({ basis: 'offer' }) })).success,
    ).toBe(false);
    // why: final review B-M5: a card's pairing figure is the board's leading one: fresh, and a flight list's
    const paths = (c: unknown) => {
      const r = searchCardSchema.safeParse(searchCard({ cheapest: c }));
      return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    };
    expect(paths({ ...pairing, stale: 'refresh' })).toEqual(['cheapest.stale']);
    expect(paths({ ...pairing, provenance: cardCheapest().provenance })).toEqual(['cheapest.provenance']);
  });
});

describe('searchCardsResponseSchema (spec rev 55 §10 GET /definitions/cards)', () => {
  it('parses the worked-example card, and one never run', () => {
    expect(searchCardsResponseSchema.safeParse({ cards: [searchCard()] }).success).toBe(true);
    const never = searchCard({ latestRun: null, cheapest: null });
    expect(searchCardsResponseSchema.safeParse({ cards: [never] }).success).toBe(true);
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
        latestRun: latestRun({ flights: { planned: 10, read: 3, reused: 2, failed: 1, ended: null, ...x } }),
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

  it('refuses a cheapest price without provenance', () => {
    const { provenance: _p, ...rest } = cardCheapest();
    expect(searchCardSchema.safeParse(searchCard({ cheapest: rest })).success).toBe(false);
  });

  // why: decision 36 — a calendar cheapest read from a truncated tile is a partial minimum and says so; a verified
  // figure is never truncated (the date-pairs figure's own rule)
  it("carries the cheapest price's truncated mark: required, and only on the calendar basis", () => {
    const { truncated: _t, ...without } = cardCheapest();
    expect(searchCardSchema.safeParse(searchCard({ cheapest: without })).success).toBe(false);
    const ok = (o: Record<string, unknown>) =>
      searchCardSchema.safeParse(searchCard({ cheapest: cardCheapest(o) })).success;
    expect(ok({ truncated: true })).toBe(true);
    expect(ok({ basis: 'verified', truncated: false })).toBe(true);
    expect(ok({ basis: 'verified', truncated: true })).toBe(false);
  });

  it('refuses an unknown key on the card, its run and its cheapest price (no error_text ever travels)', () => {
    expect(searchCardSchema.safeParse(searchCard({ errorText: 'paused: error' })).success).toBe(false);
    const run = searchCard({ latestRun: latestRun({ errorText: 'x' }) });
    expect(searchCardSchema.safeParse(run).success).toBe(false);
    const cheapest = searchCard({ cheapest: cardCheapest({ verdictClass: 'verified' }) });
    expect(searchCardSchema.safeParse(cheapest).success).toBe(false);
    expect(searchCardsResponseSchema.safeParse({ cards: [], total: 0 }).success).toBe(false);
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
