/**
 * The pure state rules and words of the Status report (spec §10 `GET /status`, brief WP18 §6): the thresholds, the
 * coverage line, the age line and the backup and consent rules, so the api's builders only gather facts and the rules are
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

/** Spec §3's six bucket words in the data check's order, with the count of `Buckets` each reads. */
export const BUCKET_WORDS = [
  ['priced', 'priced'],
  ['empty', 'no fares'],
  ['no_data', 'no cached data'],
  ['error', 'error'],
  ['skipped', 'skipped'],
  ['not_run', 'not searched'],
] as const;

/**
 * "priced 12, no fares 3, no cached data 4, error 0, skipped 1, not searched 5 of 25 cells", then spec §3's
 * "(n reused from earlier runs)" when n > 0. The parts are `Buckets` and sum to `total` (the caller's invariant).
 */
export function coverageLine(b: Buckets, total: number): string {
  const parts = BUCKET_WORDS.map(([key, word]) => `${word} ${b[key]}`).join(', ');
  const reused = b.reused > 0 ? ` (${b.reused} reused from earlier runs)` : '';
  return `${parts} of ${total} ${total === 1 ? 'cell' : 'cells'}${reused}`;
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
/** When a record that expires at `expiresAt` (a not-shown record's check plus 13 months) was made. */
export const consentMadeAt = (expiresAt: IsoDateTime): IsoDateTime =>
  addMonthsClamped(expiresAt, -CONSENT_MAX_AGE_MONTHS);

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

/** Where a consent record is captured today (one place; WP17 changes it if it ships a command). */
export const CONSENT_FIX = {
  text: 'capture consent again with pnpm --filter @gmt/camoufox-worker capture-socs (docs/setup.md section 14)',
  command: null,
} as const;
