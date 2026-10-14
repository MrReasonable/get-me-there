import {
  type Cabin,
  type Cell,
  type CellKey,
  type Clock,
  cellKeyString,
  type HistoryPoint,
  type Iata,
  type IsoDateTime,
  type PointOfSale,
  type ProviderId,
  type ResolvedSpace,
  resolveWindow,
  type SourceKind,
} from '@gmt/core';
import type { Db } from '../client.js';
import { type DefinitionDbRow, readDefinition } from '../internal/definitionRow.js';
import { type OutcomeDbRow, toOutcome } from '../internal/outcomeRow.js';
import {
  type CalendarPriceDbRow,
  insertCalendarPrice,
  toCalendarPriceRow,
  validateCalendarPrice,
} from '../internal/priceRow.js';
import { RowCorrupt } from '../internal/read.js';
import { assertIsoDateTime, RowRejected } from '../internal/validate.js';
import type { CalendarPriceInsert, CalendarPriceRow, RepoOptions, ReusedCopy } from '../types.js';

/**
 * Spec §8.1 reuse source: per cell, the newest priced|empty|no_data discovery outcome for the same definition,
 * provider, cabin, point of sale and source kind, from a non-child execution, whose original `fetched_at` is newer
 * than the cutoff (the engine passes now − 0.9 × discoveryRefreshHours).
 */
const REUSE_CANDIDATES_SQL = `
WITH ranked AS (
  SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.origin, o.destination, o.departure_date, o.return_date ORDER BY o.fetched_at DESC, e.created_at DESC, e.rowid DESC) AS rn
  FROM cell_outcomes o JOIN search_executions e ON e.id = o.execution_id
  WHERE e.definition_id = @definitionId AND e.is_child = 0 AND o.stage = 'discovery' AND o.provider_id = @providerId
    AND o.status IN ('priced', 'empty', 'no_data') AND o.cabin = @cabin AND o.point_of_sale = @pointOfSale AND o.source_kind = @sourceKind AND o.fetched_at > @newerThan
)
SELECT * FROM ranked WHERE rn = 1 ORDER BY origin, destination, departure_date, return_date`;

const PRICE_FOR_OUTCOME_SQL = `SELECT * FROM calendar_prices WHERE execution_id = @executionId AND provider_id = @providerId
  AND origin = @origin AND destination = @destination AND departure_date = @departureDate AND return_date = @returnDate`;

/** Nights of a stored cell, computed in SQL the same way `withNights` does (UTC calendar days). */
const NIGHTS = 'CAST(julianday(p.return_date) - julianday(p.departure_date) AS INTEGER)';

/** Spec §6.9 calendar basis: latest fetched per (provider, cell) in the cabin, reused copies ignored, inside the space when given. */
const LATEST_PER_CELL_SQL = `
WITH ranked AS (
  SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.provider_id, p.origin, p.destination, p.departure_date, p.return_date ORDER BY p.fetched_at DESC, p.id DESC) AS rn
  FROM calendar_prices p JOIN search_executions e ON e.id = p.execution_id
  WHERE e.definition_id = @definitionId AND p.cabin = @cabin AND p.reused_from_execution_id IS NULL
    AND (@spaced = 0 OR (p.origin IN (SELECT value FROM json_each(@origins)) AND p.destination IN (SELECT value FROM json_each(@destinations))
         AND p.departure_date BETWEEN @from AND @to AND ${NIGHTS} BETWEEN @minNights AND @maxNights))
)
SELECT * FROM ranked WHERE rn = 1 ORDER BY origin, destination, departure_date, return_date, provider_id`;

/**
 * Ruling 8: per (provider, execution) the cheapest fetched price on the pair (ties: earliest fetched, lowest id).
 * Children are excluded: a child fetches one cell, which is not a route minimum.
 */
const HISTORY_SQL = `
WITH ranked AS (
  SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.provider_id, p.execution_id ORDER BY p.price_pence, p.fetched_at, p.id) AS rn
  FROM calendar_prices p JOIN search_executions e ON e.id = p.execution_id
  WHERE p.origin = @origin AND p.destination = @destination AND p.cabin = @cabin AND p.reused_from_execution_id IS NULL AND e.is_child = 0
    AND (@definitionId IS NULL OR (e.definition_id = @definitionId AND p.departure_date BETWEEN @from AND @to AND ${NIGHTS} BETWEEN @minNights AND @maxNights))
)
SELECT ranked.*, CAST(julianday(return_date) - julianday(departure_date) AS INTEGER) AS nights FROM ranked WHERE rn = 1 ORDER BY provider_id, fetched_at, id`;

const spaceParams = (space: ResolvedSpace | null) => ({
  spaced: space === null ? 0 : 1,
  origins: JSON.stringify(space?.origins ?? []),
  destinations: JSON.stringify(space?.destinations ?? []),
  from: space?.departureFrom ?? '',
  to: space?.departureTo ?? '',
  minNights: space?.minNights ?? 0,
  maxNights: space?.maxNights ?? 0,
});

/** Spec §7 `calendar_prices`. Insert-only except the reused-row supersede. */
export class CalendarPricesRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly opts: RepoOptions,
  ) {}

  /** Validates every row, then inserts all in one transaction and returns the ids in order. A UNIQUE conflict throws SqliteError. */
  insert(executionId: string, rows: CalendarPriceInsert[]): number[] {
    for (const r of rows) validateCalendarPrice(r, this.opts.allowSynthetic, true);
    return this.db.transaction(() => rows.map((r) => insertCalendarPrice(this.db, executionId, r)));
  }

  /** Prices this execution fetched itself (reused copies excluded): the calendar-basis alert candidates (spec §6.8). */
  fetchedBy(executionId: string): CalendarPriceRow[] {
    return this.db.raw
      .prepare<[string], CalendarPriceDbRow>(
        'SELECT * FROM calendar_prices WHERE execution_id = ? AND reused_from_execution_id IS NULL ORDER BY id',
      )
      .all(executionId)
      .map(toCalendarPriceRow);
  }

  reuseCandidates(
    definitionId: string,
    providerId: ProviderId,
    cabin: Cabin,
    pointOfSale: PointOfSale,
    sourceKind: SourceKind,
    cells: CellKey[],
    newerThan: IsoDateTime,
  ): ReusedCopy[] {
    assertIsoDateTime('newerThan', newerThan);
    const wanted = new Set(cells.map(cellKeyString));
    const priceStmt = this.db.raw.prepare<Record<string, unknown>, CalendarPriceDbRow>(PRICE_FOR_OUTCOME_SQL);
    const out: ReusedCopy[] = [];
    for (const r of this.db.raw
      .prepare<Record<string, unknown>, OutcomeDbRow>(REUSE_CANDIDATES_SQL)
      .all({ definitionId, providerId, cabin, pointOfSale, sourceKind, newerThan })) {
      const outcome = toOutcome(r);
      const cell: CellKey = {
        origin: outcome.origin,
        destination: outcome.destination,
        departureDate: outcome.departureDate,
        returnDate: outcome.returnDate,
      };
      if (!wanted.has(cellKeyString(cell))) continue;
      let price: CalendarPriceRow | null = null;
      if (outcome.status === 'priced') {
        const p = priceStmt.get({ executionId: outcome.executionId, providerId, ...cell });
        // why: writeTile enforces a price for every priced outcome; a missing one is corruption, not a reusable cell.
        if (p === undefined)
          throw new RowCorrupt(
            'calendar_prices',
            `priced outcome ${cellKeyString(cell)} in ${outcome.executionId} has no calendar price`,
          );
        price = toCalendarPriceRow(p);
      }
      out.push({ cell, outcome, price });
    }
    return out;
  }

  /** Spec §7 "a fresh price superseding a reused row deletes that row" (writeTile does it inline). Fresh rows are never deleted. */
  supersedeReused(executionId: string, providerId: ProviderId, cell: CellKey): void {
    this.db.raw
      .prepare(
        `DELETE FROM calendar_prices WHERE execution_id = @executionId AND provider_id = @providerId AND origin = @origin AND destination = @destination AND departure_date = @departureDate AND return_date = @returnDate AND reused_from_execution_id IS NOT NULL`,
      )
      .run({ executionId, providerId, ...cell });
  }

  latestPerCell(definitionId: string, cabin: Cabin, space: ResolvedSpace | null): CalendarPriceRow[] {
    return this.db.raw
      .prepare<Record<string, unknown>, CalendarPriceDbRow>(LATEST_PER_CELL_SQL)
      .all({ definitionId, cabin, ...spaceParams(space) })
      .map(toCalendarPriceRow);
  }

  /** Calendar-gap source (spec §10): latest calendar prices strictly below the cheapest verified price. */
  belowVerified(
    definitionId: string,
    cabin: Cabin,
    space: ResolvedSpace,
    thresholdPence: number,
  ): CalendarPriceRow[] {
    return this.latestPerCell(definitionId, cabin, space).filter((r) => r.pricePence < thresholdPence);
  }

  /** Spec §6.8 calendar drops: the newest fetched (not reused) price for the same (provider, cabin, cell) with fetched_at in [notOlderThan, before). */
  previousFor(
    definitionId: string,
    providerId: ProviderId,
    cabin: Cabin,
    cell: CellKey,
    before: IsoDateTime,
    notOlderThan: IsoDateTime,
  ): CalendarPriceRow | null {
    const r = this.db.raw
      .prepare<Record<string, unknown>, CalendarPriceDbRow>(
        `SELECT p.* FROM calendar_prices p JOIN search_executions e ON e.id = p.execution_id
         WHERE e.definition_id = @definitionId AND p.provider_id = @providerId AND p.cabin = @cabin AND p.reused_from_execution_id IS NULL
           AND p.origin = @origin AND p.destination = @destination AND p.departure_date = @departureDate AND p.return_date = @returnDate
           AND p.fetched_at < @before AND p.fetched_at >= @notOlderThan
         ORDER BY p.fetched_at DESC, p.id DESC LIMIT 1`,
      )
      .get({ definitionId, providerId, cabin, ...cell, before, notOlderThan });
    return r === undefined ? null : toCalendarPriceRow(r);
  }

  /**
   * Route calendar history (ruling 8): per provider, one point per execution fetch, the cheapest cell's price, key and
   * provenance; oldest first. With `definitionId`: that definition's executions, cells inside its space resolved today.
   */
  history(
    origin: Iata,
    destination: Iata,
    cabin: Cabin,
    opts: { definitionId?: string } = {},
  ): Array<{ providerId: ProviderId; points: Array<HistoryPoint & { cell: Cell; executionId: string }> }> {
    let scope: {
      definitionId: string | null;
      from: string;
      to: string;
      minNights: number;
      maxNights: number;
    } = { definitionId: null, from: '', to: '', minNights: 0, maxNights: 0 };
    if (opts.definitionId !== undefined) {
      const d = this.db.raw
        .prepare<[string], DefinitionDbRow>('SELECT * FROM search_definitions WHERE id = ?')
        .get(opts.definitionId);
      if (d === undefined) throw new RowRejected('missing', `definition ${opts.definitionId} does not exist`);
      const def = readDefinition(d);
      const w = resolveWindow(def.window, this.clock.todayLondon());
      scope = {
        definitionId: def.id,
        from: w.departureFrom,
        to: w.departureTo,
        minNights: def.minNights,
        maxNights: def.maxNights,
      };
    }
    const out = new Map<ProviderId, Array<HistoryPoint & { cell: Cell; executionId: string }>>();
    for (const r of this.db.raw
      .prepare<Record<string, unknown>, CalendarPriceDbRow & { nights: number }>(HISTORY_SQL)
      .all({ origin, destination, cabin, ...scope })) {
      const row = toCalendarPriceRow(r);
      const points = out.get(row.providerId) ?? [];
      // why: the plan contract and core's routeHistoryResponseSchema carry the full Cell and the fetching execution (arch-r2-004).
      points.push({
        at: row.fetchedAt,
        pricePence: row.pricePence,
        provenance: row.provenance,
        cell: { ...row.cell, nights: r.nights },
        executionId: row.executionId,
      });
      out.set(row.providerId, points);
    }
    return [...out.entries()].map(([providerId, points]) => ({ providerId, points }));
  }
}
