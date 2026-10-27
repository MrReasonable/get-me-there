import {
  type Cabin,
  type Cell,
  type CellKey,
  type CellOutcome,
  type Clock,
  cellKeyString,
  daysBetween,
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
import { type DefinitionDbRow, readDefinition, readSnapshot } from '../internal/definitionRow.js';
import { CELL_WHERE, keyParams, type OutcomeDbRow, toOutcome } from '../internal/outcomeRow.js';
import { DELETE_REUSED_PRICE_SQL, nextOutcome, readOutcome, storeOutcome } from '../internal/outcomeWrite.js';
import {
  type CalendarPriceDbRow,
  insertCalendarPrice,
  toCalendarPriceRow,
  validateCalendarPrice,
} from '../internal/priceRow.js';
import { RowCorrupt } from '../internal/read.js';
import { storeRollUps } from '../internal/rollUps.js';
import { assertIsoDateTime, RowRejected } from '../internal/validate.js';
import type {
  CalendarMarks,
  CalendarPriceInsert,
  CalendarPriceRow,
  RepoOptions,
  ReusedCopy,
} from '../types.js';
import { ExecutionsRepo } from './executions.js';

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

/** The scope's airports and departures over alias `a`: cheap tests, applied to every row a grouped read scans. */
const airportsAndDays = (
  a: string,
) => `(@spaced = 0 OR (${a}.origin IN (SELECT value FROM json_each(@origins))
  AND ${a}.destination IN (SELECT value FROM json_each(@destinations)) AND ${a}.departure_date BETWEEN @from AND @to))`;
/** The scope's stay lengths over alias `a`; a date function, so applied to the one row per cell a read keeps. */
const stays = (a: string) =>
  `(@spaced = 0 OR CAST(julianday(${a}.return_date) - julianday(${a}.departure_date) AS INTEGER) BETWEEN @minNights AND @maxNights)`;

/**
 * The latest row per (provider, cell) among the calendar prices `where` admits: max fetched_at, then max id (fetched_at
 * is a fixed-width ISO instant by the table's CHECK, and the id is zero-padded, so one string orders both). `index`
 * names the index the scan walks in its own (provider, cell, fetched_at, id) order. why: spec §10 bounds: grouping in
 * index order never sorts a history many runs deep, which a ROW_NUMBER window over every row did (several seconds at
 * 20 runs × 50,000 cells); the stay filter is applied to the winners only.
 */
const latestOf = (where: string, index: string) => `
SELECT q.* FROM (
  SELECT MAX(printf('%s%020d', p.fetched_at, p.id)) AS k
  FROM calendar_prices p ${index}
  WHERE ${where} AND p.cabin = @cabin AND ${airportsAndDays('p')}
  GROUP BY p.provider_id, p.origin, p.destination, p.departure_date, p.return_date
) r JOIN calendar_prices q ON q.id = CAST(substr(r.k, -20) AS INTEGER)
WHERE ${stays('q')}`;

/**
 * WP19 §5: a calendar price row with its two marks, read in the same statement. `latest` is a statement yielding whole
 * `calendar_prices` rows.
 *
 * - `source_last_error`: the `last_error` of the discovery outcome that fetched the price (decisions 36, 47: a
 *   truncated tile), through `reused_from_execution_id` for a reused copy (decision 58: the copying run read no pages).
 * - `searched_empty_later`: the newest searched (priced, empty or no_data), non-reused discovery outcome of a parent
 *   execution of the price's definition for that (provider, cell) is newer than the price's execution, by the
 *   executions' (created_at, rowid) order, and found the cell empty or no_data (decision 54). A newer run that skipped,
 *   errored on or reused the cell did not search it, so an older "no fares" still marks the price (review prov M1).
 *   Only the executions newer than the price's are probed, each by the outcome's primary key: the newest search is
 *   newer than the price exactly when one of those searched.
 *
 * why: one statement whatever the history's depth (spec §10 bounds): the per-execution outcome reads this replaces
 * grew with every past run.
 */
const withMarks = (latest: string) => `
WITH latest AS (${latest})
SELECT l.*, src.last_error AS source_last_error,
  COALESCE((
    SELECT o.status IN ('empty', 'no_data')
    FROM search_executions s JOIN cell_outcomes o ON o.execution_id = s.id AND o.origin = l.origin AND o.destination = l.destination
      AND o.departure_date = l.departure_date AND o.return_date = l.return_date AND o.stage = 'discovery' AND o.provider_id = l.provider_id
    WHERE s.definition_id = pe.definition_id AND s.is_child = 0 AND (s.created_at > pe.created_at OR (s.created_at = pe.created_at AND s.rowid > pe.rowid))
      AND o.status IN ('priced', 'empty', 'no_data') AND o.reused_from_execution_id IS NULL
    ORDER BY s.created_at DESC, s.rowid DESC LIMIT 1
  ), 0) AS searched_empty_later
FROM latest l
JOIN search_executions pe ON pe.id = l.execution_id
LEFT JOIN cell_outcomes src ON src.execution_id = COALESCE(l.reused_from_execution_id, l.execution_id) AND src.origin = l.origin
  AND src.destination = l.destination AND src.departure_date = l.departure_date AND src.return_date = l.return_date
  AND src.stage = 'discovery' AND src.provider_id = l.provider_id
ORDER BY l.origin, l.destination, l.departure_date, l.return_date, l.provider_id`;

/** Spec §6.9 calendar basis: latest fetched per (provider, cell) in the cabin, reused copies ignored, inside the space when given. */
const LATEST_PER_CELL_SQL = withMarks(
  latestOf(
    'p.execution_id IN (SELECT id FROM search_executions WHERE definition_id = @definitionId) AND p.reused_from_execution_id IS NULL',
    // why: migration 0009's covering index; named, so the planner never falls back to sorting the whole history
    'INDEXED BY calendar_prices_latest_idx',
  ),
);

/**
 * `/results?executionId=` (decision 58, review prov-003): the latest price each (provider, cell) holds among the
 * executions, reused copies included, so a run's prices agree with its coverage. why: the executions' own rows are
 * reached through calendar_prices_execution_idx; the planner chooses.
 */
const LATEST_HELD_BY_SQL = withMarks(latestOf('p.execution_id IN (SELECT value FROM json_each(@ids))', ''));

/**
 * Ruling 8: per (provider, execution) the cheapest fetched price on the pair (ties: earliest fetched, lowest id).
 * Children are excluded: a child fetches one cell, which is not a route minimum. Each point carries the `last_error` of
 * the discovery outcome that fetched it, for truncation (decisions 36, 47), in the same statement (WP19).
 */
const HISTORY_SQL = `
WITH ranked AS (
  SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.provider_id, p.execution_id ORDER BY p.price_pence, p.fetched_at, p.id) AS rn
  FROM calendar_prices p JOIN search_executions e ON e.id = p.execution_id
  WHERE p.origin = @origin AND p.destination = @destination AND p.cabin = @cabin AND p.reused_from_execution_id IS NULL AND e.is_child = 0
    AND (@definitionId IS NULL OR (e.definition_id = @definitionId AND p.departure_date BETWEEN @from AND @to AND ${NIGHTS} BETWEEN @minNights AND @maxNights))
)
SELECT ranked.*, CAST(julianday(ranked.return_date) - julianday(ranked.departure_date) AS INTEGER) AS nights, src.last_error AS source_last_error
FROM ranked LEFT JOIN cell_outcomes src ON src.execution_id = ranked.execution_id AND src.origin = ranked.origin AND src.destination = ranked.destination
  AND src.departure_date = ranked.departure_date AND src.return_date = ranked.return_date AND src.stage = 'discovery' AND src.provider_id = ranked.provider_id
WHERE ranked.rn = 1 ORDER BY ranked.provider_id, ranked.fetched_at, ranked.id`;

const spaceParams = (space: ResolvedSpace | null) => ({
  spaced: space === null ? 0 : 1,
  origins: JSON.stringify(space?.origins ?? []),
  destinations: JSON.stringify(space?.destinations ?? []),
  from: space?.departureFrom ?? '',
  to: space?.departureTo ?? '',
  minNights: space?.minNights ?? 0,
  maxNights: space?.maxNights ?? 0,
});

type MarkedDbRow = CalendarPriceDbRow & { source_last_error: string | null; searched_empty_later: number };

function toMarkedRow(r: MarkedDbRow): CalendarPriceRow & CalendarMarks {
  return {
    ...toCalendarPriceRow(r),
    sourceLastError: r.source_last_error,
    searchedEmptyLater: r.searched_empty_later === 1,
  };
}

interface ExecutionScopeRow {
  is_child: number;
  child_origin: string | null;
  child_destination: string | null;
  child_departure_date: string | null;
  child_return_date: string | null;
  definition_snapshot_json: string;
}

/** Spec §7 `calendar_prices`. Rows are written with their outcome (insert, writeTile, copyReused); a fresh write deletes a reused row. */
export class CalendarPricesRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly opts: RepoOptions,
  ) {}

  /**
   * A prices-only tile write (spec §3 "priced ⇔ a price row", §7 atomic unit; ruling 2026-10-15). Every row is
   * validated and must lie inside the execution's definition (the snapshot's resolved space and night range, or the
   * child's one cell) before anything is written. Then, in one transaction, per row: the cell and its discovery
   * outcome for the row's provider are seeded when absent, a reused price for that key is deleted, the price is
   * inserted (a second fresh price for the same key throws SqliteError UNIQUE), a `priced` outcome carrying the row's
   * provenance and price is merged like writeTile's, and the cell's roll-up is stored through core.
   */
  insert(executionId: string, rows: CalendarPriceInsert[]): number[] {
    for (const r of rows) validateCalendarPrice(r, this.opts.allowSynthetic, true);
    const inScope = this.executionScope(executionId);
    for (const r of rows)
      if (!inScope(r.cell))
        throw new RowRejected(
          'cell-outside-definition',
          `${cellKeyString(r.cell)} is not a cell of execution ${executionId}'s definition`,
        );
    const cellExists = this.db.raw.prepare<Record<string, unknown>, { n: number }>(
      `SELECT COUNT(*) AS n FROM search_cells WHERE ${CELL_WHERE}`,
    );
    const seedCell = this.db.raw.prepare(
      `INSERT INTO search_cells (execution_id, origin, destination, departure_date, return_date, discovery_status, verification_selected) VALUES (@executionId, @origin, @destination, @departureDate, @returnDate, 'not_run', 0)`,
    );
    const outcomeExists = this.db.raw.prepare<Record<string, unknown>, { n: number }>(
      `SELECT COUNT(*) AS n FROM cell_outcomes WHERE ${CELL_WHERE} AND stage = 'discovery' AND provider_id = @providerId`,
    );
    const seedOutcome = this.db.raw.prepare(
      `INSERT INTO cell_outcomes (execution_id, origin, destination, departure_date, return_date, stage, provider_id, status, attempts) VALUES (@executionId, @origin, @destination, @departureDate, @returnDate, 'discovery', @providerId, 'not_run', 0)`,
    );
    return this.db.transaction(() => {
      const ids = rows.map((r) => {
        const params = { ...keyParams(executionId, r.cell), providerId: r.providerId };
        if ((cellExists.get(params)?.n ?? 0) === 0) seedCell.run(params);
        if ((outcomeExists.get(params)?.n ?? 0) === 0) seedOutcome.run(params);
        this.db.raw.prepare(DELETE_REUSED_PRICE_SQL).run(params);
        const id = insertCalendarPrice(this.db, executionId, r);
        const existing = readOutcome(this.db, executionId, r.cell, 'discovery', r.providerId);
        const incoming: CellOutcome = {
          ...existing,
          status: 'priced',
          reason: null,
          lastError: null,
          fetchedAt: r.fetchedAt,
          minPence: r.pricePence,
          cabin: r.cabin,
          pointOfSale: r.pointOfSale,
          sourceKind: r.sourceKind,
          reusedFromExecutionId: null,
        };
        storeOutcome(this.db, nextOutcome(existing, incoming, false));
        storeRollUps(this.db, executionId, 'discovery', [r.cell]);
        return id;
      });
      if (rows.length > 0) new ExecutionsRepo(this.db, this.clock).resetAutoResume(executionId);
      return ids;
    });
  }

  /** The membership test for the execution's cells: a child's one cell, or the snapshot's resolved space. */
  private executionScope(executionId: string): (c: CellKey) => boolean {
    const e = this.db.raw
      .prepare<[string], ExecutionScopeRow>(
        'SELECT is_child, child_origin, child_destination, child_departure_date, child_return_date, definition_snapshot_json FROM search_executions WHERE id = ?',
      )
      .get(executionId);
    if (e === undefined) throw new RowRejected('missing', `execution ${executionId} does not exist`);
    if (e.is_child === 1) {
      const own = [e.child_origin, e.child_destination, e.child_departure_date, e.child_return_date].join(
        '|',
      );
      return (c) => [c.origin, c.destination, c.departureDate, c.returnDate].join('|') === own;
    }
    const snapshot = readSnapshot('search_executions.definition_snapshot_json', e.definition_snapshot_json);
    const s = snapshot.resolved;
    return (c) => {
      const nights = daysBetween(c.departureDate, c.returnDate);
      return (
        s.origins.includes(c.origin) &&
        s.destinations.includes(c.destination) &&
        c.departureDate >= s.departureFrom &&
        c.departureDate <= s.departureTo &&
        nights >= s.minNights &&
        nights <= s.maxNights
      );
    };
  }

  /**
   * Every price row this execution holds: the ones it fetched and the reused copies it made (each keeping its source's
   * fetch time and `reusedFromExecutionId`). A run's own view (plan decision 58): its coverage counts a reused cell as
   * priced, so its prices must include that cell's price.
   */
  heldBy(executionId: string): CalendarPriceRow[] {
    return this.db.raw
      .prepare<[string], CalendarPriceDbRow>(
        'SELECT * FROM calendar_prices WHERE execution_id = ? ORDER BY id',
      )
      .all(executionId)
      .map(toCalendarPriceRow);
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

  /**
   * The calendar basis (spec §6.9): the latest fetched price per (provider, cell) of the definition in the cabin,
   * reused copies ignored, inside `space` when given (the scope pushed into the SQL), each with its truncation and
   * supersession marks. One statement.
   */
  latestPerCell(
    definitionId: string,
    cabin: Cabin,
    space: ResolvedSpace | null,
  ): Array<CalendarPriceRow & CalendarMarks> {
    return this.db.raw
      .prepare<Record<string, unknown>, MarkedDbRow>(LATEST_PER_CELL_SQL)
      .all({ definitionId, cabin, ...spaceParams(space) })
      .map(toMarkedRow);
  }

  /**
   * `/results?executionId=`'s calendar rows: the latest price held per (provider, cell) among `executionIds` (fetched
   * or reused within its refresh window), in the cabin and inside `space` when given, with the same marks as
   * `latestPerCell` (a reused copy's truncation is its source run's). One statement, however many executions.
   */
  latestHeldBy(
    executionIds: readonly string[],
    cabin: Cabin,
    space: ResolvedSpace | null,
  ): Array<CalendarPriceRow & CalendarMarks> {
    return this.db.raw
      .prepare<Record<string, unknown>, MarkedDbRow>(LATEST_HELD_BY_SQL)
      .all({ ids: JSON.stringify(executionIds), cabin, ...spaceParams(space) })
      .map(toMarkedRow);
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
  ): Array<{
    providerId: ProviderId;
    points: Array<HistoryPoint & { cell: Cell; executionId: string; sourceLastError: string | null }>;
  }> {
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
    const out = new Map<
      ProviderId,
      Array<HistoryPoint & { cell: Cell; executionId: string; sourceLastError: string | null }>
    >();
    for (const r of this.db.raw
      .prepare<
        Record<string, unknown>,
        CalendarPriceDbRow & { nights: number; source_last_error: string | null }
      >(HISTORY_SQL)
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
        sourceLastError: r.source_last_error,
      });
      out.set(row.providerId, points);
    }
    return [...out.entries()].map(([providerId, points]) => ({ providerId, points }));
  }
}
