import {
  asIata,
  asIsoDate,
  asIsoDateTime,
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
import { AVIASALES_BASE, itineraryOf } from '../../src/travelpayouts/response.js';
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
  NOW,
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
/** A recorded link's `search_date=DDMMYYYY` as the ISO instant the adapter must report (decision 35), read independently of the adapter. */
const searchDay = (link: unknown): string => {
  const d = str(new URL(str(link), AVIASALES_BASE).searchParams.get('search_date'));
  return `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}T00:00:00.000Z`;
};

/** Recorded 200 pages grouped into tiles by (origin, destination, departure month), pages in order from 1. */
const tiles = new Map<string, typeof ok>();
for (const x of ok) {
  const key = ['origin', 'destination', 'departure_at'].map((n) => param(x.url, n)).join('|');
  tiles.set(key, [...(tiles.get(key) ?? []), x]);
}

/**
 * The recorded row key set: the documented keys (Library notes) plus `gate` (the selling agency), which the recordings show and
 * the docs do not, and `duration_to` / `duration_back`, which the docs list but the Library notes missed (decision 33). Nothing in Phase 1-3 reads gate
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

/** One month of departures, 1–120 nights: wide enough that the band drops only rows a definition could not hold. */
function monthQuery(origin: Iata, destination: Iata, month: string): DiscoveryQuery {
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

  // why: plan decision 34: the adapter queries by airport only, so the recorded metro (LON) tiles TP-01...14 and the
  // reverse tile TP-21 (JFK → LON, a metro destination) are not replayed; they stay in the tree as evidence (the
  // documenting test and the offset and month-bucketing checks below). The airport tiles TP-15...18 are what the
  // adapter itself can request.
  const airportTiles = [...tiles.entries()].filter(
    ([key]) => !key.startsWith('LON|') && key.split('|')[1] !== 'LON',
  );
  it('the four airport tiles TP-15...18 are recorded', () => {
    expect(airportTiles.map(([key]) => key).sort()).toEqual([
      'LGW|EWR|2027-03',
      'LGW|JFK|2027-03',
      'LHR|EWR|2027-03',
      'LHR|JFK|2027-03',
    ]);
  });

  it.each(airportTiles)(
    'airport tile %s replays: pages from 1, rows accounted for, one upstream ledger row per page and no cache hit',
    async (key, pages) => {
      const [origin = '', destination = '', month = ''] = key.split('|');
      expect(pages.map((p) => param(p.url, 'page'))).toEqual(pages.map((_, i) => String(i + 1)));
      replay();
      const h = makeHarness();
      // why: observation times are clamped to the fetch time (day resolution), so the clock is the recording's own
      h.clock.set(asIsoDateTime(pages[0]?.fixture.recordedAt ?? NOW));
      const d = discoveryOf(makeProvider(h));
      const received = pages.reduce((n, p) => n + rowsOf(p.fixture.body).length, 0);
      const q = monthQuery(asIata(origin), asIata(destination), month);
      const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
      expect(r.pointOfSale).toBe('unknown');
      // a tile that priced nothing would pass every per-price check below, so the recorded rows must have become prices
      expect(r.prices.length).toBeGreaterThan(0);
      expect(r.prices.length).toBe(received);
      expect(r.cellIssues).toBeUndefined();
      const covered = new Set(r.coveredCells.map(cellKeyString));
      for (const p of r.prices) {
        expect(p.origin).toBe(origin);
        expect(covered.has(cellKeyString(p))).toBe(true);
        expect(p.currency).toBe('GBP');
        expect(Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0).toBe(true);
        // decision 35: every recorded link carries its search day, so every price has an observation time
        expect(p.providerObservedAt).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
        if (p.vendorLink !== undefined) expect(new URL(p.vendorLink).hostname).toBe('www.aviasales.com');
      }
      expect(sumCounts(r.notes, (k) => k === 'rows-received')).toBe(received);
      const dropped = sumCounts(r.notes, (k) => k.startsWith('dropped-') || k === 'offers-dropped');
      expect(r.prices.length + dropped).toBe(received);
      expect(sumCounts(r.notes, (k) => k === 'dropped-outside-tile')).toBe(0);
      expect(eventsOf(h, 'reserve')).toHaveLength(pages.length);
      expect(eventsOf(h, 'cache-hit')).toHaveLength(0);
    },
  );

  it('every airport-tile row is a closed round trip: its link goes origin → destination and back destination → origin, all four ends (decision 35)', () => {
    // If this fails after a re-record, stop and report: an airport query returned an open-jaw row, and attribution by
    // origin_airport and destination_airport would price it against a round trip it is not.
    for (const [key, pages] of airportTiles) {
      const [origin = '', destination = ''] = key.split('|');
      for (const p of pages)
        for (const r of rowsOf(p.fixture.body).map(obj)) {
          const trip = itineraryOf(r.link);
          const where = `${key} ${str(r.departure_at)}`;
          expect(trip, where).not.toBeNull();
          expect([trip?.out[0], trip?.out.at(-1), trip?.back[0], trip?.back.at(-1)], where).toEqual([
            origin,
            destination,
            destination,
            origin,
          ]);
          expect(r.origin_airport).toBe(origin);
          expect(r.destination_airport).toBe(destination);
        }
    }
  });

  it('the first recorded LHR → JFK row becomes exactly its cell and amount (ts-006)', async () => {
    const airport = ok.find(
      (x) =>
        param(x.url, 'origin') === 'LHR' &&
        param(x.url, 'destination') === 'JFK' &&
        rowsOf(x.fixture.body).length > 0,
    );
    if (airport === undefined) throw new Error('WP4b recorded no LHR → JFK tile with rows');
    const first = obj(rowsOf(airport.fixture.body).find((r) => obj(r).origin_airport === 'LHR'));
    replay();
    const h = makeHarness();
    h.clock.set(asIsoDateTime(airport.fixture.recordedAt));
    const d = discoveryOf(makeProvider(h));
    const q = monthQuery(asIata('LHR'), asIata('JFK'), param(airport.url, 'departure_at'));
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
      providerObservedAt: searchDay(first.link),
    });
  });

  it('why the rule exists (plan decision 34): the recorded metro tile hides the LHR 2027-03-29 / 2027-04-10 fare the LHR airport tile prices', async () => {
    // The vendor answers a metro-code query with one cheapest row per date pair across every airport of the metro
    // (here LTN at 429 beats LHR at 498), so a definition that does not use LTN would read that LHR cell as no_data.
    // Hence the adapter never sends a metro code (spec rev 17). The two recordings were taken seconds apart, so this
    // is not cache drift.
    const rowOf = (tile: string, airport: string) =>
      (tiles.get(tile) ?? [])
        .flatMap((p) => rowsOf(p.fixture.body).map(obj))
        .filter(
          (r) =>
            r.origin_airport === airport &&
            str(r.departure_at).slice(0, 10) === '2027-03-29' &&
            str(r.return_at).slice(0, 10) === '2027-04-10',
        );
    expect(rowOf('LON|JFK|2027-03', 'LTN')).toHaveLength(1);
    expect(rowOf('LON|JFK|2027-03', 'LHR')).toHaveLength(0);
    expect(rowOf('LHR|JFK|2027-03', 'LHR')).toHaveLength(1);
    // second reason for the rule: under a metro query a row's origin_airport and destination_airport name only the
    // outbound ends, and the recorded metro tiles (TP-01...14 and the reverse tile TP-21) hold exactly these open-jaw
    // rows: origin side (LHR>EWR returns to LCY, LGW>JFK returns to LHR) and destination side (JFK>LGW returns from LHR)
    const endsOf = (r: Record<string, unknown>) => {
      const trip = itineraryOf(r.link);
      return `${str(r.origin_airport)}>${str(r.destination_airport)} via ${trip?.out.join('-')} / ${trip?.back.join('-')}`;
    };
    const openJaw = [...tiles.entries()]
      .filter(([key]) => key.startsWith('LON|') || key.split('|')[1] === 'LON')
      .flatMap(([, pages]) => pages.flatMap((p) => rowsOf(p.fixture.body).map(obj)))
      .filter((r) => {
        const trip = itineraryOf(r.link);
        return (
          trip !== null &&
          [trip.out[0], trip.out.at(-1), trip.back[0], trip.back.at(-1)].join() !==
            [r.origin_airport, r.destination_airport, r.destination_airport, r.origin_airport].join()
        );
      })
      .map(endsOf)
      .sort();
    expect(openJaw).toEqual([
      'JFK>LGW via JFK-ZRH-LGW / LHR-ZRH-JFK',
      'LGW>JFK via LGW-KEF-JFK / JFK-KEF-LHR',
      'LHR>EWR via LHR-FRA-EWR / EWR-FRA-LCY',
      'LHR>EWR via LHR-KEF-EWR / EWR-KEF-LGW',
    ]);
    // and the adapter, querying LHR, prices that cell
    replay();
    const d = discoveryOf(makeProvider(makeHarness()));
    const q = monthQuery(asIata('LHR'), asIata('JFK'), '2027-03');
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(
      r.prices.filter((p) => p.departureDate === '2027-03-29' && p.returnDate === '2027-04-10'),
    ).toHaveLength(1);
  });

  it('every recorded link carries a search_date, and the recorded rows were found 4 to 7 days before they were fetched, so the 48-hour declaration cannot be the row age (decision 35)', () => {
    const ages: number[] = [];
    for (const x of ok)
      for (const r of rowsOf(x.fixture.body)) {
        const searched = Date.parse(searchDay(obj(r).link));
        expect(Number.isNaN(searched)).toBe(false);
        ages.push((Date.parse(x.fixture.recordedAt) - searched) / 86_400_000);
      }
    expect(ages.length).toBeGreaterThan(0);
    // if this fails after a re-record, the declared horizon and this note's wording need a human decision
    expect(Math.min(...ages)).toBeGreaterThan(0);
    expect(Math.max(...ages)).toBeLessThan(8);
    expect(ages.some((age) => age > 2)).toBe(true);
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

  it('every Z time leaves an airport that is at +00:00 on that date, so Z is local time and not a true UTC reading of a far zone (decision 33)', () => {
    // If this fails after a re-record, stop and report: a Z on a non-zero-offset leg would key an evening departure a day late.
    const zoneOf: Record<string, string> = {
      LHR: 'Europe/London',
      LGW: 'Europe/London',
      LTN: 'Europe/London',
      LCY: 'Europe/London',
      JFK: 'America/New_York',
      EWR: 'America/New_York',
    };
    const offsetName = (zone: string, iso: string): string =>
      new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(new Date(iso))
        .find((part) => part.type === 'timeZoneName')?.value ?? '?';
    let seen = 0;
    for (const r of ok.flatMap((x) => rowsOf(x.fixture.body).map(obj))) {
      // the outbound leaves origin_airport, the return leaves destination_airport
      for (const [time, airport] of [
        [str(r.departure_at), str(r.origin_airport)],
        [str(r.return_at), str(r.destination_airport)],
      ] as const) {
        if (!time.endsWith('Z')) continue;
        seen += 1;
        expect(zoneOf[airport], airport).toBeDefined();
        expect(offsetName(zoneOf[airport] ?? '', time), `${airport} ${time}`).toMatch(/^GMT(?:\+00:00)?$/);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('recorded rows carry only the known keys: no found_at, expires_at or actual, nothing that supplies a constraint input (spec §5.2 suppliedFields)', () => {
    const keys = new Set(ok.flatMap((x) => rowsOf(x.fixture.body).flatMap((r) => Object.keys(obj(r)))));
    // If this fails, stop and report the new key: a human decides whether it supplies anything (TRAVELPAYOUTS_SUPPLIED_FIELDS).
    expect([...keys].filter((k) => !DOCUMENTED_ROW_KEYS.includes(k))).toEqual([]);
  });

  it('a westward origin (TP-21, JFK → LON: metro evidence, never requested by the adapter) keys every row in the tile month by local departure date (decision 31)', () => {
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
  it('a recorded empty envelope replays as a tile with no prices and no issues: every covered cell is left for no_data', async () => {
    // TP-19 is required evidence: a re-record that lands on a month with rows must fail here, not skip.
    expect(empty.length, 'WP4b recorded no empty tile (TP-19)').toBeGreaterThan(0);
    replay();
    for (const x of empty) {
      // why: TP-19 was recorded with the metro code as origin; the pair origin is that code, so the replayed request is identical.
      const q = monthQuery(
        asIata(param(x.url, 'origin')),
        asIata(param(x.url, 'destination')),
        param(x.url, 'departure_at'),
      );
      const d = discoveryOf(makeProvider(makeHarness()));
      const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
      expect(r.prices).toEqual([]);
      expect(r.cellIssues).toBeUndefined();
      expect(r.notes).toEqual(['pages:1']);
    }
  });

  it('the recorded 401 (invalid token) replays as tile-error auth (spec §2 fact 5)', async () => {
    const unauthorised = recordings.find((x) => x.fixture.status === 401);
    if (unauthorised === undefined) throw new Error('WP4b recorded no Travelpayouts 401');
    // A replay miss here (the afterEach misses() diff) means WP4b's invalid-token probe was sent with a URL the adapter
    // does not build (other params or values): look at the probe call in WP4b's record tool, not at the adapter.
    replay();
    // why: TP-20 was recorded with the metro code as origin; the pair origin is that code, so the replayed request is identical.
    const q = monthQuery(
      asIata(param(unauthorised.url, 'origin')),
      asIata(param(unauthorised.url, 'destination')),
      param(unauthorised.url, 'departure_at'),
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
