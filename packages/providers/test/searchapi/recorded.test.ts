// pending-fixtures: every test here replays or reads WP4b's recordings, which are local-only (plan decision 61): the suites
// skip visibly while the tree is absent. No other test file needs them.
import {
  addDays,
  asIata,
  asIsoDate,
  canonicalCarrier,
  canonicalFlightNumber,
  daysBetween,
  type ItineraryQuery,
  itineraryHash,
  type RawOffer,
  type RawSegment,
  type SuppliedField,
} from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { assertRequestAllowed, loadParamsAllowlist } from '../../src/params/allowlist.js';
import { fetchCalendarTile, outboundBlockDays, planRectangles } from '../../src/searchapi/calendar.js';
import { searchItinerary } from '../../src/searchapi/itinerary.js';
import { classifySearchApiError } from '../../src/searchapi/limits.js';
import { authHeaders, SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_PARAMS } from '../../src/searchapi/params.js';
import { SEARCHAPI_SUPPLIED_FIELDS } from '../../src/searchapi/provider.js';
import {
  bookingResponseSchema,
  calendarEntrySchema,
  calendarResponseSchema,
  flightsResponseSchema,
  optionSchema,
} from '../../src/searchapi/shapes.js';
import { majorToMinor } from '../../src/shared/money.js';
import { replayHandlers } from '../../src/testing/index.js';
import { recordingsPresent, skipTitle } from '../../src/testing/recordings.js';
import { obj } from '../support/guards.js';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, KEY, saKit, sentUrls } from './support/kit.js';
import {
  byEngine,
  cabinOf,
  calendarTile,
  chainRecording,
  latestParamsPath,
  need,
  overLimit,
  RECORDED_ROOT,
  type SearchApiRecording,
  searchApiRecordings,
} from './support/recorded.js';
import { bookingBody, CELL_QUERY, ECHO, flightsBody, OUT_A, option } from './support/synthetic.js';

const present = recordingsPresent(RECORDED_ROOT);

let misses: (() => string[]) | null = null;
/** Serves the recorded tree for this test; afterEach asserts nothing missed. */
function replay(): void {
  const r = replayHandlers(RECORDED_ROOT);
  server.use(...r.handlers);
  misses = r.misses;
}
afterEach(() => {
  assertEverySentAllowed();
  if (misses !== null) expect(misses()).toEqual([]);
  misses = null;
});

const tokensIn = (body: unknown, name: string): string[] => {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null)
      for (const [k, x] of Object.entries(v)) {
        if (k === name && typeof x === 'string') out.push(x);
        walk(x);
      }
  };
  walk(body);
  return out;
};
const flights = (r: SearchApiRecording) => {
  const p = flightsResponseSchema.safeParse(r.body);
  if (!p.success) throw new Error('recorded google_flights body does not parse');
  // why: the envelope reads options as unknown (the adapter parses them one by one); recorded ones must all parse
  return [...(p.data.best_flights ?? []), ...(p.data.other_flights ?? [])].map((o) => optionSchema.parse(o));
};
/** A recorded calendar body's entries, each read with the adapter's entry schema (recorded ones must all parse). */
const calendarEntries = (body: unknown) =>
  calendarResponseSchema.parse(body).calendar.map((e) => calendarEntrySchema.parse(e));
const bookings = (r: SearchApiRecording) => bookingResponseSchema.parse(r.body).booking_options ?? [];
const minor = (major: number) => {
  const m = majorToMinor(major, 'GBP');
  if (m === null) throw new Error(`recorded price ${major} is not a GBP amount`);
  return m;
};

describe.skipIf(!present)(
  skipTitle('WP4b recordings this brief relies on (§7 "Inputs from WP4b") — pending-fixtures', present),
  () => {
    it('has the in-limit calendar tile in the production shape: the largest-b block for its band, every outbound day answered', () => {
      const rec = calendarTile(searchApiRecordings());
      const p = rec.params;
      expect(p.outbound_date).toBe(p.outbound_date_start);
      expect(p.return_date).toBe(p.return_date_start);
      const from = asIsoDate(need(p, 'outbound_date_start'));
      const to = asIsoDate(need(p, 'outbound_date_end'));
      const days = daysBetween(from, to) + 1;
      const band = {
        minNights: daysBetween(from, asIsoDate(need(p, 'return_date_start'))),
        maxNights: daysBetween(to, asIsoDate(need(p, 'return_date_end'))),
      };
      // why: decision 29: SA-02 is recorded as production plans it (9 × 20 for the worked band), so replay exercises
      // the tile shape the adapter really sends; the block is the window-free largest b for the recorded band.
      expect(days).toBe(outboundBlockDays({ departureFrom: from, departureTo: addDays(from, 181), ...band }));
      const answered = new Set(calendarEntries(rec.body).map((e) => e.departure));
      expect(answered.size).toBe(days);
    });

    it('has a chain whose step-2 departure_token comes from step 1 and whose step-3 booking_token comes from a step 2', () => {
      const { step1, step2s, step3s } = chainRecording(searchApiRecordings());
      const departures = tokensIn(step1.body, 'departure_token');
      for (const s of step2s) expect(departures).toContain(need(s.params, 'departure_token'));
      const bookingTokens = step2s.flatMap((s) => tokensIn(s.body, 'booking_token'));
      for (const s of step3s) expect(bookingTokens).toContain(need(s.params, 'booking_token'));
      expect(step3s).toHaveLength(step2s.length);
    });

    it('has the 401 body, and the over-limit probe as a descriptive 400 naming the 200-combination limit (spec §2 facts 2 and 5)', () => {
      const rs = searchApiRecordings();
      expect(rs.find((r) => r.status === 401)?.body).toEqual({ error: 'Invalid API key.' });
      // why: the recording is a 400 (the docs say "empty response"); a re-record that came back an empty 200 would change
      // what an empty grid means, so it must fail here rather than pass silently (review pie M-2).
      const over = overLimit(rs);
      expect(over.status).toBe(400);
      expect(String(obj(over.body).error ?? '')).toMatch(/200 combinations/);
    });

    it('every HTTP 200 body with content echoes currency and gl in search_parameters (spec §5.2 rests on this)', () => {
      for (const r of searchApiRecordings().filter((x) => x.status === 200)) {
        if (calendarResponseSchema.safeParse(r.body).data?.calendar.length === 0) continue; // SA-03 as an empty 200
        const echo = obj(obj(r.body).search_parameters);
        expect(typeof echo.currency).toBe('string');
        expect(typeof echo.gl).toBe('string');
      }
    });
  },
);

describe.skipIf(!present)(
  skipTitle(
    'SEARCHAPI_PARAMS against the recording (spec §5.2, plan decision 24) — pending-fixtures',
    present,
  ),
  () => {
    it('equals the recorded params-<date>.json: names, values, recordedAt and hash', () => {
      expect(SEARCHAPI_PARAMS).toEqual(loadParamsAllowlist(latestParamsPath()));
    });

    it('every recorded request passes it', () => {
      for (const r of searchApiRecordings())
        assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, new URL(r.request.url));
    });
  },
);

describe.skipIf(!present)(
  skipTitle('recorded replay through the adapter (spec §5.2, §5.4, §9 item 2) — pending-fixtures', present),
  () => {
    it('the recorded tile: every in-band priced entry at its exact minor amount; entries are accounted for; tileIndex on reserve', async () => {
      const rec = calendarTile(searchApiRecordings());
      const p = rec.params;
      const departureFrom = asIsoDate(need(p, 'outbound_date_start'));
      const departureTo = asIsoDate(need(p, 'outbound_date_end'));
      // why: the band whose tight rectangle is exactly the recorded one, so the plan reproduces the recorded request.
      const q = {
        origin: asIata(need(p, 'departure_id')),
        destination: asIata(need(p, 'arrival_id')),
        departureFrom,
        departureTo,
        minNights: daysBetween(departureFrom, asIsoDate(need(p, 'return_date_start'))),
        maxNights: daysBetween(departureTo, asIsoDate(need(p, 'return_date_end'))),
        cabin: cabinOf(p),
        currency: 'GBP' as const,
      };
      const [plan, ...rest] = planRectangles(q);
      if (plan === undefined) throw new Error('expected one tile');
      expect(rest).toHaveLength(0);
      replay();
      const k = saKit();
      const res = await fetchCalendarTile(
        {
          http: k.kit,
          log: k.log,
          key: KEY,
          pointOfSale: 'GB',
          allowlist: SEARCHAPI_PARAMS,
          cacheTtlSeconds: 3600,
        },
        plan,
        q,
        ctx(),
      );
      if (res.kind !== 'tile') throw new Error(`expected a tile, got ${res.error.message}`);
      const entries = calendarEntries(rec.body);
      const inBand = entries.filter(
        (e) =>
          e.return !== undefined &&
          e.price !== undefined &&
          e.has_no_flights !== true &&
          (() => {
            const n = daysBetween(asIsoDate(e.departure), asIsoDate(e.return ?? ''));
            return n >= q.minNights && n <= q.maxNights;
          })(),
      );
      expect(res.prices.map((x) => [x.departureDate, x.returnDate, x.amountMinor])).toEqual(
        inBand.map((e) => [e.departure, e.return, minor(e.price ?? 0)]),
      );
      expect(res.prices.every((x) => x.currency === 'GBP')).toBe(true);
      expect(res.pointOfSale).toBe('GB');
      expect(k.events.flatMap((e) => (e.type === 'reserve' ? [[e.tileIndex, e.httpAttempt]] : []))).toEqual([
        [plan.index, 1],
      ]);
    });

    it('the recorded chain: 1 + 2n calls, step-1 price = cheapest step-2 price (spike fact 3), the recorded sellers, a Google POST, route history', async () => {
      const rs = searchApiRecordings();
      const { step1, step2s, step3s } = chainRecording(rs);
      const p = step1.params;
      const q: ItineraryQuery = {
        ...CELL_QUERY,
        origin: asIata(need(p, 'departure_id')),
        destination: asIata(need(p, 'arrival_id')),
        departureDate: asIsoDate(need(p, 'outbound_date')),
        returnDate: asIsoDate(need(p, 'return_date')),
        cabin: cabinOf(p),
        expandTop: step2s.length,
      };
      replay();
      const k = saKit();
      const res = await searchItinerary(
        { http: k.kit, log: k.log, key: KEY, pointOfSale: 'GB', allowlist: SEARCHAPI_PARAMS },
        q,
        ctx(),
      );
      expect(sentUrls(k.events)).toHaveLength(1 + step2s.length + step3s.length);
      expect(res).toMatchObject({
        coverage: 'priced',
        partial: false,
        failedExpansions: 0,
        pointOfSale: 'GB',
      });
      // spike fact 3, for every expanded outbound: its step-1 price is the cheapest priced step-2 option's price.
      for (const s2 of step2s) {
        const expanded = flights(step1).find((o) => o.departure_token === need(s2.params, 'departure_token'));
        const cheapest2 = Math.min(
          ...flights(s2).flatMap((o) => (o.price === undefined ? [] : [minor(o.price)])),
        );
        expect(minor(expanded?.price ?? 0)).toBe(cheapest2);
        // why (review pie M-1): the cheapest step-2 price also equals the step-3 listing of the airline step 1 states,
        // the only evidence that a step-2 price is the round-trip total. The non-cheapest step-2 prices have no step 3
        // behind them and are trip totals by analogy only, which is why they stay verified: false.
        const cheapest = flights(s2).find((o) => o.price !== undefined && minor(o.price) === cheapest2);
        const s3 = step3s.find((r) => r.params.booking_token === cheapest?.booking_token);
        const airline = expanded?.flights[0]?.airline;
        const own = s3 === undefined ? undefined : bookings(s3).find((b) => b.book_with === airline);
        expect(own?.price === undefined ? null : minor(own.price)).toBe(cheapest2);
      }
      for (const b of step3s.flatMap(bookings)) {
        if (b.is_split_booking === true || b.price === undefined || b.book_with === undefined) continue;
        expect(
          res.offers.some((o) => o.seller === b.book_with?.trim() && o.amountMinor === minor(b.price ?? 0)),
        ).toBe(true);
      }
      // Codeshares (review pie I-1): each verified offer flies the designators its seller lists, the step-2 carrier
      // operating where they differ, so the itinerary identity (spec §6.4, marketing flights) separates the listings.
      const listedBy = new Map(
        step3s
          .flatMap(bookings)
          .flatMap((b) =>
            b.book_with === undefined || b.flight_numbers === undefined
              ? []
              : [[b.book_with.trim(), b.flight_numbers]],
          ),
      );
      const verified = res.offers.filter((o) => o.verified);
      for (const o of verified) {
        const segs = [...o.outbound, ...o.inbound];
        expect(segs.map((x) => `${x.marketingCarrier} ${x.flightNumber}`)).toEqual(listedBy.get(o.seller));
        const step2Carrier = flights(step1)
          .flatMap((x) => x.flights)[0]
          ?.flight_number.split(' ')[0];
        for (const x of segs)
          expect(x.operatingCarrier).toBe(x.marketingCarrier === step2Carrier ? undefined : step2Carrier);
      }
      const hashOf = (o: RawOffer) => {
        const h = (x: RawSegment) => ({
          marketingCarrier: canonicalCarrier(x.marketingCarrier),
          flightNumber: canonicalFlightNumber(x.flightNumber, canonicalCarrier(x.marketingCarrier)),
          from: x.from,
          to: x.to,
          departLocal: x.depart,
        });
        return itineraryHash(o.outbound.map(h), o.inbound.map(h));
      };
      const carriers = new Set(verified.map((o) => o.outbound[0]?.marketingCarrier));
      expect(new Set(verified.map(hashOf)).size).toBe(carriers.size);
      expect(carriers.size).toBeGreaterThan(1); // the recording lists EI, AA and BA designators
      expect(res.notes).toContain(
        `codeshare-listing-step3:${verified.filter((o) => o.outbound[0]?.operatingCarrier !== undefined).length}`,
      );
      // decision 27: an offer is verified exactly when a recorded step-3 seller listing confirmed it.
      const listed = step3s
        .flatMap(bookings)
        .filter((b) => b.is_split_booking !== true && b.price !== undefined && b.book_with !== undefined);
      expect(res.offers.filter((o) => o.verified)).toHaveLength(listed.length);
      for (const o of res.offers.filter((x) => !x.verified)) expect(o.booking.kind).toBe('none');
      const posts = res.offers.flatMap((o) =>
        o.booking.kind === 'post' ? [new URL(o.booking.url).hostname] : [],
      );
      expect(posts.length).toBeGreaterThan(0);
      for (const h of posts) expect(h === 'google.com' || h.endsWith('.google.com')).toBe(true);
      // why: plan decision 40: price_insights is best-effort; the recorded step 1 carries none, so the history is empty,
      // the result stays whole (asserted above) and only the informational count records the absence.
      expect('price_insights' in obj(step1.body)).toBe(false);
      expect(res.routeHistory).toEqual([]);
      expect(res.notes.filter((n) => n.startsWith('route-history'))).toEqual(['route-history-absent:1']);
    });

    it('the recorded 401 body is recognised: auth with the vendor text (spec §2 fact 5)', () => {
      const r401 = searchApiRecordings().find((r) => r.status === 401);
      if (r401 === undefined) throw new Error('WP4b must record the 401 body (SA-01)');
      const e = classifySearchApiError({
        status: 401,
        body: r401.body,
        headers: new Headers(),
        providerId: 'searchapi',
        endpointPath: SEARCHAPI_ENDPOINT_PATH,
      });
      expect(e).toMatchObject({ kind: 'auth', retryable: false });
      expect(e?.message).toContain('Invalid API key.');
    });

    // why (review pie M-2, test-strategy 2 and 3): the recorded error bodies replayed through the real http-kit with
    // SearchApi's limits, so a regression in mapping either real body fails against the recording, not only a synthetic one.
    it.each([
      ['the recorded 401', 'auth', 401, /Invalid API key\./],
      // why: http-kit keeps the first 200 characters of a vendor message (WP4), so the start of the recorded text is asserted.
      [
        'the recorded over-limit 400',
        'parse',
        400,
        /HTTP 400 \(The combination of outbound parameters .*\[bad-request\]/,
      ],
    ] as const)(
      '%s through http-kit → %s, non-retryable, one attempt, vendor text in the message',
      async (_label, kind, status, text) => {
        const rec = searchApiRecordings().find((r) => r.status === status);
        if (rec === undefined) throw new Error(`WP4b must record the HTTP ${status} body`);
        replay();
        const k = saKit();
        const err: unknown = await k.kit
          .request({
            providerId: 'searchapi',
            executionId: 'exec-test',
            tileIndex: null,
            endpointPath: SEARCHAPI_ENDPOINT_PATH,
            method: 'GET',
            url: new URL(rec.request.url),
            headers: authHeaders(KEY),
            cache: 'never',
            signal: new AbortController().signal,
            recordFixtures: false,
          })
          .then(
            () => null,
            (e: unknown) => e,
          );
        expect(err).toMatchObject({ kind, retryable: false, httpStatus: status, providerId: 'searchapi' });
        expect(err instanceof Error ? err.message : '').toMatch(text);
        expect(k.budget.count('reserve')).toBe(1);
      },
    );
  },
);

describe.skipIf(!present)(
  skipTitle(
    'supplied fields and synthetic drift against the recordings (spec §5.2) — pending-fixtures',
    present,
  ),
  () => {
    /** The SuppliedFields the recorded responses evidence; 'seller' and 'selfTransfer' are never declared (§4). */
    function evidence(rs: readonly SearchApiRecording[]): SuppliedField[] {
      const ok = byEngine(rs, 'google_flights').filter((r) => r.status === 200);
      const options = ok.flatMap((r) => (flightsResponseSchema.safeParse(r.body).success ? flights(r) : []));
      const segs = options.flatMap((o) => o.flights);
      const books = ok.flatMap((r) => bookingResponseSchema.safeParse(r.body).data?.booking_options ?? []);
      const out: SuppliedField[] = [];
      if (
        segs.length > 0 &&
        segs.every((s) => s.flight_number.length > 0 && s.departure_airport.id.length > 0)
      )
        out.push('segments');
      if (
        segs.length > 0 &&
        segs.every((s) => s.departure_airport.time.length > 0 && s.arrival_airport.time.length > 0)
      )
        out.push('segmentTimes');
      if (segs.length > 0 && segs.every((s) => s.travel_class !== undefined)) out.push('segmentCabins');
      if (options.some((o) => typeof o.price === 'number')) out.push('price');
      if (books.some((b) => (b.baggage_prices?.length ?? 0) > 0)) out.push('baggage');
      return out.sort();
    }

    it('suppliedFields equals what the recorded fixtures evidence, and nothing more', () => {
      expect([...SEARCHAPI_SUPPLIED_FIELDS].sort()).toEqual(evidence(searchApiRecordings()));
    });

    it('synthetic builders use only top-level keys the recorded bodies carry (drift guard)', () => {
      const rs = searchApiRecordings();
      const recordedKeys = new Set(
        rs.filter((r) => r.status === 200).flatMap((r) => Object.keys(obj(r.body))),
      );
      const optionKeys = new Set(
        byEngine(rs, 'google_flights')
          .filter((r) => r.status === 200)
          .flatMap((r) => flights(r).flatMap((o) => Object.keys(o))),
      );
      for (const body of [flightsBody([]), bookingBody([]), ECHO])
        for (const key of Object.keys(body)) expect(recordedKeys).toContain(key);
      for (const key of Object.keys(option(OUT_A, 1, { departure_token: 't' })))
        expect(optionKeys).toContain(key);
    });
  },
);
