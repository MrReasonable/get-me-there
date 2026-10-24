import type { SkipCode, SkipDetail } from '../types/execution.js';

/**
 * Spec §3, §8.2 rev 36: why each `scheduled_only` detail left a cell. View D, the cell panel, the status report and the
 * engine's notice render a `skipped:scheduled_only` cell as "<who fetches it>: <why>" (scheduledOnlyText).
 */
export const SKIP_DETAIL_TEXT: Readonly<Record<SkipDetail, string>> = {
  'catch-up-no-browser': 'a catch-up loads no browser pages',
  'outside-browser-window': "outside this run's browser window",
};

/** Spec §8.2 rev 36: the fixed text of each `skipped_missed` code, the reason the firing had when it was recorded. */
export const SKIP_CODE_TEXT: Readonly<Record<SkipCode, string>> = {
  'half-cadence': 'the next scheduled run was less than half the gap away',
  'browser-only-definition': 'only the browser provider could run it, and a catch-up loads no browser pages',
};

/** Who fetches a browser provider's left cell, read when it is shown (review R12, S6). */
export const LEFT_FOR = ['next-scheduled-run', 'next-run', 'no-longer-used'] as const;
export type LeftFor = (typeof LEFT_FOR)[number];

/** The words of each LeftFor; a new run the operator starts is its own window's anchor (decision 83). */
export const LEFT_FOR_TEXT: Readonly<Record<LeftFor, string>> = {
  'next-scheduled-run': 'left for the next scheduled run',
  'next-run': 'left for your next run of this search',
  'no-longer-used': 'not fetched: this search no longer uses the browser provider',
};

/**
 * Review S6: who fetches a left browser cell, from the definition as it is now and whether its runs would still use the
 * browser provider (`uses.scheduled`: a scheduled run's providers include it, configured and enabled; `uses.manual`: a
 * run started by hand would). The next scheduled run only when the definition is scheduled, enabled and its scheduled
 * runs use it; the operator's next run when that one would; otherwise nobody.
 */
export function leftForOf(
  def: { scheduleCron: string | null; enabled: boolean },
  uses: { scheduled: boolean; manual: boolean },
): LeftFor {
  if (def.scheduleCron !== null && def.enabled && uses.scheduled) return 'next-scheduled-run';
  return uses.manual ? 'next-run' : 'no-longer-used';
}

/** A `skipped:scheduled_only` cell of the latest run in operator words: who fetches it, then why it was left. */
export function scheduledOnlyText(detail: SkipDetail, leftFor: LeftFor): string {
  const why = SKIP_DETAIL_TEXT[detail];
  return leftFor === 'no-longer-used'
    ? `${LEFT_FOR_TEXT[leftFor]}; ${why}`
    : `${LEFT_FOR_TEXT[leftFor]}: ${why}`;
}

/**
 * Review S9: a `skipped:scheduled_only` cell of an earlier run, in the past tense and from its stored detail alone (a
 * later run has fetched it or left it in turn, so a promise about the next run would be a statement about now).
 */
export function scheduledOnlyPastText(detail: SkipDetail): string {
  return `left by that run: ${SKIP_DETAIL_TEXT[detail]}`;
}
