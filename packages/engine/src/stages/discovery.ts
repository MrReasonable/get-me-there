import {
  type CapabilityInfo,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type DiscoveryCapability,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type Iata,
  NormalisationError,
  ProviderError,
  type ProviderId,
  type TilePlan,
} from '@gmt/core';
import type { TileWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { normaliseCalendarPrice, type RepoDeps, reduceTile } from '../normalise.js';
import { runPool } from '../pool.js';
import { laneFor, onFailure, type RunState, runnableCells, stopRun } from '../run.js';

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

/** The discovery query for one pair, re-planned over exactly `cells` (spec §5.1 `cells`, §8.1). */
export function discoveryQuery(
  snapshot: DefinitionSnapshot,
  origin: Iata,
  destination: Iata,
  cells: readonly CellKey[],
): DiscoveryQuery {
  const r = snapshot.resolved;
  return {
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
      const query = discoveryQuery(snapshot, origin, destination, pairCells);
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
  const cells = runnableCells(ctx, run, 'discovery', providerId);
  if (cells.length > 0) await fetchTiles(ctx, run, providerId, cap, cells);
}

async function fetchTiles(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  cap: DiscoveryCapability,
  cells: readonly CellKey[],
): Promise<void> {
  const log = run.log.child({ providerId });
  const tiles = planTiles(providerId, cap, run.snapshot, cells);
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
 * Writes one tile atomically (spec §7 "each tile's prices, outcomes and roll-ups"): covered cells with a price that
 * normalises → priced; in noFares → empty; otherwise → no_data (not evidence of no flights). Cells whose price cannot
 * be normalised become `error` with the normalisation reason through writeTileError, in the same transaction
 * (WP3's writeTile takes only priced, empty and no_data; po-009). The repository resets auto_resume_count in it.
 */
export function commitTile(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  info: CapabilityInfo,
  result: Extract<DiscoveryTileResult, { kind: 'tile' }>,
): void {
  const reduced = reduceTile(result.prices);
  const pointOfSale = result.pointOfSale; // why: spec rev 10 — the adapter states the point of sale of what it fetched
  const noFares = new Set(result.noFares.map(cellKeyString));
  const write: TileWrite = {
    tileIndex: result.index,
    cells: [],
    prices: [],
    outcomes: [],
    discards: reduced.discarded,
  };
  const failed = new Map<string, { cells: CellKey[]; message: string }>();
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
    if (raw !== undefined) {
      const price = normaliseCalendarPrice(
        raw,
        { providerId, info, cabin: run.snapshot.cabin, pointOfSale, fetchedAt: result.fetchedAt },
        normaliseDeps(ctx),
      );
      if (price instanceof NormalisationError) {
        const group = failed.get(price.reason) ?? { cells: [], message: price.message };
        group.cells.push(cell);
        failed.set(price.reason, group);
        continue;
      }
      write.prices.push(price);
      write.outcomes.push({
        ...base,
        status: 'priced',
        reason: null,
        lastError: null,
        minPence: price.pricePence,
      });
    } else if (noFares.has(key))
      write.outcomes.push({ ...base, status: 'empty', reason: null, lastError: null, minPence: null });
    else write.outcomes.push({ ...base, status: 'no_data', reason: null, lastError: null, minPence: null });
    write.cells.push(cell);
  }
  ctx.db.transaction(() => {
    if (write.cells.length > 0) ctx.repos.cells.writeTile(run.executionId, providerId, write);
    for (const [reason, g] of failed)
      ctx.repos.cells.writeTileError(run.executionId, providerId, g.cells, reason, g.message);
  });
  run.parseStreak.set(providerId, 0);
  if (reduced.discarded > 0 || result.notes.length > 0 || failed.size > 0) {
    run.log.child({ providerId }).debug(
      {
        tileIndex: result.index,
        discarded: reduced.discarded,
        notes: result.notes,
        normalisationErrors: [...failed.keys()],
      },
      'discovery: tile reduced',
    );
  }
}
