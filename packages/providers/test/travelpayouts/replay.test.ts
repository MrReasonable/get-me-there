import {
  asIata,
  asIsoDate,
  cellKeyString,
  type DiscoveryQuery,
  fromEpochDay,
  type Iata,
  monthOf,
  toEpochDay,
} from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRequestAllowed } from '../../src/params/allowlist.js';
import { majorToMinor } from '../../src/shared/money.js';
import { replayHandlers, verifyRecordedTree } from '../../src/testing/index.js';
import {
  PRICES_FOR_DATES_PATH,
  TRAVELPAYOUTS_HOST,
  TRAVELPAYOUTS_PARAMS,
} from '../../src/travelpayouts/params.js';
import { MAX_PAGES } from '../../src/travelpayouts/provider.js';
import { AVIASALES_BASE } from '../../src/travelpayouts/response.js';
import { SENTINELS } from '../fakes.js';
import { arr, obj, str } from '../support/guards.js';
import { server } from '../support/msw.js';
import {
  ctx,
  discoveryOf,
  errorOf,
  eventsOf,
  makeHarness,
  makeProvider,
  only,
  query,
  tileOf,
} from './harness.js';
import { latestSession, RECORDED_ROOT } from './recorded.js';

const { session, recordings } = latestSession();
const ok = recordings.filter((x) => x.fixture.status === 200);
/** The data rows of a recorded body, narrowed without a cast (test/support/guards.ts). */
const rowsOf = (body: unknown): unknown[] => arr(obj(body).data);
const param = (u: URL, name: string): string => str(u.searchParams.get(name));

/** Recorded 200 pages grouped into tiles by (origin, destination, departure month), pages in order from 1. */
const tiles = new Map<string, typeof ok>();
for (const x of ok) {
  const key = ['origin', 'destination', 'departure_at'].map((n) => param(x.url, n)).join('|');
  tiles.set(key, [...(tiles.get(key) ?? []), x]);
}

/**
 * The recorded row key set: the documented keys (Library notes) plus `gate` (the selling agency), `duration_to` and
 * `duration_back`, which the recordings show and the docs do not (plan decision 33). Nothing in Phase 1-3 reads gate
 * or the durations; calendar prices carry no seller, so suppliedFields stays ['price']. Any other key needs a human
 * decision.
 */
const DOCUMENTED_ROW_KEYS = [
  'airline',
  'departure_at',
  'destination',
  'destination_airport',
  'duration',
  'duration_back',
  'duration_to',
  'flight_number',
  'gate',
  'link',
  'origin',
  'origin_airport',
  'price',
  'return_at',
  'return_transfers',
  'transfers',
];

/** The worked example's airports per recorded origin parameter: LON serves both London airports. */
const pairOriginsOf = (origin: string): Iata[] =>
  origin === 'LON' ? [asIata('LHR'), asIata('LGW')] : [asIata(origin)];

/** One month of departures, 1–120 nights: wide enough that the band drops only rows a definition could not hold. */
function monthQuery(
  origin: Iata,
  destination: Iata,
  month: string,
  definitionOrigins: Iata[],
): DiscoveryQuery {
  const from = asIsoDate(`${month}-01`);
  let last = toEpochDay(from);
  while (monthOf(fromEpochDay(last + 1)) === monthOf(from)) last += 1;
  return query({
    origin,
    destination,
    departureFrom: from,
    departureTo: fromEpochDay(last),
    minNights: 1,
    maxNights: 120,
    definitionOrigins,
  });
}

/** Installs the recorded session's replay handlers; afterEach asserts no request missed them. */
let misses: () => string[] = () => [];
function replay(): void {
  const r = replayHandlers(RECORDED_ROOT, { session });
  server.use(...r.handlers);
  misses = r.misses;
}
afterEach(() => {
  // why: a miss means the adapter sent a request the vendor was never asked; the replay answered it with an error.
  expect(misses()).toEqual([]);
  misses = () => [];
});

const sumCounts = (notes: readonly string[], keys: (k: string) => boolean): number =>
  notes.map((n) => n.split(':')).reduce((s, [k = '', v = '0']) => (keys(k) ? s + Number(v) : s), 0);

describe('recorded Travelpayouts fixtures (WP4b) replay through replayHandlers (plan decision 17: one session)', () => {
  it('exist for prices_for_dates, carry rows, target the public host, pass the recorded-tree checks and hold no credential header', () => {
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.some((x) => rowsOf(x.fixture.body).length > 0)).toBe(true);
    for (const x of recordings) expect(x.url.hostname).toBe(TRAVELPAYOUTS_HOST);
    // why: the recorder drops credential headers entirely (plan http-kit block); the real token's absence from every
    // file is enforced by WP4's recorder tests and `pnpm secret-scan`, since this test only knows the sentinel (ts2-002).
    for (const x of recordings)
      expect(Object.keys(x.fixture.request.headers).map((k) => k.toLowerCase())).not.toContain(
        'x-access-token',
      );
    expect(
      verifyRecordedTree(RECORDED_ROOT, [SENTINELS.travelpayouts]).filter((p) =>
        p.startsWith('travelpayouts'),
      ),
    ).toEqual([]);
  });

  it.each([...tiles.entries()])(
    'tile %s replays for every pair it serves: pages from 1, rows accounted for, one ledger row per tile',
    async (key, pages) => {
      const [origin = '', destination = '', month = ''] = key.split('|');
      expect(pages.map((p) => param(p.url, 'page'))).toEqual(pages.map((_, i) => String(i + 1)));
      replay();
      const pairOrigins = pairOriginsOf(origin);
      const h = makeHarness();
      const d = discoveryOf(makeProvider(h));
      const received = pages.reduce((n, p) => n + rowsOf(p.fixture.body).length, 0);
      for (const pairOrigin of pairOrigins) {
        const q = monthQuery(pairOrigin, asIata(destination), month, pairOrigins);
        const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
        expect(r.pointOfSale).toBe('unknown');
        const covered = new Set(r.coveredCells.map(cellKeyString));
        for (const p of r.prices) {
          expect(p.origin).toBe(pairOrigin);
          expect(covered.has(cellKeyString(p))).toBe(true);
          expect(p.currency).toBe('GBP');
          expect(Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0).toBe(true);
          expect('providerObservedAt' in p).toBe(false);
          if (p.vendorLink !== undefined) expect(new URL(p.vendorLink).hostname).toBe('www.aviasales.com');
        }
        expect(sumCounts(r.notes, (k) => k === 'rows-received')).toBe(received);
        const dropped = sumCounts(r.notes, (k) => k.startsWith('dropped-') || k === 'offers-dropped');
        expect(r.prices.length + dropped).toBe(received);
      }
      // the first pair reaches upstream once per page; the sibling is served from the cache: one row for its whole tile
      expect(eventsOf(h, 'reserve')).toHaveLength(pages.length);
      expect(eventsOf(h, 'cache-hit')).toHaveLength(pairOrigins.length - 1);
    },
  );

  it('the first recorded LHR → JFK row becomes exactly its cell and amount (ts-006)', async () => {
    const metro = ok.find(
      (x) =>
        param(x.url, 'origin') === 'LON' &&
        param(x.url, 'destination') === 'JFK' &&
        rowsOf(x.fixture.body).some((r) => obj(r).origin_airport === 'LHR'),
    );
    if (metro === undefined) throw new Error('WP4b recorded no LON → JFK tile with an LHR row');
    const first = obj(rowsOf(metro.fixture.body).find((r) => obj(r).origin_airport === 'LHR'));
    replay();
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = monthQuery(asIata('LHR'), asIata('JFK'), param(metro.url, 'departure_at'), [
      asIata('LHR'),
      asIata('LGW'),
    ]);
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    const price = typeof first.price === 'number' ? majorToMinor(first.price, 'GBP') : null;
    expect(r.prices).toContainEqual({
      origin: 'LHR',
      destination: 'JFK',
      departureDate: str(first.departure_at).slice(0, 10),
      returnDate: str(first.return_at).slice(0, 10),
      amountMinor: price,
      currency: 'GBP',
      vendorLink: `${AVIASALES_BASE}${str(first.link)}`,
    });
  });

  it('every vendor time carries an explicit offset (Z is +00:00), and the recordings show two different offsets (pie-wp06-001)', () => {
    const rows = ok.flatMap((x) => rowsOf(x.fixture.body).map(obj));
    const offset = /(?:Z|[+-]\d{2}:\d{2})$/;
    // the offset a time states, with the vendor's `Z` read as +00:00 (plan decision 33)
    const offsetOf = (v: unknown): string =>
      str(v).replace(/^.*(Z|[+-]\d{2}:\d{2})$/, (_m, o: string) => (o === 'Z' ? '+00:00' : o));
    for (const r of rows) {
      expect(str(r.departure_at)).toMatch(offset);
      expect(str(r.return_at)).toMatch(offset);
    }
    // a transatlantic round trip departs at one UTC offset and returns at another, which proves local times
    expect(rows.some((r) => offsetOf(r.departure_at) !== offsetOf(r.return_at))).toBe(true);
  });

  it('recorded rows carry only the known keys: no found_at, expires_at or actual, nothing that supplies a constraint input (spec §5.2 suppliedFields)', () => {
    const keys = new Set(ok.flatMap((x) => rowsOf(x.fixture.body).flatMap((r) => Object.keys(obj(r)))));
    // If this fails, stop and report the new key: a human decides whether it supplies anything (TRAVELPAYOUTS_SUPPLIED_FIELDS).
    expect([...keys].filter((k) => !DOCUMENTED_ROW_KEYS.includes(k))).toEqual([]);
  });

  it('a westward origin (TP-21, JFK → LON) keys every row in the tile month by local departure date (decision 31)', () => {
    // If this fails, stop and report: the vendor buckets departure_at=YYYY-MM by UTC date, so an evening departure on
    // a month's last day (or the first, east of UTC) lands in the neighbouring tile and its own cell reads no_data.
    const westward = [...tiles.entries()].filter(([key]) => key.startsWith('JFK|'));
    if (westward.length === 0) throw new Error('WP4b recorded no JFK → LON tile (TP-21)');
    for (const [key, pages] of westward) {
      const month = key.split('|')[2] ?? '';
      const rows = pages.flatMap((p) => rowsOf(p.fixture.body).map(obj));
      expect(rows.length, `${key} carries rows`).toBeGreaterThan(0);
      for (const r of rows) expect(str(r.departure_at).slice(0, 7), key).toBe(month);
    }
  });

  it(`no recorded tile reached the ${MAX_PAGES}-page cap, so the cap guards a loop rather than deciding coverage (pie-wp06-r2-003)`, () => {
    // If this fails, stop and report the tile: a worked-example month holds more rows than MAX_PAGES pages.
    for (const [key, pages] of tiles) expect(pages.length, key).toBeLessThan(MAX_PAGES);
  });

  it('some recorded departure date carries two or more return dates, so a month query is not one row per departure (pie-wp06-r2-001)', () => {
    // If this fails, stop and report: no_data for a nights value of a priced departure day would then mean "the
    // vendor collapsed it", not "nothing cached", and spec §3's no_data meaning for this provider needs a ruling.
    const returnsPerDeparture = new Map<string, Set<string>>();
    for (const [key, pages] of tiles)
      for (const p of pages)
        for (const r of rowsOf(p.fixture.body).map(obj)) {
          const k = `${key}|${String(r.origin_airport)}|${str(r.departure_at).slice(0, 10)}`;
          returnsPerDeparture.set(
            k,
            (returnsPerDeparture.get(k) ?? new Set()).add(str(r.return_at).slice(0, 10)),
          );
        }
    expect([...returnsPerDeparture.values()].some((returns) => returns.size >= 2)).toBe(true);
  });

  it("every recorded 200 states currency 'gbp', the empty envelope included (spec §2; settles brief §3 mismatch 3)", () => {
    for (const x of ok) expect(obj(x.fixture.body).currency).toBe('gbp');
  });

  // why: a single-page tile whose only page is empty; the empty last page of a paginated tile is not an empty envelope.
  const empty = ok.filter((x) => {
    const key = ['origin', 'destination', 'departure_at'].map((n) => param(x.url, n)).join('|');
    return (
      rowsOf(x.fixture.body).length === 0 &&
      (tiles.get(key) ?? []).length === 1 &&
      param(x.url, 'page') === '1'
    );
  });
  // why: TP-19 is best-effort (WP4b); when the probed month held rows there is no empty recording, the test shows as
  // skipped and the report says so, rather than passing without asserting anything.
  it.skipIf(empty.length === 0)(
    'a recorded empty envelope replays as a tile with no prices and no issues: every covered cell is left for no_data',
    async () => {
      replay();
      for (const x of empty) {
        const origins = pairOriginsOf(param(x.url, 'origin'));
        const [first = asIata('LHR')] = origins;
        const q = monthQuery(
          first,
          asIata(param(x.url, 'destination')),
          param(x.url, 'departure_at'),
          origins,
        );
        const d = discoveryOf(makeProvider(makeHarness()));
        const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
        expect(r.prices).toEqual([]);
        expect(r.cellIssues).toBeUndefined();
        expect(r.notes).toEqual(['pages:1']);
      }
    },
  );

  it('the recorded 401 (invalid token) replays as tile-error auth (spec §2 fact 5)', async () => {
    const unauthorised = recordings.find((x) => x.fixture.status === 401);
    if (unauthorised === undefined) throw new Error('WP4b recorded no Travelpayouts 401');
    // A replay miss here (the afterEach misses() diff) means WP4b's invalid-token probe was sent with a URL the adapter
    // does not build (other params or values): look at the probe call in WP4b's record tool, not at the adapter.
    replay();
    const origins = pairOriginsOf(param(unauthorised.url, 'origin'));
    const [first = asIata('LHR')] = origins;
    const q = monthQuery(
      first,
      asIata(param(unauthorised.url, 'destination')),
      param(unauthorised.url, 'departure_at'),
      origins,
    );
    const d = discoveryOf(makeProvider(makeHarness()));
    expect(errorOf(await d.fetchTile(only(d.plan(q)), q, ctx()))).toMatchObject({
      kind: 'auth',
      retryable: false,
      httpStatus: 401,
    });
  });

  it('recorded requests satisfy TRAVELPAYOUTS_PARAMS, names and values, and vendor links are site-relative paths', () => {
    for (const x of recordings)
      expect(() => assertRequestAllowed(TRAVELPAYOUTS_PARAMS, PRICES_FOR_DATES_PATH, x.url)).not.toThrow();
    for (const x of ok)
      for (const r of rowsOf(x.fixture.body)) expect(str(obj(r).link).startsWith('/')).toBe(true);
  });
});
