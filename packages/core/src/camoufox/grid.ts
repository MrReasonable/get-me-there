/**
 * The camoufox grid mode's dated constants (spec §2 rev 34; plan decision 70), measured by the `--grid` recordings of
 * 2026-10-18 at the worker's pinned 1280 × 900 window: the grid's side, the days one scroll moves on each axis, the
 * planning horizon past which Google showed its no-flights page, and the measured times the planner and the estimate
 * use. A change to any of them is a re-recording.
 */

/** The grid's side at the pinned window: 7 departures by 7 returns. */
export const GRID_SIDE = 7;
/** One scroll moves one day on its axis: left and right the departures, up and down the returns. */
export const GRID_STEP_DAYS: Readonly<{ departures: number; returns: number }> = {
  departures: 1,
  returns: 1,
};
/** No grid departure is planned past this many days from today (a page 327 days out showed no flights). */
export const GRID_HORIZON_DAYS = 320;
/**
 * A page opens a block in about the 30 s page spacing (its first view is ready about 21–26 s after the load starts);
 * a scroll's click, settle and read take about 9.3 s, so the 5 s scroll spacing never binds.
 */
export const GRID_TIMES: Readonly<{ pageSeconds: number; scrollSeconds: number }> = {
  pageSeconds: 30,
  scrollSeconds: 9.3,
};
/** The cell grammar's date (the worker's gridNames.ts), stated in every grid answer's versions. */
export const GRID_GRAMMAR_VERSION = '2026-10-18';
/** The least spacing between scroll clicks, start to start (ruling 12). */
export const GRID_MIN_SCROLL_SPACING_SECONDS = 5;
/** The most scrolls a page may make (CAMOUFOX_GRID_SCROLL_CAP's maximum). */
export const GRID_MAX_SCROLLS_PER_PAGE = 60;
/**
 * One scroll's own budget, its click, settle and read, inside the page's overall cap, and the part of it kept for
 * reading the view once it settles (WP15 ruling 10). The worker's moves and the app's request timeout both use them.
 */
export const GRID_MOVE_BUDGET_MS = 45_000;
export const GRID_MOVE_RESERVE_MS = 15_000;
