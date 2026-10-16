import {
  asIata,
  asIsoDate,
  asIsoDateTime,
  cellKeyString,
  evaluateConstraints,
  type ItinerarySearchResult,
  isPartialExpansion,
  type RawSegment,
  unverifiedNames,
  verdictClass,
} from '@gmt/core';
import type { FixtureRule } from '@gmt/providers/fixture';
import { describe, expect, it, vi } from 'vitest';
import { pricedReason } from '../src/stages/verification.js';
import {
  createHarness,
  FIXTURE_RULES,
  type Harness,
  type HarnessOptions,
  itineraryRule,
  JFK,
  LGW,
  LHR,
  verificationOf,
  withVerification,
} from './support/harness.js';
import { mapOffers, mapResult } from './support/wrappers.js';

const def = (h: Harness, patch = {}) => h.createDefinition({ providers: withVerification(), ...patch });
const searched = (h: Harness, id: string) =>
  h.outcomes(id, { stage: 'verification' }).filter((o) => o.reason !== 'not_selected');
interface ObsRow {
  k: string;
  f: string;
  m: number | null;
  pos: string;
  sf: string;
  sc: string | null;
  b: string | null;
}
const observations = (h: Harness, id: string) =>
  h.db.raw
    .prepare<[string], ObsRow>(
      'SELECT source_kind AS k, fetched_at AS f, max_age_hours AS m, point_of_sale AS pos, supplied_fields_json AS sf, segment_cabins_json AS sc, booking_json AS b FROM price_observations WHERE execution_id = ?',
    )
    .all(id);

describe('verification stage (spec §8.1 "verification", §6.7, §7 atomic units)', () => {
  it('persists selection with verification seeding: selected cells searched, the rest skipped:not_selected', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(h.orch(), def(h).id);
    expect(e.status).toBe('completed');
    const selected = h.repos.cells.selected(e.id);
    expect(selected).toHaveLength(2); // maxCells
    const chosen = new Set(selected.map((x) => cellKeyString(x.cell)));
    const v = h.outcomes(e.id, { stage: 'verification' });
    expect(v).toHaveLength(28); // every cell × the one verification provider
    const picked = v.filter((o) => chosen.has(cellKeyString(o)));
    const rest = v.filter((o) => !chosen.has(cellKeyString(o)));
    expect(picked).toHaveLength(2);
    expect(picked.every((o) => o.status === 'priced')).toBe(true);
    expect(rest).toHaveLength(26);
    expect(rest.every((o) => o.status === 'skipped' && o.reason === 'not_selected')).toBe(true);
  });

  it('a priced cell stores best_observation_id = the cheapest observation written for it (verdict-independent), and min_pence matches', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(
      h.orch(),
      def(h, { verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 2, bookingLinks: true } })
        .id,
    );
    const rows = h.db.raw
      .prepare<[string], { best: number | null; bestPence: number; minPence: number; outcomeMin: number }>(
        `SELECT sc.best_observation_id AS best,
                (SELECT price_pence FROM price_observations WHERE id = sc.best_observation_id) AS bestPence,
                (SELECT min(po.price_pence) FROM price_observations po
                   JOIN fare_offers fo ON fo.id = po.offer_id JOIN itineraries i ON i.hash = fo.itinerary_hash
                  WHERE po.execution_id = sc.execution_id AND i.origin = sc.origin AND i.destination = sc.destination
                    AND i.departure_date = sc.departure_date AND i.return_date = sc.return_date) AS minPence,
                sc.verification_min_pence AS outcomeMin
           FROM search_cells sc WHERE sc.execution_id = ? AND sc.verification_status = 'priced'`,
      )
      .all(e.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.best).not.toBeNull();
      expect(r.bestPence).toBe(r.minPence);
      expect(r.outcomeMin).toBe(r.minPence);
    }
  });

  it('observations carry full provenance, the provider suppliedFields, and no booking for the fixture', async () => {
    const h = createHarness();
    const e = await h.runToCompletion(h.orch(), def(h).id);
    const obs = observations(h, e.id);
    expect(obs).toHaveLength(2);
    const info = verificationOf(h.fixture).info;
    for (const o of obs) {
      expect(o.k).toBe('synthetic');
      expect(o.f).toBe(h.clock.now());
      expect(o.m).toBe(info.maxAgeHours === 'unknown' ? null : info.maxAgeHours);
      expect(o.pos).toBe('unknown');
      expect(JSON.parse(o.sf)).toEqual([...h.fixture.suppliedFields]);
      expect(o.b).toBe('{"kind":"none"}'); // the fixture's allowlist is empty, so no booking is ever stored
    }
  });

  it('selection runs once: an interrupt during verification and a resume keep the same selection', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    await h.fixtureScenario([itineraryRule(FIXTURE_RULES.hold, 1)]);
    const d = def(h);
    const first = h.orch();
    const r = await first.start(d.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    const before = h.repos.cells
      .selected(r.executionId)
      .map((x) => cellKeyString(x.cell))
      .sort();
    expect(before).toHaveLength(2);
    await first.shutdown();
    expect((await h.waitForSettled(r.executionId)).status).toBe('interrupted');
    expect(await h.orch().resume(r.executionId, { manual: false })).toEqual({
      ok: true,
      executionId: r.executionId,
    });
    expect((await h.waitForSettled(r.executionId)).status).toBe('completed');
    expect(
      h.repos.cells
        .selected(r.executionId)
        .map((x) => cellKeyString(x.cell))
        .sort(),
    ).toEqual(before);
    expect(h.logs.filter((l) => l.msg === 'verification: selection persisted')).toHaveLength(1);
  });

  it('never selects a cell whose departure date has arrived (spec §8.1 departed, ssr-05)', async () => {
    const h = createHarness({ fixtureConcurrency: 1 });
    const d = def(h, {
      origins: [LHR, LGW],
      destinations: [JFK],
      verification: {
        maxCells: 6,
        topN: 6,
        alwaysInclude: [
          {
            origin: LHR,
            destination: JFK,
            departureDate: asIsoDate('2026-11-02'),
            returnDate: asIsoDate('2026-11-09'),
          },
        ],
        expandTop: 1,
        bookingLinks: true,
      },
    });
    const first = h.orch();
    h.onTileCommit((n) => {
      if (n === 1) void first.shutdown();
    });
    const r = await first.start(d.id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await h.waitForSettled(r.executionId);
    h.clearHooks();
    h.clock.set(asIsoDateTime('2026-11-03T10:00:00.000Z')); // today (London) = 2026-11-03
    expect(await h.orch().resume(r.executionId, { manual: false })).toEqual({
      ok: true,
      executionId: r.executionId,
    });
    await h.waitForSettled(r.executionId);
    const selected = h.repos.cells.selected(r.executionId);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((s) => s.cell.departureDate > '2026-11-03')).toBe(true);
    expect(
      h.requests.filter((q) => q.kind === 'itinerary' && (q.params.departureDate ?? '') <= '2026-11-03'),
    ).toHaveLength(0);
    const alwaysInclude = h
      .outcomes(r.executionId, { stage: 'verification' })
      .find((o) => o.departureDate === '2026-11-02' && o.returnDate === '2026-11-09' && o.origin === LHR);
    expect(alwaysInclude).toMatchObject({ status: 'skipped', reason: 'departed' });
  });
});

describe('offer normalisation (spec §5.6, §9 item 4 "fx-unavailable, currency-unsupported, unknown-airport-tz, offers-dropped")', () => {
  const two = { verification: { maxCells: 2, topN: 2, alwaysInclude: [], expandTop: 2, bookingLinks: true } };
  const run = async (opts: HarnessOptions, rules: FixtureRule[] = []) => {
    const h = createHarness(opts);
    await h.fixtureScenario(rules);
    return { h, e: await h.runToCompletion(h.orch(), def(h, two).id) };
  };

  it('pricedReason is the closed set of decisions 19 and 45', () => {
    expect([
      pricedReason(false, 0),
      pricedReason(true, 0),
      pricedReason(false, 2),
      pricedReason(true, 1),
      pricedReason(false, 0, true),
      pricedReason(true, 3, true),
    ]).toEqual([
      null,
      'partial-expansion',
      'offers-dropped:2',
      'partial-expansion;offers-dropped:1',
      'price-unconfirmed',
      'partial-expansion;price-unconfirmed;offers-dropped:3',
    ]);
  });

  it.each([
    ['a negative amount', -1],
    ['an amount whose conversion overflows', Number.MAX_SAFE_INTEGER],
  ])(
    '%s drops only its offer (parse), beside a good one; the run is never paused (decision 45)',
    async (_n, amountMinor) => {
      // why: a USD amount converts through toGbp, whose overflow guard is the RangeError a real vendor amount can reach
      const h = createHarness({
        transformFixture: (p) =>
          mapOffers(p, (o, i) => (i === 0 ? { ...o, amountMinor, currency: 'USD' } : o)),
      });
      // why: 2 GBP per USD, so the largest safe amount converts past Number.MAX_SAFE_INTEGER
      h.repos.fx.upsert([
        { date: h.clock.todayLondon(), currency: 'USD', rateNano: 2_000_000_000, source: 'ecb' },
      ]);
      const e = await h.runToCompletion(h.orch(), def(h, two).id);
      expect(e.status).toBe('completed');
      const v = searched(h, e.id);
      expect(v).toHaveLength(2);
      expect(v.every((o) => o.status === 'priced' && o.reason === 'offers-dropped:1')).toBe(true);
    },
  );

  it('one bad offer among several is dropped and counted: priced with offers-dropped:1 (expandTop 2: the fixture answers two offers)', async () => {
    const { h, e } = await run({
      transformFixture: (p) => mapOffers(p, (o, i) => (i === 0 ? { ...o, currency: 'ARS' } : o)),
    });
    const priced = searched(h, e.id);
    expect(priced).toHaveLength(2);
    expect(priced.every((o) => o.status === 'priced' && o.reason === 'offers-dropped:1')).toBe(true);
  });

  it.each([
    ['currency-unsupported', { currency: 'ARS' }],
    ['fx-unavailable', { currency: 'USD' }],
  ] as const)(
    'every offer failing with %s → error with that reason, no observation written',
    async (reason, patch) => {
      const { h, e } = await run({ transformFixture: (p) => mapOffers(p, (o) => ({ ...o, ...patch })) });
      expect(e.status).toBe('completed');
      const v = searched(h, e.id);
      expect(v).toHaveLength(2);
      expect(v.every((o) => o.status === 'error' && o.reason === reason)).toBe(true);
      expect(h.count('price_observations', e.id)).toBe(0);
    },
  );

  it.each([
    ['unknown-airport-tz', (s: RawSegment): RawSegment => ({ ...s, to: asIata('AAA') })],
    ['unmappable-carrier', (s: RawSegment): RawSegment => ({ ...s, marketingCarrier: '!!' })],
  ] as const)('every offer failing with %s → error with that reason', async (reason, seg) => {
    const { h, e } = await run({
      transformFixture: (p) =>
        mapOffers(p, (o) => ({ ...o, outbound: o.outbound.map((s, i) => (i === 0 ? seg(s) : s)) })),
    });
    const v = searched(h, e.id);
    expect(v).toHaveLength(2);
    expect(v.every((o) => o.status === 'error' && o.reason === reason)).toBe(true);
    expect(h.count('price_observations', e.id)).toBe(0);
  });

  it('a partial expansion is noted on the priced outcome (WP4 rule `partial`)', async () => {
    const { h, e } = await run({}, [itineraryRule(FIXTURE_RULES.partial)]);
    const priced = searched(h, e.id);
    expect(priced).toHaveLength(2);
    expect(priced.every((o) => o.status === 'priced' && isPartialExpansion(o.reason))).toBe(true);
  });

  it('a partial expansion that also drops an offer stores partial-expansion;offers-dropped:1; the roll-up keeps partial-expansion', async () => {
    // why: the fixture's `partial` rule removes the failed option, so the partial result is shaped here to keep two offers
    const partialWithBadFirst = (r: ItinerarySearchResult): ItinerarySearchResult => ({
      ...r,
      partial: true,
      failedExpansions: 1,
      offers: r.offers.map((o, i) => (i === 0 ? { ...o, currency: 'ARS' } : o)),
    });
    const { h, e } = await run({ transformFixture: (p) => mapResult(p, partialWithBadFirst) });
    const priced = searched(h, e.id);
    expect(priced.map((o) => o.reason)).toEqual([
      'partial-expansion;offers-dropped:1',
      'partial-expansion;offers-dropped:1',
    ]);
    for (const o of priced)
      expect(h.repos.cells.rollUps(e.id).get(cellKeyString(o))?.verification).toMatchObject({
        status: 'priced',
        reason: 'partial-expansion',
      });
  });

  it('empty is written only for an empty answer; a result claiming offers it does not carry is an upstream error (prov-wp07-005)', async () => {
    const empty = await run({}, [itineraryRule(FIXTURE_RULES.empty)]);
    expect(searched(empty.h, empty.e.id).every((o) => o.status === 'empty')).toBe(true);
    const { h, e } = await run({
      transformFixture: (p) =>
        mapResult(p, (r) => ({ ...r, coverage: 'priced', offers: [], partial: true, failedExpansions: 1 })),
    });
    const v = searched(h, e.id);
    expect(v).toHaveLength(2);
    expect(
      v.every(
        (o) =>
          o.status === 'error' &&
          o.reason === 'upstream' &&
          (o.lastError ?? '').includes('returned no offer'),
      ),
    ).toBe(true);
  });

  it('an offer no seller listing confirmed (RawOffer.verified false, decision 27) is written without price and cabin evidence', async () => {
    const { h, e } = await run({ transformFixture: (p) => mapOffers(p, (o) => ({ ...o, verified: false })) });
    const obs = observations(h, e.id);
    expect(obs.length).toBeGreaterThan(0);
    for (const o of obs) {
      const supplied: unknown = JSON.parse(o.sf);
      expect(
        Array.isArray(supplied) && !supplied.includes('price') && !supplied.includes('segmentCabins'),
      ).toBe(true);
      expect(o.sc).toBeNull();
    }
    // why: decision 37 — what WP8 and WP11 read back (this repository, core's evaluateConstraints over the stored supplied
    // fields) shows the price as not confirmed, with no constraint set, so the row can never class as verified
    const rows = h.repos.itineraries.writtenBy(e.id);
    expect(rows).toHaveLength(obs.length);
    for (const row of rows) {
      const v = evaluateConstraints(row.itinerary, row, {}, 'economy', row.suppliedFields);
      expect(v.priceConfirmed).toBe('unverified');
      expect(verdictClass(v)).toBe('partially-verified');
      expect(unverifiedNames(v)).toContain('priceConfirmed');
    }
    // why: decision 45 — a cell with no confirmed price is priced but has no itinerary-search price in its roll-up
    const cells = searched(h, e.id);
    expect(cells).toHaveLength(2);
    expect(cells.every((o) => o.status === 'priced' && o.reason === 'price-unconfirmed')).toBe(true);
    for (const o of cells)
      expect(h.repos.cells.rollUps(e.id).get(cellKeyString(o))?.verification).toEqual({
        status: 'priced',
        reason: 'price-unconfirmed',
        minPence: null,
      });
  });

  it('a cheaper unconfirmed offer never becomes the cell price: the cheapest confirmed one does (decision 45)', async () => {
    const { h, e } = await run({
      transformFixture: (p) =>
        mapOffers(p, (o, i) => (i === 0 ? { ...o, verified: false, amountMinor: 100 } : o)),
    });
    const v = searched(h, e.id);
    expect(v).toHaveLength(2);
    for (const o of v) {
      const confirmed = h.repos.itineraries
        .writtenBy(e.id)
        .filter((r) => cellKeyString(r.cell) === cellKeyString(o) && r.suppliedFields.includes('price'));
      expect(confirmed.length).toBeGreaterThan(0);
      const min = Math.min(...confirmed.map((r) => r.pricePence));
      expect(o).toMatchObject({ status: 'priced', reason: null, minPence: min });
      expect(h.repos.cells.rollUps(e.id).get(cellKeyString(o))?.verification.minPence).toBe(min);
      const best = h.repos.itineraries.bestObservationForCell(e.id, o);
      expect(confirmed.find((r) => r.id === best)?.pricePence).toBe(min);
    }
  });

  it('a chain stopped by cancel resolves with the offers it already paid for, and they are written (decisions 25, 27)', async () => {
    const h = createHarness({
      fixtureConcurrency: 1,
      transformFixture: (p) => {
        const v = verificationOf(p);
        return {
          ...p,
          healthcheck: (c) => p.healthcheck(c),
          verification: {
            info: v.info,
            estimate: (q) => v.estimate(q),
            search: async (q, c) => {
              const step2 = await v.search(q, c);
              // why: a SearchApi chain waiting on step 3 when the run is cancelled returns what step 2 paid for
              await new Promise<void>((resolve) =>
                c.signal.addEventListener('abort', () => resolve(), { once: true }),
              );
              return {
                ...step2,
                partial: true,
                failedExpansions: 1,
                offers: step2.offers.map((o) => ({ ...o, verified: false })),
              };
            },
          },
        };
      },
    });
    const orch = h.orch();
    const r = await orch.start(def(h).id, { trigger: 'manual' });
    if (!r.ok) throw new Error(r.message);
    await vi.waitFor(() => expect(h.requests.some((q) => q.kind === 'itinerary')).toBe(true));
    expect(await orch.cancel(r.executionId)).toBe(true);
    const e = await h.waitForSettled(r.executionId);
    expect(e.status).toBe('cancelled');
    const v = searched(h, e.id);
    // why: step-2 offers are unconfirmed (decision 27), so the cell is also price-unconfirmed (decision 45)
    expect(v.filter((o) => o.status === 'priced')).toEqual([
      expect.objectContaining({ reason: 'partial-expansion;price-unconfirmed' }),
    ]);
    expect(v.filter((o) => o.status === 'not_run')).toHaveLength(1);
    expect(h.count('price_observations', e.id)).toBeGreaterThan(0);
  });
});

describe('route price history (spec §7 rev 10)', () => {
  it('upserts only the points the vendor gave in GBP, cabin unknown; other currencies are dropped and counted (prov-wp07-007)', async () => {
    const routeHistory = [
      { date: asIsoDate('2026-10-12'), lowestPriceMinor: 41_200, currency: 'GBP' },
      { date: asIsoDate('2026-10-13'), lowestPriceMinor: 40_900, currency: 'GBP' },
      { date: asIsoDate('2026-10-11'), lowestPriceMinor: 52_000, currency: 'USD' },
    ];
    const h = createHarness({ transformFixture: (p) => mapResult(p, (r) => ({ ...r, routeHistory })) });
    await h.runToCompletion(h.orch(), def(h).id);
    const rows = h.db.raw
      .prepare<
        [],
        { origin: string; destination: string; cabin: string; p: string; date: string; pence: number }
      >(
        'SELECT origin, destination, cabin, provider_id AS p, date, lowest_price_pence AS pence FROM route_price_history ORDER BY date',
      )
      .all();
    expect(rows).toEqual([
      {
        origin: 'LHR',
        destination: 'JFK',
        cabin: 'unknown',
        p: 'fixture',
        date: '2026-10-12',
        pence: 41_200,
      },
      {
        origin: 'LHR',
        destination: 'JFK',
        cabin: 'unknown',
        p: 'fixture',
        date: '2026-10-13',
        pence: 40_900,
      },
    ]);
    expect(
      h.logs.some(
        (l) => l.msg === 'verification: route history points not in GBP dropped' && l.fields.dropped === 1,
      ),
    ).toBe(true);
  });
});
