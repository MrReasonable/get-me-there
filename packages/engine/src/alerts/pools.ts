/**
 * Alert candidates of one execution, per basis (spec §6.8): the calendar prices it fetched and the observations it
 * wrote, with each candidate's previous price and that price's provenance (decision 56).
 */
import {
  type AlertCandidate,
  type AlertEvent,
  type CalendarCandidate,
  daysBetween,
  type Provenance,
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

/** Calendar prices fetched by this execution (reused excluded by the repository) in the snapshot's cabin. Spec §6.8. */
export function calendarPool(ctx: AlertRunContext): Pool {
  const candidates = ctx.deps.repos.calendarPrices
    .fetchedBy(ctx.executionId)
    .filter((r) => r.cabin === ctx.snapshot.cabin)
    .map(
      (r): CalendarCandidate => ({
        basis: 'calendar',
        calendarPriceId: r.id,
        fetchedByExecutionId: r.executionId,
        pricePence: r.pricePence,
        provenance: r.provenance,
        cell: { ...r.cell, nights: daysBetween(r.cell.departureDate, r.cell.returnDate) },
        previous: null,
      }),
    );
  return { candidates, previous: new Map(), unconfirmed: 0 };
}
