import { CONFIRM_TARGET, type ConfirmSummary, stopDetailClause } from '@gmt/core';
import type { ExecutionResponse } from '../../api/types.js';
import type { PageCopy } from './stateLines.js';

// Design 2026-11-08 §5.5: the one line under the board that says how checking flights ended, as a pure function of the
// run's flight counts (the stored `ConfirmSummary`, `ended`, the reason the api reports, whether the step is still going
// and how many dates it checked). Every word is a COPY template (`datesView.confirm`), passed in so the catalogue sweeps
// them. The operator reads "trips with flights read", never "confirmed"; `confirm` is the code's term.

type Flights = NonNullable<ExecutionResponse['flights']>;

/** What the line is composed from; the run's `flights` object carries all of it but `running`. */
export interface ConfirmLineInput {
  /** The stored summary; null for a run stored before the change, or one that never reached the step: no line. */
  confirm: ConfirmSummary | null;
  /** How the plan says the step ended early: the browser window (`window`) or an ending page or cap (`stopped`). */
  ended: Flights['ended'];
  /** Why the step stopped early (the api's `flights.stopCause`), or null. */
  stopCause: Flights['stopCause'];
  /** The step is going now (an active run still reading flights). */
  running: boolean;
  /** The dates checked: `flights.planned`, the pairs whose read started plus those reused (design §7). */
  planned: number;
}

/** "Because …" for a reason the run reports: an ending page's stop detail in its existing words, else the cause's kind. */
function causeWords(cause: Flights['stopCause'], c: PageCopy): string {
  const B = c.datesView.confirm.because;
  if (cause === null) return B.other;
  // why: design §5.5 — a stop detail reuses `stopText`'s own wording (core's `stopDetailClause`); the step is the
  // browser worker's, so the clause names it where it would open with "it"
  if ('detail' in cause) return stopDetailClause(cause.detail, 'camoufox', true);
  return B[cause.kind];
}

/**
 * The reason the step stopped before its own rule ended it, or null when the rule did (patience, queue empty).
 * An ending page or a cap (`ended 'stopped'`) reads its stop detail; the window its own words; the step losing return
 * flights its own; a step with no end and no stop of its own was aborted (a cancel, a spending limit, an error), which
 * the run's stop cause tells.
 */
function becauseOf(i: ConfirmLineInput & { confirm: ConfirmSummary }, c: PageCopy): string | null {
  const B = c.datesView.confirm.because;
  if (i.ended === 'window') return B.window;
  if (i.ended !== null) return causeWords(i.stopCause, c);
  if (i.confirm.stop === 'returns-stopped') return B.returnsStopped;
  return i.confirm.stop === null ? causeWords(i.stopCause, c) : null;
}

/** Whether a run's flight step is in confirm mode and still going: no early end and no stop of its own yet. */
export function confirmStepGoing(f: Flights | null): boolean {
  return f !== null && f.confirm?.mode === 'confirm' && f.ended === null && f.confirm.stop === null;
}

/** Design §5.5: the line's words, or null when the run has no summary. */
export function confirmLineText(i: ConfirmLineInput, c: PageCopy): string | null {
  const k = i.confirm;
  if (k === null) return null;
  const D = c.datesView.confirm;
  if (k.mode === 'outbound-only') return D.outboundOnly;
  if (k.mode === 'flags-unread') return D.flagsUnread;
  const trips = D.trips(k.confirmed);
  if (i.running) return D.running(i.planned, trips);
  const dates = D.dates(i.planned);
  const unread = k.unread > 0 ? D.unread(k.unread) : null;
  // why: design §4.5 — with fewer than the target of trips every unread pair could still have made the standings, so the
  // count is of dates not checked (not of those that look cheaper)
  const few = k.confirmed < CONFIRM_TARGET;
  const left = k.uncheckedCheaper;
  const because = becauseOf({ ...i, confirm: k }, c);
  if (because !== null) {
    const head = `${D.stopped(dates, because)}; ${trips}.`;
    if (left === 0) return head;
    return `${head} ${few ? D.unchecked(left) : D.cheaperStopped(left)}`;
  }
  if (k.stop === 'queue-empty') return `${D.checkedEvery(unread)}; ${trips}.`;
  const head = `${D.checked(dates, unread)}; ${trips}`;
  if (left === 0) return `${head}.`;
  return few ? `${head}: ${D.fewTrips}. ${D.unchecked(left)}` : `${head}. ${D.cheaperUnchecked(left)}`;
}
