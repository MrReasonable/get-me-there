/**
 * The row set every read route shares (spec §6.5, §6.9, §10), read through a fixed number of grouped statements
 * (WP19 §5). Its own module so `results.ts` and `datePairs.ts` both read it without importing each other.
 */
import {
  type CellKey,
  type Execution,
  isTruncated,
  type ResolvedSpace,
  type SearchDefinition,
} from '@gmt/core';
import type { Ports } from '../wiring.js';
import {
  calendarRow,
  latestPerOffer,
  notSeenResolver,
  type ResultRow,
  type RowContext,
  verifiedRow,
} from './rows.js';
import type { ParsedScope } from './scope.js';
import { cellInSpace, currentSpace } from './space.js';

export interface Loaded {
  def: SearchDefinition;
  space: ResolvedSpace;
  rc: RowContext;
  /** All executions of the definition (children included), newest first. */
  all: Execution[];
  /** The executions the rows come from (all, or the one `executionId`). */
  scoped: Execution[];
  latestParent: Execution | null;
  /** One row per offer inside the current space, verdicts evaluated now; not deduped. */
  verified: ResultRow[];
  /**
   * Observation ids whose price the final step did not confirm (no `price` supplied field, decisions 27, 37). The
   * verified-basis minima of the views skip them, so an unconfirmed fare is never shown as an itinerary-search price
   * (decisions 45, 48); `/results` returns them, and the web badges them from `verdicts`.
   */
  unconfirmed: ReadonlySet<number>;
  /** One row per (provider, cell) inside the current space; reused copies ignored. */
  calendar: ResultRow[];
  /** Itineraries / calendar rows dropped because they fall outside the current space. */
  excluded: { verified: number; calendar: number };
}

/** What `loadRows` reads: executions to scope the rows to, and the scope pushed into the SQL. */
export interface LoadOptions {
  /** the rows of these executions only (a run picked with `?executionId=`, or the duration analysis's set) */
  executionIds?: readonly string[] | undefined;
  /**
   * The scope's space, pushed into every read (spec §10 bounds: the route reads only the scope's cells). Absent: the
   * whole history is read and filtered to the current space here, so the rows outside it can be counted (`excluded`).
   */
  scope?: ParsedScope | undefined;
}

/**
 * Everything the read routes share: rows of both bases for the definition's current space (or a scope of it) and
 * cabin, read through a fixed number of grouped statements whatever the history's depth (spec §10, WP19 §5): the
 * executions, the observations with their itineraries (three statements; three more under `executionIds`), the newest
 * verification outcome per cell, and the calendar rows with their truncation and supersession marks (one). With
 * `executionIds`, calendar rows are the latest each of them holds — fetched, or reused within its refresh window
 * (decision 58, so a run's prices agree with its coverage, which counts a reused cell as priced) — so a cell a newer
 * run priced again still shows the scoped run's price (review prov-003). "Not seen in latest search" and "superseded
 * by a later search" always compare with the newest search of the cell.
 */
export function loadRows(def: SearchDefinition, ports: Ports, opts: LoadOptions = {}): Loaded {
  const now = ports.clock.now();
  const space = currentSpace(def, ports.clock.todayLondon());
  // why: every execution, never the newest N: past a fixed cap older prices vanished without `truncated` and an older
  // run's executionId answered 404 although the run exists (CodeRabbit batch 3)
  const all = ports.repos.executions.listForDefinition(def.id, { limit: 'all', includeChildren: true });
  const wanted = opts.executionIds === undefined ? null : new Set(opts.executionIds);
  const scoped = wanted === null ? all : all.filter((e) => wanted.has(e.id));
  const ids = scoped.map((e) => e.id);
  const rc: RowContext = { def, now, config: ports.config, providers: ports.providers };
  const latestParent = all.find((e) => !e.isChild) ?? null;
  // why: without a scope, space null reads every cell, so rows outside the current space can be counted (review
  // focus 4); with one, the scope's space is in the SQL and nothing outside it is read.
  const sqlSpace = opts.scope?.space ?? null;
  const inScope = (c: CellKey) => cellInSpace(opts.scope?.space ?? space, c);

  const raw = ports.repos.itineraries.observationsForDefinition(def.id, {
    executionIds: ids,
    space: sqlSpace,
    cabin: def.cabin,
    includeChildren: true,
  });
  // why: "seen in execution X" must consider every observation of the definition, not only each offer's latest one and
  // not only the scoped executions: the newest search of a cell may be outside the scope (review prov I1). An offer
  // belongs to one itinerary and so to one cell, so the scope's cells hold every observation that can decide it.
  const everyObservation =
    wanted === null
      ? raw
      : ports.repos.itineraries.observationsForDefinition(def.id, {
          executionIds: 'all',
          space: sqlSpace,
          cabin: def.cabin,
          includeChildren: true,
        });
  const notSeen = notSeenResolver(
    everyObservation,
    ports.repos.itineraries.latestVerificationOutcomes(def.id, def.cabin, sqlSpace),
    now,
  );
  const latest = latestPerOffer(raw);
  const inSpace = latest.filter((o) => inScope(o.cell));
  const hashes = (xs: readonly { itinerary: { hash: string } }[]) =>
    new Set(xs.map((o) => o.itinerary.hash)).size;

  const calendarAll =
    wanted === null
      ? ports.repos.calendarPrices.latestPerCell(def.id, def.cabin, sqlSpace)
      : ports.repos.calendarPrices.latestHeldBy(ids, def.cabin, sqlSpace);
  const calendarIn = calendarAll.filter((r) => inScope(r.cell));

  return {
    def,
    space,
    rc,
    all,
    scoped,
    latestParent,
    verified: inSpace.map((o) => verifiedRow(o, rc, notSeen(o))),
    unconfirmed: new Set(inSpace.filter((o) => !o.suppliedFields.includes('price')).map((o) => o.id)),
    // why: decisions 36, 47 (core's isTruncated over the fetching outcome's last_error) and 54 (a newer parent found the
    // cell empty), both read with the row by the grouped statement
    calendar: calendarIn.map((r) => calendarRow(r, rc, isTruncated(r.sourceLastError), r.searchedEmptyLater)),
    excluded: {
      verified: hashes(latest) - hashes(inSpace),
      calendar: calendarAll.length - calendarIn.length,
    },
  };
}
