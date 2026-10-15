// In-process stand-ins for the two vendors, shaped like spec §2 facts 1–5. Test bodies only; never committed: every
// identifier they invent carries STANDIN_MARKER, and the committed-tree check rejects any file holding it (prov-wp04b-006).
// why: msw is imported only by @gmt/providers/testing (plan decision 7). While stubbed, this function replaces the
// msw-patched fetch, so it is itself the barrier: it answers the two vendor hosts and throws for any other host; WP4's
// network guards (test/support/setup.ts) cover every test that does not stub fetch (r2-ts-006).
import { vi } from 'vitest';
import { SENTINEL_SA, SENTINEL_TP } from './env.js';

/**
 * The marker every stand-in identifier carries; the committed-tree check fails on it. why: a token that cannot occur in
 * vendor text, matched case-sensitively, so 'Outstanding legroom' in a real body never trips it (r3-ts-002).
 */
export const STANDIN_MARKER = 'gmt-standin-7f3a';

import { onCleanup } from './tmp.js';

export interface VendorLog {
  tp: URLSearchParams[];
  sa: URLSearchParams[];
  /** Every request as the vendor saw it: URL and header names (values never kept). */
  requests: Array<{ url: string; headerNames: string[] }>;
}

export interface VendorOptions {
  /** Rows a Travelpayouts page returns (default 1); 1000 makes the tool fetch the next page. */
  tpRows?: (p: URLSearchParams) => number;
  /** The calendar body: the default grid, or one with no priced in-band cell. */
  calendar?: 'default' | 'no-priced-cell';
  /** A vendor that echoes a real credential (ts-008): in the calendar's search_parameters, in a 401 body, in a Travelpayouts body. */
  echo?: 'calendar-parameters' | 'calendar-base64' | 'sa-401-bearer' | 'tp-body' | 'tp-bearer';
  /** A failure for chosen requests (r2-ts-004): an HTTP 500 or 429, a socket error, or no answer until the client aborts. */
  failOn?: (url: URL) => 'http-500' | 'http-429' | 'network' | 'hang' | undefined;
  /** Step 1 answers with priced options that carry no departure_token. */
  step1WithoutToken?: boolean;
  /** Step 3 answers 200 with no booking option. */
  step3Empty?: boolean;
  /** How the vendor answers more than 200 combinations (spec §2 fact 2 versus the docs). */
  overLimit?: '400' | 'empty-200';
  /** Called before each answer (e.g. to abort the run after a given call). */
  onRequest?: (url: URL) => void;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function inclusiveDays(from: string | null, to: string | null): number {
  if (from === null || to === null) return 0;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

/** The default calendar: the global minimum lies outside the 10–21-night band, an unpriced cell carries a price field. */
const CALENDAR = [
  { departure: '2027-03-01', return: '2027-03-29', price: 380 },
  { departure: '2027-03-04', return: '2027-03-16', has_no_flights: true, price: 390 },
  { departure: '2027-03-03', return: '2027-03-15', price: 640 },
  { departure: '2027-03-02', return: '2027-03-16', price: 603, is_lowest_price: true },
];

/** Stand-in tokens; the cheapest priced option of each step is the one the tool must follow. */
export const DT = {
  unpriced: `${STANDIN_MARKER}-DT-unpriced`,
  dearer: `${STANDIN_MARKER}-DT-dearer`,
  cheapest: `${STANDIN_MARKER}-DT-cheapest`,
};
export const BT = {
  unpriced: `${STANDIN_MARKER}-BT-unpriced`,
  dearer: `${STANDIN_MARKER}-BT-dearer`,
  cheapest: `${STANDIN_MARKER}-BT-cheapest`,
};

function failure(
  how: 'http-500' | 'http-429' | 'network' | 'hang',
  init: RequestInit | undefined,
): Promise<Response> {
  if (how === 'http-500') return Promise.resolve(json({ error: 'internal error' }, 500));
  if (how === 'http-429')
    return Promise.resolve(json({ error: 'Too many requests.' }, 429, { 'retry-after': '0' }));
  if (how === 'network') return Promise.reject(new TypeError('fetch failed'));
  // why: settle on abort, so http-kit's request timeout ends the call inside the process
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
      once: true,
    });
  });
}

function tpAnswer(url: URL, headers: Headers, opts: VendorOptions): Response {
  const p = url.searchParams;
  if (headers.get('x-access-token') !== SENTINEL_TP)
    return new Response('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } });
  if (p.get('departure_at') === '2028-02') return json({ success: true, data: [], currency: 'gbp' });
  if (opts.echo === 'tp-body')
    return json({ success: true, data: [], currency: 'gbp', debug: `X-Access-Token: ${SENTINEL_TP}` });
  if (opts.echo === 'tp-bearer')
    return json({ success: true, data: [], currency: 'gbp', note: `Bearer ${SENTINEL_TP}` });
  const n = opts.tpRows?.(p) ?? 1;
  // why: the reverse tile (TP-21, plan decision 31) departs westward-local: 22:30 on 31 March in New York is already
  // 1 April in UTC, the month-boundary case WP6 checks
  const reverse = p.get('origin') === 'JFK';
  const row = {
    origin: p.get('origin'),
    destination: p.get('destination'),
    origin_airport: reverse ? 'JFK' : 'LHR',
    destination_airport: reverse ? 'LHR' : p.get('destination'),
    price: 412,
    airline: 'ZZ',
    flight_number: '9999',
    departure_at: reverse ? '2027-03-31T22:30:00-04:00' : '2027-03-02T08:25:00+00:00',
    return_at: reverse ? '2027-04-14T08:00:00+01:00' : '2027-03-16T18:00:00-04:00',
    transfers: 0,
    return_transfers: 0,
    link: `/search/${STANDIN_MARKER}-${reverse ? '3103-1404' : '0203-1603'}`,
  };
  return json({ success: true, currency: 'gbp', data: Array.from({ length: n }, () => row) }, 200, {
    'x-ratelimit-remaining': '599',
  });
}

function saAnswer(url: URL, headers: Headers, opts: VendorOptions): Response {
  const p = url.searchParams;
  if (headers.get('authorization') !== `Bearer ${SENTINEL_SA}`)
    return json({ error: 'Invalid API key.' }, 401);
  const engine = p.get('engine');
  if (opts.echo === 'sa-401-bearer' && engine === 'google_flights_calendar')
    return json({ error: `Invalid API key: Bearer ${SENTINEL_SA}` }, 401);
  if (engine === 'google_flights_calendar') {
    const combos =
      inclusiveDays(p.get('outbound_date_start'), p.get('outbound_date_end')) *
      inclusiveDays(p.get('return_date_start'), p.get('return_date_end'));
    if (combos > 200)
      return opts.overLimit === 'empty-200'
        ? json({ search_metadata: { id: `${STANDIN_MARKER}-cal-empty` } })
        : json({ error: 'Too many date combinations: the maximum is 200.' }, 400);
    const calendar =
      opts.calendar === 'no-priced-cell'
        ? CALENDAR.map((e) => ({ departure: e.departure, return: e.return, has_no_flights: true }))
        : CALENDAR;
    return json({
      search_metadata: {
        id: `${STANDIN_MARKER}-cal-1`,
        request_url: 'https://www.searchapi.io/api/v1/search?engine=google_flights_calendar&departure_id=LHR',
        json_endpoint: `https://user:pw@www.searchapi.io/api/v1/searches/${STANDIN_MARKER}-cal-1.json`,
      },
      search_parameters: {
        engine,
        gl: p.get('gl'),
        currency: p.get('currency'),
        ...(opts.echo === 'calendar-parameters' ? { api_key: SENTINEL_SA } : {}),
        ...(opts.echo === 'calendar-base64'
          ? { key_b64: Buffer.from(SENTINEL_SA, 'utf8').toString('base64') }
          : {}),
      },
      calendar,
    });
  }
  if (engine === 'google_flights') {
    const dt = p.get('departure_token');
    const bt = p.get('booking_token');
    if (dt === null && bt === null)
      return json({
        best_flights: opts.step1WithoutToken
          ? [{ price: 603 }, { price: 655 }]
          : [{ departure_token: DT.unpriced }, { price: 655, departure_token: DT.dearer }],
        other_flights: opts.step1WithoutToken ? [] : [{ price: 603, departure_token: DT.cheapest }],
        price_insights: { lowest_price: 590, price_history: [[1790000000, 610]] },
      });
    if (dt === DT.cheapest && bt === null)
      return json({
        best_flights: [{ booking_token: BT.unpriced }, { price: 640, booking_token: BT.dearer }],
        other_flights: [{ price: 603, booking_token: BT.cheapest }],
      });
    if (bt === BT.cheapest && dt === null)
      return json({
        booking_options: opts.step3Empty
          ? []
          : [
              {
                book_with: 'Airline',
                price: 603,
                booking_request: {
                  url: `https://www.google.com/travel/clk/f?booking_token=${BT.cheapest}`,
                  post_data: 'u=airline',
                },
              },
              {
                book_with: 'OTA',
                price: 573,
                booking_request: {
                  url: `https://www.google.com/travel/clk/f?booking_token=${BT.cheapest}`,
                  post_data: 'u=ota',
                },
              },
            ],
      });
  }
  return json({ error: 'unexpected request' }, 400);
}

/** Replaces globalThis.fetch with the two stand-ins for this test (restored afterwards). */
export function stubVendors(opts: VendorOptions = {}): VendorLog {
  const seen: VendorLog = { tp: [], sa: [], requests: [] };
  const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (init?.signal?.aborted === true) throw new DOMException('aborted', 'AbortError');
    const headers = new Headers(init?.headers);
    seen.requests.push({ url: url.href, headerNames: [...headers.keys()] });
    opts.onRequest?.(url);
    const fail = opts.failOn?.(url);
    if (fail !== undefined) {
      if (url.hostname === 'www.searchapi.io') seen.sa.push(url.searchParams);
      else seen.tp.push(url.searchParams);
      return failure(fail, init);
    }
    if (url.hostname === 'api.travelpayouts.com') {
      seen.tp.push(url.searchParams);
      return tpAnswer(url, headers, opts);
    }
    if (url.hostname === 'www.searchapi.io') {
      seen.sa.push(url.searchParams);
      return saAnswer(url, headers, opts);
    }
    throw new TypeError(`no stand-in for ${url.origin}`);
  };
  vi.stubGlobal('fetch', fake);
  onCleanup(() => vi.unstubAllGlobals());
  return seen;
}
