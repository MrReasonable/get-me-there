import type { CellOutcome } from '@gmt/core';
import { MANUAL_RETRYABLE, NON_RETRYABLE } from './enums.js';

const listed = (xs: readonly string[], reason: string | null): boolean =>
  reason !== null && xs.includes(reason);

/**
 * The resume rule of RESUMABLE_SQL as a predicate over one outcome, from the same two lists, so a reader that shows
 * "retry" (View D, WP8) and the resume that does the retry cannot disagree (plan decision 54; test cells.resume).
 */
export function retriedOnResume(
  o: Pick<CellOutcome, 'status' | 'reason' | 'attempts'>,
  manual: boolean,
): boolean {
  switch (o.status) {
    case 'not_run':
      return true;
    case 'skipped':
      // why: a camoufox worker that was not reachable may be back; its cells are retried like a budget stop (WP14).
      return (
        o.reason === 'budget' ||
        o.reason === 'provider_unavailable' ||
        (manual && o.reason === 'provider_disabled')
      );
    case 'error':
      return (
        (o.attempts < 3 && !listed(NON_RETRYABLE, o.reason)) || (manual && listed(MANUAL_RETRYABLE, o.reason))
      );
    default:
      return false;
  }
}
