import { type CellOutcome, type Clock, cellKeyString, type ProviderId } from '@gmt/core';
import type { Db } from '../client.js';
import { ExecutionsRepo } from '../repositories/executions.js';
import type { CalendarPriceRow, ReuseCriteria, ReusedCopy } from '../types.js';
import { readSnapshot } from './definitionRow.js';
import { keyParams, type OutcomeDbRow, toOutcome } from './outcomeRow.js';
import { SELECT_OUTCOME_SQL, storeOutcome } from './outcomeWrite.js';
import {
  type CalendarPriceDbRow,
  insertCalendarPrice,
  toCalendarPriceRow,
  validateCalendarPrice,
} from './priceRow.js';
import { storeRollUps } from './rollUps.js';
import { assertIsoDateTime, assertProviderAllowed, assertProviderKind, RowRejected } from './validate.js';

// Spec §8.1 reuse: every copy re-checked against the stored source and the criteria, then written in one transaction (arch-M4).

/** prov-005: every field a reused copy carries must agree before anything is written (rule reuse-source). */
function assertReusable(
  providerId: ProviderId,
  { cell, outcome, price }: ReusedCopy,
  allowSynthetic: boolean,
): void {
  const key = cellKeyString(cell);
  const refuse = (why: string) => new RowRejected('reuse-source', `${key}: ${why} (spec §8.1)`);
  if (outcome.status !== 'priced' && outcome.status !== 'empty' && outcome.status !== 'no_data')
    throw refuse(`only priced, empty or no_data outcomes are reused, got ${outcome.status}`);
  if (outcome.providerId !== providerId || outcome.stage !== 'discovery')
    throw refuse(
      `a ${outcome.providerId} ${outcome.stage} outcome cannot be reused for ${providerId} discovery`,
    );
  if (cellKeyString(outcome) !== key) throw refuse(`the outcome is for ${cellKeyString(outcome)}`);
  if (
    outcome.fetchedAt === null ||
    outcome.cabin === null ||
    outcome.pointOfSale === null ||
    outcome.sourceKind === null
  )
    throw refuse('the outcome carries no provenance');
  assertProviderKind(providerId, outcome.sourceKind, allowSynthetic);
  if ((outcome.status === 'priced') !== (price !== null))
    throw refuse(`a ${outcome.status} outcome with${price === null ? 'out' : ''} a price`);
  if (price === null) return;
  if (cellKeyString(price.cell) !== key) throw refuse(`the price is for ${cellKeyString(price.cell)}`);
  if (price.providerId !== providerId) throw refuse(`the price is from ${price.providerId}`);
  if (price.fetchedAt !== outcome.fetchedAt || price.pricePence !== outcome.minPence)
    throw refuse('the price and the outcome disagree on fetched_at or amount');
  if (
    price.cabin !== outcome.cabin ||
    price.pointOfSale !== outcome.pointOfSale ||
    price.sourceKind !== outcome.sourceKind
  )
    throw refuse('the price and the outcome disagree on cabin, point of sale or source kind');
}

/**
 * prov-r2-001: the copy must be what the database holds. The source outcome is re-read by its keys and the price by
 * its id; both must equal the values supplied, and the source must be a non-child execution of the target's
 * definition fetched in the target's cabin, at the criteria's point of sale and source kind and after its cutoff
 * (spec §8.1, §9 Layer A). This is the one path that writes a price without a
 * provider call, so it trusts no caller; copyReused writes the re-read rows it returns.
 */
function assertSourceStored(
  db: Db,
  targetExecutionId: string,
  providerId: ProviderId,
  { cell, outcome, price }: ReusedCopy,
  criteria: ReuseCriteria,
): { stored: CellOutcome; held: CalendarPriceRow | null } {
  const refuse = (why: string) =>
    new RowRejected('reuse-source', `${cellKeyString(cell)}: ${why} (spec §8.1)`);
  const src = db.raw
    .prepare<Record<string, unknown>, OutcomeDbRow & { definition_id: string; is_child: number }>(
      `SELECT o.*, e.definition_id, e.is_child FROM cell_outcomes o JOIN search_executions e ON e.id = o.execution_id
       WHERE o.execution_id = @executionId AND o.origin = @origin AND o.destination = @destination AND o.departure_date = @departureDate AND o.return_date = @returnDate
         AND o.stage = 'discovery' AND o.provider_id = @providerId`,
    )
    .get({ ...keyParams(outcome.executionId, cell), providerId });
  if (src === undefined) throw refuse(`no stored outcome in ${outcome.executionId}`);
  const target = db.raw
    .prepare<[string], { definition_id: string; definition_snapshot_json: string }>(
      'SELECT definition_id, definition_snapshot_json FROM search_executions WHERE id = ?',
    )
    .get(targetExecutionId);
  if (src.is_child !== 0 || target === undefined || src.definition_id !== target.definition_id)
    throw refuse('the source is not a parent execution of the same definition');
  const stored = toOutcome(src);
  // why: spec §9 Layer A "refuse on a cabin change": the definition's cabin may have been edited since the source ran (prov-r3-002).
  const targetCabin = readSnapshot(
    'search_executions.definition_snapshot_json',
    target.definition_snapshot_json,
  ).cabin;
  if (stored.cabin !== targetCabin)
    throw refuse(`the source was fetched in ${String(stored.cabin)}, the target searches ${targetCabin}`);
  // why: spec §8.1 reuse matches point of sale and source kind and takes only sources newer than the cutoff; this
  // path trusts no caller, so it re-applies the criteria reuseCandidates used (prov-M3).
  if (stored.pointOfSale !== criteria.pointOfSale || stored.sourceKind !== criteria.sourceKind)
    throw refuse(
      `the source is ${String(stored.pointOfSale)}/${String(stored.sourceKind)}, not ${criteria.pointOfSale}/${criteria.sourceKind}`,
    );
  if (stored.fetchedAt === null || stored.fetchedAt <= criteria.newerThan)
    throw refuse(`the source was fetched at ${String(stored.fetchedAt)}, not after ${criteria.newerThan}`);
  const same = (a: CellOutcome) =>
    [
      a.status,
      a.reason,
      a.fetchedAt,
      a.minPence,
      a.cabin,
      a.pointOfSale,
      a.sourceKind,
      a.reusedFromExecutionId,
    ].join('|');
  if (same(stored) !== same(outcome)) throw refuse('the supplied outcome differs from the stored one');
  if (price === null) return { stored, held: null };
  const p = db.raw
    .prepare<[number], CalendarPriceDbRow>('SELECT * FROM calendar_prices WHERE id = ?')
    .get(price.id);
  if (p === undefined) throw refuse(`calendar price ${price.id} does not exist`);
  const held = toCalendarPriceRow(p);
  const fxKey = (x: CalendarPriceRow) =>
    x.fx.converted ? `1|${x.fx.rateNano}|${x.fx.rateDate}|${x.fx.source}` : '0';
  const priceKey = (x: CalendarPriceRow) =>
    [
      x.executionId,
      x.providerId,
      cellKeyString(x.cell),
      x.pricePence,
      x.priceNativeMinor,
      x.currencyNative,
      fxKey(x),
      x.fetchedAt,
      x.providerObservedAt,
      x.maxAgeHours,
      x.vendorLink,
      x.cabin,
      x.pointOfSale,
      x.sourceKind,
      x.reusedFromExecutionId,
    ].join('|');
  if (held.executionId !== outcome.executionId || priceKey(held) !== priceKey(price))
    throw refuse('the supplied price differs from the stored one');
  return { stored, held };
}

/**
 * A target a reused copy may replace (ssr M2): `not_run`, an `error`, or `skipped` for budget or a disabled provider,
 * the outcomes a resume would fetch again; never a fetched result or another skip (departed, not_selected).
 */
function refetchable(target: OutcomeDbRow): boolean {
  return (
    target.status === 'not_run' ||
    target.status === 'error' ||
    (target.status === 'skipped' && (target.reason === 'budget' || target.reason === 'provider_disabled'))
  );
}

/**
 * Spec §7 atomic unit "each reused cell's outcome + copied prices + roll-up" (one transaction for the batch).
 * Copies keep the original fetched_at and provenance; reused_from_execution_id is always the execution that
 * fetched the price, even when the source is itself a reused copy.
 */
export function writeReusedCopies(
  db: Db,
  clock: Clock,
  allowSynthetic: boolean,
  executionId: string,
  providerId: ProviderId,
  copies: ReusedCopy[],
  criteria: ReuseCriteria,
): void {
  assertProviderAllowed(providerId, allowSynthetic);
  assertIsoDateTime('newerThan', criteria.newerThan);
  for (const copy of copies) {
    assertReusable(providerId, copy, allowSynthetic);
    if (copy.price !== null) validateCalendarPrice(copy.price, allowSynthetic, false);
  }
  db.transaction(() => {
    for (const { cell, outcome, price } of copies) {
      const key = { ...keyParams(executionId, cell), stage: 'discovery', providerId };
      const target = db.raw.prepare<Record<string, unknown>, OutcomeDbRow>(SELECT_OUTCOME_SQL).get(key);
      if (target === undefined || !refetchable(target))
        throw new RowRejected(
          'reuse-target',
          `${cellKeyString(cell)} in ${executionId} is ${target?.status ?? 'missing'}${target?.reason ? `:${target.reason}` : ''}, not an outcome a resume fetches again`,
        );
      // why: what is written is what the database holds (prov-r3-001), never the caller's objects.
      const { stored, held } = assertSourceStored(
        db,
        executionId,
        providerId,
        { cell, outcome, price },
        criteria,
      );
      const reusedFrom = stored.reusedFromExecutionId ?? stored.executionId;
      storeOutcome(db, {
        ...stored,
        ...keyParams(executionId, cell),
        executionId,
        stage: 'discovery',
        providerId,
        // why: attempts count failed passes (ssr-03); a copy over an error keeps them
        attempts: target.attempts,
        lastError: null,
        reusedFromExecutionId: reusedFrom,
      });
      if (held !== null) insertCalendarPrice(db, executionId, { ...held, reusedFromExecutionId: reusedFrom });
    }
    storeRollUps(
      db,
      executionId,
      'discovery',
      copies.map((c) => c.cell),
    );
    // why: spec §7 "reset when a tile or cell commits"; a run that progresses only by reuse is progressing (dm-M1).
    if (copies.length > 0) new ExecutionsRepo(db, clock).resetAutoResume(executionId);
  });
}
