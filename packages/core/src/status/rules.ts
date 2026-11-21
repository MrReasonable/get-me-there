/**
 * The pure state rules and words of the Status report (spec §10 `GET /status`, brief WP18 §6): the thresholds, the
 * last-run line, the age line and the backup and consent rules, so the api's builders only gather facts and the rules are
 * mutation-tested here. Nothing in this file reads a clock, a file or the network.
 */

import type { Buckets, CellOutcomeStatus } from '../types/execution.js';
import { type IsoDateTime, isoDateTimeOfEpochMs } from '../types/ids.js';
import { addMonthsClamped } from './time.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A daily backup older than this is a warning, and its absence in an app older than this a failure. */
export const BACKUP_MAX_AGE_MS = 36 * HOUR_MS;
/** A consent record with this long or less left is a warning ("30 days" is elapsed time, 30 × 86,400,000 ms). */
export const CONSENT_WARN_MS = 30 * DAY_MS;
/** A run whose not-searched, skipped and error cells exceed this share of its cells is a warning. */
export const COVERAGE_GAP_SHARE = 0.2;
/** The trial's remaining credits at or below which its card warns. */
export const TRIAL_WARN_CREDITS = 10;
/** A cap's use at or above this share warns. */
export const CAP_WARN_SHARE = 0.8;

export type RuleState = 'ok' | 'warn' | 'fail';

/** The newest daily backup (or none) against the age of the app: `first` is the "first daily backup due" case. */
export function backupState(a: {
  newestAt: IsoDateTime | null;
  appStartedAt: IsoDateTime;
  now: IsoDateTime;
}): { state: RuleState; first: boolean } {
  const now = Date.parse(a.now);
  if (a.newestAt !== null)
    return { state: now - Date.parse(a.newestAt) < BACKUP_MAX_AGE_MS ? 'ok' : 'warn', first: false };
  // why: none yet is expected for the first 36 hours of a new install (the daily job has not fired); after that it is a failure
  return now - Date.parse(a.appStartedAt) < BACKUP_MAX_AGE_MS
    ? { state: 'ok', first: true }
    : { state: 'fail', first: false };
}

/**
 * A consent record's own `expiresAt` against now: expired (at or before now) is a failure, 30 days or less left a warning
 * (spec §8.3 and the brief's table: exactly 30 days left warns; one millisecond more does not).
 */
export function consentWindowState(expiresAt: IsoDateTime, now: IsoDateTime): RuleState {
  const left = Date.parse(expiresAt) - Date.parse(now);
  if (left <= 0) return 'fail';
  return left <= CONSENT_WARN_MS ? 'warn' : 'ok';
}

/** True when the cells that were not priced for lack of a result (error, skipped, not searched) exceed 20% of the cells. */
export function coverageGapWarn(b: Pick<Buckets, 'error' | 'skipped' | 'not_run'>, total: number): boolean {
  return (b.error + b.skipped + b.not_run) * 5 > total;
}

/** What a run's error cells hold beside the six buckets: how many are day pairs a "no flights" page did not show. */
export interface UnseenCells {
  /** Error cells on a route whose every page said no flights (core's `noFlightsRoutes`, `everyPage`). */
  cells: number;
  /**
   * Where no flights were found, in words after "found": "from Gatwick (LGW)" for whole origins, "on Gatwick (LGW) →
   * Newark Liberty (EWR)" for single routes.
   */
  where: string;
}

const pairs = (n: number): string => `${n} ${n === 1 ? 'date pair' : 'date pairs'}`;

/**
 * The data check's last-run line in plain words (spec §10 `GET /status`, revision 74): "prices for 12 of 25 date pairs;
 * 3 with no flights; 4 with no price found; 2 not shown because no flights were found from Gatwick (LGW); 1 not read
 * (the page failed); 1 skipped; 2 not searched yet", each part after the first left out when it is 0, then "(n reused
 * from earlier runs)" when n > 0. The parts are the six buckets with the error bucket split in two (`unseen` and the
 * rest), so they still sum to `total`; no cell changes bucket.
 */
export function lastRunLine(b: Buckets, total: number, unseen: UnseenCells): string {
  const counted: [number, string][] = [
    [b.empty, 'with no flights'],
    [b.no_data, 'with no price found'],
    [unseen.cells, `not shown because no flights were found ${unseen.where}`],
    [b.error - unseen.cells, 'not read (the page failed)'],
    [b.skipped, 'skipped'],
    [b.not_run, 'not searched yet'],
  ];
  const parts = [
    `prices for ${b.priced} of ${pairs(total)}`,
    ...counted.filter(([n]) => n > 0).map(([n, words]) => `${n} ${words}`),
  ];
  const reused = b.reused > 0 ? ` (${b.reused} reused from earlier runs)` : '';
  return `${parts.join('; ')}${reused}`;
}

/** The two ends of the priced cells' effective ages, as the face form words them ("age unknown" when no bound is known). */
export function ageEndsLine(newest: string, oldest: string): string {
  return `newest price ${newest}, oldest ${oldest}`;
}

/** The share of a cap used, as a whole percent (down), or null when there is no cap. */
export function capPercent(used: number, cap: number | null): number | null {
  return cap === null || cap <= 0 ? null : Math.floor((used * 100) / cap);
}

/** True at or above 80% of a cap. */
export function capWarn(used: number, cap: number | null): boolean {
  return cap !== null && cap > 0 && used >= cap * CAP_WARN_SHARE;
}

/** The cookie lifetime the consent record is judged by: a capture expires 13 months after it was made (spec §2). */
export const CONSENT_MAX_AGE_MONTHS = 13;
/** The latest a capture made at `capturedAt` can expire (an upper bound: the cookie's own expiry may be earlier). */
export const consentBoundOf = (capturedAt: IsoDateTime): IsoDateTime =>
  addMonthsClamped(capturedAt, CONSENT_MAX_AGE_MONTHS);

/** The daily backup file name the backup job writes (and db's retention reads): one pattern for every reader. */
export const BACKUP_FILE_PATTERN = /^get-me-there-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/;
/** The instant in a backup's name, or null for a file that is not one. */
export function backupTimeOf(name: string): IsoDateTime | null {
  const m = BACKUP_FILE_PATTERN.exec(name);
  return m === null ? null : isoDateTimeOfEpochMs(Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`));
}

/**
 * The six buckets of a run's cells after the §6.6 roll-up (a cell with no discovery roll-up counts as not searched), and
 * how many cells there are: the parts always sum to the total.
 */
export function coverageBuckets(
  discovery: readonly (CellOutcomeStatus | null)[],
  reused: number,
): { buckets: Buckets; total: number } {
  const buckets: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused };
  for (const status of discovery) buckets[status ?? 'not_run'] += 1;
  return { buckets, total: discovery.length };
}
