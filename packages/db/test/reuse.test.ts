import {
  asIsoDate,
  type CellKey,
  cellKeyString,
  fixedClock,
  type IsoDateTime,
  type ProviderId,
} from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CalendarPricesRepo } from '../src/repositories/calendarPrices.js';
import { CellsRepo } from '../src/repositories/cells.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { ExecutionsRepo } from '../src/repositories/executions.js';
import type { CalendarPriceRow, ReuseCriteria, ReusedCopy, TileWrite } from '../src/types.js';
import { at, count, freshDb, T0 } from './helpers/db.js';
import {
  calendarPrice,
  cell,
  EWR,
  exampleDefinitionInput,
  newExecution,
  snapshotOf,
  withNights,
} from './helpers/factories.js';
import { rawOutcome } from './helpers/outcomes.js';

const P = cell(); // priced
const E = cell(undefined, EWR); // empty
const N = cell(undefined, undefined, '2027-03-15', '2027-03-29'); // no_data
const X = cell(undefined, undefined, '2027-03-16', '2027-03-30'); // error
const R = cell(undefined, undefined, '2027-03-17', '2027-03-31'); // left not_run
const ALL = [P, E, N, X, R];
const opts = { allowSynthetic: false };
type TileOutcome = TileWrite['outcomes'][number];
const out = (
  c: CellKey,
  status: TileOutcome['status'],
  fetchedAt: IsoDateTime,
  minPence: number | null = null,
): TileOutcome => ({
  ...c,
  status,
  reason: null,
  lastError: null,
  fetchedAt,
  minPence,
  cabin: 'economy',
  pointOfSale: 'unknown',
  sourceKind: 'authorised-cached',
});
const pricedTile = (cells: Array<[CellKey, number]>, fetchedAt: IsoDateTime): TileWrite => ({
  tileIndex: 0,
  cells: cells.map(([c]) => c),
  discards: 0,
  prices: cells.map(([c, pence]) =>
    calendarPrice(c, { pricePence: pence, priceNativeMinor: pence, fetchedAt }),
  ),
  outcomes: cells.map(([c, pence]) => out(c, 'priced', fetchedAt, pence)),
});
/** The reuse criteria the engine passes to both reuseCandidates and copyReused (prov-M3). */
const CRITERIA = {
  pointOfSale: 'unknown',
  sourceKind: 'authorised-cached',
  newerThan: at('2026-10-14T11:00:00.000Z'),
} as const;
const reuse = (
  cells: CellsRepo,
  executionId: string,
  providerId: ProviderId,
  copies: ReusedCopy[],
  criteria: ReuseCriteria = CRITERIA,
) => cells.copyReused(executionId, providerId, copies, criteria);
const ask = (
  prices: CalendarPricesRepo,
  definitionId: string,
  cells: CellKey[],
  newerThan = '2026-10-14T11:00:00.000Z',
) =>
  prices.reuseCandidates(
    definitionId,
    'travelpayouts',
    'economy',
    'unknown',
    'authorised-cached',
    cells,
    at(newerThan),
  );

/** Execution a (completed) fetched P priced 40,000, E empty, N no_data at T0, and X failed. */
function world() {
  const db = freshDb();
  const clock = fixedClock(T0);
  const cells = new CellsRepo(db, clock, opts);
  const prices = new CalendarPricesRepo(db, clock, opts);
  const { definition, execution: a } = newExecution(db, clock, { status: 'completed' });
  cells.seed(a.id, ALL.map(withNights), ['travelpayouts']);
  cells.writeTile(a.id, 'travelpayouts', {
    tileIndex: 0,
    cells: [P, E, N],
    prices: [calendarPrice(P, { pricePence: 40_000, priceNativeMinor: 40_000 })],
    outcomes: [out(P, 'priced', T0, 40_000), out(E, 'empty', T0), out(N, 'no_data', T0)],
    discards: 0,
  });
  cells.writeTileError(a.id, 'travelpayouts', [X], 'upstream', null);
  return { db, clock, cells, prices, definition, a: a.id };
}
const find = (copies: ReusedCopy[], c: CellKey) => {
  const hit = copies.find((x) => cellKeyString(x.cell) === cellKeyString(c));
  if (hit === undefined) throw new Error(`no copy for ${cellKeyString(c)}`);
  return hit;
};

describe('reuse (spec §8.1 "reuse, per cell", §7 atomic unit "each reused cell")', () => {
  it('copyReused commits progress: it resets auto_resume_count like a tile or verified cell (spec §7, dm-M1)', () => {
    const { db, clock, cells, prices, definition } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    const executions = new ExecutionsRepo(db, clock);
    executions.incrementAutoResume(c);
    executions.incrementAutoResume(c);
    reuse(cells, c, 'travelpayouts', []);
    expect(executions.get(c)?.autoResumeCount).toBe(2); // nothing committed, nothing reset
    reuse(cells, c, 'travelpayouts', ask(prices, definition.id, [P]));
    expect(executions.get(c)?.autoResumeCount).toBe(0);
  });

  it('copyReused re-checks the reuse criteria itself: point of sale, source kind and the age cutoff (prov-M3)', () => {
    const { db, clock, cells, prices, definition } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    const copies = ask(prices, definition.id, [P, E]);
    const refused: ReuseCriteria[] = [
      { ...CRITERIA, pointOfSale: 'GB' },
      { ...CRITERIA, sourceKind: 'scraped-aggregate' },
      { ...CRITERIA, newerThan: T0 }, // fetched at T0: not newer than the cutoff
    ];
    for (const criteria of refused)
      expect(() => reuse(cells, c, 'travelpayouts', copies, criteria)).toThrow(
        expect.objectContaining({ rule: 'reuse-source' }),
      );
    expect(cells.outcomes(c, { cells: [P, E] }).map((o) => o.status)).toEqual(['not_run', 'not_run']);
    reuse(cells, c, 'travelpayouts', copies);
    expect(cells.outcomes(c, { cells: [P, E] }).map((o) => o.status)).toEqual(['empty', 'priced']);
  });

  it('candidates: newest priced|empty|no_data per cell for the same provider, cabin, point of sale and source kind; never error or not_run', () => {
    const { prices, definition, a } = world();
    const copies = ask(prices, definition.id, ALL);
    expect(copies.map((c) => cellKeyString(c.cell))).toEqual([E, P, N].map(cellKeyString));
    expect(find(copies, P)).toMatchObject({
      outcome: { executionId: a, status: 'priced', minPence: 40_000 },
      price: { executionId: a, pricePence: 40_000 },
    });
    expect(find(copies, E).price).toBeNull();
    expect(ask(prices, definition.id, [P])).toHaveLength(1);
  });

  it('refuses on a cabin, point-of-sale or source-kind change, and on age (fetched_at must be newer than the cutoff)', () => {
    const { prices, definition } = world();
    const n = (
      cabin: 'economy' | 'business',
      pos: string,
      kind: 'authorised-cached' | 'scraped-aggregate',
      newerThan: string,
    ) => prices.reuseCandidates(definition.id, 'travelpayouts', cabin, pos, kind, ALL, at(newerThan)).length;
    expect(n('business', 'unknown', 'authorised-cached', '2026-10-14T11:00:00.000Z')).toBe(0);
    expect(n('economy', 'GB', 'authorised-cached', '2026-10-14T11:00:00.000Z')).toBe(0);
    expect(n('economy', 'unknown', 'scraped-aggregate', '2026-10-14T11:00:00.000Z')).toBe(0);
    expect(n('economy', 'unknown', 'authorised-cached', T0)).toBe(0);
  });

  it('a newer execution wins; child executions are never reuse sources', () => {
    const { db, clock, cells, prices, definition } = world();
    clock.advance(3_600_000);
    const b = newExecution(db, clock, { definition, status: 'completed' }).execution.id;
    cells.seed(b, [withNights(P)], ['travelpayouts']);
    cells.writeTile(b, 'travelpayouts', pricedTile([[P, 39_000]], clock.now()));
    clock.advance(3_600_000);
    const child = newExecution(db, clock, { definition, cell: P, status: 'completed' }).execution.id;
    cells.seed(child, [withNights(P)], ['travelpayouts']);
    cells.writeTile(child, 'travelpayouts', pricedTile([[P, 1]], clock.now()));
    expect(ask(prices, definition.id, [P])[0]?.outcome.executionId).toBe(b);
  });

  it('copyReused copies outcome and price with the original fetched_at and reused_from = the fetching execution, even from a reused copy', () => {
    const { db, clock, cells, prices, definition, a } = world();
    clock.advance(60_000);
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    reuse(cells, c, 'travelpayouts', ask(prices, definition.id, ALL));
    expect(cells.outcomes(c, { cells: [P] })[0]).toMatchObject({
      status: 'priced',
      fetchedAt: T0,
      minPence: 40_000,
      cabin: 'economy',
      pointOfSale: 'unknown',
      sourceKind: 'authorised-cached',
      reusedFromExecutionId: a,
    });
    expect(cells.outcomes(c, { cells: [X] })[0]?.status).toBe('not_run');
    expect(cells.rollUps(c).get(cellKeyString(P))?.discovery).toEqual({
      status: 'priced',
      reason: null,
      minPence: 40_000,
    });
    expect(cells.buckets(c, 'discovery', 'travelpayouts')).toEqual({
      priced: 1,
      empty: 1,
      no_data: 1,
      error: 0,
      skipped: 0,
      not_run: 2,
      reused: 3,
    });
    expect(
      db.raw
        .prepare(
          'SELECT fetched_at AS f, reused_from_execution_id AS r FROM calendar_prices WHERE execution_id = ?',
        )
        .all(c),
    ).toEqual([{ f: T0, r: a }]);
    expect(prices.fetchedBy(c)).toEqual([]); // a reused copy is not "fetched by" c
    new ExecutionsRepo(db, clock).setStatus(c, 'completed');
    clock.advance(60_000);
    const d = newExecution(db, clock, { definition }).execution.id;
    cells.seed(d, [withNights(P)], ['travelpayouts']);
    reuse(cells, d, 'travelpayouts', ask(prices, definition.id, [P]));
    expect(cells.outcomes(d, { cells: [P] })[0]?.reusedFromExecutionId).toBe(a);
  });

  it('copyReused refuses error sources and another provider before writing', () => {
    const { db, clock, cells, prices, definition, a } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    const errorOutcome = cells.outcomes(a, { cells: [X] })[0];
    if (errorOutcome === undefined) throw new Error('fixture');
    expect(() => reuse(cells, c, 'travelpayouts', [{ cell: X, outcome: errorOutcome, price: null }])).toThrow(
      expect.objectContaining({ rule: 'reuse-source' }),
    );
    expect(() => reuse(cells, c, 'searchapi', ask(prices, definition.id, ALL))).toThrow(
      expect.objectContaining({ rule: 'reuse-source' }),
    );
    expect(count(db, 'calendar_prices')).toBe(1);
  });

  it('copyReused refuses a copy the database does not hold: an amount the source never fetched, or a source from another definition (prov-r2-001)', () => {
    const { db, clock, cells, prices, definition } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    const real = find(ask(prices, definition.id, [P]), P);
    if (real.price === null) throw new Error('fixture: P is priced');
    const forged: ReusedCopy = {
      ...real,
      outcome: { ...real.outcome, minPence: 1 },
      price: { ...real.price, pricePence: 1, priceNativeMinor: 1 },
    }; // internally consistent
    expect(() => reuse(cells, c, 'travelpayouts', [forged])).toThrow(
      expect.objectContaining({ rule: 'reuse-source' }),
    );
    const other = new DefinitionsRepo(db, clock).create(exampleDefinitionInput({ name: 'Other' }));
    const o = newExecution(db, clock, { definition: other, status: 'completed' }).execution.id;
    cells.seed(o, [withNights(P)], ['travelpayouts']);
    cells.writeTile(o, 'travelpayouts', pricedTile([[P, 30_000]], T0));
    const foreign = find(
      prices.reuseCandidates(
        other.id,
        'travelpayouts',
        'economy',
        'unknown',
        'authorised-cached',
        [P],
        at('2026-10-14T11:00:00.000Z'),
      ),
      P,
    );
    expect(() => reuse(cells, c, 'travelpayouts', [foreign])).toThrow(
      expect.objectContaining({ rule: 'reuse-source' }),
    );
    expect(cells.outcomes(c, { cells: [P] })[0]?.status).toBe('not_run');
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM calendar_prices WHERE execution_id = ?').get(c)).toEqual(
      { n: 0 },
    );
  });

  // prov-r3-001: provenance the stored price never had is refused, field by field.
  const forgedProvenance: Array<[string, (p: CalendarPriceRow) => CalendarPriceRow]> = [
    ['maxAgeHours widened', (p) => ({ ...p, maxAgeHours: 720 })],
    ['providerObservedAt moved', (p) => ({ ...p, providerObservedAt: at('2026-10-14T11:59:00.000Z') })],
    ['vendorLink swapped', (p) => ({ ...p, vendorLink: 'https://www.aviasales.com/search/LON1403NYC28031' })],
    [
      'fx conversion hidden',
      (p) => ({ ...p, currencyNative: 'GBP', priceNativeMinor: p.pricePence, fx: { converted: false } }),
    ],
  ];
  it.each(forgedProvenance)('copyReused refuses a price whose %s, and writes nothing', (_name, forge) => {
    const { db, clock, cells, prices, definition } = world();
    const usd = cell(undefined, undefined, '2027-03-18', '2027-04-01');
    const b = newExecution(db, clock, { definition, status: 'completed' }).execution.id;
    cells.seed(b, [withNights(usd)], ['travelpayouts']);
    const converted = calendarPrice(usd, {
      currencyNative: 'USD',
      priceNativeMinor: 54_900,
      pricePence: 41_175,
      fx: {
        converted: true,
        rateNano: 750_000_000,
        rateDate: asIsoDate('2026-10-13'),
        source: 'frankfurter',
      },
    });
    cells.writeTile(b, 'travelpayouts', {
      tileIndex: 0,
      cells: [usd],
      discards: 0,
      prices: [converted],
      outcomes: [out(usd, 'priced', T0, 41_175)],
    });
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, [withNights(usd)], ['travelpayouts']);
    const real = find(ask(prices, definition.id, [usd]), usd);
    const realPrice = real.price;
    if (realPrice === null) throw new Error('fixture: priced');
    expect(() => reuse(cells, c, 'travelpayouts', [{ ...real, price: forge(realPrice) }])).toThrow(
      expect.objectContaining({ rule: 'reuse-source' }),
    );
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM calendar_prices WHERE execution_id = ?').get(c)).toEqual(
      { n: 0 },
    );
    reuse(cells, c, 'travelpayouts', [real]); // the unforged copy is accepted and stored with its conversion
    expect(
      prices.reuseCandidates(
        definition.id,
        'travelpayouts',
        'economy',
        'unknown',
        'authorised-cached',
        [usd],
        at('2026-10-14T11:00:00.000Z'),
      )[0]?.price?.fx,
    ).toEqual(converted.fx);
  });

  it('copyReused refuses a source fetched in another cabin than the target searches (prov-r3-002)', () => {
    const { db, clock, cells, prices, definition } = world();
    const business = new DefinitionsRepo(db, clock).update(definition.id, { cabin: 'business' });
    const c = newExecution(db, clock, { definition: business }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    expect(() => reuse(cells, c, 'travelpayouts', ask(prices, definition.id, [P]))).toThrow(
      expect.objectContaining({ rule: 'reuse-source' }),
    );
    expect(cells.outcomes(c, { cells: [P] })[0]?.status).toBe('not_run');
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM calendar_prices WHERE execution_id = ?').get(c)).toEqual(
      { n: 0 },
    );
  });

  // prov-005: each mismatch is refused before any write.
  const mismatches: Array<[string, (p: ReusedCopy) => ReusedCopy]> = [
    ['copy cell ≠ outcome cell', (p) => ({ ...p, cell: E })],
    [
      'price cell ≠ outcome cell',
      (p) => ({ ...p, price: p.price === null ? null : { ...p.price, cell: E } }),
    ],
    [
      'price provider',
      (p) => ({
        ...p,
        price:
          p.price === null ? null : { ...p.price, providerId: 'searchapi', sourceKind: 'scraped-aggregate' },
      }),
    ],
    [
      'price fetchedAt',
      (p) => ({
        ...p,
        price: p.price === null ? null : { ...p.price, fetchedAt: at('2026-10-14T11:30:00.000Z') },
      }),
    ],
    [
      'price ≠ minPence',
      (p) => ({
        ...p,
        price: p.price === null ? null : { ...p.price, pricePence: 39_999, priceNativeMinor: 39_999 },
      }),
    ],
    ['price cabin', (p) => ({ ...p, price: p.price === null ? null : { ...p.price, cabin: 'business' } })],
    [
      'price point of sale',
      (p) => ({ ...p, price: p.price === null ? null : { ...p.price, pointOfSale: 'GB' } }),
    ],
    ['outcome without provenance', (p) => ({ ...p, outcome: { ...p.outcome, sourceKind: null } })],
    ['priced without a price', (p) => ({ ...p, price: null })],
  ];
  it.each(mismatches)('copyReused refuses %s and writes nothing', (_name, mutate) => {
    const { db, clock, cells, prices, definition } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    expect(() =>
      reuse(cells, c, 'travelpayouts', [mutate(find(ask(prices, definition.id, [P]), P))]),
    ).toThrow(expect.objectContaining({ rule: 'reuse-source' }));
    expect(cells.outcomes(c, { cells: [P, E] }).map((o) => o.status)).toEqual(['not_run', 'not_run']);
    expect(count(db, 'calendar_prices')).toBe(1);
  });

  it('copies onto any outcome a resume would fetch again: retryable error (keeping its attempts), skipped:budget, skipped:provider_disabled (ssr M2)', () => {
    const { db, clock, cells, prices, definition } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    rawOutcome(db, c, E, 'discovery', 'travelpayouts', { status: 'error', reason: 'network', attempts: 2 });
    cells.setOutcome(c, P, 'discovery', 'travelpayouts', { status: 'skipped', reason: 'budget' });
    cells.setOutcome(c, N, 'discovery', 'travelpayouts', { status: 'skipped', reason: 'provider_disabled' });
    reuse(cells, c, 'travelpayouts', ask(prices, definition.id, ALL));
    const after = new Map(cells.outcomes(c, { cells: [E, P, N] }).map((o) => [cellKeyString(o), o]));
    expect([E, P, N].map((k) => after.get(cellKeyString(k))?.reusedFromExecutionId ?? null)).not.toContain(
      null,
    );
    expect([E, P, N].map((k) => after.get(cellKeyString(k))?.attempts)).toEqual([2, 0, 0]);
  });

  it.each([
    ['a non-retryable error', { status: 'error', reason: 'no-return-legs', attempts: 1 }],
    ['an error past its attempts', { status: 'error', reason: 'network', attempts: 3 }],
  ])('refuses %s as a target: no resume fetches it again (re-review N3)', (_name, fields) => {
    const { db, clock, cells, prices, definition } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    rawOutcome(db, c, P, 'discovery', 'travelpayouts', fields);
    expect(() => reuse(cells, c, 'travelpayouts', [find(ask(prices, definition.id, [P]), P)])).toThrow(
      expect.objectContaining({ rule: 'reuse-target' }),
    );
  });

  it('a later target that a resume would not fetch again rolls back the copies already written (test-011)', () => {
    const { db, clock, cells, prices, definition } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    cells.setOutcome(c, N, 'discovery', 'travelpayouts', { status: 'skipped', reason: 'departed' }); // N sorts after E and P
    expect(() => reuse(cells, c, 'travelpayouts', ask(prices, definition.id, ALL))).toThrow(
      expect.objectContaining({ rule: 'reuse-target' }),
    );
    expect(cells.outcomes(c, { cells: [E, P] }).map((o) => [o.status, o.reusedFromExecutionId])).toEqual([
      ['not_run', null],
      ['not_run', null],
    ]);
    expect(cells.rollUps(c).get(cellKeyString(P))?.discovery.status).toBe('not_run');
    expect(count(db, 'calendar_prices')).toBe(1);
  });

  it('a fresh tile write deletes only the reused row (supersede happens inside writeTile)', () => {
    const { db, clock, cells, prices, definition } = world();
    const c = newExecution(db, clock, { definition }).execution.id;
    cells.seed(c, ALL.map(withNights), ['travelpayouts']);
    reuse(cells, c, 'travelpayouts', ask(prices, definition.id, [P]));
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM calendar_prices WHERE execution_id = ?').get(c)).toEqual(
      { n: 1 },
    );
    cells.writeTile(c, 'travelpayouts', {
      tileIndex: 0,
      cells: [P],
      prices: [],
      outcomes: [
        {
          ...P,
          status: 'empty',
          reason: null,
          lastError: null,
          fetchedAt: clock.now(),
          minPence: null,
          cabin: 'economy',
          pointOfSale: 'unknown',
          sourceKind: 'authorised-cached',
        },
      ],
      discards: 0,
    });
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM calendar_prices WHERE execution_id = ?').get(c)).toEqual(
      { n: 0 },
    );
    expect(count(db, 'calendar_prices')).toBe(1);
    expect(cells.outcomes(c, { cells: [P] })[0]).toMatchObject({
      status: 'empty',
      reusedFromExecutionId: null,
    });
  });
});

describe('calendar-basis reads (spec §6.9, §6.8) ignore reused copies (test-001)', () => {
  it("with P reused into b (not fetched), latestPerCell, belowVerified and previousFor still return a's row", () => {
    const { db, clock, cells, prices, definition, a } = world();
    clock.advance(3_600_000);
    const b = newExecution(db, clock, { definition }).execution.id;
    cells.seed(b, [withNights(P)], ['travelpayouts']);
    reuse(cells, b, 'travelpayouts', ask(prices, definition.id, [P]));
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM calendar_prices WHERE execution_id = ?').get(b)).toEqual(
      { n: 1 },
    ); // the reused row exists
    const space = snapshotOf(definition).resolved;
    expect(
      prices
        .latestPerCell(definition.id, 'economy', space)
        .map((r) => [r.executionId, r.reusedFromExecutionId]),
    ).toEqual([[a, null]]);
    expect(prices.belowVerified(definition.id, 'economy', space, 40_001).map((r) => r.executionId)).toEqual([
      a,
    ]);
    expect(
      prices.previousFor(
        definition.id,
        'travelpayouts',
        'economy',
        P,
        at('2026-10-14T13:00:00.000Z'),
        at('2026-10-07T13:00:00.000Z'),
      )?.executionId,
    ).toBe(a);
    expect(prices.history(P.origin, P.destination, 'economy', {})).toEqual([
      { providerId: 'travelpayouts', points: [expect.objectContaining({ at: T0, pricePence: 40_000 })] },
    ]);
  });

  it('with P fetched fresh in b, the newer row wins and cabin and space apply', () => {
    const { db, clock, cells, prices, definition, a } = world();
    clock.advance(3_600_000);
    const b = newExecution(db, clock, { definition }).execution.id;
    cells.seed(b, [withNights(P)], ['travelpayouts']);
    cells.writeTile(b, 'travelpayouts', pricedTile([[P, 41_000]], clock.now()));
    const space = snapshotOf(definition).resolved;
    const rows = prices.latestPerCell(definition.id, 'economy', space);
    expect(rows.map((r) => [r.executionId, r.pricePence, r.reusedFromExecutionId])).toEqual([
      [b, 41_000, null],
    ]);
    expect(rows[0]?.provenance).toMatchObject({
      providerId: 'travelpayouts',
      fetchedAt: '2026-10-14T13:00:00.000Z',
      maxAgeHours: 48,
      fx: { converted: false },
    });
    expect(prices.latestPerCell(definition.id, 'economy', null)).toHaveLength(1);
    expect(prices.latestPerCell(definition.id, 'business', space)).toEqual([]);
    expect(prices.latestPerCell(definition.id, 'economy', { ...space, minNights: 15 })).toEqual([]);
    expect(prices.belowVerified(definition.id, 'economy', space, 41_001).map((r) => r.pricePence)).toEqual([
      41_000,
    ]);
    expect(prices.belowVerified(definition.id, 'economy', space, 41_000)).toEqual([]);
    expect(
      prices.previousFor(
        definition.id,
        'travelpayouts',
        'economy',
        P,
        at('2026-10-14T13:00:00.000Z'),
        at('2026-10-07T13:00:00.000Z'),
      ),
    ).toMatchObject({ executionId: a, pricePence: 40_000 });
    expect(
      prices.previousFor(
        definition.id,
        'travelpayouts',
        'economy',
        P,
        at('2026-10-14T13:00:00.000Z'),
        at('2026-10-14T12:00:00.001Z'),
      ),
    ).toBeNull();
  });
});

describe('route history (ruling 8, po-001): one point per provider and execution fetch', () => {
  it("two cells, two fetches: each point is that fetch's cheapest cell, with its full cell, execution and provenance; reused copies and children add nothing", () => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const cells = new CellsRepo(db, clock, opts);
    const prices = new CalendarPricesRepo(db, clock, opts);
    const { definition, execution: a } = newExecution(db, clock, { status: 'completed' });
    const Q = cell(undefined, undefined, '2027-03-21', '2027-04-04');
    const late = cell(undefined, undefined, '2027-05-01', '2027-05-15'); // outside the definition's window (ends 2027-04-20)
    cells.seed(a.id, [P, Q, late].map(withNights), ['travelpayouts']);
    cells.writeTile(
      a.id,
      'travelpayouts',
      pricedTile(
        [
          [P, 40_000],
          [Q, 38_000],
          [late, 20_000],
        ],
        T0,
      ),
    );
    clock.advance(3_600_000);
    const b = newExecution(db, clock, { definition, status: 'completed' }).execution.id;
    cells.seed(b, [P, Q].map(withNights), ['travelpayouts']);
    cells.writeTile(
      b,
      'travelpayouts',
      pricedTile(
        [
          [P, 41_000],
          [Q, 42_000],
        ],
        clock.now(),
      ),
    );
    clock.advance(3_600_000);
    const c = newExecution(db, clock, { definition }).execution.id; // reuses only
    cells.seed(c, [withNights(P)], ['travelpayouts']);
    reuse(cells, c, 'travelpayouts', ask(prices, definition.id, [P], '2026-10-14T00:00:00.000Z'), {
      ...CRITERIA,
      newerThan: at('2026-10-14T00:00:00.000Z'),
    });
    const child = newExecution(db, clock, { definition, cell: Q }).execution.id;
    cells.seed(child, [withNights(Q)], ['travelpayouts']);
    cells.writeTile(child, 'travelpayouts', pricedTile([[Q, 30_000]], clock.now()));
    const other = new DefinitionsRepo(db, clock).create(exampleDefinitionInput({ name: 'Other' }));
    const o = newExecution(db, clock, { definition: other, status: 'completed' }).execution.id;
    cells.seed(o, [withNights(P)], ['travelpayouts']);
    cells.writeTile(o, 'travelpayouts', pricedTile([[P, 35_000]], clock.now()));

    const all = prices.history(P.origin, P.destination, 'economy');
    expect(
      all.map((s) => [
        s.providerId,
        s.points.map((p) => [p.at, p.pricePence, p.cell.departureDate, p.cell.nights, p.executionId]),
      ]),
    ).toEqual([
      [
        'travelpayouts',
        [
          [T0, 20_000, '2027-05-01', 14, a.id],
          ['2026-10-14T13:00:00.000Z', 41_000, '2027-03-14', 14, b],
          ['2026-10-14T14:00:00.000Z', 35_000, '2027-03-14', 14, o],
        ],
      ],
    ]);
    const scoped = prices.history(P.origin, P.destination, 'economy', { definitionId: definition.id });
    expect(scoped[0]?.points.map((p) => [p.at, p.pricePence, cellKeyString(p.cell), p.executionId])).toEqual([
      [T0, 38_000, cellKeyString(Q), a.id],
      ['2026-10-14T13:00:00.000Z', 41_000, cellKeyString(P), b],
    ]);
    expect(scoped[0]?.points[0]?.provenance).toMatchObject({
      providerId: 'travelpayouts',
      fetchedAt: T0,
      cabin: 'economy',
    });
    expect(prices.history(P.origin, P.destination, 'business', {})).toEqual([]);
    expect(() => prices.history(P.origin, P.destination, 'economy', { definitionId: 'missing' })).toThrow(
      expect.objectContaining({ rule: 'missing' }),
    );
  });
});
