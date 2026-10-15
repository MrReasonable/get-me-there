import { type CellOutcome, type Clock, cellKeyString, isPartialExpansion, type ProviderId } from '@gmt/core';
import type { Db } from '../client.js';
import { ExecutionsRepo } from '../repositories/executions.js';
import { ItinerariesRepo } from '../repositories/itineraries.js';
import type { VerifiedCellWrite } from '../types.js';
import { CELL_WHERE, keyParams } from './outcomeRow.js';
import {
  assertOutcomeProvenance,
  assertOutcomeReason,
  nextOutcome,
  readOutcome,
  storeOutcome,
} from './outcomeWrite.js';
import { storeRollUps } from './rollUps.js';
import { assertErrorReason, assertProviderAllowed, assertProviderKind, RowRejected } from './validate.js';

// Spec §7 atomic unit "one verified cell": validation, then one transaction (arch-M4).

/**
 * Spec §7 atomic unit: one verified cell's itineraries, segments, offers, observations, outcome, best_observation_id
 * and roll-up. Merged like writeTile (ruling 3); best_observation_id is the cheapest observation written (ruling 13).
 */
export function writeVerifiedCellRows(
  db: Db,
  clock: Clock,
  allowSynthetic: boolean,
  executionId: string,
  providerId: ProviderId,
  w: VerifiedCellWrite,
): void {
  assertProviderAllowed(providerId, allowSynthetic);
  if (w.outcome.sourceKind !== null) assertProviderKind(providerId, w.outcome.sourceKind, allowSynthetic);
  const key = cellKeyString(w.cell);
  const o = w.outcome;
  const offers = w.itineraries.flatMap((i) => i.offers.map((x) => ({ ...x, itinerary: i.itinerary })));
  if (cellKeyString(o) !== key)
    throw new RowRejected('cell-mismatch', `outcome is for ${cellKeyString(o)}, not ${key}`);
  if (o.status !== 'priced' && o.status !== 'empty' && o.status !== 'error')
    throw new RowRejected('verified-status', `a verified cell is priced, empty or error; got ${o.status}`);
  if (o.status === 'priced' && offers.length === 0)
    throw new RowRejected('priced-needs-offer', `${key} is priced with no offer (spec §5.4)`);
  if (o.status !== 'priced' && offers.length > 0)
    throw new RowRejected('offers-need-priced', `${key} has offers but status ${o.status}`);
  if (o.status === 'error') assertErrorReason(o.reason);
  else {
    assertOutcomeProvenance(o);
    assertOutcomeReason(o);
  }
  for (const x of offers) {
    if (cellKeyString(x.itinerary) !== key)
      throw new RowRejected(
        'cell-mismatch',
        `itinerary ${x.itinerary.hash} is for ${cellKeyString(x.itinerary)}, not ${key}`,
      );
    if (x.offer.itineraryHash !== x.itinerary.hash || x.offer.providerId !== providerId)
      throw new RowRejected(
        'offer-mismatch',
        `offer does not belong to itinerary ${x.itinerary.hash} from ${providerId}`,
      );
    const p = x.observation.provenance;
    if (
      p.providerId !== providerId ||
      p.cabin !== o.cabin ||
      p.pointOfSale !== o.pointOfSale ||
      p.sourceKind !== o.sourceKind
    )
      throw new RowRejected(
        'outcome-price-mismatch',
        `${key} observation provenance differs from its outcome (ruling 5)`,
      );
  }
  // why: the per-observation flag and the outcome reason describe the same truncation; a cell must not roll up as
  // complete while its observations say expansion was partial, or the reverse (prov-M6).
  if (
    o.status === 'priced' &&
    offers.some((x) => x.observation.partialExpansion) !== isPartialExpansion(o.reason)
  )
    throw new RowRejected(
      'partial-expansion',
      `${key} reason ${String(o.reason)} disagrees with its observations' partialExpansion flags`,
    );
  if (offers.length > 0) {
    const cheapest = Math.min(...offers.map((x) => x.observation.pricePence));
    const oldest = offers.map((x) => x.observation.provenance.fetchedAt).sort()[0];
    if (o.minPence !== cheapest)
      throw new RowRejected(
        'min-pence',
        `${key} min_pence ${String(o.minPence)} differs from the cheapest offer ${cheapest}`,
      );
    if (o.fetchedAt !== oldest)
      throw new RowRejected(
        'outcome-price-mismatch',
        `${key} outcome fetchedAt must be its oldest observation's (spec §2)`,
      );
  }
  const itineraries = new ItinerariesRepo(db, clock, { allowSynthetic });
  db.transaction(() => {
    let best: { id: number; pence: number } | null = null;
    for (const x of offers) {
      itineraries.upsertItinerary(x.itinerary);
      const { observationId: id } = itineraries.recordObservation(x.offer, {
        ...x.observation,
        executionId,
      });
      if (best === null || x.observation.pricePence < best.pence)
        best = { id, pence: x.observation.pricePence };
    }
    const existing = readOutcome(db, executionId, w.cell, 'verification', providerId);
    // why: an error carries no fetched data, so it stores no provenance, as writeTileError does (prov-M5).
    const provenance =
      o.status === 'error' ? { fetchedAt: null, cabin: null, pointOfSale: null, sourceKind: null } : {};
    const incoming: CellOutcome = {
      ...existing,
      ...o,
      ...provenance,
      minPence: best?.pence ?? null,
      attempts: existing.attempts,
      reusedFromExecutionId: null,
    };
    storeOutcome(db, nextOutcome(existing, incoming, o.status === 'error'));
    if (best !== null) {
      db.raw
        .prepare(
          `UPDATE search_cells SET best_observation_id = @bestId WHERE ${CELL_WHERE} AND (best_observation_id IS NULL OR (SELECT price_pence FROM price_observations WHERE id = search_cells.best_observation_id) > @bestPence)`,
        )
        .run({ ...keyParams(executionId, w.cell), bestId: best.id, bestPence: best.pence });
    }
    storeRollUps(db, executionId, 'verification', [w.cell]);
    if (o.status !== 'error') new ExecutionsRepo(db, clock).resetAutoResume(executionId);
  });
}
