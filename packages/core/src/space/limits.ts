/**
 * The search space's limits, written once (spec §6.1, §10; WP19 brief §5, revision 50). `validate.ts` refuses a
 * definition past them, `config/schema.ts` defaults `MAX_CELLS_PER_DEFINITION` to the cell bound, and the date-pairs
 * contract bounds its response by them.
 *
 * why: config and the api contract both read these, so they live beside the space code rather than in either, and
 * config never depends on api-contract.
 */

/** Spec §6.1: the longest departure window, in days. */
export const MAX_WINDOW_DAYS = 400;
/** Spec §6.1: the longest stay, in nights (`0 ≤ minNights ≤ maxNights ≤ 90`). */
export const MAX_NIGHTS = 90;
/** Spec §10: the cells the date-pairs route reads at most; `MAX_CELLS_PER_DEFINITION`'s default. */
export const DEFAULT_MAX_CELLS = 50_000;
/** Spec §10: the date pairs any space holds at most, 400 × 91 = 36,400, whatever its airports. */
export const MAX_DATE_PAIRS = MAX_WINDOW_DAYS * (MAX_NIGHTS + 1);
