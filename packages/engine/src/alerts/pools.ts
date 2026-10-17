/**
 * Alert candidates of one execution, per basis (spec §6.8): the calendar prices it fetched and the observations it
 * wrote, with each candidate's previous price and that price's provenance (decision 56).
 */
import {
  type AlertCandidate,
  type AlertEvent,
  type CalendarCandidate,
  daysBetween,
  evaluateConstraints,
  isoDateTimeOfEpochMs,
  type Observation,
  type Provenance,
  type ProviderId,
  type ResultBasis,
  unverifiedNames,
  type VerifiedCandidate,
  verdictClass,
  withAssumedBound,
} from '@gmt/core';
import type { AlertRunContext } from './context.js';

/** A previous price with its provenance, for the email and the event payload. */
export interface PreviousPrice {
  pricePence: number;
  provenance: Provenance;
}

/** One basis's candidates, their previous prices by rowRef, and the fares left out because their price is unconfirmed. */
export interface Pool {
  candidates: AlertCandidate[];
  previous: ReadonlyMap<string, PreviousPrice>;
  unconfirmed: number;
}

/** previousFor's lower bound: none. Core judges the 2 × discoveryRefreshHours window itself (in whole minutes). */
const NO_LOWER_BOUND = isoDateTimeOfEpochMs(0);

/** A price row as alert_events references it: the one format (decision 59), for candidates and events alike. */
export function rowRefOf(r: Pick<AlertEvent, 'observationId' | 'calendarPriceId'>): string {
  return r.observationId !== null ? `observation:${r.observationId}` : `calendar:${r.calendarPriceId}`;
}

/** The candidate's row, as alert_events references it. */
export function rowRef(c: AlertCandidate): string {
  return rowRefOf({
    observationId: c.basis === 'verified' ? c.observation.id : null,
    calendarPriceId: c.basis === 'calendar' ? c.calendarPriceId : null,
  });
}

/** Spec §5.5: alerts refuse synthetic rows; the fixture provider ⇔ synthetic invariant is checked both ways. */
export function isSynthetic(p: Pick<Provenance, 'providerId' | 'sourceKind'>): boolean {
  return p.sourceKind === 'synthetic' || p.providerId === 'fixture';
}

/** Drops synthetic rows before any rule sees them and logs the count once per basis. */
function refuseSynthetic<T extends { provenance: Provenance }>(
  ctx: AlertRunContext,
  basis: ResultBasis,
  rows: T[],
): T[] {
  const kept = rows.filter((r) => !isSynthetic(r.provenance));
  const refused = rows.length - kept.length;
  if (refused > 0) ctx.log.warn({ basis, refused }, 'alerts: synthetic rows refused');
  return kept;
}

/**
 * Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin; previous =
 * the newest earlier fetch for (definition, provider, cabin, cell). Spec §6.8.
 * why: core compares only within 2 × discoveryRefreshHours and lists an older previous price in the "new" section with
 * its age, so the repository query has no lower bound.
 */
export function calendarPool(ctx: AlertRunContext): Pool {
  const previous = new Map<string, PreviousPrice>();
  const infoOf = (id: ProviderId) => ctx.deps.providers.find((p) => p.id === id)?.discovery?.info;
  const rows = refuseSynthetic(ctx, 'calendar', ctx.deps.repos.calendarPrices.fetchedBy(ctx.executionId));
  const candidates = rows
    .filter((r) => r.cabin === ctx.snapshot.cabin)
    .map((r): CalendarCandidate => {
      const prev = ctx.deps.repos.calendarPrices.previousFor(
        ctx.definition.id,
        r.providerId,
        r.cabin,
        r.cell,
        r.fetchedAt,
        NO_LOWER_BOUND,
      );
      const c: CalendarCandidate = {
        basis: 'calendar',
        calendarPriceId: r.id,
        fetchedByExecutionId: r.executionId,
        pricePence: r.pricePence,
        // why: N4 (pie-007): the email and the event payload label an assumed bound "assumed", as the views do.
        provenance: withAssumedBound(r.provenance, infoOf(r.providerId)),
        cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
        previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.fetchedAt },
      };
      if (prev !== null)
        previous.set(rowRef(c), {
          pricePence: prev.pricePence,
          provenance: withAssumedBound(prev.provenance, infoOf(r.providerId)),
        });
      return c;
    });
  return { candidates, previous, unconfirmed: 0 };
}

/**
 * The offer's newest earlier observation whose price the final step confirmed (PA-1): a drop is never measured against
 * an unconfirmed price, so unconfirmed ones are walked past.
 */
function confirmedPrevious(ctx: AlertRunContext, offerId: number, before: Observation): Observation | null {
  let prev = ctx.deps.repos.itineraries.previousObservation(offerId, before.provenance.fetchedAt);
  while (prev !== null && !prev.suppliedFields.includes('price'))
    prev = ctx.deps.repos.itineraries.previousObservation(offerId, prev.provenance.fetchedAt);
  return prev;
}

/**
 * Observations written by this execution in the snapshot's cabin, verdicts recomputed against the current definition
 * (spec §6.2), failed excluded; previous = the offer's newest earlier confirmed observation. Spec §6.8.
 * why: an offer whose price the final step did not confirm (`price` not supplied) is never alerted on (decisions 27,
 * 37, 45); one that passes its other constraints is counted, so the digest can say so. Core settles each identity on
 * its cheapest eligible candidate (rev 11), so every other offer is passed; reducing here could drop the
 * class-verified offer a requireAllVerified rule needs in favour of a cheaper partially-verified one.
 */
export function verifiedPool(ctx: AlertRunContext): Pool {
  const candidates: VerifiedCandidate[] = [];
  const previous = new Map<string, PreviousPrice>();
  let unconfirmed = 0;
  for (const row of refuseSynthetic(ctx, 'verified', ctx.deps.repos.itineraries.writtenBy(ctx.executionId))) {
    if (row.offer.cabin !== ctx.snapshot.cabin) continue;
    const verdicts = evaluateConstraints(
      row.itinerary,
      row,
      ctx.definition.constraints,
      ctx.snapshot.cabin,
      row.suppliedFields,
    );
    const cls = verdictClass(verdicts);
    if (cls === 'failed') continue;
    if (!row.suppliedFields.includes('price')) {
      unconfirmed += 1;
      continue;
    }
    const prev = confirmedPrevious(ctx, row.offerId, row);
    const c: VerifiedCandidate = {
      basis: 'verified',
      observation: row,
      itinerary: row.itinerary,
      verdictClass: cls,
      unverified: unverifiedNames(verdicts),
      seller: row.seller,
      previous: prev === null ? null : { pricePence: prev.pricePence, fetchedAt: prev.provenance.fetchedAt },
    };
    if (prev !== null) previous.set(rowRef(c), { pricePence: prev.pricePence, provenance: prev.provenance });
    candidates.push(c);
  }
  if (unconfirmed > 0) ctx.log.info({ unconfirmed }, 'alerts: unconfirmed prices left out');
  return { candidates, previous, unconfirmed };
}
