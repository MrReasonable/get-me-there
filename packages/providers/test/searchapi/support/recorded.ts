// Helpers over WP4's loadRecorded for WP4b's SearchApi recordings (SA-01…SA-06, WP4b brief §7).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate, type Cabin, cabinSchema } from '@gmt/core';
import { defaultRecordedRoot, type RecordedFixture } from '../../../src/http/recorder.js';
import { combinations, MAX_COMBINATIONS } from '../../../src/searchapi/calendar.js';
import { SEARCHAPI_ENDPOINT_PATH, TRAVEL_CLASS } from '../../../src/searchapi/params.js';
import { calendarResponseSchema } from '../../../src/searchapi/shapes.js';
import { loadRecorded } from '../../../src/testing/index.js';
import { errnoCode } from '../../../src/util.js';

export const RECORDED_ROOT = defaultRecordedRoot();
export type SearchApiRecording = RecordedFixture & { params: Record<string, string> };

/**
 * Every SearchApi recording, with the credential-free query parsed into params (placeholders kept). Fails with a
 * `pending-fixtures` message while WP4b's recorded tree is absent, so the cause is never mistaken for a WP5 bug.
 */
export function searchApiRecordings(): SearchApiRecording[] {
  const rs = loadRecorded(RECORDED_ROOT, 'searchapi', SEARCHAPI_ENDPOINT_PATH);
  if (rs.length === 0)
    throw new Error(
      `pending-fixtures: no SearchApi recordings under ${RECORDED_ROOT}; WP4b's recording run (SA-01…SA-06) must land first`,
    );
  return rs.map((r) => ({ ...r, params: Object.fromEntries(new URL(r.request.url).searchParams.entries()) }));
}

export const byEngine = (rs: readonly SearchApiRecording[], engine: string) =>
  rs.filter((r) => r.params.engine === engine);

/** A required recorded parameter, or a failure naming it. */
export function need(params: Readonly<Record<string, string>>, name: string): string {
  const v = params[name];
  if (v === undefined) throw new Error(`recorded request lacks ${name}`);
  return v;
}

/** The cabin whose travel_class the recording sent. */
export function cabinOf(params: Readonly<Record<string, string>>): Cabin {
  const sent = need(params, 'travel_class');
  const cabin = cabinSchema.options.find((c) => TRAVEL_CLASS[c] === sent);
  if (cabin === undefined) throw new Error(`recorded travel_class ${sent} maps to no cabin`);
  return cabin;
}

/**
 * The recorded in-limit calendar tile (SA-02): an HTTP 200 whose rectangle is ≤ 200 combinations and whose grid is
 * not empty, so the over-limit probe (SA-03, a 400 or an empty 200) is never picked.
 */
export function calendarTile(rs: readonly SearchApiRecording[]): SearchApiRecording {
  const tile = byEngine(rs, 'google_flights_calendar').find((r) => {
    const body = calendarResponseSchema.safeParse(r.body);
    return r.status === 200 && body.success && body.data.calendar.length > 0;
  });
  if (tile === undefined) throw new Error('WP4b must record one non-empty HTTP 200 calendar tile (SA-02)');
  return tile;
}

/** The recorded over-limit probe (SA-03): the calendar request whose rectangle exceeds 200 combinations. */
export function overLimit(rs: readonly SearchApiRecording[]): SearchApiRecording {
  const over = byEngine(rs, 'google_flights_calendar').find(
    (r) =>
      combinations({
        kind: 'rectangle',
        departFrom: asIsoDate(need(r.params, 'outbound_date_start')),
        departTo: asIsoDate(need(r.params, 'outbound_date_end')),
        returnFrom: asIsoDate(need(r.params, 'return_date_start')),
        returnTo: asIsoDate(need(r.params, 'return_date_end')),
      }) > MAX_COMBINATIONS,
  );
  if (over === undefined) throw new Error('WP4b must record the over-limit probe (SA-03)');
  return over;
}

/** The recorded step 1 → 2 → 3 chain (SA-04…SA-06). */
export function chainRecording(rs: readonly SearchApiRecording[]) {
  const ok = byEngine(rs, 'google_flights').filter((r) => r.status === 200);
  const step1 = ok.find((r) => !('departure_token' in r.params) && !('booking_token' in r.params));
  const step2s = ok.filter((r) => 'departure_token' in r.params);
  const step3s = ok.filter((r) => 'booking_token' in r.params);
  if (step1 === undefined || step2s.length === 0 || step3s.length === 0)
    throw new Error('WP4b recordings must include a full step 1 → 2 → 3 chain');
  return { step1, step2s, step3s };
}

/** Path of the newest dated parameter allowlist WP4b wrote (`searchapi/params-<yyyy-mm-dd>.json`). */
export function latestParamsPath(): string {
  const dir = join(RECORDED_ROOT, 'searchapi');
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch (e) {
    // why: only a missing directory means "not recorded yet"; any other failure (EACCES …) is reported as itself.
    if (errnoCode(e) !== 'ENOENT') throw e;
  }
  const last = names
    .filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n))
    .sort()
    .at(-1);
  if (last === undefined) throw new Error(`pending-fixtures: no params-<date>.json under ${dir}`);
  return join(dir, last);
}
