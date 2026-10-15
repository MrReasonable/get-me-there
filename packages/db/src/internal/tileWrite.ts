import { type CellOutcome, type Clock, cellKeyString, type ProviderId } from '@gmt/core';
import type { Db } from '../client.js';
import { ExecutionsRepo } from '../repositories/executions.js';
import type { CalendarPriceInsert, TileWrite } from '../types.js';
import { keyParams } from './outcomeRow.js';
import {
  assertOutcomeProvenance,
  assertOutcomeReason,
  DELETE_FRESH_PRICE_SQL,
  DELETE_REUSED_PRICE_SQL,
  nextOutcome,
  readOutcome,
  storeOutcome,
  TILE_STATUSES,
} from './outcomeWrite.js';
import { insertCalendarPrice, validateCalendarPrice } from './priceRow.js';
import { storeRollUps } from './rollUps.js';
import { assertInt, assertProviderAllowed, assertProviderKind, RowRejected } from './validate.js';

// Spec §7 atomic unit "each tile's prices, outcomes and roll-ups": validation, then one transaction (arch-M4).

/**
 * Spec §7 atomic unit: one tile's prices, outcomes and roll-ups. Validation first (a malformed tile writes nothing);
 * any SQL failure inside rolls the whole tile back.
 */
export function writeTileRows(
  db: Db,
  clock: Clock,
  allowSynthetic: boolean,
  executionId: string,
  providerId: ProviderId,
  w: TileWrite,
): void {
  assertProviderAllowed(providerId, allowSynthetic);
  assertInt('tileIndex', w.tileIndex);
  assertInt('discards', w.discards);
  const prices = new Map<string, CalendarPriceInsert>();
  for (const p of w.prices) {
    if (p.providerId !== providerId)
      throw new RowRejected('provider', `price from ${p.providerId} in a ${providerId} tile`);
    const key = cellKeyString(p.cell);
    if (prices.has(key))
      throw new RowRejected(
        'in-tile-conflict',
        `two prices for ${key} in one tile; the engine keeps one per cell (spec §5.6)`,
      );
    validateCalendarPrice(p, allowSynthetic, true);
    prices.set(key, p);
  }
  const covered = new Set(w.cells.map(cellKeyString));
  const seen = new Set<string>();
  for (const o of w.outcomes) {
    const key = cellKeyString(o);
    if (!TILE_STATUSES.some((s) => s === o.status))
      throw new RowRejected(
        'tile-status',
        `a tile outcome is priced, empty or no_data; got ${o.status} (errors go through writeTileError)`,
      );
    if (!covered.has(key) || seen.has(key))
      throw new RowRejected('tile-partition', `${key} is outside the tile or repeated`);
    seen.add(key);
    assertOutcomeProvenance(o);
    if (o.sourceKind !== null) assertProviderKind(providerId, o.sourceKind, allowSynthetic);
    assertOutcomeReason(o);
    const price = prices.get(key);
    if (o.status === 'priced' && price === undefined)
      throw new RowRejected(
        'priced-needs-price',
        `${key} is priced but the tile wrote no price for it (spec §3)`,
      );
    if (o.status !== 'priced' && price !== undefined)
      throw new RowRejected('price-needs-priced', `${key} has a price but its outcome is ${o.status}`);
    if (price !== undefined) {
      if (o.minPence !== price.pricePence)
        throw new RowRejected(
          'min-pence',
          `${key} min_pence ${String(o.minPence)} differs from its price ${price.pricePence}`,
        );
      if (
        o.fetchedAt !== price.fetchedAt ||
        o.cabin !== price.cabin ||
        o.pointOfSale !== price.pointOfSale ||
        o.sourceKind !== price.sourceKind
      ) {
        throw new RowRejected(
          'outcome-price-mismatch',
          `${key} outcome provenance differs from its price row (ruling 5)`,
        );
      }
    }
  }
  if (seen.size !== covered.size)
    throw new RowRejected('tile-partition', 'every covered cell needs exactly one outcome');
  for (const key of prices.keys())
    if (!seen.has(key)) throw new RowRejected('price-needs-priced', `${key} has a price but no outcome`);
  db.transaction(() => {
    for (const o of w.outcomes) {
      const existing = readOutcome(db, executionId, o, 'discovery', providerId);
      const params = { ...keyParams(executionId, o), providerId };
      db.raw.prepare(DELETE_REUSED_PRICE_SQL).run(params);
      const price = prices.get(cellKeyString(o));
      if (price !== undefined) {
        // why: brief ruling 3, fresh on fresh priced keeps the minimum (core's merge picks the same source):
        // a lower price replaces the stored fresh row, an equal or higher one is not written.
        const freshPriced = existing.status === 'priced' && existing.reusedFromExecutionId === null;
        if (!freshPriced) insertCalendarPrice(db, executionId, price);
        else if (existing.minPence !== null && price.pricePence < existing.minPence) {
          db.raw.prepare(DELETE_FRESH_PRICE_SQL).run(params);
          insertCalendarPrice(db, executionId, price);
        }
      }
      const incoming: CellOutcome = {
        ...existing,
        ...o,
        attempts: existing.attempts,
        reusedFromExecutionId: null,
      };
      storeOutcome(db, nextOutcome(existing, incoming, false));
      // why: per cell, so a later failure in the same tile also rolls back roll-ups already stored (test-011 pins it).
      storeRollUps(db, executionId, 'discovery', [o]);
    }
    new ExecutionsRepo(db, clock).resetAutoResume(executionId);
  });
}
