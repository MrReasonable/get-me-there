import { type Execution, type IsoDateTime, isoDateTimeOfEpochMs, type ProviderId } from '@gmt/core';
import { HOUR_MS } from '../units.js';

/**
 * The providers whose calls load browser pages (spec §2: `camoufox`, the worker's own browser). A catch-up never loads
 * them (decision 79), and every other run loads them only inside its browser window unless the operator chose `any`
 * (decision 83).
 */
export function loadsBrowserPages(providerId: ProviderId): boolean {
  return providerId === 'camoufox';
}

/** Spec §8.2: a run's browser window lasts 1.5 × its estimated duration from its anchor. */
export const BROWSER_WINDOW_FACTOR = 1.5;

/** CAMOUFOX_BROWSER_WINDOW (spec §12) and STUCK_AFTER_HOURS, the two settings the window reads, read at each check. */
export interface BrowserWindowSetting {
  mode: 'scheduled' | 'any';
  stuckAfterHours: number;
}

/**
 * A run's window anchor (decision 83): the later of its firing and the moment its pass actually started, so a punctual
 * tick that starts up to the 2-minute grace after its firing (a short wake) never finds a small run's window already
 * closed at its first page; a manual run has no firing and is its own anchor.
 */
export function windowAnchor(firing: IsoDateTime | null, startedAt: IsoDateTime): IsoDateTime {
  return firing !== null && Date.parse(firing) > Date.parse(startedAt) ? firing : startedAt;
}

/**
 * The end the start transaction writes (decision 83): the run's anchor (`windowAnchor`) plus 1.5 × the estimate's total
 * seconds, in whole milliseconds. A live-tick resume writes it again from its own anchor (the later of its firing and
 * the resume) and the estimate of the cells still resumable.
 */
export function browserWindowEndFrom(anchor: IsoDateTime, estimateSeconds: number): IsoDateTime {
  return isoDateTimeOfEpochMs(Date.parse(anchor) + Math.ceil(BROWSER_WINDOW_FACTOR * estimateSeconds * 1000));
}

/**
 * Decision 83: whether a run may load a browser page now. It reads the setting live and only the execution's stored
 * columns: under `any` the window is unbounded; under `scheduled` it ends at `browser_window_end`, inclusive, and a row
 * with none (started before migration 0007, or without an estimate) ends at `started_at` (else `created_at`) plus
 * STUCK_AFTER_HOURS.
 */
export function browserWindow(
  execution: Pick<Execution, 'browserWindowEnd' | 'startedAt' | 'createdAt'>,
  setting: BrowserWindowSetting,
  now: IsoDateTime,
): { open: boolean; end: IsoDateTime | null } {
  if (setting.mode === 'any') return { open: true, end: null };
  const end =
    execution.browserWindowEnd ??
    isoDateTimeOfEpochMs(
      Date.parse(execution.startedAt ?? execution.createdAt) + setting.stuckAfterHours * HOUR_MS,
    );
  return { open: Date.parse(now) <= Date.parse(end), end };
}

/**
 * Whether a resume of `execution` now leaves its browser provider's cells unloaded (decisions 79, 83): a catch-up always,
 * any other parent past its window; a child never. The resume's check (b) and View D's Retry read this one rule, so
 * View D never offers a retry that the resume would only relabel.
 */
export function resumeLeavesBrowserCells(
  execution: Pick<Execution, 'isChild' | 'isCatchUp' | 'browserWindowEnd' | 'startedAt' | 'createdAt'>,
  setting: BrowserWindowSetting,
  now: IsoDateTime,
): boolean {
  if (execution.isChild) return false;
  return execution.isCatchUp || !browserWindow(execution, setting, now).open;
}
