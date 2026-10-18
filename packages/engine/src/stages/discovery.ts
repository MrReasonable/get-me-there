import {
  type CapabilityInfo,
  type CellIssue,
  type CellKey,
  cellKeyString,
  cooldownNoticeKey,
  type DefinitionSnapshot,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type Iata,
  ProviderError,
  type ProviderId,
  pricedReason,
  type TilePlan,
  TRUNCATED_NOTE,
} from '@gmt/core';
import type { TileWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { normaliseCalendarPrice, type RepoDeps, reduceTile } from '../normalise.js';
import { runPool } from '../pool.js';
import { laneFor, onFailure, type RunState, runnableCells, settleLane, stopRun } from '../run.js';
import { applyReuse } from './reuse.js';

export interface PlannedTile {
  plan: TilePlan;
  query: DiscoveryQuery;
}

/** Normalisation dependencies drawn from the context. */
export function normaliseDeps(ctx: EngineContext): RepoDeps {
  return {
    airports: ctx.repos.airports,
    fx: ctx.repos.fx,
    clock: ctx.clock,
    fxMaxRateAgeDays: ctx.config.fxMaxRateAgeDays,
  };
}

/** The airports dataset's names for a code (spec §5.1 rev 32 `airportNames`); none when the code is unknown. */
export type AirportNames = (iata: Iata) => string[];

/** Names from the airports repository, the engine's one source of them. */
export function airportNamesOf(ctx: Pick<EngineContext, 'repos'>): AirportNames {
  return (iata) => {
    const a = ctx.repos.airports.get(iata);
    return a === null ? [] : [a.name];
  };
}

/**
 * The discovery query for one pair, re-planned over exactly `cells` (spec §5.1 `cells`, §8.1), with the airports
 * dataset's names for its codes (spec §5.1 rev 32: set for every query; camoufox matches airports by name).
 */
export function discoveryQuery(
  snapshot: DefinitionSnapshot,
  origin: Iata,
  destination: Iata,
  cells: readonly CellKey[],
  names?: AirportNames,
): DiscoveryQuery {
  const r = snapshot.resolved;
  return {
    ...(names === undefined
      ? {}
      : { airportNames: { origin: names(origin), destination: names(destination) } }),
    origin,
    destination,
    departureFrom: r.departureFrom,
    departureTo: r.departureTo,
    minNights: r.minNights,
    maxNights: r.maxNights,
    cabin: snapshot.cabin,
    currency: 'GBP',
    cells: [...cells],
  };
}

const sameCells = (a: readonly CellKey[], b: readonly CellKey[]): boolean => {
  const ka = a.map(cellKeyString).sort();
  const kb = b.map(cellKeyString).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
};

/**
 * Groups cells by pair in snapshot order and plans each pair over its cells; tile indexes are made unique across
 * pairs. Spec §5.2 "tiles partition the query's cells", asserted here, at the point that decides coverage
 * (ssr-06): a plan that leaves out, repeats or adds a cell is a wiring error, so the pass stops instead of finishing
 * `completed` with cells silently left `not_run`.
 */
export function planTiles(
  providerId: ProviderId,
  cap: DiscoveryCapability,
  snapshot: DefinitionSnapshot,
  cells: readonly CellKey[],
  names?: AirportNames,
): PlannedTile[] {
  const byPair = new Map<string, CellKey[]>();
  for (const c of cells) {
    const key = `${c.origin}|${c.destination}`;
    const list = byPair.get(key);
    if (list === undefined) byPair.set(key, [c]);
    else list.push(c);
  }
  const out: PlannedTile[] = [];
  let offset = 0;
  for (const origin of snapshot.resolved.origins) {
    for (const destination of snapshot.resolved.destinations) {
      const pairCells = byPair.get(`${origin}|${destination}`);
      if (pairCells === undefined) continue;
      const query = discoveryQuery(snapshot, origin, destination, pairCells, names);
      const plans = cap.plan(query);
      if (
        !sameCells(
          plans.flatMap((p) => p.coveredCells),
          pairCells,
        )
      )
        throw new Error(
          `discovery plan for ${providerId} ${origin}-${destination} does not partition its ${pairCells.length} cells`,
        );
      // why: plan() numbers tiles from 0 per pair; the ledger's tile_index must be unique within one
      // pass of one provider so parity can count distinct tiles (spec §8.1 "Parity").
      for (const p of plans) out.push({ plan: { ...p, index: offset + p.index }, query });
      offset += plans.length;
    }
  }
  return out;
}

/** Spec §8.1 "discovery, per discovery provider, per (origin, destination) pair". */
export async function runDiscovery(ctx: EngineContext, run: RunState): Promise<void> {
  const ids = run.snapshot.providers.discovery.filter((id) => ctx.providers.get(id)?.discovery !== undefined);
  if (ids.length === 0) return;
  ctx.repos.executions.setStatus(run.executionId, 'running', { stage: 'discovery' });
  await Promise.all(ids.map((id) => runDiscoveryProvider(ctx, run, id)));
  // why: spec §8.1 error table "if none remain, paused_error + notify"
  if (run.stop === null && ids.every((id) => run.disabled.has(id)))
    stopRun(run, { kind: 'all-disabled', stage: 'discovery' });
}

async function runDiscoveryProvider(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
): Promise<void> {
  const cap = ctx.providers.get(providerId)?.discovery;
  if (cap === undefined) return;
  if (!run.disabled.has(providerId)) {
    const reused = applyReuse(ctx, run, providerId, cap.info);
    if (reused > 0)
      run.log
        .child({ providerId })
        .info({ stage: 'discovery', reused }, 'discovery: reused cells from earlier runs');
  }
  const cells = runnableCells(ctx, run, 'discovery', providerId);
  if (cells.length > 0 && (await preflightPasses(ctx, run, providerId, cap)))
    await fetchTiles(ctx, run, providerId, cap, cells);
  settleLane(ctx, run, 'discovery', providerId);
}

/**
 * Spec §2, §8.1 rev 32 (decision 69): a capability with an unledgered preflight (camoufox) is asked before its tiles
 * are planned. A refusal skips every one of the provider's cells in the stage with the given reason and the detail in
 * `last_error`, writes no ledger row, and (for a cool-down) queues one notice keyed by the cool-down's end.
 */
async function preflightPasses(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  cap: DiscoveryCapability,
): Promise<boolean> {
  if (cap.preflight === undefined) return true;
  const r = await cap.preflight({
    executionId: run.executionId,
    signal: run.controller.signal,
    recordFixtures: false,
  });
  if (r.ok) return true;
  ctx.repos.cells.setOutcomesForProvider(run.executionId, 'discovery', providerId, ['not_run'], {
    status: 'skipped',
    reason: r.skip,
    lastError: r.detail,
  });
  run.disabled.add(providerId);
  run.disabledReason.set(providerId, r.skip);
  run.log.child({ providerId }).warn({ skip: r.skip, detail: r.detail }, 'discovery: preflight refused');
  if (r.until !== undefined)
    run.notices.push({
      kind: 'provider_disabled',
      detail: `${providerId} is ${r.detail}; its cells are skipped until then and the other providers continue.`,
      key: cooldownNoticeKey(providerId, r.until),
    });
  return false;
}

async function fetchTiles(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  cap: DiscoveryCapability,
  cells: readonly CellKey[],
): Promise<void> {
  const log = run.log.child({ providerId });
  const tiles = planTiles(providerId, cap, run.snapshot, cells, airportNamesOf(ctx));
  run.plannedTiles.set(providerId, (run.plannedTiles.get(providerId) ?? 0) + tiles.length);
  log.info({ stage: 'discovery', cells: cells.length, tiles: tiles.length }, 'discovery: planned tiles');
  const lane = laneFor(run, 'discovery', providerId);
  await runPool(tiles, ctx.limitsOf(providerId).concurrency, lane.intakeSignal, async (tile) => {
    const keys = tile.plan.coveredCells.map(cellKeyString);
    for (const k of keys) lane.inFlight.add(k);
    try {
      const result = await cap.fetchTile(tile.plan, tile.query, {
        executionId: run.executionId,
        signal: run.controller.signal,
        recordFixtures: false,
      });
      // why: decisions 25 and 27 — a result that resolves after a stop is written (its calls were paid for); only a
      // fatal stop, where the database itself failed, writes nothing more
      if (run.stop?.kind === 'fatal') return;
      if (result.kind === 'tile-error')
        onFailure(ctx, run, providerId, 'discovery', tile.plan.coveredCells, result.error);
      else if (!sameCells(result.coveredCells, tile.plan.coveredCells)) {
        // why: the engine owns which cells a tile covers (ssr-06); an adapter echoing others breached the contract
        const err = new ProviderError({
          kind: 'parse',
          retryable: false,
          providerId,
          message: `tile ${tile.plan.index} answered for cells other than the ones planned`,
        });
        onFailure(ctx, run, providerId, 'discovery', tile.plan.coveredCells, err);
      } else commitTile(ctx, run, providerId, cap.info, result);
    } catch (err) {
      onFailure(ctx, run, providerId, 'discovery', tile.plan.coveredCells, err);
    } finally {
      for (const k of keys) lane.inFlight.delete(k);
    }
  });
}

/**
 * Writes one tile atomically (spec §7 "each tile's prices, outcomes and roll-ups"). Per covered cell:
 * - a price that normalises → `priced` (reason `offers-dropped:n` when the adapter also reported rows it dropped for
 *   that cell in `cellIssues`, decision 28; last_error "cheapest of the rows read" when the tile is `truncated`,
 *   decision 30);
 * - a price that cannot be normalised → `error` with the normalisation reason;
 * - no price but a `cellIssues` entry (rows dropped or a cell left unread) → `error` with the issue's reason and detail,
 *   never `no_data` (spec §8.1);
 * - in noFares → `empty`; otherwise → `no_data` (not evidence of no flights).
 * Errors go through writeTileError in the same transaction (WP3's writeTile takes only priced, empty and no_data;
 * po-009). The repository resets auto_resume_count in it.
 */
export function commitTile(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  info: CapabilityInfo,
  result: Extract<DiscoveryTileResult, { kind: 'tile' }>,
): void {
  const reduced = reduceTile(result.prices);
  if (reduced.kind === 'mixed-currency') {
    // why: two currencies in one response means it was misread; treat it as the vendor-shape error it is
    const err = new ProviderError({
      kind: 'parse',
      retryable: false,
      providerId,
      message: `tile ${result.index} mixed currencies: ${reduced.currencies.join(', ')}`,
    });
    onFailure(ctx, run, providerId, 'discovery', result.coveredCells, err);
    return;
  }
  const pointOfSale = result.pointOfSale; // why: spec rev 10 — the adapter states the point of sale of what it fetched
  const noFares = new Set(result.noFares.map(cellKeyString));
  const issues = new Map<string, CellIssue>();
  for (const i of result.cellIssues ?? []) {
    const key = cellKeyString(i.cell);
    const seen = issues.get(key);
    issues.set(
      key,
      seen === undefined ? i : { ...seen, offersDropped: seen.offersDropped + i.offersDropped },
    );
  }
  const write: TileWrite = {
    tileIndex: result.index,
    cells: [],
    prices: [],
    outcomes: [],
    discards: reduced.discarded,
  };
  const failed = new Map<string, { reason: string; lastError: string; cells: CellKey[] }>();
  const fail = (cell: CellKey, reason: string, lastError: string): void => {
    const group = failed.get(`${reason}\n${lastError}`) ?? { reason, lastError, cells: [] };
    group.cells.push(cell);
    failed.set(`${reason}\n${lastError}`, group);
  };
  for (const cell of result.coveredCells) {
    const key = cellKeyString(cell);
    const base = {
      origin: cell.origin,
      destination: cell.destination,
      departureDate: cell.departureDate,
      returnDate: cell.returnDate,
      fetchedAt: result.fetchedAt,
      cabin: run.snapshot.cabin,
      pointOfSale,
      sourceKind: info.sourceKind,
    };
    const raw = reduced.perCell.get(key);
    const issue = issues.get(key);
    if (raw !== undefined) {
      const price = normaliseCalendarPrice(
        raw,
        { providerId, info, cabin: run.snapshot.cabin, pointOfSale, fetchedAt: result.fetchedAt },
        normaliseDeps(ctx),
      );
      if ('reason' in price) {
        fail(cell, price.reason, price.message);
        continue;
      }
      const dropped = issue?.offersDropped ?? 0;
      // why: decision 30 — a truncated tile's price is the cheapest of the rows read, said on the cell (no new reason)
      const notes = [
        ...(result.truncated === true ? [TRUNCATED_NOTE] : []),
        ...(issue === undefined ? [] : [issue.detail]),
      ];
      write.prices.push(price);
      write.outcomes.push({
        ...base,
        status: 'priced',
        reason: pricedReason(false, false, dropped),
        lastError: notes.length > 0 ? notes.join('; ') : null,
        minPence: price.pricePence,
      });
    } else if (issue !== undefined) {
      fail(cell, issue.reason, issue.detail);
      continue;
    } else if (noFares.has(key))
      write.outcomes.push({ ...base, status: 'empty', reason: null, lastError: null, minPence: null });
    else if (result.truncated === true) {
      // why: decision 30 asks the adapter to list unread cells in cellIssues; one it left out may still sit on an
      // unread page, so it is an error (fetched again), never reusable no_data, as the coverage check judges it (prov M1)
      fail(cell, 'upstream', 'pagination truncated: cell left unread');
      continue;
    } else write.outcomes.push({ ...base, status: 'no_data', reason: null, lastError: null, minPence: null });
    write.cells.push(cell);
  }
  ctx.db.transaction(() => {
    if (write.cells.length > 0) ctx.repos.cells.writeTile(run.executionId, providerId, write);
    for (const g of failed.values())
      ctx.repos.cells.writeTileError(run.executionId, providerId, g.cells, g.reason, g.lastError);
  });
  run.parseStreak.set(providerId, 0);
  if (reduced.discarded > 0 || result.notes.length > 0 || failed.size > 0) {
    run.log.child({ providerId }).debug(
      {
        tileIndex: result.index,
        discarded: reduced.discarded,
        notes: result.notes,
        cellErrors: [...failed.values()].map((g) => g.reason),
      },
      'discovery: tile reduced',
    );
  }
}
