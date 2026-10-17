import { type CellKey, cellKeyString, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { RowRejected } from '../src/internal/validate.js';
import { CellsRepo } from '../src/repositories/cells.js';
import { ItinerariesRepo } from '../src/repositories/itineraries.js';
import type { VerifiedCellWrite } from '../src/types.js';
import { freshDb, T0 } from './helpers/db.js';
import { cell, EWR, itinerary, newExecution, observationWrite, withNights } from './helpers/factories.js';

const CONFIRMED = ['segments', 'segmentTimes', 'segmentCabins', 'price', 'seller', 'baggage'] as const;
const UNCONFIRMED = ['segments', 'segmentTimes', 'seller', 'baggage'] as const;

function seeded() {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { execution } = newExecution(db, clock);
  const cells = new CellsRepo(db, clock, { allowSynthetic: false });
  const repo = new ItinerariesRepo(db, clock, { allowSynthetic: false });
  const all = [cell(), cell(undefined, EWR)];
  cells.seed(execution.id, all.map(withNights), []);
  cells.seedVerification(execution.id, [{ cell: cell(), reason: 'top_n' }], all, ['searchapi']);
  return { executionId: execution.id, cells, repo };
}

/** One verified cell with one offer per entry; `minPence` and `reason` as the engine computes them (decision 45). */
function write(
  c: CellKey,
  offers: Array<{ seller: string; pence: number; confirmed: boolean }>,
  reason: string | null,
  minPence: number,
): VerifiedCellWrite {
  const hash = 'a'.repeat(64);
  return {
    cell: c,
    outcome: {
      ...c,
      status: 'priced',
      reason,
      lastError: null,
      fetchedAt: T0,
      minPence,
      cabin: 'economy',
      pointOfSale: 'GB',
      sourceKind: 'scraped-search',
    },
    itineraries: [
      {
        itinerary: itinerary(hash, c),
        offers: offers.map((o) => ({
          offer: { itineraryHash: hash, providerId: 'searchapi', seller: o.seller, cabin: 'economy' },
          observation: observationWrite({
            pricePence: o.pence,
            priceNativeMinor: o.pence,
            suppliedFields: [...(o.confirmed ? CONFIRMED : UNCONFIRMED)],
            segmentCabins: o.confirmed ? ['economy', 'economy'] : null,
          }),
        })),
      },
    ],
  };
}

const bestPrice = (repo: ItinerariesRepo, executionId: string, c: CellKey) => {
  const id = repo.bestObservationForCell(executionId, c);
  return repo.writtenBy(executionId).find((o) => o.id === id)?.pricePence ?? null;
};

describe('confirmed prices in a verified cell (decision 45)', () => {
  it('a cheaper unconfirmed offer never becomes the cell price or its best observation', () => {
    const { executionId, cells, repo } = seeded();
    cells.writeVerifiedCell(
      executionId,
      'searchapi',
      write(
        cell(),
        [
          { seller: 'Mytrip', pence: 30_000, confirmed: false },
          { seller: 'British Airways', pence: 41_200, confirmed: true },
        ],
        null,
        41_200,
      ),
    );
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification).toEqual({
      status: 'priced',
      reason: null,
      minPence: 41_200,
    });
    expect(bestPrice(repo, executionId, cell())).toBe(41_200);
  });

  it('with no confirmed offer the outcome says price-unconfirmed, the roll-up has no price, and best falls back to the cheapest', () => {
    const { executionId, cells, repo } = seeded();
    const offers = [
      { seller: 'Mytrip', pence: 30_000, confirmed: false },
      { seller: 'Kiwi', pence: 33_000, confirmed: false },
    ];
    expect(() =>
      cells.writeVerifiedCell(executionId, 'searchapi', write(cell(), offers, null, 30_000)),
    ).toThrow(RowRejected);
    cells.writeVerifiedCell(executionId, 'searchapi', write(cell(), offers, 'price-unconfirmed', 30_000));
    expect(cells.outcomes(executionId, { stage: 'verification', cells: [cell()] })[0]).toMatchObject({
      status: 'priced',
      reason: 'price-unconfirmed',
      minPence: 30_000,
    });
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification).toEqual({
      status: 'priced',
      reason: 'price-unconfirmed',
      minPence: null,
    });
    expect(bestPrice(repo, executionId, cell())).toBe(30_000);
  });

  it('a later confirmed write replaces an unconfirmed best even when dearer; a cheaper unconfirmed one never displaces it', () => {
    const { executionId, cells, repo } = seeded();
    cells.writeVerifiedCell(
      executionId,
      'searchapi',
      write(cell(), [{ seller: 'Mytrip', pence: 30_000, confirmed: false }], 'price-unconfirmed', 30_000),
    );
    cells.writeVerifiedCell(
      executionId,
      'searchapi',
      write(cell(), [{ seller: 'British Airways', pence: 45_000, confirmed: true }], null, 45_000),
    );
    expect(bestPrice(repo, executionId, cell())).toBe(45_000);
    cells.writeVerifiedCell(
      executionId,
      'searchapi',
      write(cell(), [{ seller: 'Kiwi', pence: 20_000, confirmed: false }], 'price-unconfirmed', 20_000),
    );
    expect(bestPrice(repo, executionId, cell())).toBe(45_000);
    expect(cells.rollUps(executionId).get(cellKeyString(cell()))?.verification.minPence).toBe(45_000);
  });

  it('the closed priced-reason set accepts the part in its place only', () => {
    const { executionId, cells } = seeded();
    const bad = write(
      cell(),
      [{ seller: 'Mytrip', pence: 30_000, confirmed: false }],
      'offers-dropped:1;price-unconfirmed',
      30_000,
    );
    expect(() => cells.writeVerifiedCell(executionId, 'searchapi', bad)).toThrow(RowRejected);
  });
});
