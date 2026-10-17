import {
  type Cabin,
  type CapabilityInfo,
  type CellKey,
  cellKeyString,
  type DefinitionSnapshot,
  type FlightProvider,
  generateCells,
  type ItineraryQuery,
  type ItinerarySearchResult,
  type ProviderId,
  pricedReason,
  type RollUp,
  selectCandidates,
} from '@gmt/core';
import type { VerifiedCellWrite } from '@gmt/db';
import type { EngineContext } from '../context.js';
import { lineKey } from '../lines.js';
import { offerWrite, type PriceRefusal } from '../normalise.js';
import { runPool } from '../pool.js';
import {
  laneFor,
  markRemaining,
  onFailure,
  type RunState,
  runnableCells,
  settleLane,
  stopRun,
} from '../run.js';
import { sellsCabin } from '../snapshot.js';
import { normaliseDeps } from './discovery.js';

/** The itinerary query for one cell from the frozen snapshot (spec §5.1 ItineraryQuery). */
export function itineraryQuery(snapshot: DefinitionSnapshot, cell: CellKey): ItineraryQuery {
  const p = snapshot.verification;
  return {
    origin: cell.origin,
    destination: cell.destination,
    departureDate: cell.departureDate,
    returnDate: cell.returnDate,
    cabin: snapshot.cabin,
    adults: 1,
    currency: 'GBP',
    expandTop: p.expandTop,
    bookingLinks: p.bookingLinks,
    ...(p.maxStops !== undefined ? { maxStops: p.maxStops } : {}),
  };
}

function discoveryRollUps(ctx: EngineContext, executionId: string): Map<string, RollUp> {
  return new Map([...ctx.repos.cells.rollUps(executionId)].map(([k, v]) => [k, v.discovery]));
}

/**
 * Spec §6.7: selection once, persisted with verification seeding in one transaction (spec §7); cells whose departure
 * date has arrived are never candidates (spec §8.1 departed, ssr-05) and are marked skipped:departed in the same
 * transaction; providers that do not sell the cabin, or are blocked for budget or disabled, are marked too. Only the
 * discovery providers that sell the cabin count for step 5's "no discovery provider" stride (ruling 3). A child
 * bypasses selection.
 */
function persistSelection(ctx: EngineContext, run: RunState, ids: readonly ProviderId[]): void {
  const today = ctx.clock.todayLondon();
  const allCells = run.isChild && run.cell !== null ? [run.cell] : generateCells(run.snapshot.resolved);
  const live = (c: CellKey) => c.departureDate > today;
  const policy = {
    ...run.snapshot.verification,
    alwaysInclude: run.snapshot.verification.alwaysInclude.filter(live),
  };
  const selection =
    run.isChild && run.cell !== null
      ? live(run.cell)
        ? [{ cell: run.cell, reason: 'always_include' as const }]
        : []
      : selectCandidates(
          policy,
          generateCells(run.snapshot.resolved).filter(live),
          discoveryRollUps(ctx, run.executionId),
          // why: ruling 3 — a discovery provider that does not sell the cabin prices nothing, so with no other the
          // step-5 stride applies rather than an empty ranking (ssr I3)
          run.snapshot.providers.discovery.some((id) => sellsCabin(ctx, id, run.snapshot.cabin)),
        );
  ctx.db.transaction(() => {
    ctx.repos.cells.seedVerification(run.executionId, selection, allCells, [...ids]);
    ctx.repos.cells.markDeparted(run.executionId, today);
    for (const id of ids) {
      if (!sellsCabin(ctx, id, run.snapshot.cabin))
        ctx.repos.cells.markNoData(run.executionId, 'verification', id, 'cabin-not-offered');
      else if (run.blocked.has(lineKey('verification', id)))
        markRemaining(ctx, run, 'verification', id, 'budget');
      else if (run.disabled.has(id)) markRemaining(ctx, run, 'verification', id, 'provider_disabled');
    }
  });
  const reasons: Record<string, number> = {};
  for (const x of selection) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
  run.log.info(
    { stage: 'verification', selected: selection.length, reasons },
    'verification: selection persisted',
  );
}

/** Spec §8.1 "verification": selection, then a bounded pool of cells per provider. */
export async function runVerification(ctx: EngineContext, run: RunState): Promise<void> {
  const ids = run.snapshot.providers.verification.filter(
    (id) => ctx.providers.get(id)?.verification !== undefined,
  );
  if (ids.length === 0) return; // why: spec §3 "a stage with no provider configured has no outcome rows and a NULL roll-up"
  ctx.repos.executions.setStatus(run.executionId, 'running', { stage: 'verification' });
  // why: spec §6.7 "never recomputed on resume"; spec §7 "resume re-runs selection only when no verification outcomes exist"
  if (!ctx.repos.cells.hasVerificationOutcomes(run.executionId)) persistSelection(ctx, run, ids);
  await Promise.all(ids.map((id) => runVerificationProvider(ctx, run, id)));
  if (run.stop === null && ids.every((id) => run.disabled.has(id)))
    stopRun(run, { kind: 'all-disabled', stage: 'verification' });
}

async function runVerificationProvider(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
): Promise<void> {
  const provider = ctx.providers.get(providerId);
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined) return;
  const cells = runnableCells(ctx, run, 'verification', providerId);
  if (cells.length > 0) {
    const lane = laneFor(run, 'verification', providerId);
    run.log
      .child({ providerId })
      .info({ stage: 'verification', cells: cells.length }, 'verification: searching cells');
    await runPool(cells, ctx.limitsOf(providerId).concurrency, lane.intakeSignal, async (cell) => {
      const key = cellKeyString(cell);
      lane.inFlight.add(key);
      try {
        const result = await cap.search(itineraryQuery(run.snapshot, cell), {
          executionId: run.executionId,
          signal: run.controller.signal,
          recordFixtures: false,
        });
        // why: decisions 25 and 27 — a chain stopped by budget or cancel resolves with the offers it already paid for,
        // and they are written; only a fatal stop writes nothing more. A cancelled call that throws stays not_run (spec §9 item 4)
        if (run.stop?.kind === 'fatal') return;
        commitVerifiedCell(ctx, run, provider, cap.info, cell, result);
      } catch (err) {
        onFailure(ctx, run, providerId, 'verification', [cell], err);
      } finally {
        lane.inFlight.delete(key);
      }
    });
  }
  settleLane(ctx, run, 'verification', providerId);
}

type RouteHistoryRow = Parameters<EngineContext['repos']['routeHistory']['upsert']>[0][number];

/**
 * Spec §7 route_price_history (rev 28, ruling 6 of decision 67): the vendor's price-history series belongs to the
 * searched trip, so each point is keyed by the cell's departure and return dates and the request cabin (the run's
 * snapshot cabin, never 'unknown'). Only points the vendor states in GBP are stored: the table has no FX columns, and a
 * past date converted at today's rate would be a figure the vendor never gave (prov-wp07-007); the repository asserts
 * the same rule (prov-004). Other points are dropped and counted.
 */
export function routeHistoryRows(
  providerId: ProviderId,
  cell: CellKey,
  cabin: Cabin,
  result: ItinerarySearchResult,
): { rows: RouteHistoryRow[]; dropped: number } {
  const rows: RouteHistoryRow[] = [];
  let dropped = 0;
  for (const p of result.routeHistory ?? []) {
    if (p.currency.toUpperCase() !== 'GBP') {
      dropped += 1;
      continue;
    }
    rows.push({
      origin: cell.origin,
      destination: cell.destination,
      trip: { departureDate: cell.departureDate, returnDate: cell.returnDate },
      cabin,
      providerId,
      date: p.date,
      lowestPricePence: p.lowestPriceMinor,
      currency: 'GBP',
      fetchedAt: result.fetchedAt,
      // why: spec §3 — the series carries the point of sale of the search that returned it (CodeRabbit batch 3)
      pointOfSale: result.pointOfSale,
    });
  }
  return { rows, dropped };
}

/**
 * Writes one verified cell atomically (spec §7: itinerary, segments, offer, observation, outcome, best_observation_id,
 * roll-up; the repository sets best_observation_id to the cheapest confirmed observation written, else the cheapest
 * unconfirmed one (decision 45), and never downgrades priced to empty; verdicts are read-time). Spec §3, §5.4, §5.6:
 * `priced` iff ≥ 1 offer survives normalisation, reason from core's `pricedReason` (`price-unconfirmed` when no
 * surviving offer had its price confirmed); `error` with the first normalisation reason when offers existed but none survived; `empty` only when
 * the provider answered coverage `empty` with no offers and no failed expansion. A result claiming priced coverage or
 * a partial expansion with no offer is a contract breach, recorded as `error` upstream, never as positive evidence of
 * no fares (prov-wp07-005).
 */
export function commitVerifiedCell(
  ctx: EngineContext,
  run: RunState,
  provider: FlightProvider,
  info: CapabilityInfo,
  cell: CellKey,
  result: ItinerarySearchResult,
): void {
  const pointOfSale = result.pointOfSale;
  const oc = {
    providerId: provider.id,
    info,
    cabin: run.snapshot.cabin,
    pointOfSale,
    fetchedAt: result.fetchedAt,
    suppliedFields: provider.suppliedFields,
    partialExpansion: result.partial,
  };
  const deps = normaliseDeps(ctx);
  const groups = new Map<string, VerifiedCellWrite['itineraries'][number]>();
  let written = 0;
  let minPence: number | null = null;
  let minConfirmed: number | null = null;
  let dropped = 0;
  let firstFailure: PriceRefusal | null = null;
  for (const raw of result.offers) {
    const w = offerWrite(raw, cell, oc, deps);
    if ('reason' in w) {
      dropped += 1;
      firstFailure ??= w;
      continue;
    }
    const g = groups.get(w.itinerary.hash) ?? { itinerary: w.itinerary, offers: [] };
    g.offers.push({ offer: w.offer, observation: w.observation });
    groups.set(w.itinerary.hash, g);
    written += 1;
    minPence = minPence === null ? w.observation.pricePence : Math.min(minPence, w.observation.pricePence);
    if (w.observation.suppliedFields.includes('price'))
      minConfirmed =
        minConfirmed === null ? w.observation.pricePence : Math.min(minConfirmed, w.observation.pricePence);
  }
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
  let outcome: VerifiedCellWrite['outcome'];
  if (written > 0)
    outcome = {
      ...base,
      status: 'priced',
      // why: decision 45 — the cell's price is the cheapest confirmed one; with none it is the cheapest unconfirmed one,
      // marked price-unconfirmed so the roll-up shows no itinerary-search price
      reason: pricedReason(result.partial, minConfirmed === null, dropped),
      lastError: firstFailure?.message ?? null,
      minPence: minConfirmed ?? minPence,
    };
  else if (firstFailure !== null)
    outcome = {
      ...base,
      status: 'error',
      reason: firstFailure.reason,
      lastError: firstFailure.message,
      minPence: null,
    };
  else if (result.coverage === 'empty' && !result.partial)
    outcome = { ...base, status: 'empty', reason: null, lastError: null, minPence: null };
  else {
    const breach = `the provider answered coverage ${result.coverage}${result.partial ? ` with ${result.failedExpansions} failed expansions` : ''} but returned no offer`;
    run.log
      .child({ providerId: provider.id })
      .warn(
        { stage: 'verification', coverage: result.coverage, partial: result.partial },
        'verification: result contradicts itself; cell marked error',
      );
    outcome = { ...base, status: 'error', reason: 'upstream', lastError: breach, minPence: null };
  }
  const history = routeHistoryRows(provider.id, cell, run.snapshot.cabin, result);
  ctx.db.transaction(() => {
    ctx.repos.cells.writeVerifiedCell(run.executionId, provider.id, {
      cell,
      outcome,
      itineraries: [...groups.values()],
    });
    if (history.rows.length > 0) ctx.repos.routeHistory.upsert(history.rows);
  });
  run.parseStreak.set(provider.id, 0);
  const log = run.log.child({ providerId: provider.id });
  if (dropped > 0)
    log.warn(
      { stage: 'verification', dropped, reason: firstFailure?.reason ?? null },
      'verification: offers dropped in normalisation',
    );
  if (history.dropped > 0)
    log.debug(
      { stage: 'verification', dropped: history.dropped },
      'verification: route history points not in GBP dropped',
    );
}
