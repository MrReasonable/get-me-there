// Stand-ins for the two vendors in the shapes the real adapters parse (spec §2, §5.2, §5.4), for the smoke's offline
// tests. Test bodies only, never written under fixtures/: every identifier they invent carries STANDIN_MARKER, the
// carriers and sellers are clearly synthetic, and the airports are the worked example's. Dates follow the request, so
// the stand-ins answer whatever month the smoke query names. Like vendors.ts, this replaces globalThis.fetch for one
// test and throws for any other host.
import { addDays, asIsoDate, type IsoDate } from '@gmt/core';
import { vi } from 'vitest';
import { SENTINEL_SA, SENTINEL_TP } from './env.js';
import { onCleanup } from './tmp.js';
import { STANDIN_MARKER } from './vendors.js';

export interface SmokeVendorOptions {
  /** Travelpayouts answers with no row (the schema-valid empty envelope, spec §5.2). */
  tpEmpty?: boolean;
  /** The price step 2 shows for the cheapest return (default 603, equal to step 1). */
  step2Price?: number;
  /** Step 3 lists only an agent dearer than step 2, so the cheapest offer is the airline's unconfirmed step-2 price. */
  step3Dearer?: boolean;
  /** Step 3 lists no seller at all, so no price is confirmed by the final step. */
  step3Empty?: boolean;
  /** Travelpayouts fills every page (1,000 distinct rows), so the adapter stops at its 3-page cap (decision 30). */
  tpTruncated?: boolean;
  /** Travelpayouts adds a row with an unusable price for a covered cell (a per-cell issue, decision 24). */
  tpBadPrice?: boolean;
  /** A failure for the chosen request: an HTTP status with a body, or a socket error. */
  failOn?: (url: URL) => { status: number; body: unknown } | 'network' | undefined;
}

export interface SmokeVendorLog {
  /** Every request URL, in order (header values never kept). */
  urls: URL[];
}

const ECHO = { search_parameters: { currency: 'GBP', gl: 'gb', hl: 'en' } };
const POST = { url: 'https://www.google.com/travel/clk/f', post_data: `u=${STANDIN_MARKER}` };
const DT = `${STANDIN_MARKER}-DT-cheapest`;
const DT_DEARER = `${STANDIN_MARKER}-DT-dearer`;
const BT = `${STANDIN_MARKER}-BT-cheapest`;
const BT_DEARER = `${STANDIN_MARKER}-BT-dearer`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** DDMMYYYY of a date, for a Travelpayouts `search_date`. */
const ddmmyyyy = (d: IsoDate): string => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`;
/** The `t` itinerary token: 26 digits then each direction's airport chain (decision 35, WP6). */
const token = (out: string, back: string): string => `${'1'.repeat(26)}${out}${'2'.repeat(26)}${back}`;

function tpAnswer(url: URL, o: SmokeVendorOptions): Response {
  const p = url.searchParams;
  const month = p.get('departure_at') ?? '';
  if (o.tpEmpty === true) return json({ success: true, data: [], currency: 'gbp' });
  const dep = asIsoDate(`${month}-02`);
  const ret = addDays(dep, 14);
  const dep2 = addDays(dep, 1);
  const ret2 = addDays(dep2, 12);
  const origin = p.get('origin') ?? '';
  const destination = p.get('destination') ?? '';
  const row = (d: IsoDate, r: IsoDate, price: number, back: string) => ({
    origin,
    destination,
    origin_airport: origin,
    destination_airport: destination,
    price,
    airline: 'ZZ',
    flight_number: '9999',
    departure_at: `${d}T08:25:00+00:00`,
    return_at: `${r}T18:00:00-04:00`,
    transfers: 0,
    return_transfers: 0,
    // why: the vendor dates the find 30 days before the departure, 10 days before the smoke's clock (2027-02-10 for a
    // 2027-03-02 departure); WP6 reads it as the observed age (decision 35)
    link: `/search/${STANDIN_MARKER}?t=${token(`${origin}${destination}`, back)}&search_date=${ddmmyyyy(addDays(dep, -30))}`,
  });
  if (o.tpTruncated === true) {
    // why: a full page makes the adapter read the next one; prices differ per page so no page repeats another
    const page = Number(p.get('page') ?? '1');
    const data = Array.from({ length: 1000 }, (_, k) =>
      row(dep, ret, 400 + page * 1000 + k, `${destination}${origin}`),
    );
    return json({ success: true, currency: 'gbp', data });
  }
  return json({
    success: true,
    currency: 'gbp',
    data: [
      row(dep, ret, 412, `${destination}${origin}`),
      // why: an open-jaw row (back to another London airport) the adapter must drop and report (decision 39)
      row(dep2, ret2, 377, `${destination}LGW`),
      ...(o.tpBadPrice === true ? [{ ...row(dep, ret, 0, `${destination}${origin}`), price: 'n/a' }] : []),
    ],
  });
}

function seg(from: string, to: string, date: IsoDate, flight: string) {
  return {
    departure_airport: { id: from, date, time: '09:00' },
    arrival_airport: { id: to, date, time: '23:00' },
    airline: 'Synthetic Air One',
    flight_number: flight,
    travel_class: 'Economy',
    duration: 420,
  };
}

function saAnswer(url: URL, o: SmokeVendorOptions): Response {
  const p = url.searchParams;
  const origin = p.get('departure_id') ?? '';
  const destination = p.get('arrival_id') ?? '';
  if (p.get('engine') === 'google_flights_calendar') {
    const from = asIsoDate(p.get('outbound_date_start') ?? '');
    return json({
      ...ECHO,
      calendar: [
        { departure: addDays(from, 1), return: addDays(from, 15), price: 603 },
        { departure: addDays(from, 2), return: addDays(from, 14), has_no_flights: true },
      ],
    });
  }
  const out = asIsoDate(p.get('outbound_date') ?? '');
  const back = asIsoDate(p.get('return_date') ?? '');
  if (p.has('booking_token'))
    return json({
      ...ECHO,
      booking_options:
        o.step3Empty === true
          ? []
          : o.step3Dearer === true
            ? [{ book_with: 'Synthetic Travel Agent', price: 650, booking_request: POST }]
            : [
                { book_with: 'Synthetic Air One', price: 603, booking_request: POST },
                { book_with: 'Synthetic Travel Agent', price: 573, booking_request: POST },
              ],
    });
  if (p.has('departure_token'))
    return json({
      ...ECHO,
      other_flights: [
        {
          flights: [seg(destination, origin, back, 'X1 101')],
          price: o.step2Price ?? 603,
          booking_token: BT,
        },
        { flights: [seg(destination, origin, back, 'X1 103')], price: 640, booking_token: BT_DEARER },
      ],
    });
  return json({
    ...ECHO,
    // why: a route-level series the adapter keeps (decision 40: best-effort, absent from the recordings)
    price_insights: {
      price_history: [
        { price: 640, iso_date: `${addDays(out, -20)}T04:00:00Z` },
        { price: 610, iso_date: `${addDays(out, -10)}T04:00:00Z` },
      ],
    },
    other_flights: [
      { flights: [seg(origin, destination, out, 'X1 100')], price: 603, departure_token: DT },
      { flights: [seg(origin, destination, out, 'X1 102')], price: 655, departure_token: DT_DEARER },
    ],
  });
}

/** Replaces globalThis.fetch with the two stand-ins for this test (restored afterwards). */
export function stubSmokeVendors(o: SmokeVendorOptions = {}): SmokeVendorLog {
  const log: SmokeVendorLog = { urls: [] };
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    const headers = new Headers(init?.headers);
    log.urls.push(url);
    const fail = o.failOn?.(url);
    if (fail === 'network') throw new TypeError('fetch failed');
    if (fail !== undefined) return json(fail.body, fail.status);
    if (url.hostname === 'api.travelpayouts.com') {
      if (headers.get('x-access-token') !== SENTINEL_TP)
        return new Response('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } });
      return tpAnswer(url, o);
    }
    if (url.hostname === 'www.searchapi.io') {
      if (headers.get('authorization') !== `Bearer ${SENTINEL_SA}`)
        return json({ error: 'Invalid API key.' }, 401);
      return saAnswer(url, o);
    }
    throw new TypeError(`no stand-in for ${url.origin}`);
  };
  vi.stubGlobal('fetch', fake);
  onCleanup(() => vi.unstubAllGlobals());
  return log;
}
