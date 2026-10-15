// The committed-tree manifest as a function of a root (r2-ts-002), so every predicate is proven against a known-good
// tree recorded from the stand-ins, and against broken copies, before it ever meets the live recording.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Secret } from '@gmt/core';
import { assertRequestAllowed, loadParamsAllowlist, type RecordedFixture } from '@gmt/providers';
import { loadRecorded, verifyRecordedTree } from '@gmt/providers/testing';
import { STANDIN_MARKER } from './vendors.js';

const q = (f: RecordedFixture, k: string): string | null => new URL(f.request.url).searchParams.get(k);
const nights = (f: RecordedFixture): number =>
  (Date.parse(`${q(f, 'return_date')}T00:00:00Z`) - Date.parse(`${q(f, 'outbound_date')}T00:00:00Z`)) /
  86_400_000;

/** Every string inside a JSON value, with the key it sits under. */
function strings(v: unknown, key = ''): Array<{ key: string; value: string }> {
  if (typeof v === 'string') return [{ key, value: v }];
  if (Array.isArray(v)) return v.flatMap((x) => strings(x, key));
  if (typeof v === 'object' && v !== null) return Object.entries(v).flatMap(([k, x]) => strings(x, k));
  return [];
}

/** True when text carries the test stand-ins' marker; case-sensitive, so ordinary prose never matches (r3-ts-002). */
export function holdsStandInMarker(text: string): boolean {
  return text.includes(STANDIN_MARKER);
}

/** A query value that looks like an opaque token rather than a placeholder or a short code (sec2-005). */
const OPAQUE = /^[A-Za-z0-9_-]{24,}$/;

/**
 * Every way `root` differs from the worked example's recorded tree (brief WP4b section 7); empty = conforming.
 * `recordedBy` is the one signature every file must carry; `standInsAllowed` is true only for trees recorded from the
 * test stand-ins, whose identifiers carry STANDIN_MARKER (the committed tree must never hold one).
 */
export function checkWorkedExampleTree(
  root: string,
  opts: { recordedBy: string; standInsAllowed: boolean; secrets?: readonly Secret[] },
): string[] {
  const problems: string[] = [];
  const fail = (p: string): void => {
    problems.push(p);
  };
  for (const p of verifyRecordedTree(root, opts.secrets ?? [])) fail(`verifier: ${p}`);
  const tp = loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates');
  const sa = loadRecorded(root, 'searchapi', '/api/v1/search');
  const all = [...tp, ...sa];

  // signature, session, stand-in tripwire
  if (tp.length < 20) fail(`travelpayouts: ${tp.length} recordings, expected at least 20`);
  if (sa.length !== 6) fail(`searchapi: ${sa.length} recordings, expected 6`);
  for (const f of all)
    if (f.recordedBy !== opts.recordedBy) fail(`recordedBy ${f.recordedBy} on a ${f.providerId} file`);
  const sessions = new Set(all.map((f) => f.session));
  if (sessions.size > 1) fail(`${sessions.size} recording sessions, expected one`);
  for (const f of all)
    for (const p of Object.keys(f.placeholders))
      if (!p.endsWith(`@${f.session}>`)) fail(`placeholder ${p} not scoped to its session`);
  if (!opts.standInsAllowed)
    for (const f of all)
      if (holdsStandInMarker(JSON.stringify([f.request, f.body])))
        fail(`a ${f.providerId} file holds the test stand-ins' marker: stand-in data in the committed tree`);

  // replay distinctness (plan decision 20)
  const statuses = new Map<string, Set<number>>();
  for (const f of all) {
    const k = `${f.request.method} ${f.request.url}`;
    statuses.set(k, (statuses.get(k) ?? new Set<number>()).add(f.status));
  }
  for (const [k, s] of statuses)
    if (s.size > 1) fail(`one request recorded with statuses ${[...s].join(', ')}: ${k}`);

  // Travelpayouts
  const metro = new Set(
    tp
      .filter((f) => f.status === 200 && q(f, 'origin') === 'LON' && q(f, 'page') === '1')
      .map((f) => `${q(f, 'destination')}|${q(f, 'departure_at')}`),
  );
  for (const d of ['JFK', 'EWR'])
    for (const m of ['2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09'])
      if (!metro.has(`${d}|${m}`)) fail(`travelpayouts: no metro tile LON→${d} ${m}`);
  for (const o of ['LHR', 'LGW'])
    for (const d of ['JFK', 'EWR'])
      if (!tp.some((f) => f.status === 200 && q(f, 'origin') === o && q(f, 'destination') === d))
        fail(`travelpayouts: no airport tile ${o}→${d}`);
  if (JSON.stringify(tp.filter((f) => q(f, 'departure_at') === '2028-02').map((f) => f.status)) !== '[200]')
    fail('travelpayouts: the empty-envelope probe (2028-02) is missing or not a 200');
  if (JSON.stringify(tp.filter((f) => f.status === 401).map((f) => q(f, 'departure_at'))) !== '["2028-03"]')
    fail('travelpayouts: the 401 probe must be the one 401, on 2028-03');
  for (const f of tp) if (q(f, 'currency') !== 'gbp') fail('travelpayouts: currency is not gbp');

  // SearchApi
  const cal = sa.filter((f) => q(f, 'engine') === 'google_flights_calendar');
  // why: SA-02 and SA-03 share outbound 2027-03-01..03-09 (plan decision 29); the return span tells them apart
  const main = cal.filter((f) => q(f, 'return_date_end') === '2027-03-30');
  if (main.length !== 1 || main[0]?.status !== 200 || q(main[0], 'outbound_date_end') !== '2027-03-09')
    fail(
      'searchapi: the 180-combination calendar must be one 200, out 2027-03-01..03-09 × ret 2027-03-11..03-30',
    );
  const over = cal.filter((f) => q(f, 'return_date_end') === '2027-04-03');
  const overBody = over[0]?.body;
  const emptyCalendar =
    typeof overBody === 'object' &&
    overBody !== null &&
    !Array.isArray(overBody) &&
    (!('calendar' in overBody) || (Array.isArray(overBody.calendar) && overBody.calendar.length === 0));
  if (over.length !== 1 || !(over[0]?.status === 400 || (over[0]?.status === 200 && emptyCalendar)))
    fail('searchapi: the over-limit calendar must be one 400 or one empty 200');
  const unauth = sa
    .filter((f) => f.status === 401)
    .map((f) => `${q(f, 'outbound_date')}/${q(f, 'return_date')}`);
  if (JSON.stringify(unauth) !== '["2027-03-10/2027-03-31"]')
    fail('searchapi: the 401 probe must be the one 401, on 2027-03-10/2027-03-31');
  for (const f of sa) {
    if (
      q(f, 'gl') !== 'gb' ||
      q(f, 'travel_class') !== 'economy' ||
      q(f, 'currency') !== 'GBP' ||
      q(f, 'adults') !== '1'
    )
      fail('searchapi: gl, travel_class, currency or adults differs');
    if (q(f, 'stops') !== null) fail('searchapi: a stops parameter was sent (plan decision 24)');
    if (q(f, 'separate_tickets') !== '1')
      fail('searchapi: a request without separate_tickets=1 (plan decisions 24 and 29: both engines)');
    if (q(f, 'engine') === 'google_flights' && q(f, 'sort_by') !== 'price')
      fail('searchapi: google_flights without sort_by=price (plan decision 24)');
  }

  // the chain
  const flights = sa.filter((f) => q(f, 'engine') === 'google_flights' && f.status === 200);
  const step1 = flights.find((f) => q(f, 'departure_token') === null && q(f, 'booking_token') === null);
  const step2 = flights.find((f) => q(f, 'departure_token') !== null);
  const step3 = flights.find((f) => q(f, 'booking_token') !== null);
  if (step1 === undefined || step2 === undefined || step3 === undefined)
    fail('searchapi: the step 1 → 2 → 3 chain is incomplete');
  else {
    if (nights(step1) < 10 || nights(step1) > 21)
      fail(`searchapi: step 1 is ${nights(step1)} nights, outside 10–21`);
    const dt = q(step2, 'departure_token') ?? '';
    const bt = q(step3, 'booking_token') ?? '';
    if (!new RegExp(`^<departure_token:\\d+@${step2.session}>$`).test(dt))
      fail('searchapi: step 2 departure_token is not a session placeholder');
    if (!new RegExp(`^<booking_token:\\d+@${step3.session}>$`).test(bt))
      fail('searchapi: step 3 booking_token is not a session placeholder');
    if (!JSON.stringify(step1.body).includes(JSON.stringify(dt)))
      fail("searchapi: step 2's departure_token is not in step 1's body");
    if (!JSON.stringify(step2.body).includes(JSON.stringify(bt)))
      fail("searchapi: step 3's booking_token is not in step 2's body");
  }

  // allowlists, body URLs
  for (const [provider, files] of [
    ['travelpayouts', tp],
    ['searchapi', sa],
  ] as const) {
    const dir = join(root, provider);
    const names = existsSync(dir)
      ? readdirSync(dir).filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n))
      : [];
    if (names.length !== 1) {
      fail(`${provider}: ${names.length} allowlist files, expected 1`);
      continue;
    }
    try {
      const allow = loadParamsAllowlist(join(dir, names[0] ?? ''), root);
      for (const f of files) assertRequestAllowed(allow, f.endpointPath, new URL(f.request.url));
    } catch (e) {
      fail(`${provider} allowlist: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const f of all)
    for (const { key, value } of strings(f.body)) {
      if (!/^https?:\/\//i.test(value)) continue;
      const u = new URL(value);
      if (u.host !== 'www.google.com' && u.host !== 'www.searchapi.io')
        fail(`body URL host ${u.host} under ${key}`);
      if (u.username !== '' || u.password !== '') fail(`body URL with userinfo under ${key}`);
      if (u.host === 'www.searchapi.io' && u.search !== '')
        fail(`search_metadata URL with a query under ${key}`);
      if (u.host === 'www.google.com')
        for (const [name, v] of u.searchParams)
          if (OPAQUE.test(v) && !v.startsWith('<'))
            fail(`www.google.com URL parameter ${name} under ${key} holds an opaque value`);
    }
  return problems;
}
