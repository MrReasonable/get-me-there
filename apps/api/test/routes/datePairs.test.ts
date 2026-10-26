// Spec §10 `GET /definitions/:id/date-pairs` (WP19 Task 19.2): decision 53's honesty, the figure and its marks, the
// distinct-cell counts, the journey limit, the 422s, gzip, and the calendar route's rules ported before it goes.
import { gunzipSync } from 'node:zlib';
import { apiContract, asIata, type CellKey, type DatePair, type DecodedDatePairs } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/contract.js';
import { DATE_PAIRS, datesOf, pairOf, resultsOf, SCOPE_422, seedDatesWorld, W } from '../helpers/dates.js';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function harness(env: Record<string, string> = {}): Promise<Harness> {
  h = await createHarness({ env });
  return h;
}

const FOUR = { origins: [LHR, LGW], destinations: [JFK, EWR], window: SMALL_WINDOW };

/** The world over the four airport pairs, and the decoded unfiltered read. */
async function world() {
  const x = await harness();
  const def = x.ports.repos.definitions.create(exampleDefinitionInput(FOUR));
  const s = seedDatesWorld(x, def, () => true);
  return { x, def, s };
}

/** Every pair without its figure's execution-independent parts changed: the comparable form of two reads. */
const comparable = (d: DecodedDatePairs) => ({
  scope: d.scope,
  summary: d.summary,
  pairs: d.pairs,
  space: d.space,
});

describe('airport filtering is honest (decision 53)', () => {
  it('origins=LHR equals a definition holding only LHR, seeded with the same cells; the §16 date pair has no figure', async () => {
    const x = await harness();
    const four = x.ports.repos.definitions.create(exampleDefinitionInput(FOUR));
    seedDatesWorld(x, four, () => true);
    const lhr = x.ports.repos.definitions.create(exampleDefinitionInput({ ...FOUR, origins: [LHR] }));
    seedDatesWorld(x, lhr, (c) => c.origin === LHR);
    const filtered = await datesOf(x, four.id, '?origins=LHR');
    expect(comparable(filtered)).toEqual(comparable(await datesOf(x, lhr.id)));
    // the §16 test at the route: 2 Nov, 11 nights is priced only on LGW→EWR
    expect(pairOf(filtered, '2026-11-02', '2026-11-13').figure).toBeNull();
    expect(pairOf(filtered, '2026-11-02', '2026-11-13').buckets).toMatchObject({ priced: 0, not_run: 2 });
    expect(pairOf(await datesOf(x, four.id), '2026-11-02', '2026-11-13').figure?.price.pricePence).toBe(
      31_000,
    );
  });

  it('destinations=JFK equals a definition holding only JFK, seeded with the same cells', async () => {
    const x = await harness();
    const four = x.ports.repos.definitions.create(exampleDefinitionInput(FOUR));
    seedDatesWorld(x, four, () => true);
    const jfk = x.ports.repos.definitions.create(exampleDefinitionInput({ ...FOUR, destinations: [JFK] }));
    seedDatesWorld(x, jfk, (c) => c.destination === JFK);
    expect(comparable(await datesOf(x, four.id, '?destinations=JFK'))).toEqual(
      comparable(await datesOf(x, jfk.id)),
    );
  });

  it('normalises the scope: LHR,LHR equals LHR; LHR,LGW is sorted to [LGW, LHR] and figures index that order', async () => {
    const { x, def } = await world();
    const once = await datesOf(x, def.id, '?origins=LHR');
    expect(await datesOf(x, def.id, '?origins=LHR,LHR')).toEqual(once);
    const both = await datesOf(x, def.id, '?origins=LHR,LGW');
    expect(both.scope.origins).toEqual(['LGW', 'LHR']);
    expect(both.scope.destinations).toEqual(['EWR', 'JFK']);
    const f = pairOf(both, '2026-11-02', '2026-11-12').figure;
    // LHR→JFK is the fourth of LGW→EWR, LGW→JFK, LHR→EWR, LHR→JFK
    expect([f?.origin, f?.destination, f?.airportPair]).toEqual(['LHR', 'JFK', 3]);
  });
});

describe('the date-pairs shape over the worked world (spec §10, §11 "The figure")', () => {
  it('columns in generation order, executionId the latest parent, the summary the columns sum', async () => {
    const { x, def, s } = await world();
    const d = await datesOf(x, def.id);
    expect(d.executionId).toBe(s.id('E2'));
    expect(d.pairs.map((p) => p.index)).toEqual(d.pairs.map((_, i) => i));
    expect(d.pairs).toHaveLength(4 * 12);
    expect([d.pairs[0]?.departureDate, d.pairs[0]?.nights, d.pairs[12]?.departureDate]).toEqual([
      '2026-11-02',
      10,
      '2026-11-03',
    ]);
    expect(d.scope).toEqual({
      origins: ['LGW', 'LHR'],
      destinations: ['EWR', 'JFK'],
      airportPairs: 4,
      cells: 192,
      maxJourneyMinutes: null,
    });
    expect(d.summary.total).toBe(192);
    // 2 Nov, 10 nights: priced on two pairs, no data on one, an error on the fourth
    expect(pairOf(d, '2026-11-02', '2026-11-12').buckets).toEqual({
      priced: 2,
      empty: 0,
      no_data: 1,
      error: 1,
      skipped: 0,
      not_run: 0,
      reused: 0,
    });
  });

  it('a fresh verified LHR→JFK figure hides a cheaper LGW→EWR calendar price and names its airports', async () => {
    const { x, def } = await world();
    const f = pairOf(await datesOf(x, def.id), '2026-11-02', '2026-11-12').figure;
    expect(f).toMatchObject({
      basis: 'verified',
      origin: 'LHR',
      destination: 'JFK',
      price: { pricePence: 60_000, stale: false, truncated: false },
      cheaperCached: {
        pricePence: 30_000,
        origin: 'LGW',
        destination: 'EWR',
        truncated: false,
        stale: false,
      },
      fromEarlierSearch: false,
      departOut: '2026-11-02T08:00',
      arriveOut: '2026-11-02T10:00',
      departBack: '2026-11-12T10:00',
      arriveBack: '2026-11-12T18:00',
      journeyMinutes: 960,
    });
  });

  it("decision 54's marks: a calendar figure a newer run found empty is superseded, a verified one the latest search did not return carries its age", async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput(FOUR));
    // only LHR→JFK of 3 Nov, so the superseded price is the only one
    seedDatesWorld(x, def, (c) => c === W.J3 || c === W.J4);
    const d = await datesOf(x, def.id);
    expect(pairOf(d, '2026-11-03', '2026-11-13').figure).toMatchObject({
      basis: 'calendar',
      superseded: true,
      price: { pricePence: 28_000 },
      fromEarlierSearch: true,
    });
    expect(pairOf(d, '2026-11-03', '2026-11-14').figure).toMatchObject({
      basis: 'verified',
      notSeenInLatest: { ageHours: 2 },
      price: { pricePence: 55_000 },
    });
  });

  it('a current price from an earlier run beats a superseded one', async () => {
    const { x, def } = await world();
    const d = await datesOf(x, def.id);
    // 3 Nov, 10 nights: LHR→EWR £500 from E1 (current), LHR→JFK £280 superseded
    expect(pairOf(d, '2026-11-03', '2026-11-13').figure).toMatchObject({
      basis: 'calendar',
      origin: 'LHR',
      destination: 'EWR',
      superseded: false,
      fromEarlierSearch: true,
      price: { pricePence: 50_000 },
    });
  });

  it('a superseded cheaper calendar price is never "cached from"', async () => {
    const x2 = await harness();
    const def2 = x2.ports.repos.definitions.create(exampleDefinitionInput(FOUR));
    const s2 = seeder(x2.ports);
    s2.execution('E1', { def: def2, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s2.cells('E1', [W.W1]);
    s2.tile('E1', W.W1, { status: 'priced', pricePence: 20_000, fetchedAt: at(-29) });
    s2.execution('E2', { def: def2, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s2.cells('E2', [W.J1, W.W1], { selected: [{ cell: W.J1, reason: 'top_n' }] });
    s2.tile('E2', W.W1, { status: 'empty', fetchedAt: at(-2) });
    s2.verified('E2', W.J1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-2) }]);
    const f = pairOf(await datesOf(x2, def2.id), '2026-11-02', '2026-11-12').figure;
    expect(f).toMatchObject({ basis: 'verified', price: { pricePence: 60_000 }, cheaperCached: null });
  });

  it('a truncated tile gives a truncated calendar figure', async () => {
    const { x, def } = await world();
    expect(pairOf(await datesOf(x, def.id), '2026-11-04', '2026-11-14').figure).toMatchObject({
      basis: 'calendar',
      price: { pricePence: 40_000, truncated: true },
      departOut: null,
      arriveOut: null,
      departBack: null,
      arriveBack: null,
    });
  });

  it('a truncated cheaper price carries cheaperCachedTruncated', async () => {
    const x2 = await harness();
    const def2 = x2.ports.repos.definitions.create(exampleDefinitionInput(FOUR));
    const s2 = seeder(x2.ports);
    s2.execution('E1', { def: def2, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s2.cells('E1', [W.J1, W.W1], { selected: [{ cell: W.J1, reason: 'top_n' }] });
    s2.tile('E1', W.W1, {
      status: 'priced',
      pricePence: 30_000,
      fetchedAt: at(-2),
      lastError: 'cheapest of the rows read',
    });
    s2.verified('E1', W.J1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-2) }]);
    expect(
      pairOf(await datesOf(x2, def2.id), '2026-11-02', '2026-11-12').figure?.cheaperCached,
    ).toMatchObject({
      pricePence: 30_000,
      truncated: true,
    });
  });

  it("cheaperCachedStale for a provider no longer among the definition's discovery providers follows the figure's own rule", async () => {
    const x = await harness({ CALENDAR_STALE_AFTER_HOURS: '10' });
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        ...FOUR,
        providers: { discovery: [], verification: ['fixture'], discoveryRefreshHours: {} },
      }),
    );
    const s = seeder(x.ports);
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-2) });
    s.cells('E1', [W.J1, W.W1], { selected: [{ cell: W.J1, reason: 'top_n' }] });
    s.tile('E1', W.W1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-20) }); // 20 h + 24 h > 10 h
    s.verified('E1', W.J1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-2) }]);
    const d = await datesOf(x, def.id);
    expect(pairOf(d, '2026-11-02', '2026-11-12').figure?.cheaperCached).toMatchObject({ stale: true });
    // the same price as a figure is stale by the same rule
    const alone = await datesOf(x, def.id, '?destinations=EWR');
    expect(pairOf(alone, '2026-11-02', '2026-11-12').figure?.price.stale).toBe(true);
  });

  it('an overnight return keeps its arrival as the source states it; an on-demand price after the latest run is a figure and counts once', async () => {
    const { x, def } = await world();
    const d = await datesOf(x, def.id);
    expect(pairOf(d, '2026-11-04', '2026-11-15').figure).toMatchObject({
      origin: 'LGW', // £480 of 601 minutes is the cheaper without a limit
      price: { pricePence: 48_000 },
    });
    const lhr = await datesOf(x, def.id, '?origins=LHR');
    expect(pairOf(lhr, '2026-11-04', '2026-11-15').figure).toMatchObject({
      departBack: '2026-11-15T22:10',
      arriveBack: '2026-11-16T06:40',
      journeyMinutes: 600,
    });
    const child = pairOf(d, '2026-11-05', '2026-11-15');
    expect(child.onDemand).toBe(1);
    expect(child.figure).toMatchObject({
      basis: 'verified',
      price: { pricePence: 70_000 },
      fromEarlierSearch: false,
    });
    expect(d.summary.onDemand).toBe(1);
  });

  it('maxJourneyMinutes=600 leaves out a 601-minute price, keeps 600 and a calendar price with no journey time', async () => {
    const { x, def } = await world();
    const d = await datesOf(x, def.id, '?maxJourneyMinutes=600');
    expect(d.scope.maxJourneyMinutes).toBe(600);
    const p7 = pairOf(d, '2026-11-04', '2026-11-15');
    expect(p7.figure).toMatchObject({ origin: 'LHR', journeyMinutes: 600, price: { pricePence: 52_000 } });
    expect(p7.journeyLeftOut).toBe(1);
    expect(pairOf(d, '2026-11-04', '2026-11-14').figure).toMatchObject({
      journeyMinutes: null,
      price: { pricePence: 40_000 },
    });
    // every figure-eligible price of 5 Nov, 11 nights is over the limit: no figure, its buckets kept
    const p8 = pairOf(d, '2026-11-05', '2026-11-16');
    expect(p8.figure).toBeNull();
    expect(p8.journeyLeftOut).toBe(1);
    expect(p8.buckets).toEqual(pairOf(await datesOf(x, def.id), '2026-11-05', '2026-11-16').buckets);
    const none = await datesOf(x, def.id);
    expect(none.pairs.every((p) => p.journeyLeftOut === 0)).toBe(true);
    expect(pairOf(none, '2026-11-05', '2026-11-16').figure?.journeyMinutes).toBe(1000);
  });
});

describe('every count is of distinct cells (spec §10)', () => {
  const C = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
  const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');

  it('two completed children on one cell give onDemand 1; two partially-verified itineraries in one cell give 1 and no figure', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ window: SMALL_WINDOW, constraints: { checkedBagRequired: true } }),
    );
    const s = seeder(x.ports);
    for (const name of ['K1', 'K2']) {
      s.execution(name, { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1), child: C });
      s.cells(name, [C], { selected: [{ cell: C, reason: 'always_include' }] });
      s.verified(name, C, [{ hash: `h${name}`, pricePence: 60_000, fetchedAt: at(-1) }]);
    }
    s.execution('E1', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('E1', [C2], { selected: [{ cell: C2, reason: 'top_n' }] });
    s.verified('E1', C2, [
      { hash: 'hP1', pricePence: 40_000, fetchedAt: at(-2), baggage: null },
      { hash: 'hP2', pricePence: 41_000, fetchedAt: at(-2), baggage: null },
    ]);
    // why: executions are ordered by creation, so the parent made last is the latest
    const d = await datesOf(x, def.id);
    expect(pairOf(d, '2026-11-02', '2026-11-12').onDemand).toBe(1);
    const p = pairOf(d, '2026-11-03', '2026-11-13');
    expect([p.partiallyVerified, p.figure]).toEqual([1, null]);
  });

  it('an unconfirmed offer is never a figure and counts once; not reached counts not_run and skipped:budget, never error', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ window: SMALL_WINDOW }));
    const s = seeder(x.ports);
    const D1 = cell('LHR', 'JFK', '2026-11-05', '2026-11-15');
    const D2 = cell('LHR', 'JFK', '2026-11-05', '2026-11-16');
    const D3 = cell('LHR', 'JFK', '2026-11-05', '2026-11-17');
    s.execution('E1', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('E1', [C, D1, D2, D3], {
      selected: [C, D1, D2, D3].map((c) => ({ cell: c, reason: 'top_n' as const })),
    });
    s.verified('E1', C, [
      { hash: 'hU1', pricePence: 38_000, fetchedAt: at(-2), confirmed: false },
      { hash: 'hU2', pricePence: 39_000, fetchedAt: at(-2), confirmed: false },
    ]);
    const exec = s.id('E1');
    x.ports.repos.cells.setOutcome(exec, D2, 'verification', 'fixture', {
      status: 'skipped',
      reason: 'budget',
    });
    x.ports.repos.cells.setOutcome(exec, D3, 'verification', 'fixture', {
      status: 'error',
      reason: 'upstream',
    });
    const d = await datesOf(x, def.id);
    const u = pairOf(d, '2026-11-02', '2026-11-12');
    expect([u.unconfirmed, u.itinerarySearched, u.figure]).toEqual([1, 1, null]);
    const notReached = [D1, D2, D3].map((c) => pairOf(d, c.departureDate, c.returnDate).notReached);
    expect(notReached).toEqual([1, 1, 0]);
    expect(d.pairs.reduce((n, p) => n + p.notReached, 0)).toBe(2);
    // one airport pair in scope: every count within 0..1 (and the body parsed above)
    for (const p of d.pairs)
      for (const v of [
        p.selected,
        p.itinerarySearched,
        p.notReached,
        p.onDemand,
        p.unconfirmed,
        p.partiallyVerified,
      ])
        expect(v).toBeLessThanOrEqual(1);
  });
});

describe('provenance by deep equality (spec §10, §11)', () => {
  it("every figure and cheaper-cached provenance is the stored row's, as the row carries it; differing ones are distinct entries", async () => {
    const { x, def } = await world();
    const res = await x.request(`/api/definitions/${def.id}/date-pairs`);
    const body = apiContract.datePairsResponseSchema.parse(await res.json());
    const d = await datesOf(x, def.id);
    const rows = await resultsOf(x, def.id, '?basis=calendar');
    const verifiedRows = await resultsOf(x, def.id, '?basis=verified');
    const stored = [...rows.rows, ...verifiedRows.rows];
    const figures = d.pairs.flatMap((p) => (p.figure === null ? [] : [p.figure]));
    expect(figures.length).toBeGreaterThan(5);
    for (const f of figures) {
      const row = stored.find(
        (r) =>
          r.pricePence === f.price.pricePence &&
          r.cell.origin === f.origin &&
          r.cell.destination === f.destination,
      );
      expect(f.price.provenance).toEqual(row?.provenance);
      if (f.cheaperCached !== null) {
        const c = f.cheaperCached;
        const cRow = stored.find((r) => r.pricePence === c.pricePence && r.cell.origin === c.origin);
        expect(c.provenance).toEqual(cRow?.provenance);
      }
    }
    // the calendar and verified provenances differ in fields, so the table holds each once
    const distinct = new Set(figures.map((f) => JSON.stringify(f.price.provenance)));
    expect(body.provenances.length).toBeGreaterThanOrEqual(distinct.size);
    expect(new Set(body.provenances.map((p) => JSON.stringify(p))).size).toBe(body.provenances.length);
  });
});

describe('the board and the detail agree (prov-014)', () => {
  it("for each date pair with a figure, /results scoped to it returns the board's figure and a row with its price", async () => {
    const { x, def } = await world();
    for (const q of ['', 'origins=LHR', 'maxJourneyMinutes=600']) {
      const d = await datesOf(x, def.id, q === '' ? '' : `?${q}`);
      const withFigure = d.pairs.filter(
        (p): p is DatePair & { figure: NonNullable<DatePair['figure']> } => p.figure !== null,
      );
      expect(withFigure.length).toBeGreaterThan(3);
      for (const p of withFigure) {
        const r = await resultsOf(
          x,
          def.id,
          `?departureDate=${p.departureDate}&returnDate=${p.returnDate}&basis=${p.figure.basis}${q === '' ? '' : `&${q}`}`,
        );
        const { airportPair: _a, ...board } = p.figure;
        expect(r.datePairFigure).toEqual(board);
        // the figure's price is a row of its airport pair, or one of that row's other offers
        expect(
          r.rows.some(
            (row) =>
              row.cell.origin === p.figure.origin &&
              row.cell.destination === p.figure.destination &&
              [row, ...row.otherOffers].some(
                (o) =>
                  o.pricePence === p.figure.price.pricePence &&
                  JSON.stringify(o.provenance) === JSON.stringify(p.figure.price.provenance),
              ),
          ),
          `${p.departureDate} ${p.returnDate} ${q}`,
        ).toBe(true);
      }
    }
  });
});

describe('refusals and edges (spec §10)', () => {
  it.each(SCOPE_422)('422 for $name', async ({ query, code }) => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ window: SMALL_WINDOW, destinations: [JFK, EWR] }),
    );
    const res = await x.request(`/api/definitions/${def.id}/date-pairs?${query}`);
    expect(res.status).toBe(422);
    const e = await errorOf(res);
    expect(e.code).toBe(code);
    expect(e.details).toHaveProperty('fields');
  });

  it('422 too_many_cells above 50,000 cells in scope, whatever MAX_CELLS_PER_DEFINITION says; an airport filter brings it under', async () => {
    const x = await harness({ MAX_CELLS_PER_DEFINITION: '200000' });
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        ...FOUR,
        window: { kind: 'relative', startOffsetDays: 7, lengthDays: 400 },
        minNights: 0,
        maxNights: 90,
      }),
    );
    const res = await x.request(`/api/definitions/${def.id}/date-pairs`);
    expect(res.status).toBe(422);
    const e = await errorOf(res);
    expect(e.code).toBe('too_many_cells');
    expect(e.details).toMatchObject({ cells: 145_600, bound: 50_000 });
    const one = await datesOf(x, def.id, '?origins=LHR&destinations=JFK');
    expect([one.scope.cells, one.pairs.length]).toEqual([36_400, 36_400]);
  });

  it('a draft definition answers 200 with no airport pairs; a window that has passed answers zero-length columns', async () => {
    const x = await harness();
    const draft = x.ports.repos.definitions.create(
      exampleDefinitionInput({ window: SMALL_WINDOW, origins: [], enabled: false }),
    );
    const d = await datesOf(x, draft.id);
    expect([d.scope.airportPairs, d.scope.cells, d.pairs.some((p) => p.figure !== null)]).toEqual([
      0,
      0,
      false,
    ]);
    const past = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        window: { kind: 'absolute', from: SMALL_WINDOW.from, to: SMALL_WINDOW.to },
        enabled: false,
      }),
    );
    x.clock.set(at(24 * 60)); // 60 days later: the window has passed
    const gone = await datesOf(x, past.id);
    expect([gone.pairs.length, gone.scope.cells]).toEqual([0, 0]);
  });

  it('children before any parent: executionId null, every cell not searched, onDemand and figures as the children give them', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ window: SMALL_WINDOW }));
    const s = seeder(x.ports);
    const C = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    s.execution('K1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1), child: C });
    s.cells('K1', [C], { selected: [{ cell: C, reason: 'always_include' }] });
    s.verified('K1', C, [{ hash: 'hK', pricePence: 60_000, fetchedAt: at(-1) }]);
    const d = await datesOf(x, def.id);
    expect(d.executionId).toBeNull();
    expect(d.summary.buckets.not_run).toBe(d.summary.total);
    expect(d.summary.onDemand).toBe(1);
    expect(pairOf(d, '2026-11-02', '2026-11-12').figure).toMatchObject({
      price: { pricePence: 60_000 },
      fromEarlierSearch: false,
    });
  });

  it('gzip when the request accepts it, plain JSON otherwise; /results is never compressed', async () => {
    const { x, def } = await world();
    const zipped = await x.request(`/api/definitions/${def.id}/date-pairs`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(zipped.headers.get('content-encoding')).toBe('gzip');
    const json = JSON.parse(gunzipSync(Buffer.from(await zipped.arrayBuffer())).toString('utf8'));
    const plain = await x.request(`/api/definitions/${def.id}/date-pairs`);
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(json).toEqual(await plain.json());
    const results = await x.request(`/api/definitions/${def.id}/results`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(results.headers.get('content-encoding')).toBeNull();
  });

  it('answers through the route table (auth required)', async () => {
    const { x, def } = await world();
    expect((await x.request(`/api/definitions/${def.id}/date-pairs`, { auth: false })).status).toBe(401);
    expect(DATE_PAIRS).toBe('/api/definitions/:id/date-pairs');
  });
});

// The calendar route's rules, ported before WP19 Task 19.8 deletes it: each `it` of views.test.ts's "calendar
// selection rules", "an assumed calendar bound reaches every price as such" and "superseded calendar prices on the
// views", with the same seed and the same expectation on the figure.
describe('ported: calendar selection rules (plan decisions 53, 54; review prov-009)', () => {
  const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
  async function bare(destinations = ['JFK']) {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ destinations: destinations.map(asIata), window: SMALL_WINDOW }),
    );
    return { x, s, def };
  }
  const day = (d: DecodedDatePairs, c: CellKey) => pairOf(d, c.departureDate, c.returnDate);

  it('with destinations=JFK, buckets, selection and figures count that destination only; 422 for another', async () => {
    const { x, s, def } = await bare(['JFK', 'EWR']);
    const J = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    const E = cell('LHR', 'EWR', '2026-11-02', '2026-11-12');
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [J, E], { selected: [J, E].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.tile('E1', J, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1) });
    s.tile('E1', E, { status: 'priced', pricePence: 35_000, fetchedAt: at(-1), tileIndex: 1 });
    s.verified('E1', J, [{ hash: 'hJ', pricePence: 60_000, fetchedAt: at(-1) }]);
    s.verified('E1', E, [{ hash: 'hE', pricePence: 50_000, fetchedAt: at(-1) }]);
    const both = day(await datesOf(x, def.id), J);
    expect([both.figure?.price.pricePence, both.selected, both.buckets.priced]).toEqual([50_000, 2, 2]);
    const jfk = day(await datesOf(x, def.id, '?destinations=JFK'), J);
    expect([jfk.figure?.price.pricePence, jfk.figure?.cheaperCached?.pricePence]).toEqual([60_000, 45_000]);
    expect([jfk.selected, jfk.buckets.priced]).toEqual([1, 1]);
    const other = await x.request(`/api/definitions/${def.id}/date-pairs?destinations=LGA`);
    expect(other.status).toBe(422);
    expect((await errorOf(other)).code).toBe('unknown_airport');
  });

  it('prefers a price the newest search returned over a cheaper one it did not', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [{ hash: 'hOld', pricePence: 55_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E2', C1, [{ hash: 'hNew', pricePence: 65_000, fetchedAt: at(-1) }]);
    expect(day(await datesOf(x, def.id), C1).figure).toMatchObject({
      price: { pricePence: 65_000 },
      notSeenInLatest: null,
    });
  });

  it('prefers a fresh price over a cheaper stale one on the same day (the board ranks each stay on its own)', async () => {
    const { x, s, def } = await bare();
    const C1b = cell('LHR', 'JFK', '2026-11-02', '2026-11-13');
    s.execution('E1', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-1) });
    s.cells('E1', [C1, C1b], { selected: [C1, C1b].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.verified('E1', C1, [{ hash: 'hStale', pricePence: 50_000, fetchedAt: at(-250) }]); // 250 h > 192
    s.verified('E1', C1b, [{ hash: 'hFresh', pricePence: 58_000, fetchedAt: at(-1) }]);
    const d = await datesOf(x, def.id);
    expect(day(d, C1b).figure).toMatchObject({ price: { pricePence: 58_000, stale: false } });
    expect(day(d, C1).figure).toMatchObject({ price: { pricePence: 50_000, stale: true } });
  });

  it('a fresh offer from another seller is shown before a cheaper stale offer of the same itinerary (decision 58)', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-300), finishedAt: at(-1) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [
      { hash: 'hS', pricePence: 40_000, fetchedAt: at(-250), seller: 'Stale Air' }, // 250 h > 192
      { hash: 'hS', pricePence: 42_000, fetchedAt: at(-1), seller: 'Fresh Travel' },
    ]);
    expect(day(await datesOf(x, def.id), C1).figure).toMatchObject({
      price: { pricePence: 42_000, stale: false },
    });
  });

  it('a confirmed £400 offer is the figure even when the same itinerary has an unconfirmed £380 offer', async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [
      { hash: 'hD', pricePence: 40_000, fetchedAt: at(-1), seller: 'Confirmed Air' },
      { hash: 'hD', pricePence: 38_000, fetchedAt: at(-1), seller: 'Unconfirmed Travel', confirmed: false },
    ]);
    const p = day(await datesOf(x, def.id), C1);
    expect(p.figure).toMatchObject({ price: { pricePence: 40_000 } });
    expect(p.unconfirmed).toBe(0);
  });

  it("unconfirmed follows the latest run: an older run's confirmed price does not hide it", async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [{ hash: 'hC', pricePence: 60_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E2', C1, [{ hash: 'hU', pricePence: 55_000, fetchedAt: at(-1), confirmed: false }]);
    expect(day(await datesOf(x, def.id), C1).unconfirmed).toBe(1);
  });
});

describe('ported: an assumed calendar bound reaches every price as such (N4, pie-007)', () => {
  const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
  async function priced() {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ window: SMALL_WINDOW }));
    s.execution('E1', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('E1', [C1]);
    s.tile('E1', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-2) });
    const provenance = async () =>
      pairOf(await datesOf(x, def.id), '2026-11-02', '2026-11-12').figure?.price.provenance;
    return { x, provenance };
  }

  it('a calendar price from a provider whose bound is assumed carries maxAgeAssumed; a stated bound does not', async () => {
    const { x, provenance } = await priced();
    expect(await provenance()).not.toHaveProperty('maxAgeAssumed');
    x.ports.providers.splice(
      0,
      x.ports.providers.length,
      ...x.ports.providers.map((p) =>
        p.discovery === undefined
          ? p
          : { ...p, discovery: { ...p.discovery, info: { ...p.discovery.info, maxAgeAssumed: true } } },
      ),
    );
    expect(await provenance()).toMatchObject({ maxAgeHours: 24, maxAgeAssumed: true });
  });

  it('a stored grid-cell price is assumed from its own row, with camoufox off or in list mode (fix round 1, PA I2)', async () => {
    const { x, provenance } = await priced();
    x.ports.db.raw
      .prepare(
        "UPDATE calendar_prices SET provider_id = 'camoufox', source_kind = 'scraped-self', return_date_source = 'grid-cell', vendor_price_mark = 'none'",
      )
      .run();
    expect(x.ports.providers.some((p) => p.id === 'camoufox')).toBe(false);
    expect(await provenance()).toMatchObject({
      providerId: 'camoufox',
      maxAgeHours: 24,
      maxAgeAssumed: true,
    });
  });

  it('a stored SearchApi calendar price is assumed from its own row, with SearchApi turned off (fix round 2)', async () => {
    const { x, provenance } = await priced();
    x.ports.db.raw
      .prepare(
        "UPDATE calendar_prices SET provider_id = 'searchapi', source_kind = 'scraped-aggregate', return_date_source = 'vendor', vendor_price_mark = 'none'",
      )
      .run();
    expect(x.ports.providers.some((p) => p.id === 'searchapi')).toBe(false);
    expect(await provenance()).toMatchObject({
      providerId: 'searchapi',
      maxAgeHours: 24,
      maxAgeAssumed: true,
    });
  });
});

describe('ported: superseded calendar prices on the views (decision 54)', () => {
  it('a date pair marks a price a later search found empty, and prefers a current one', async () => {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ window: SMALL_WINDOW, destinations: [JFK, EWR] }),
    );
    const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    // why: the Calendar's "same day, another stay" becomes the same date pair on another airport pair
    const C1b = cell('LHR', 'EWR', '2026-11-02', '2026-11-12');
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1, C1b]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-29) });
    s.tile('Eold', C1b, { status: 'priced', pricePence: 50_000, fetchedAt: at(-29), tileIndex: 1 });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('Enew', [C1, C1b]);
    s.tile('Enew', C1, { status: 'empty', fetchedAt: at(-2) });
    s.tile('Enew', C1b, { status: 'priced', pricePence: 52_000, fetchedAt: at(-2), tileIndex: 1 });
    const both = pairOf(await datesOf(x, def.id), '2026-11-02', '2026-11-12');
    expect(both.figure).toMatchObject({ price: { pricePence: 52_000 }, superseded: false });
    const jfk = pairOf(await datesOf(x, def.id, '?destinations=JFK'), '2026-11-02', '2026-11-12');
    expect(jfk.figure).toMatchObject({ price: { pricePence: 30_000 }, superseded: true });
  });
});

// Ported from the duration-analysis route's "over one set of executions" tests (review prov-012) before the route went
// (WP19 Task 19.8): the same seeds, read per date pair. A stay length's minimum is gone with the Duration view
// (revision 48), so each rule is stated on the date pair that held the minimum.
describe('ported: one set of executions per read (review prov-012)', () => {
  const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
  const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
  async function bare() {
    const x = await harness();
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ origins: [LHR], destinations: [JFK], window: SMALL_WINDOW }),
    );
    return { x, s, def };
  }

  it('a cell the latest run reused counts as priced and reused, and its reused price is the figure (decision 58)', async () => {
    const { x, s, def } = await bare();
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 41_000, fetchedAt: at(-29) });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('Enew', [C1, C2]);
    s.reuse('Enew', 'Eold', [C1], at(-100));
    s.tile('Enew', C2, { status: 'priced', pricePence: 52_000, fetchedAt: at(-1), tileIndex: 1 });
    const d = await datesOf(x, def.id);
    const reused = pairOf(d, C1.departureDate, C1.returnDate);
    expect(reused.buckets).toMatchObject({ priced: 1, reused: 1, not_run: 0 });
    expect(reused.figure?.price.pricePence).toBe(41_000);
    expect(pairOf(d, C2.departureDate, C2.returnDate).figure?.price.pricePence).toBe(52_000);
    expect(d.summary.reused).toBe(1);
  });

  it("an older run's price on a cell the newer run did not search stays a figure from an earlier search, its cell not searched (revision 50)", async () => {
    const { x, s, def } = await bare();
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-29) });
    s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C2], { selected: [{ cell: C2, reason: 'top_n' }] });
    s.verified('E2', C2, [{ hash: 'hW', pricePence: 61_000, fetchedAt: at(-1) }]);
    const d = await datesOf(x, def.id);
    const old = pairOf(d, C1.departureDate, C1.returnDate);
    // why: revision 50 (settled by the orchestrator): the Duration view dropped such a price; the Dates view keeps it,
    // says it comes from an earlier search, and counts its cell not searched by the latest run
    expect(old.buckets.not_run).toBe(1);
    expect([old.selected, old.itinerarySearched]).toEqual([0, 0]);
    expect(old.figure).toMatchObject({ basis: 'verified', fromEarlierSearch: true });
    const fresh = pairOf(d, C2.departureDate, C2.returnDate);
    expect(fresh.figure).toMatchObject({ price: { pricePence: 61_000 }, fromEarlierSearch: false });
    expect([fresh.selected, fresh.itinerarySearched]).toEqual([1, 1]);
  });
});
