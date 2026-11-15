import {
  ACTIVE_STATUSES,
  type ExecutionStatus,
  IN_FLIGHT_STATUSES,
  type IsoDateTime,
  RESUMABLE_ACTIVE_STATUSES,
  STOPPED_STATUSES,
  type Stage,
} from '@gmt/core';
import { useEffect, useState } from 'react';
import type { SearchCard } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatRunInstant } from '../format.js';
import { readingCount } from '../lib/flightsReading.js';
import { instantMs } from '../lib/time.js';
import { useNow } from '../now.js';
import { fixNamesResume, StopSentence, type StopWords, stopOrNone } from './StopWords.js';

const IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);
const ACTIVE: ReadonlySet<string> = new Set(ACTIVE_STATUSES);
const STOPPED: ReadonlySet<string> = new Set(STOPPED_STATUSES);
const RESUMABLE_ACTIVE: ReadonlySet<string> = new Set(RESUMABLE_ACTIVE_STATUSES);
const R = COPY.runProgress;

/**
 * What `RunProgress` shows of one run (design 2026-11-08 Ruling 11): a card's `latestRun` and the Search page's
 * execution both reduce to it (`runProgressOf` does the card's), so the two never word a run differently.
 */
export interface RunProgressRun {
  /** The run's id: the Cancel confirmation is bound to it, so it can never cancel another run. */
  id: string;
  status: ExecutionStatus;
  /**
   * The calendar pass: dates read so far, and the dates in the search; both null when the whole search's counts are not
   * known (a narrowed page read with no card of this run), so no part is given as the whole.
   */
  done: number | null;
  total: number | null;
  /** Now plus the run's remaining time while it is pending or running; null leaves "about N min left" out. */
  estimatedFinishAt: IsoDateTime | null;
  /** The flight step's reads so far (`readingCount`) while it is reading; null while the calendar is still being read. */
  flightsRead: number | null;
  /**
   * While the run checks fares (running at its verification stage: the page's hidden status says "Checking fares"), the
   * date pairs checked of those to check; a total of 0 is a run whose checks are not counted (a card's). Null
   * otherwise.
   */
  checking: { done: number; total: number } | null;
  /** A stopped run's sentence and fix; null takes `NO_STOP_CAUSE_TEXT` when the status is a stopped one. */
  stop: StopWords | null;
  /** When a paused run resumes by itself, from the run; null when it names none. */
  resumeAfter: IsoDateTime | null;
  /** An active one-date child run's status (it reads flights for a date on its own); null when none. */
  childRun: ExecutionStatus | null;
}

/**
 * True while a run checks fares: running at its verification stage. The page's hidden status (`stateLine`'s
 * *checking*) and `RunProgress`'s line on a card and on the page all take it from here, so the two never disagree.
 */
export const isChecking = (run: { status: ExecutionStatus; stage: Stage | null }): boolean =>
  run.status === 'running' && run.stage === 'verification';

/** A card's latest run as `RunProgress` shows it: its dates, its flight reads, whether it checks fares, and its stop. */
export function runProgressOf(run: NonNullable<SearchCard['latestRun']>): RunProgressRun {
  const reading = readingCount(run.flights);
  return {
    id: run.id,
    status: run.status,
    done: run.datePairsSearched,
    total: run.datePairs,
    estimatedFinishAt: run.estimatedFinishAt,
    // why: as the card's state line did (ruling R-reading): the flights line only once the run is reading them
    flightsRead: run.status === 'running' ? reading : null,
    // why: final review M1: the card carries the run's stage but not its checks, so it says "Checking fares" uncounted
    checking: isChecking(run) ? { done: 0, total: 0 } : null,
    stop: run.stop,
    resumeAfter: null,
    childRun: null,
  };
}

/**
 * The run's bar: the dates read while the calendar is read, the fares checked while they are (when counted); no value
 * while flights are read or checks are not counted, as an open-ended number has no total, so the bar says only "going".
 */
function RunBar({ run }: { run: RunProgressRun }) {
  if (run.checking !== null)
    return (
      <progress
        className="run-bar"
        aria-label={R.checkingBarLabel}
        max={Math.max(run.checking.total, 1)}
        value={run.checking.total === 0 ? undefined : run.checking.done}
      />
    );
  return (
    <progress
      className="run-bar"
      aria-label={R.barLabel}
      max={run.total ?? 1}
      value={run.flightsRead === null && run.done !== null ? run.done : undefined}
    />
  );
}

export interface RunProgressProps {
  run: RunProgressRun;
  /** Cancel (with today's confirmation) on an active run; without it the run shows no Cancel (a read-only view). */
  onCancel?: () => void;
  /** Resume on a paused or interrupted run whose fix names it; without it no Resume. */
  onResume?: () => void;
  /** The action in flight, which disables its button and says "Working…". */
  pending?: 'cancel' | 'resume' | null;
  /** A failed action's message, announced. */
  failure?: string | null;
}

/** "about 14 min left" (Ruling 11's own sentence), "less than a minute left" under a minute; null without an estimate. */
function leftOf(finish: IsoDateTime | null, now: IsoDateTime): string | null {
  if (finish === null) return null;
  const minutes = Math.ceil((instantMs(finish) - instantMs(now)) / 60_000);
  return minutes < 1 ? R.lessThanAMinuteLeft : R.minutesLeft(minutes);
}

/**
 * Ruling 11: the one place a run's progress is worded, used by the cards and the Search page. A pending or running run
 * has a bar over "Reading the calendar, 1,203 of 2,184 dates · about 14 min left", then "Reading flights for the
 * cheapest dates, 9 read so far", then while it checks fares "Checking fares, 3 of 10 done · about 2 min left" (final
 * review M1: the hidden status's own words); a stopped or interrupted one its stop sentence with the fix, when it
 * resumes and Resume; an active run Cancel, which asks once more. A finished run says nothing. The run's calls and
 * cost, and each source's window, are not here (the Full search log keeps estimate versus ledger).
 */
export function RunProgress({ run, onCancel, onResume, pending = null, failure = null }: RunProgressProps) {
  const now = useNow();
  // why: bound to the run it was opened for; once another run is shown the confirmation is abandoned
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirming = confirmingId === run.id;
  // why: a confirmation belongs to the run on display; once another run is shown it is abandoned, and coming back to
  // the first run must ask for Cancel again rather than revive it
  useEffect(() => {
    setConfirmingId((open) => (open !== null && open !== run.id ? null : open));
    return () => setConfirmingId(null);
  }, [run.id]);
  const inFlight = IN_FLIGHT.has(run.status);
  const stopped = STOPPED.has(run.status);
  const canCancel = onCancel !== undefined && ACTIVE.has(run.status);
  // why: Resume belongs with a sentence only when its fix names it (a browser page limit offers a fresh search instead)
  const canResume =
    onResume !== undefined && RESUMABLE_ACTIVE.has(run.status) && fixNamesResume(stopOrNone(run.stop));
  if (!inFlight && !stopped && run.childRun === null && failure === null) return null;
  const busy = (what: 'cancel' | 'resume') => (pending === what ? true : undefined);
  return (
    <section aria-label={R.label} className="run-progress" data-status={run.status}>
      {inFlight ? (
        <>
          <RunBar run={run} />
          <p className="run-line" data-testid="run-line">
            {run.checking !== null
              ? R.checking(run.checking.total === 0 ? null : run.checking, leftOf(run.estimatedFinishAt, now))
              : run.flightsRead !== null
                ? R.flights(run.flightsRead)
                : run.done === null || run.total === null
                  ? R.calendarUncounted(leftOf(run.estimatedFinishAt, now))
                  : R.calendar(run.done, run.total, leftOf(run.estimatedFinishAt, now))}
          </p>
        </>
      ) : null}
      {/* why: spec rev 55 §8.1, §11 — a stopped run's sentence as-is with its fix, `NO_STOP_CAUSE_TEXT` for a row with
      no stored cause; never a stored status word and never a prefix of ours */}
      {/* why: only a stop appearing or a child run changing is announced, politely; the ticking estimate is not */}
      <div aria-live="polite">
        {stopped ? (
          <p className="run-line warn-text">
            <StopSentence stop={stopOrNone(run.stop)} />
            {run.resumeAfter !== null ? ` · ${R.resumesAt(formatRunInstant(run.resumeAfter))}` : null}
          </p>
        ) : null}
        {run.childRun !== null ? (
          <p className="run-line">{R.childRun(COPY.barStatusName[run.childRun])}</p>
        ) : null}
      </div>
      <div className="run-actions">
        {canResume ? (
          <button
            type="button"
            className="btn btn-sm min-h-11"
            disabled={pending === 'resume'}
            aria-busy={busy('resume')}
            onClick={onResume}
          >
            {pending === 'resume' ? R.working : R.resume}
          </button>
        ) : null}
        {canCancel && !confirming ? (
          <button type="button" className="btn btn-sm min-h-11" onClick={() => setConfirmingId(run.id)}>
            {R.cancel}
          </button>
        ) : null}
        {canCancel && confirming ? (
          <>
            <button
              type="button"
              className="btn btn-danger btn-sm min-h-11"
              disabled={pending === 'cancel'}
              aria-busy={busy('cancel')}
              onClick={() => {
                setConfirmingId(null);
                onCancel?.();
              }}
            >
              {R.confirmCancel}
            </button>
            <button type="button" className="btn btn-sm min-h-11" onClick={() => setConfirmingId(null)}>
              {R.keepRunning}
            </button>
          </>
        ) : null}
      </div>
      {failure !== null ? (
        <p role="alert" className="bad-text">
          {COPY.actionFailed(failure)}
        </p>
      ) : null}
    </section>
  );
}
