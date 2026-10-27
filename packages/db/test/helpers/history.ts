// WP19 Task 19.2: a definition with several parent runs, reused copies, truncated tiles and on-demand children, written
// through the repositories' own atomic units, for the grouped reads' reference tests. The reference algorithms (the
// per-execution and per-cell reads the grouped reads replace) live in the test files beside them.
import {
  type CellKey,
  cellKeyString,
  fixedClock,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  type ProviderId,
  type SourceKind,
} from '@gmt/core';
import { vi } from 'vitest';
import type { Db } from '../../src/client.js';
import { CalendarPricesRepo } from '../../src/repositories/calendarPrices.js';
import { CellsRepo } from '../../src/repositories/cells.js';
import { DefinitionsRepo } from '../../src/repositories/definitions.js';
import { ExecutionsRepo } from '../../src/repositories/executions.js';
import { ItinerariesRepo } from '../../src/repositories/itineraries.js';
import { freshDb, T0 } from './db.js';
import {
  calendarPrice,
  cell,
  EWR,
  exampleDefinitionInput,
  itinerary,
  JFK,
  LGW,
  LHR,
  newExecution,
  observationWrite,
  withNights,
} from './factories.js';

const HOUR = 3_600_000;
export const hoursAfterT0 = (h: number): IsoDateTime => isoDateTimeOfEpochMs(Date.parse(T0) + h * HOUR);

/** The two discovery providers and the source kind each writes (spec §5.5). */
export const DISCOVERY: ReadonlyArray<{ providerId: ProviderId; sourceKind: SourceKind }> = [
  { providerId: 'travelpayouts', sourceKind: 'authorised-cached' },
  { providerId: 'searchapi', sourceKind: 'scraped-aggregate' },
];

/** Eight cells of the worked example: two departures, two origins, two destinations, 14 nights. */
export const CELLS: CellKey[] = ['2027-03-14', '2027-03-15'].flatMap((dep) =>
  [LGW, LHR].flatMap((o) =>
    [EWR, JFK].map((d) => {
      const ret = dep === '2027-03-14' ? '2027-03-28' : '2027-03-29';
      return cell(o, d, dep, ret);
    }),
  ),
);

type Fate = 'priced' | 'truncated' | 'empty' | 'no_data' | 'error' | 'skipped' | 'reused' | 'not_run';
const FATES: readonly Fate[] = [
  'priced',
  'empty',
  'truncated',
  'no_data',
  'error',
  'reused',
  'skipped',
  'not_run',
];

/** A deterministic, well-mixed fate per (run, provider, cell). */
export function fateOf(run: number, provider: number, c: number): Fate {
  return FATES[(run * 5 + provider * 3 + c * 7 + run * c) % FATES.length] ?? 'not_run';
}

/**
 * Five parent runs one hour apart (the fourth and fifth created in the same second, so the executions' rowid breaks
 * their tie), each giving every (provider, cell) a fate; a sixth definition's run elsewhere; two completed children and
 * a failed one; every outcome through the repositories.
 */
export function historySeed() {
  const db = freshDb();
  const clock = fixedClock(T0);
  const repoOpts = { allowSynthetic: true };
  const cells = new CellsRepo(db, clock, repoOpts);
  const prices = new CalendarPricesRepo(db, clock, repoOpts);
  const itineraries = new ItinerariesRepo(db, clock, repoOpts);
  const executions = new ExecutionsRepo(db, clock);
  const definitions = new DefinitionsRepo(db, clock);
  const definition = definitions.create(exampleDefinitionInput());
  const runs: string[] = [];
  for (let run = 0; run < 5; run++) {
    if (run !== 4) clock.set(hoursAfterT0(run * 24));
    const { execution } = newExecution(db, clock, { definition, status: 'completed' });
    runs.push(execution.id);
    cells.seed(
      execution.id,
      CELLS.map(withNights),
      DISCOVERY.map((d) => d.providerId),
    );
    const fetchedAt = clock.now();
    DISCOVERY.forEach(({ providerId, sourceKind }, p) => {
      CELLS.forEach((c, i) => {
        const fate = fateOf(run, p, i);
        const base = {
          ...c,
          reason: null,
          fetchedAt,
          cabin: 'economy' as const,
          pointOfSale: 'unknown',
          sourceKind,
        };
        if (fate === 'priced' || fate === 'truncated') {
          const pricePence = 30_000 + run * 1_000 + i * 100 + p * 10;
          cells.writeTile(execution.id, providerId, {
            tileIndex: i,
            cells: [c],
            discards: 0,
            prices: [
              calendarPrice(c, {
                providerId,
                sourceKind,
                pricePence,
                priceNativeMinor: pricePence,
                fetchedAt,
              }),
            ],
            outcomes: [
              {
                ...base,
                status: 'priced',
                lastError: fate === 'truncated' ? `truncated: run ${run}` : null,
                minPence: pricePence,
              },
            ],
          });
        } else if (fate === 'empty' || fate === 'no_data') {
          cells.writeTile(execution.id, providerId, {
            tileIndex: i,
            cells: [c],
            discards: 0,
            prices: [],
            outcomes: [{ ...base, status: fate, lastError: null, minPence: null }],
          });
        } else if (fate === 'error') {
          cells.writeTileError(execution.id, providerId, [c], 'upstream', 'HTTP 503');
        } else if (fate === 'skipped') {
          cells.setOutcome(execution.id, c, 'discovery', providerId, { status: 'skipped', reason: 'budget' });
        } else if (fate === 'reused' && run > 0) {
          const copies = prices.reuseCandidates(
            definition.id,
            providerId,
            'economy',
            'unknown',
            sourceKind,
            [c],
            hoursAfterT0(-1),
          );
          if (copies.length > 0)
            cells.copyReused(execution.id, providerId, copies, {
              pointOfSale: 'unknown',
              sourceKind,
              newerThan: hoursAfterT0(-1),
            });
        }
      });
    });
  }
  // another definition's run over the same cells never counts as a search of this one
  const other = definitions.create(exampleDefinitionInput({ name: 'Elsewhere' }));
  clock.set(hoursAfterT0(200));
  const { execution: foreign } = newExecution(db, clock, { definition: other, status: 'completed' });
  cells.seed(foreign.id, CELLS.map(withNights), ['travelpayouts']);
  for (const c of CELLS)
    cells.writeTile(foreign.id, 'travelpayouts', {
      tileIndex: 0,
      cells: [c],
      discards: 0,
      prices: [],
      outcomes: [
        {
          ...c,
          status: 'empty',
          reason: null,
          lastError: null,
          minPence: null,
          fetchedAt: clock.now(),
          cabin: 'economy',
          pointOfSale: 'unknown',
          sourceKind: 'authorised-cached',
        },
      ],
    });
  // on-demand children: two completed (one priced, one with an error), one cancelled
  const children: string[] = [];
  const childCells = [CELLS[0], CELLS[1], CELLS[2]].flatMap((c) => (c === undefined ? [] : [c]));
  childCells.forEach((c, i) => {
    clock.set(hoursAfterT0(210 + i));
    const { execution } = newExecution(db, clock, {
      definition,
      cell: c,
      status: i === 2 ? 'cancelled' : 'completed',
    });
    children.push(execution.id);
    cells.seed(execution.id, [withNights(c)], []);
    cells.seedVerification(execution.id, [{ cell: c, reason: 'always_include' }], [c], ['searchapi']);
    if (i === 1)
      cells.setOutcome(execution.id, c, 'verification', 'searchapi', { status: 'error', reason: 'upstream' });
    else verifiedCell(cells, execution.id, c, [`${'c'.repeat(63)}${i}`], clock.now());
  });
  clock.set(hoursAfterT0(240));
  return { db, clock, cells, prices, itineraries, executions, definition, runs, children };
}

/** One searchapi-verified cell with one offer per hash, all fetched at `fetchedAt`. */
export function verifiedCell(
  cells: CellsRepo,
  executionId: string,
  c: CellKey,
  hashes: readonly string[],
  fetchedAt: IsoDateTime,
  providerId: 'searchapi' | 'fixture' = 'searchapi',
): void {
  const provenance = {
    ...observationWrite().provenance,
    providerId,
    sourceKind: providerId === 'fixture' ? ('synthetic' as const) : ('scraped-search' as const),
    fetchedAt,
  };
  cells.writeVerifiedCell(executionId, providerId, {
    cell: c,
    outcome: {
      ...c,
      status: 'priced',
      reason: null,
      lastError: null,
      fetchedAt,
      minPence: 41_200,
      cabin: 'economy',
      pointOfSale: 'GB',
      sourceKind: provenance.sourceKind,
    },
    itineraries: hashes.map((hash, k) => ({
      itinerary: itinerary(hash, c, 100 + (k % 800)),
      offers: [
        {
          offer: { itineraryHash: hash, providerId, seller: 'British Airways', cabin: 'economy' },
          observation: observationWrite({ provenance, booking: { kind: 'none' } }),
        },
      ],
    })),
  });
}

/** The number of statements `fn` prepares (better-sqlite3 prepares one per statement). */
export function statementsOf<T>(db: Db, fn: () => T): { result: T; statements: number } {
  const spy = vi.spyOn(db.raw, 'prepare');
  try {
    const result = fn();
    return { result, statements: spy.mock.calls.length };
  } finally {
    spy.mockRestore();
  }
}

/** A stable key for comparing row sets regardless of order. */
export const byCell = <T extends { providerId?: string; cell: CellKey }>(rows: readonly T[]): T[] =>
  [...rows].sort((a, b) => {
    const ka = `${a.providerId ?? ''}|${cellKeyString(a.cell)}`;
    const kb = `${b.providerId ?? ''}|${cellKeyString(b.cell)}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
