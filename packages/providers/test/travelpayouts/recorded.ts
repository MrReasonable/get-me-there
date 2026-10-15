/**
 * Loaders for WP4b's recorded Travelpayouts fixtures, through the package's testing subpath (`@gmt/providers/testing`,
 * imported relatively because the package exports point at dist/). loadRecorded refuses files outside
 * fixtures/recorded/ and files whose contentSha256 no longer matches (spec §5.5).
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRecordedRoot, type RecordedFixture } from '../../src/http/recorder.js';
import { loadRecorded } from '../../src/testing/index.js';
import { PRICES_FOR_DATES_PATH } from '../../src/travelpayouts/params.js';

/** The package's recorded tree, the same root WP4's recorder writes to (arch-016: one definition). */
export const RECORDED_ROOT = defaultRecordedRoot();
const TRAVELPAYOUTS_DIR = join(RECORDED_ROOT, 'travelpayouts');

/** Path of the latest dated allowlist file (names sort by date); WP4's loadParamsAllowlist reads it. */
export function paramsFilePath(): string {
  const latest = readdirSync(TRAVELPAYOUTS_DIR)
    .filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .at(-1);
  if (latest === undefined)
    throw new Error(`no params-<date>.json under ${TRAVELPAYOUTS_DIR} (WP4b writes it)`);
  return join(TRAVELPAYOUTS_DIR, latest);
}

/**
 * The prices_for_dates recordings of the latest recording session only (plan decision 17: replay filters by session,
 * so a re-recording never mixes pages of two sessions), each with its request URL (credential-free, query kept).
 */
export function latestSession(): {
  session: string;
  recordings: Array<{ url: URL; fixture: RecordedFixture }>;
} {
  const all = loadRecorded(RECORDED_ROOT, 'travelpayouts', PRICES_FOR_DATES_PATH);
  const last = all.at(-1);
  if (last === undefined) throw new Error('WP4b recorded no Travelpayouts prices_for_dates exchange');
  // why: loadRecorded returns recordedAt order, so the last file belongs to the newest session.
  const recordings = all
    .filter((f) => f.session === last.session)
    .map((fixture) => ({ url: new URL(fixture.request.url), fixture }));
  return { session: last.session, recordings };
}
