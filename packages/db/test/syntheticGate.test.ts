import { type CellKey, fixedClock, type SourceKind } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CellsRepo } from '../src/repositories/cells.js';
import { ExecutionsRepo } from '../src/repositories/executions.js';
import { ItinerariesRepo } from '../src/repositories/itineraries.js';
import type { ReusedCopy, TileWrite, VerifiedCellWrite } from '../src/types.js';
import { at, count, freshDb, sqliteCode, T0 } from './helpers/db.js';
import { cell, EWR, itinerary, newExecution, observationWrite, withNights } from './helpers/factories.js';

const A = cell();
const B = cell(undefined, EWR);

/** One database, two views of it: the gate open (tests, smoke) and closed (production). */
function world() {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { definition, execution } = newExecution(db, clock);
  const open = new CellsRepo(db, clock, { allowSynthetic: true });
  const closed = new CellsRepo(db, clock, { allowSynthetic: false });
  open.seed(execution.id, [A, B].map(withNights), ['fixture', 'travelpayouts']);
  return {
    db,
    clock,
    definition,
    executionId: execution.id,
    open,
    closed,
    itOpen: new ItinerariesRepo(db, clock, { allowSynthetic: true }),
    itClosed: new ItinerariesRepo(db, clock, { allowSynthetic: false }),
  };
}
type World = ReturnType<typeof world>;
const gate = expect.objectContaining({ rule: 'synthetic-gate' });
const kind = expect.objectContaining({ rule: 'provider-kind' });
const tile = (c: CellKey, sourceKind: SourceKind): TileWrite => ({
  tileIndex: 0,
  cells: [c],
  prices: [],
  discards: 0,
  outcomes: [
    {
      ...c,
      status: 'empty',
      reason: null,
      lastError: null,
      fetchedAt: T0,
      minPence: null,
      cabin: 'economy',
      pointOfSale: 'unknown',
      sourceKind,
    },
  ],
});
const verified = (c: CellKey, sourceKind: SourceKind): VerifiedCellWrite => ({
  cell: c,
  itineraries: [],
  outcome: {
    ...c,
    status: 'empty',
    reason: null,
    lastError: null,
    fetchedAt: T0,
    minPence: null,
    cabin: 'economy',
    pointOfSale: 'unknown',
    sourceKind,
  },
});

describe('gate-only paths: fixture refused when closed, accepted when open (ruling 1)', () => {
  const paths: Array<[string, (w: World, repo: 'open' | 'closed') => unknown, (w: World) => number]> = [
    [
      'seed',
      (w, r) => {
        const e = newExecution(w.db, w.clock).execution.id;
        return w[r].seed(e, [withNights(A)], ['fixture']);
      },
      (w) => count(w.db, 'cell_outcomes'),
    ],
    [
      'seedVerification',
      (w, r) => w[r].seedVerification(w.executionId, [{ cell: A, reason: 'top_n' }], [A], ['fixture']),
      (w) => count(w.db, 'cell_outcomes'),
    ],
    [
      'setOutcome',
      (w, r) =>
        w[r].setOutcome(w.executionId, A, 'discovery', 'fixture', { status: 'error', reason: 'upstream' }),
      (w) =>
        w.open.outcomes(w.executionId, { providerId: 'fixture' }).filter((o) => o.status === 'error').length,
    ],
    [
      'setOutcomesForProvider',
      (w, r) =>
        w[r].setOutcomesForProvider(w.executionId, 'discovery', 'fixture', ['not_run'], {
          status: 'skipped',
          reason: 'provider_disabled',
        }),
      (w) =>
        w.open.outcomes(w.executionId, { providerId: 'fixture' }).filter((o) => o.status === 'skipped')
          .length,
    ],
    [
      'markNoData',
      (w, r) => w[r].markNoData(w.executionId, 'discovery', 'fixture', 'cabin-not-offered'),
      (w) =>
        w.open.outcomes(w.executionId, { providerId: 'fixture' }).filter((o) => o.status === 'no_data')
          .length,
    ],
    [
      'writeTileError',
      (w, r) => w[r].writeTileError(w.executionId, 'fixture', [A], 'upstream', null),
      (w) =>
        w.open.outcomes(w.executionId, { providerId: 'fixture' }).filter((o) => o.status === 'error').length,
    ],
    [
      'recordObservation',
      (w, r) => {
        w.itOpen.upsertItinerary(itinerary());
        return (r === 'open' ? w.itOpen : w.itClosed).recordObservation(
          { itineraryHash: 'a'.repeat(64), providerId: 'fixture', seller: 'Fixture', cabin: 'economy' },
          {
            ...observationWrite({
              provenance: {
                ...observationWrite().provenance,
                providerId: 'fixture',
                sourceKind: 'synthetic',
              },
            }),
            executionId: w.executionId,
          },
        );
      },
      (w) => count(w.db, 'fare_offers'),
    ],
  ];

  it.each(paths)('%s', (_name, write, written) => {
    const w = world();
    const before = written(w);
    expect(() => write(w, 'closed')).toThrow(gate);
    expect(written(w)).toBe(before);
    write(w, 'open');
    expect(written(w)).toBeGreaterThan(before);
  });
});

describe('paths carrying a source kind: the gate and fixture ⇔ synthetic, both directions (ruling 1)', () => {
  it('writeTile', () => {
    const w = world();
    expect(() => w.closed.writeTile(w.executionId, 'fixture', tile(A, 'synthetic'))).toThrow(gate);
    expect(() => w.open.writeTile(w.executionId, 'fixture', tile(A, 'authorised-cached'))).toThrow(kind);
    expect(() => w.open.writeTile(w.executionId, 'travelpayouts', tile(A, 'synthetic'))).toThrow(kind);
    expect(w.open.outcomes(w.executionId, { cells: [A] }).map((o) => o.status)).toEqual([
      'not_run',
      'not_run',
    ]);
    w.open.writeTile(w.executionId, 'fixture', tile(A, 'synthetic'));
    expect(w.open.outcomes(w.executionId, { cells: [A], providerId: 'fixture' })[0]).toMatchObject({
      status: 'empty',
      sourceKind: 'synthetic',
    });
  });

  it('writeVerifiedCell', () => {
    const w = world();
    w.open.seedVerification(
      w.executionId,
      [
        { cell: A, reason: 'top_n' },
        { cell: B, reason: 'top_n' },
      ],
      [A, B],
      ['fixture', 'searchapi'],
    );
    expect(() => w.closed.writeVerifiedCell(w.executionId, 'fixture', verified(A, 'synthetic'))).toThrow(
      gate,
    );
    expect(() => w.open.writeVerifiedCell(w.executionId, 'fixture', verified(A, 'scraped-search'))).toThrow(
      kind,
    );
    expect(() => w.open.writeVerifiedCell(w.executionId, 'searchapi', verified(A, 'synthetic'))).toThrow(
      kind,
    );
    w.open.writeVerifiedCell(w.executionId, 'fixture', verified(A, 'synthetic'));
    expect(
      w.open.outcomes(w.executionId, { stage: 'verification', providerId: 'fixture', cells: [A] })[0]?.status,
    ).toBe('empty');
  });

  it('writeVerifiedCell with a fixture offer writes no itinerary, offer or observation while the gate is closed', () => {
    const w = world();
    w.open.seedVerification(w.executionId, [{ cell: A, reason: 'top_n' }], [A], ['fixture']);
    const fixtureObservation = observationWrite({
      provenance: {
        providerId: 'fixture',
        sourceKind: 'synthetic',
        fetchedAt: T0,
        maxAgeHours: 0,
        fx: { converted: false },
        pointOfSale: 'unknown',
        cabin: 'economy',
      },
    });
    const write: VerifiedCellWrite = {
      cell: A,
      outcome: { ...verified(A, 'synthetic').outcome, status: 'priced', minPence: 41_200 },
      itineraries: [
        {
          itinerary: itinerary(),
          offers: [
            {
              offer: {
                itineraryHash: 'a'.repeat(64),
                providerId: 'fixture',
                seller: 'Fixture',
                cabin: 'economy',
              },
              observation: fixtureObservation,
            },
          ],
        },
      ],
    };
    expect(() => w.closed.writeVerifiedCell(w.executionId, 'fixture', write)).toThrow(gate);
    expect([
      count(w.db, 'itineraries'),
      count(w.db, 'fare_offers'),
      count(w.db, 'price_observations'),
    ]).toEqual([0, 0, 0]);
    w.open.writeVerifiedCell(w.executionId, 'fixture', write);
    expect(count(w.db, 'price_observations')).toBe(1);
  });

  it('copyReused', () => {
    const w = world();
    w.open.writeTile(w.executionId, 'fixture', tile(A, 'synthetic'));
    const source = w.open.outcomes(w.executionId, { cells: [A], providerId: 'fixture' })[0];
    if (source === undefined) throw new Error('fixture outcome missing');
    new ExecutionsRepo(w.db, w.clock).setStatus(w.executionId, 'completed'); // the source is a finished parent of the same definition (prov-r2-001)
    const target = newExecution(w.db, w.clock, { definition: w.definition }).execution.id;
    w.open.seed(target, [withNights(A)], ['fixture', 'travelpayouts']);
    const copy: ReusedCopy = { cell: A, outcome: source, price: null };
    const criteria = {
      pointOfSale: 'unknown',
      sourceKind: 'synthetic',
      newerThan: at('2026-10-14T00:00:00.000Z'),
    } as const;
    expect(() => w.closed.copyReused(target, 'fixture', [copy], criteria)).toThrow(gate);
    expect(() =>
      w.open.copyReused(
        target,
        'fixture',
        [{ ...copy, outcome: { ...source, sourceKind: 'authorised-cached' } }],
        criteria,
      ),
    ).toThrow(kind);
    expect(() =>
      w.open.copyReused(
        target,
        'travelpayouts',
        [{ ...copy, outcome: { ...source, providerId: 'travelpayouts' } }],
        criteria,
      ),
    ).toThrow(kind);
    w.open.copyReused(target, 'fixture', [copy], criteria);
    expect(w.open.outcomes(target, { providerId: 'fixture' })[0]).toMatchObject({
      status: 'empty',
      sourceKind: 'synthetic',
      reusedFromExecutionId: w.executionId,
    });
  });

  it('cell_outcomes enforces fixture ⇔ synthetic in SQL, both directions', () => {
    const w = world();
    const raw = (providerId: string, sourceKind: string) => () =>
      w.db.raw
        .prepare(
          `UPDATE cell_outcomes SET status = 'empty', fetched_at = ?, cabin = 'economy', point_of_sale = 'unknown', source_kind = ? WHERE provider_id = ? AND departure_date = '2027-03-14' AND destination = 'JFK'`,
        )
        .run(T0, sourceKind, providerId);
    expect(sqliteCode(raw('fixture', 'authorised-cached'))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(sqliteCode(raw('travelpayouts', 'synthetic'))).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(raw('fixture', 'synthetic')).not.toThrow();
  });
});
