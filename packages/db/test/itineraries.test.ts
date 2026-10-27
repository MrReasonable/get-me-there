import { type CellKey, cellKeyString, fixedClock, type Offer, type Provenance } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/client.js';
import { RowRejected } from '../src/internal/validate.js';
import { CellsRepo } from '../src/repositories/cells.js';
import { ItinerariesRepo } from '../src/repositories/itineraries.js';
import type { VerifiedCellWrite } from '../src/types.js';
import { at, count, freshDb, sqliteCode, T0 } from './helpers/db.js';
import {
  cell,
  EWR,
  itinerary,
  newExecution,
  observationWrite,
  snapshotOf,
  withNights,
} from './helpers/factories.js';
import { CELLS, historySeed, hoursAfterT0, statementsOf, verifiedCell } from './helpers/history.js';

const offerOf = (hash = 'a'.repeat(64), seller = 'British Airways') =>
  ({ itineraryHash: hash, providerId: 'searchapi', seller, cabin: 'economy' }) as const;
const SEARCHAPI_PROVENANCE: Provenance = {
  providerId: 'searchapi',
  sourceKind: 'scraped-search',
  fetchedAt: T0,
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
};

function setup(allowSynthetic = false) {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { definition, execution } = newExecution(db, clock);
  return {
    db,
    clock,
    definition,
    executionId: execution.id,
    repo: new ItinerariesRepo(db, clock, { allowSynthetic }),
    cells: new CellsRepo(db, clock, { allowSynthetic }),
  };
}
const insertObs = (
  repo: ItinerariesRepo,
  executionId: string,
  offer: Offer,
  over: Parameters<typeof observationWrite>[0] = {},
) => repo.recordObservation(offer, { ...observationWrite(over), executionId });

/** Raw insert into price_observations, to prove the shared price CHECKs hold on this table too (test-017). */
function rawObservation(db: Db, executionId: string, offerId: number, over: Record<string, unknown>): void {
  const row = {
    offer_id: offerId,
    execution_id: executionId,
    source_kind: 'scraped-search',
    cabin: 'economy',
    fetched_at: T0,
    price_pence: 41_200,
    price_native_minor: 41_200,
    currency_native: 'GBP',
    fx_rate_nano: null,
    fx_rate_date: null,
    fx_source: null,
    fx_converted: 0,
    point_of_sale: 'GB',
    supplied_fields_json: '[]',
    partial_expansion: 0,
    ...over,
  };
  const cols = Object.keys(row);
  db.raw
    .prepare(
      `INSERT INTO price_observations (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`,
    )
    .run(row);
}

describe('itineraries and offers (spec §7)', () => {
  it('itineraries and segments are insert-or-ignore on hash; get rebuilds the whole itinerary including layovers', () => {
    const { db, repo } = setup();
    const it2 = {
      ...itinerary(),
      layovers: [{ at: EWR, minutes: 95, overnight: false, airportChange: false }],
    };
    repo.upsertItinerary(it2);
    repo.upsertItinerary({ ...it2, nights: 99 });
    expect([count(db, 'itineraries'), count(db, 'segments')]).toEqual([1, 2]);
    expect(repo.get('a'.repeat(64))).toEqual({ ...it2, firstSeenAt: T0 });
    expect(repo.get('missing')).toBeNull();
  });

  it('UNIQUE (itinerary_hash, provider_id, seller, cabin): recordObservation reuses the offer id; a raw duplicate throws', () => {
    const { db, executionId, repo } = setup();
    repo.upsertItinerary(itinerary());
    const { offerId: id } = insertObs(repo, executionId, offerOf());
    expect(insertObs(repo, executionId, offerOf()).offerId).toBe(id);
    expect(insertObs(repo, executionId, offerOf(undefined, 'Mytrip')).offerId).not.toBe(id);
    const business = insertObs(
      repo,
      executionId,
      { ...offerOf(), cabin: 'business' },
      {
        provenance: { ...SEARCHAPI_PROVENANCE, cabin: 'business' },
        segmentCabins: ['business', 'business'],
      },
    );
    expect(business.offerId).not.toBe(id);
    const raw = (prices: boolean) => () =>
      db.raw
        .prepare(
          prices
            ? `INSERT INTO fare_offers (itinerary_hash, provider_id, seller, cabin, first_seen_at, last_seen_at, first_price_pence, lowest_price_pence, highest_price_pence, latest_price_pence) VALUES (?, 'searchapi', 'British Airways', 'economy', ?, ?, 1, 1, 1, 1)`
            : `INSERT INTO fare_offers (itinerary_hash, provider_id, seller, cabin, first_seen_at, last_seen_at) VALUES (?, 'searchapi', 'Elsewhere', 'economy', ?, ?)`,
        )
        .run('a'.repeat(64), T0, T0);
    expect(sqliteCode(raw(true))).toBe('SQLITE_CONSTRAINT_UNIQUE');
    // dm-M2: an offer without its price aggregates cannot exist
    expect(sqliteCode(raw(false))).toBe('SQLITE_CONSTRAINT_NOTNULL');
  });

  it('recordObservation writes offer, observation and aggregates in one transaction; the offer is first seen at the observation', () => {
    const { db, clock, executionId, repo } = setup();
    repo.upsertItinerary(itinerary());
    clock.advance(3_600_000); // the clock moves on; the offer's first_seen_at must still be the observation's
    const { offerId, observationId } = insertObs(repo, executionId, offerOf());
    expect(
      db.raw
        .prepare(
          'SELECT first_seen_at AS fs, last_seen_at AS ls, first_price_pence AS f, lowest_price_pence AS l, highest_price_pence AS h, latest_price_pence AS x FROM fare_offers WHERE id = ?',
        )
        .get(offerId),
    ).toEqual({ fs: T0, ls: T0, f: 41_200, l: 41_200, h: 41_200, x: 41_200 });
    expect(repo.previousObservation(offerId, at('2026-10-15T00:00:00.000Z'))?.id).toBe(observationId);
    // a SQL failure on the observation (unknown execution: FK) leaves no new offer behind
    expect(sqliteCode(() => insertObs(repo, 'no-such-execution', offerOf(undefined, 'Mytrip')))).toBe(
      'SQLITE_CONSTRAINT_FOREIGNKEY',
    );
    expect([count(db, 'fare_offers'), count(db, 'price_observations')]).toEqual([1, 1]);
  });

  it('latest = max fetched_at, ties broken by id; first, lowest, highest follow; previousObservation looks strictly before', () => {
    const { db, executionId, repo } = setup();
    repo.upsertItinerary(itinerary());
    const offer = offerOf();
    const obs = (fetchedAt: string, pence: number) =>
      insertObs(repo, executionId, offer, {
        pricePence: pence,
        priceNativeMinor: pence,
        provenance: { ...SEARCHAPI_PROVENANCE, fetchedAt: at(fetchedAt) },
      });
    const { offerId } = obs('2026-10-14T10:00:00.000Z', 50_000);
    obs('2026-10-14T12:00:00.000Z', 45_000);
    obs('2026-10-14T11:00:00.000Z', 40_000); // inserted later, fetched earlier
    const read = () =>
      db.raw
        .prepare(
          'SELECT first_price_pence AS f, lowest_price_pence AS l, highest_price_pence AS h, latest_price_pence AS x, first_seen_at AS fs, last_seen_at AS ls FROM fare_offers WHERE id = ?',
        )
        .get(offerId);
    expect(read()).toEqual({
      f: 50_000,
      l: 40_000,
      h: 50_000,
      x: 45_000,
      fs: '2026-10-14T10:00:00.000Z',
      ls: '2026-10-14T12:00:00.000Z',
    });
    obs('2026-10-14T12:00:00.000Z', 47_000); // same fetched_at as the latest: the higher id wins
    expect(read()).toMatchObject({ x: 47_000 });
    expect(repo.previousObservation(offerId, at('2026-10-14T12:00:00.000Z'))?.pricePence).toBe(40_000);
    expect(repo.previousObservation(offerId, at('2026-10-14T10:00:00.000Z'))).toBeNull();
  });

  it('observations: provider ⇔ kind both directions, the gate, offer mismatch, disagreeing fx, non-integers', () => {
    const open = setup(true);
    open.repo.upsertItinerary(itinerary());
    const offer = offerOf();
    const fixtureOffer: Offer = { ...offerOf(), providerId: 'fixture' };
    const closed = new ItinerariesRepo(open.db, open.clock, { allowSynthetic: false });
    const write = (repo: ItinerariesRepo, offer: Offer, over: Parameters<typeof observationWrite>[0]) => () =>
      insertObs(repo, open.executionId, offer, over);
    expect(
      write(closed, offer, { provenance: { ...SEARCHAPI_PROVENANCE, sourceKind: 'synthetic' } }),
    ).toThrow(expect.objectContaining({ rule: 'provider-kind' }));
    for (const repo of [open.repo, closed]) {
      expect(
        write(repo, fixtureOffer, {
          provenance: { ...SEARCHAPI_PROVENANCE, providerId: 'fixture', sourceKind: 'scraped-search' },
        }),
      ).toThrow(expect.objectContaining({ rule: 'provider-kind' })); // test-010
    }
    expect(
      write(closed, fixtureOffer, {
        provenance: { ...SEARCHAPI_PROVENANCE, providerId: 'fixture', sourceKind: 'synthetic' },
      }),
    ).toThrow(expect.objectContaining({ rule: 'synthetic-gate' }));
    expect(write(closed, offer, { provenance: { ...SEARCHAPI_PROVENANCE, cabin: 'business' } })).toThrow(
      expect.objectContaining({ rule: 'offer-mismatch' }),
    );
    expect(
      write(closed, offer, {
        provenance: { ...SEARCHAPI_PROVENANCE, providerId: 'travelpayouts', sourceKind: 'authorised-cached' },
      }),
    ).toThrow(expect.objectContaining({ rule: 'offer-mismatch' }));
    expect(
      write(closed, offer, {
        provenance: {
          ...SEARCHAPI_PROVENANCE,
          fx: { converted: true, rateNano: 1, rateDate: cell().departureDate, source: 'x' },
        },
      }),
    ).toThrow(expect.objectContaining({ rule: 'fx-mismatch' }));
    expect(write(closed, offer, { pricePence: 412.5, priceNativeMinor: 412.5 })).toThrow(
      expect.objectContaining({ rule: 'integer' }),
    );
    expect([count(open.db, 'price_observations'), count(open.db, 'fare_offers')]).toEqual([0, 0]);
  });

  it('price_observations carries the shared price CHECKs (test-017)', () => {
    const { db, executionId, repo } = setup();
    repo.upsertItinerary(itinerary());
    const { offerId } = insertObs(repo, executionId, offerOf());
    rawObservation(db, executionId, offerId, {}); // positive control: the baseline row satisfies every CHECK
    rawObservation(db, executionId, offerId, { price_pence: '412', price_native_minor: '412' }); // INTEGER affinity stores 412
    expect(
      db.raw
        .prepare(
          'SELECT typeof(price_pence) AS t, price_pence AS p FROM price_observations ORDER BY id DESC LIMIT 1',
        )
        .get(),
    ).toEqual({ t: 'integer', p: 412 });
    expect(
      sqliteCode(() =>
        rawObservation(db, executionId, offerId, {
          fx_converted: 1,
          currency_native: 'GBP',
          fx_rate_nano: 1,
          fx_rate_date: '2026-10-13',
          fx_source: 'x',
        }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() => rawObservation(db, executionId, offerId, { fx_converted: 0, currency_native: 'USD' })),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() =>
        rawObservation(db, executionId, offerId, {
          fx_converted: 1,
          currency_native: 'USD',
          fx_rate_nano: null,
          fx_rate_date: '2026-10-13',
          fx_source: 'x',
        }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() =>
        rawObservation(db, executionId, offerId, { price_pence: 412.5, price_native_minor: 412.5 }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() =>
        rawObservation(db, executionId, offerId, { price_pence: 'abc', price_native_minor: 'abc' }),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(
      sqliteCode(() => rawObservation(db, executionId, offerId, { fetched_at: '2026-10-14T12:00:00Z' })),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(count(db, 'price_observations')).toBe(3);
  });
});

describe('CellsRepo.writeVerifiedCell (spec §7 atomic unit "each verified cell")', () => {
  function seeded() {
    const s = setup();
    const all = [cell(), cell(undefined, EWR)];
    s.cells.seed(s.executionId, all.map(withNights), []);
    s.cells.seedVerification(s.executionId, [{ cell: cell(), reason: 'top_n' }], all, ['searchapi']);
    return s;
  }
  const write = (
    c: CellKey,
    offers: Array<{ hash: string; seller: string; pence: number }>,
    status: 'priced' | 'empty' | 'error' = 'priced',
  ): VerifiedCellWrite => {
    const hashes = [...new Set(offers.map((o) => o.hash))];
    return {
      cell: c,
      outcome: {
        ...c,
        status,
        reason: status === 'error' ? 'upstream' : null,
        lastError: null,
        fetchedAt: status === 'error' ? null : T0,
        minPence: offers.length > 0 ? Math.min(...offers.map((o) => o.pence)) : null,
        cabin: 'economy',
        pointOfSale: 'GB',
        sourceKind: 'scraped-search',
      },
      itineraries: hashes.map((h) => ({
        itinerary: itinerary(h, c),
        offers: offers
          .filter((o) => o.hash === h)
          .map((o) => ({
            offer: offerOf(h, o.seller),
            observation: observationWrite({ pricePence: o.pence, priceNativeMinor: o.pence }),
          })),
      })),
    };
  };
  const bestPrice = (repo: ItinerariesRepo, executionId: string, c: CellKey) => {
    const id = repo.bestObservationForCell(executionId, c);
    return repo.writtenBy(executionId).find((o) => o.id === id)?.pricePence ?? null;
  };

  it('writes itinerary, segments, offers, observations, outcome, best_observation_id and roll-up together', () => {
    const { db, executionId, cells, repo } = seeded();
    cells.writeVerifiedCell(
      executionId,
      'searchapi',
      write(cell(), [
        { hash: 'a'.repeat(64), seller: 'British Airways', pence: 60_300 },
        { hash: 'a'.repeat(64), seller: 'Mytrip', pence: 57_300 },
      ]),
    );
    expect([
      count(db, 'itineraries'),
      count(db, 'segments'),
      count(db, 'fare_offers'),
      count(db, 'price_observations'),
    ]).toEqual([1, 2, 2, 2]);
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification).toEqual({
      status: 'priced',
      reason: null,
      minPence: 57_300,
    });
    expect(bestPrice(repo, executionId, cell())).toBe(57_300);
    expect(repo.bestObservationForCell(executionId, cell(undefined, EWR))).toBeNull();
  });

  it('merges like writeTile: an error or empty never downgrades priced; a dearer second write keeps the cheaper minimum (ruling 3)', () => {
    const { executionId, cells, repo } = seeded();
    cells.writeVerifiedCell(
      executionId,
      'searchapi',
      write(cell(), [{ hash: 'a'.repeat(64), seller: 'British Airways', pence: 50_000 }]),
    );
    cells.writeVerifiedCell(executionId, 'searchapi', write(cell(), [], 'error'));
    expect(cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0]).toMatchObject({
      status: 'priced',
      minPence: 50_000,
      attempts: 1,
    });
    cells.writeVerifiedCell(executionId, 'searchapi', write(cell(), [], 'empty'));
    expect(cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0]?.status).toBe('priced');
    cells.writeVerifiedCell(
      executionId,
      'searchapi',
      write(cell(), [{ hash: 'b'.repeat(64), seller: 'Mytrip', pence: 60_000 }]),
    );
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification.minPence).toBe(50_000);
    expect(bestPrice(repo, executionId, cell())).toBe(50_000);
  });

  it('a failure on the second itinerary rolls back the first itinerary, its offer and observation', () => {
    const { db, executionId, cells, repo } = seeded();
    const w = write(cell(), [
      { hash: 'a'.repeat(64), seller: 'British Airways', pence: 60_300 },
      { hash: 'b'.repeat(64), seller: 'Mytrip', pence: 57_300 },
    ]);
    const second = w.itineraries[1]?.offers[0];
    if (second === undefined) throw new Error('fixture has two itineraries');
    second.observation = { ...second.observation, pricePence: 573.5, priceNativeMinor: 573.5 };
    w.outcome = { ...w.outcome, minPence: 573.5 }; // passes the pre-check, so the integer rule fires inside the transaction after the first itinerary was written
    expect(() => cells.writeVerifiedCell(executionId, 'searchapi', w)).toThrow(RowRejected);
    expect([
      count(db, 'itineraries'),
      count(db, 'segments'),
      count(db, 'fare_offers'),
      count(db, 'price_observations'),
    ]).toEqual([0, 0, 0, 0]);
    expect(cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0]?.status).toBe(
      'not_run',
    );
    expect(repo.bestObservationForCell(executionId, cell())).toBeNull();
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification.status).toBe('not_run');
  });

  it('a failure after the outcome was written (injected at best_observation_id) rolls back the outcome, rows and roll-up (test-r2-005)', () => {
    const { db, executionId, cells, repo } = seeded();
    db.raw.exec(
      `CREATE TRIGGER fail_best BEFORE UPDATE OF best_observation_id ON search_cells WHEN NEW.best_observation_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    );
    expect(() =>
      cells.writeVerifiedCell(
        executionId,
        'searchapi',
        write(cell(), [{ hash: 'a'.repeat(64), seller: 'British Airways', pence: 60_300 }]),
      ),
    ).toThrow(/injected/);
    expect([count(db, 'itineraries'), count(db, 'fare_offers'), count(db, 'price_observations')]).toEqual([
      0, 0, 0,
    ]);
    expect(cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0]).toMatchObject({
      status: 'not_run',
      minPence: null,
      attempts: 0,
    });
    expect(repo.bestObservationForCell(executionId, cell())).toBeNull();
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification).toEqual({
      status: 'not_run',
      reason: null,
      minPence: null,
    });
  });

  // test-r2-001: every field the outcome must share with its observations, one row each.
  const mismatches: Array<[string, (v: VerifiedCellWrite) => VerifiedCellWrite]> = [
    ['cabin', (v) => ({ ...v, outcome: { ...v.outcome, cabin: 'business' } })],
    ['pointOfSale', (v) => ({ ...v, outcome: { ...v.outcome, pointOfSale: 'unknown' } })],
    ['sourceKind', (v) => ({ ...v, outcome: { ...v.outcome, sourceKind: 'scraped-aggregate' } })],
    [
      'provider',
      (v) => ({
        ...v,
        itineraries: v.itineraries.map((i) => ({
          ...i,
          offers: i.offers.map((o) => ({
            ...o,
            observation: {
              ...o.observation,
              provenance: {
                ...o.observation.provenance,
                providerId: 'travelpayouts',
                sourceKind: 'authorised-cached',
              },
            },
          })),
        })),
      }),
    ],
  ];
  it.each(mismatches)('refuses an outcome whose %s differs from its observations', (_field, mutate) => {
    const { db, executionId, cells } = seeded();
    expect(() =>
      cells.writeVerifiedCell(
        executionId,
        'searchapi',
        mutate(write(cell(), [{ hash: 'a'.repeat(64), seller: 'x', pence: 100 }])),
      ),
    ).toThrow(expect.objectContaining({ rule: 'outcome-price-mismatch' }));
    expect(count(db, 'price_observations')).toBe(0);
  });

  it("the outcome fetchedAt is the oldest observation's: accepted with the oldest, refused with the newest (spec §2)", () => {
    const { executionId, cells } = seeded();
    const later = at('2026-10-14T13:00:00.000Z');
    const base = write(cell(), [
      { hash: 'a'.repeat(64), seller: 'British Airways', pence: 60_300 },
      { hash: 'a'.repeat(64), seller: 'Mytrip', pence: 57_300 },
    ]);
    const mixed: VerifiedCellWrite = {
      ...base,
      itineraries: base.itineraries.map((i) => ({
        ...i,
        offers: i.offers.map((o, k) =>
          k === 1
            ? {
                ...o,
                observation: {
                  ...o.observation,
                  provenance: { ...o.observation.provenance, fetchedAt: later },
                },
              }
            : o,
        ),
      })),
    };
    expect(() =>
      cells.writeVerifiedCell(executionId, 'searchapi', {
        ...mixed,
        outcome: { ...mixed.outcome, fetchedAt: later },
      }),
    ).toThrow(expect.objectContaining({ rule: 'outcome-price-mismatch' }));
    cells.writeVerifiedCell(executionId, 'searchapi', mixed);
    expect(cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0]).toMatchObject({
      status: 'priced',
      fetchedAt: T0,
      minPence: 57_300,
    });
  });

  it('rejects priced without offers, offers on a non-priced outcome, a foreign cell, a wrong min_pence, missing provenance and mismatched observations', () => {
    const { executionId, cells } = seeded();
    const w = (v: VerifiedCellWrite) => () => cells.writeVerifiedCell(executionId, 'searchapi', v);
    const one = write(cell(), [{ hash: 'a'.repeat(64), seller: 'x', pence: 100 }]);
    expect(w(write(cell(), []))).toThrow(expect.objectContaining({ rule: 'priced-needs-offer' }));
    expect(w({ ...one, outcome: { ...one.outcome, status: 'empty', minPence: null } })).toThrow(
      expect.objectContaining({ rule: 'offers-need-priced' }),
    );
    expect(w({ ...one, cell: cell(undefined, EWR) })).toThrow(
      expect.objectContaining({ rule: 'cell-mismatch' }),
    );
    expect(w({ ...one, outcome: { ...one.outcome, minPence: 99 } })).toThrow(
      expect.objectContaining({ rule: 'min-pence' }),
    );
    expect(w({ ...one, outcome: { ...one.outcome, sourceKind: null } })).toThrow(
      expect.objectContaining({ rule: 'outcome-provenance' }),
    );
    expect(w({ ...one, outcome: { ...one.outcome, pointOfSale: 'unknown' } })).toThrow(
      expect.objectContaining({ rule: 'outcome-price-mismatch' }),
    );
    expect(w({ ...one, outcome: { ...one.outcome, fetchedAt: at('2026-10-14T13:00:00.000Z') } })).toThrow(
      expect.objectContaining({ rule: 'outcome-price-mismatch' }),
    );
    expect(
      w({
        ...write(cell(), [], 'error'),
        outcome: { ...write(cell(), [], 'error').outcome, reason: 'socket hang up' },
      }),
    ).toThrow(expect.objectContaining({ rule: 'error-reason' }));
    expect(
      w({
        ...write(cell(), [], 'empty'),
        outcome: { ...write(cell(), [], 'empty').outcome, reason: 'no flights https://www.google.com/x?q=1' },
      }),
    ).toThrow(expect.objectContaining({ rule: 'outcome-reason' }));
  });
  it('an error outcome stores no provenance, whatever the caller supplied (prov-M5)', () => {
    const { executionId, cells } = seeded();
    const base = write(cell(), [], 'error');
    cells.writeVerifiedCell(executionId, 'searchapi', {
      ...base,
      outcome: { ...base.outcome, fetchedAt: T0 },
    });
    expect(cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0]).toMatchObject({
      status: 'error',
      reason: 'upstream',
      fetchedAt: null,
      minPence: null,
      cabin: null,
      pointOfSale: null,
      sourceKind: null,
    });
  });

  it('partial expansion: the outcome reason and the observations’ partialExpansion flags must agree (prov-M6)', () => {
    const { executionId, cells } = seeded();
    const base = write(cell(), [{ hash: 'a'.repeat(64), seller: 'British Airways', pence: 60_300 }]);
    const partialObs = (v: VerifiedCellWrite): VerifiedCellWrite => ({
      ...v,
      itineraries: v.itineraries.map((i) => ({
        ...i,
        offers: i.offers.map((x) => ({ ...x, observation: { ...x.observation, partialExpansion: true } })),
      })),
    });
    const withReason = (v: VerifiedCellWrite, reason: string | null): VerifiedCellWrite => ({
      ...v,
      outcome: { ...v.outcome, reason },
    });
    for (const bad of [
      withReason(base, 'partial-expansion'),
      withReason(base, 'partial-expansion;offers-dropped:1'),
      partialObs(base),
      partialObs(withReason(base, 'offers-dropped:1')),
    ])
      expect(() => cells.writeVerifiedCell(executionId, 'searchapi', bad)).toThrow(
        expect.objectContaining({ rule: 'partial-expansion' }),
      );
    cells.writeVerifiedCell(
      executionId,
      'searchapi',
      partialObs(withReason(base, 'partial-expansion;offers-dropped:1')),
    );
    expect(cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0]?.reason).toBe(
      'partial-expansion;offers-dropped:1',
    );
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification).toEqual({
      status: 'priced',
      reason: 'partial-expansion',
      minPence: 60_300,
    });
  });

  it('a priced verified cell may carry offers-dropped:n (ruling 2026-10-15)', () => {
    const { executionId, cells } = seeded();
    const base = write(cell(), [{ hash: 'a'.repeat(64), seller: 'British Airways', pence: 60_300 }]);
    cells.writeVerifiedCell(executionId, 'searchapi', {
      ...base,
      outcome: { ...base.outcome, reason: 'offers-dropped:2' },
    });
    const stored = cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0];
    expect(stored?.reason).toBe('offers-dropped:2');
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification).toEqual({
      status: 'priced',
      reason: null,
      minPence: 60_300,
    });
  });
});

describe('ItinerariesRepo reads', () => {
  it('observationsForDefinition, writtenBy, offerHistory, latestVerificationOutcomeForCell (cabin-filtered, ruling 9)', () => {
    const { db, clock, definition, executionId, cells, repo } = setup();
    const w = (c: CellKey, hash: string, pence: number): VerifiedCellWrite => ({
      cell: c,
      outcome: {
        ...c,
        status: 'priced',
        reason: null,
        lastError: null,
        fetchedAt: T0,
        minPence: pence,
        cabin: 'economy',
        pointOfSale: 'GB',
        sourceKind: 'scraped-search',
      },
      itineraries: [
        {
          itinerary: itinerary(hash, c),
          offers: [
            {
              offer: offerOf(hash),
              observation: observationWrite({ pricePence: pence, priceNativeMinor: pence }),
            },
          ],
        },
      ],
    });
    cells.seed(executionId, [withNights(cell())], []);
    cells.seedVerification(executionId, [{ cell: cell(), reason: 'top_n' }], [cell()], ['searchapi']);
    cells.writeVerifiedCell(executionId, 'searchapi', w(cell(), 'a'.repeat(64), 41_200));
    const child = newExecution(db, clock, { definition, cell: cell(undefined, EWR) }).execution;
    cells.seed(child.id, [withNights(cell(undefined, EWR))], []);
    cells.seedVerification(
      child.id,
      [{ cell: cell(undefined, EWR), reason: 'always_include' }],
      [cell(undefined, EWR)],
      ['searchapi'],
    );
    cells.writeVerifiedCell(child.id, 'searchapi', w(cell(undefined, EWR), 'c'.repeat(64), 39_000));
    const space = snapshotOf(definition).resolved;
    const all = repo.observationsForDefinition(definition.id, {
      executionIds: 'all',
      space,
      cabin: 'economy',
      includeChildren: true,
    });
    expect(
      all.map((r) => [r.executionId, r.pricePence, r.cell.destination, r.cell.nights, r.seller]),
    ).toEqual([
      [child.id, 39_000, 'EWR', 14, 'British Airways'],
      [executionId, 41_200, 'JFK', 14, 'British Airways'],
    ]);
    expect(all[0]?.provenance).toEqual(SEARCHAPI_PROVENANCE);
    expect(all[0]?.itinerary).toEqual(itinerary('c'.repeat(64), cell(undefined, EWR)));
    expect(all[0]?.offer).toMatchObject({
      itineraryHash: 'c'.repeat(64),
      providerId: 'searchapi',
      seller: 'British Airways',
      cabin: 'economy',
      id: expect.any(Number),
    });
    expect(
      repo.observationsForDefinition(definition.id, {
        executionIds: 'all',
        space,
        cabin: 'economy',
        includeChildren: false,
      }),
    ).toHaveLength(1);
    expect(
      repo.observationsForDefinition(definition.id, {
        executionIds: [executionId],
        space: null,
        cabin: 'economy',
        includeChildren: true,
      }),
    ).toHaveLength(1);
    expect(
      repo.observationsForDefinition(definition.id, {
        executionIds: 'all',
        space,
        cabin: 'business',
        includeChildren: true,
      }),
    ).toHaveLength(0);
    expect(
      repo.observationsForDefinition(definition.id, {
        executionIds: 'all',
        space: { ...space, maxNights: 13 },
        cabin: 'economy',
        includeChildren: true,
      }),
    ).toHaveLength(0);
    expect(repo.writtenBy(child.id).map((o) => o.pricePence)).toEqual([39_000]);
    expect(repo.offerHistory('a'.repeat(64))).toEqual([
      {
        providerId: 'searchapi',
        seller: 'British Airways',
        cabin: 'economy',
        points: [
          {
            at: T0,
            pricePence: 41_200,
            provenance: SEARCHAPI_PROVENANCE,
            // why: the observation's own supplied fields, which the api reads as priceConfirmed (plan decision 42)
            suppliedFields: ['segments', 'segmentTimes', 'segmentCabins', 'price', 'seller', 'baggage'],
            executionId,
          },
        ],
      },
    ]);
    expect(repo.latestVerificationOutcomeForCell(definition.id, cell(), 'economy')).toMatchObject({
      executionId,
      status: 'priced',
    });
    expect(repo.latestVerificationOutcomeForCell(definition.id, cell(), 'business')).toBeNull(); // prov-007: another cabin's search never counts
    expect(
      repo.latestVerificationOutcomeForCell(
        definition.id,
        cell(undefined, undefined, '2027-01-01', '2027-01-15'),
        'economy',
      ),
    ).toBeNull();
  });
});

// WP19 Task 19.2: the grouped reads, a fixed number of statements, equal to the per-cell and per-hash reads they replace.
describe('ItinerariesRepo grouped reads (WP19 Task 19.2, spec §10 bounds)', () => {
  it('latestVerificationOutcomes equals latestVerificationOutcomeForCell for every cell, a provider tie included, in one statement', () => {
    const seed = historySeed();
    const [c3, c5] = [CELLS[3], CELLS[5]];
    const run = seed.runs[4];
    if (c3 === undefined || c5 === undefined || run === undefined) throw new Error('seed');
    // why: two verification providers' outcomes on one cell, fetched in the same second of one execution
    seed.cells.seedVerification(
      run,
      [c3, c5].map((c) => ({ cell: c, reason: 'top_n' as const })),
      CELLS,
      ['fixture', 'searchapi'],
    );
    const t = hoursAfterT0(230);
    verifiedCell(seed.cells, run, c3, ['d'.repeat(64)], t, 'searchapi');
    verifiedCell(seed.cells, run, c3, ['e'.repeat(64)], t, 'fixture');
    seed.cells.setOutcome(run, c5, 'verification', 'searchapi', { status: 'error', reason: 'upstream' });
    seed.cells.setOutcome(run, c5, 'verification', 'fixture', { status: 'error', reason: 'upstream' });
    const { result, statements } = statementsOf(seed.db, () =>
      seed.itineraries.latestVerificationOutcomes(seed.definition.id, 'economy', null),
    );
    expect(statements).toBe(1);
    for (const c of CELLS) {
      const one = seed.itineraries.latestVerificationOutcomeForCell(seed.definition.id, c, 'economy');
      expect(result.get(cellKeyString(c)) ?? null).toEqual(one);
    }
    // the tie goes to the first provider id in both reads
    expect(result.get(cellKeyString(c3))).toMatchObject({ executionId: run, providerId: 'fixture' });
    // a cell whose only verification outcomes are errors is absent (the child's error cell, and c5)
    expect(result.has(cellKeyString(c5))).toBe(false);
    expect(result.has(cellKeyString(CELLS[1] ?? c5))).toBe(false);
    expect(result.has(cellKeyString(CELLS[0] ?? c5))).toBe(true);
    expect(seed.itineraries.latestVerificationOutcomes(seed.definition.id, 'business', null).size).toBe(0);
    const narrow = seed.itineraries.latestVerificationOutcomes(seed.definition.id, 'economy', {
      origins: [c3.origin],
      destinations: [c3.destination],
      departureFrom: c3.departureDate,
      departureTo: c3.departureDate,
      minNights: 14,
      maxNights: 14,
    });
    expect([...narrow.keys()]).toEqual([cellKeyString(c3)]);
  });

  it('observationsForDefinition and writtenBy hydrate itineraries and segments in two statements, for 1 or 500 itineraries, as get(hash) does', () => {
    const counts: number[] = [];
    for (const n of [1, 500]) {
      const seed = historySeed();
      const run = seed.runs[4];
      const c = CELLS[3];
      if (run === undefined || c === undefined) throw new Error('seed');
      seed.cells.seedVerification(run, [{ cell: c, reason: 'top_n' }], CELLS, ['searchapi']);
      const hashes = Array.from({ length: n }, (_, i) => i.toString(16).padStart(64, 'f'));
      verifiedCell(seed.cells, run, c, hashes, hoursAfterT0(230));
      const read = () =>
        seed.itineraries.observationsForDefinition(seed.definition.id, {
          executionIds: 'all',
          space: null,
          cabin: 'economy',
          includeChildren: true,
        });
      const { result, statements } = statementsOf(seed.db, read);
      counts.push(statements);
      // the reference: each observation's itinerary as get(hash) builds it
      expect(result).toHaveLength(n + 2); // two children's observations besides the run's n
      for (const o of result) {
        const full = seed.itineraries.get(o.itinerary.hash);
        if (full === null) throw new Error('missing');
        const { firstSeenAt: _f, ...it } = full;
        expect(o.itinerary).toEqual(it);
      }
      const written = statementsOf(seed.db, () => seed.itineraries.writtenBy(run));
      expect(written.result).toHaveLength(n);
      expect(written.statements).toBe(3);
    }
    expect(counts).toEqual([3, 3]);
  });
});
