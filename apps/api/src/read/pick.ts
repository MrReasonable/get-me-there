/** Picking one figure out of rows (spec §8.1, §11 "The figure"; plan decisions 54, 58). */
import { pickVerifiedFigure } from '@gmt/core';
import type { ResultRow } from './rows.js';

/**
 * The verified-basis figure of a set of rows (plan decision 54, spec §8.1, §11): a row the newest search of its cell
 * returned beats one it did not, a fresh row beats a stale one, then the cheaper wins, then generation order and the
 * row key. why: WP19: core's `pickVerifiedFigure` is the one copy of the rule, so the calendar-gap reference and the
 * Dates board's figure cannot drift apart. The caller carries the winner's `notSeenInLatest`.
 */
export function pickVerified(rows: readonly ResultRow[]): ResultRow | null {
  return pickVerifiedFigure(rows);
}
