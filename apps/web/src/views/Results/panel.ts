import {
  type CellKey,
  type Iata,
  type IsoDate,
  type LeftFor,
  type SkipDetail,
  scheduledOnlyPastText,
  scheduledOnlyText,
  sortedAirportPairs,
} from '@gmt/core';
import type { CellDetailResponse, ExecutionSummary } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatInstantDateLondon } from '../../format.js';
import { instantMs } from '../../lib/time.js';

// The per-airport-pair panel's pure helpers (review arch2-008: under the view-model coverage floor, beside the
// components). Moved from the Calendar's side panel (WP19 Task 19.6, §4: moved, not rewritten); the Calendar keeps its
// day picker (`cellsForDay`) until Task 19.8 removes that view.

const P = COPY.panel;
type Outcome = CellDetailResponse['outcomes'][number];
type VerifyInfo = CellDetailResponse['verify'];

/**
 * The date pair's cell on each airport pair in scope, in core's generation order (spec §6.1; review arch2-004: core's
 * one ordering): origins sorted, then destinations. One panel per cell (spec §11 Date pair detail).
 */
export function cellsForDatePair(
  origins: readonly Iata[],
  destinations: readonly Iata[],
  dates: { departureDate: IsoDate; returnDate: IsoDate },
): CellKey[] {
  return sortedAirportPairs(origins, destinations).map((p) => ({
    origin: p.origin,
    destination: p.destination,
    departureDate: dates.departureDate,
    returnDate: dates.returnDate,
  }));
}

/** The four-field key of a cell (the verify request and the picker take no `nights`). */
export function toKey(c: CellKey): CellKey {
  return {
    origin: c.origin,
    destination: c.destination,
    departureDate: c.departureDate,
    returnDate: c.returnDate,
  };
}

/**
 * Outcomes newest run first (prov-011): rows of runs the calendar response lists come in its newest-first order, then
 * any other run (an on-demand child), each group by fetchedAt descending.
 */
export function orderOutcomes(
  outcomes: readonly Outcome[],
  executions: readonly ExecutionSummary[],
): Outcome[] {
  const rank = (o: Outcome) => {
    const i = executions.findIndex((e) => e.id === o.executionId);
    return i === -1 ? executions.length : i;
  };
  const fetched = (o: Outcome) => (o.fetchedAt === null ? 0 : instantMs(o.fetchedAt));
  return [...outcomes].sort((a, b) => rank(a) - rank(b) || fetched(b) - fetched(a));
}

// why: widened once, so a part is looked up by Object.hasOwn and never reaches Object.prototype.
const REASONS: Readonly<Record<string, string>> = P.reasons;

/**
 * What a left cell's wording reads (review R12, S6, S9): who fetches the browser provider's left cells now (the api's
 * `browserLeftFor`), and whether the outcome is the latest parent run's; an earlier run's reads in the past tense.
 */
export interface LeftContext {
  leftFor: LeftFor;
  latest: boolean;
}

/**
 * An outcome reason in operator words (spec §3 reason lists). A priced reason is core's `;`-joined parts
 * (`pricedReason`: partial-expansion, price-unconfirmed, offers-dropped:n; decisions 19, 45, 48, 50); a reason core
 * does not know is shown as it came, marked "other".
 */
export function reasonText(
  reason: string | null,
  skipDetail: SkipDetail | null = null,
  left: LeftContext | null = null,
): string {
  if (reason === null) return P.dash;
  // why: spec §3 rev 36 — a scheduled_only cell says which run fetches it and which rule left it, in core's one text;
  // only the latest run's cells carry that promise (review S9), an earlier run's says what that run did
  if (reason === 'scheduled_only' && skipDetail !== null && left !== null)
    return left.latest ? scheduledOnlyText(skipDetail, left.leftFor) : scheduledOnlyPastText(skipDetail);
  return reason.split(';').map(reasonPart).join('; ');
}

function reasonPart(part: string): string {
  const dropped = /^offers-dropped:(\d+)$/.exec(part);
  if (dropped?.[1] !== undefined) return P.offersDropped(Number(dropped[1]));
  return Object.hasOwn(REASONS, part) ? (REASONS[part] ?? P.reasonRaw(part)) : P.reasonRaw(part);
}

/** "run 14 Mar 2027" (Europe/London, decision 52) for a run the response lists, else the run id's head. */
export function runLabel(executionId: string, executions: readonly ExecutionSummary[]): string {
  const started = executions.find((e) => e.id === executionId)?.startedAt ?? null;
  return P.run(started === null ? executionId.slice(0, 8) : formatInstantDateLondon(instantMs(started)));
}

/**
 * The cell's calendar prices with current ones first and those a newer parent execution superseded after them
 * (decision 54), each group in the order the api sent it.
 */
export function orderCalendarPrices<P extends { superseded: boolean }>(prices: readonly P[]): P[] {
  return [...prices.filter((p) => !p.superseded), ...prices.filter((p) => p.superseded)];
}

/** True when the child could make no call: a zero cap or no budget headroom left (WP7's childCapPreview). */
export function noHeadroom(v: VerifyInfo): boolean {
  if (v === null) return false;
  return v.maxCalls === 0 || v.headroomCalls === 0;
}

/**
 * Whether Verify may be pressed (review ui-r2-007): only once the cell detail has loaded what the search may spend,
 * so no call is spent before the operator has seen its hard stop; never with no headroom, never while one is sent.
 */
export function canPressVerify(detail: CellDetailResponse | undefined, sending: boolean): boolean {
  return detail !== undefined && detail.verify !== null && !noHeadroom(detail.verify) && !sending;
}
