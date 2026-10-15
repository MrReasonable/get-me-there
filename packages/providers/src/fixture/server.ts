import { isoDateSchema, type SyntheticGateInput, syntheticAllowed } from '@gmt/core';
import { isRecord } from '../util.js';
import { RELEASE_PATH, SCENARIO_HEADER, SCENARIO_PATH } from './constants.js';
import { addDaysIso, daysBetweenIso, localPlusMinutes } from './dates.js';
import {
  type FixtureResponse,
  type FixtureRule,
  parseFixtureResponse,
  parseFixtureRules,
} from './scenario.js';
import {
  type CalendarPairFile,
  calendarPriceMinor,
  type FixtureTree,
  type LegTemplate,
  loadFixtureTree,
  type OptionTemplate,
} from './tree.js';

type Generated = Exclude<FixtureResponse, { kind: 'status' | 'malformed' | 'network' | 'hang' | 'hold' }>;

export interface FixtureServer {
  handle(request: Request): Promise<Response>;
  setRules(rules: FixtureRule[]): void;
  reset(): void;
}

const MAX_NIGHTS = 90;
const MAX_SPAN_DAYS = 400;
const AGENCY_DISCOUNT_MINOR = 300;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const refuse = (status: number, error: string): Response =>
  json({ synthetic: true, error: `synthetic: ${error}` }, status);

async function readJson(request: Request): Promise<unknown> {
  try {
    const v: unknown = await request.json();
    return v;
  } catch {
    return undefined;
  }
}

/**
 * The fixture provider's server (spec §5.5: an ordinary HTTP endpoint at http://fixture.local), one routing core
 * shared by the msw handlers (tests) and the Hono router (fixture mode). Every generated body carries
 * `synthetic: true`. Throws unless syntheticAllowed(gate) (ruling 7). State (rules, held requests) lives here.
 */
export function createFixtureServer(root: string, gate: SyntheticGateInput): FixtureServer {
  if (!syntheticAllowed(gate))
    throw new Error('fixture server refused: syntheticAllowed(gate) is false (spec §5.5)');
  const tree: FixtureTree = loadFixtureTree(root);
  let rules: Array<{ rule: FixtureRule; remaining: number }> = [];
  const held = new Map<
    string,
    Array<{ url: URL; request: Request; settle: (res: Response | Promise<Response>) => void }>
  >();
  const setRules = (next: FixtureRule[]): void => {
    rules = next.map((rule) => ({ rule, remaining: rule.times ?? Number.POSITIVE_INFINITY }));
  };
  const reset = (): void => {
    rules = [];
  };

  const pick = (url: URL): FixtureResponse => {
    for (const entry of rules) {
      if (entry.remaining <= 0) continue;
      const m = entry.rule.match;
      if (m.path !== undefined && m.path !== url.pathname) continue;
      if (
        m.params !== undefined &&
        !Object.entries(m.params).every(([k, v]) => url.searchParams.get(k) === v)
      )
        continue;
      entry.remaining -= 1;
      return entry.rule.respond;
    }
    return { kind: 'normal' };
  };

  const need = (url: URL, names: string[], dates: string[]): Record<string, string> | Response => {
    const out: Record<string, string> = {};
    for (const n of names) {
      const v = url.searchParams.get(n);
      if (v === null || v === '') return refuse(400, `missing parameter ${n}`);
      if (dates.includes(n) && !isoDateSchema.safeParse(v).success) return refuse(400, `${n} is not a date`);
      out[n] = v;
    }
    return out;
  };

  function calendar(respond: Generated, url: URL): Response {
    const dates = ['departFrom', 'departTo', 'returnFrom', 'returnTo'];
    const p = need(url, ['origin', 'destination', ...dates], dates);
    if (p instanceof Response) return p;
    const {
      origin = '',
      destination = '',
      departFrom = '',
      departTo = '',
      returnFrom = '',
      returnTo = '',
    } = p;
    const file = tree.calendar.get(`${origin}-${destination}`);
    if (file === undefined) return refuse(404, `no calendar fixture for ${origin}-${destination}`);
    if (
      daysBetweenIso(departFrom, departTo) > MAX_SPAN_DAYS ||
      daysBetweenIso(returnFrom, returnTo) > MAX_SPAN_DAYS
    )
      return refuse(400, 'rectangle too large');
    const entries: Array<{ departureDate: string; returnDate: string; amountMinor: number | null }> = [];
    if (respond.kind !== 'empty') {
      for (let dep: string = departFrom; dep <= departTo; dep = addDaysIso(dep, 1)) {
        for (let ret: string = returnFrom; ret <= returnTo; ret = addDaysIso(ret, 1)) {
          const nights = daysBetweenIso(dep, ret);
          if (nights < 0 || nights > MAX_NIGHTS || file.noDataNights.includes(nights)) continue;
          const noFare = respond.kind === 'no-fares' || file.noFaresNights.includes(nights);
          entries.push({
            departureDate: dep,
            returnDate: ret,
            amountMinor: noFare ? null : calendarPriceMinor(file, dep, nights),
          });
        }
      }
    }
    const pageSize = file.pageSize ?? Math.max(1, entries.length);
    const pages = Math.max(1, Math.ceil(entries.length / pageSize));
    const pageParam = url.searchParams.get('page') ?? '1';
    const page = /^\d+$/.test(pageParam) ? Number(pageParam) : Number.NaN;
    if (!(page >= 1 && page <= pages)) return refuse(400, `page must be 1–${pages}`);
    const slice = entries.slice((page - 1) * pageSize, page * pageSize);
    const body: Record<string, unknown> = {
      synthetic: true,
      origin,
      destination,
      page,
      pages,
      prices: slice.flatMap((e) =>
        e.amountMinor === null
          ? []
          : [{ departureDate: e.departureDate, returnDate: e.returnDate, amountMinor: e.amountMinor }],
      ),
      noFares: slice.flatMap((e) =>
        e.amountMinor === null ? [{ departureDate: e.departureDate, returnDate: e.returnDate }] : [],
      ),
    };
    if (respond.kind !== 'no-currency')
      body.currency =
        respond.kind === 'variant' && respond.currency !== undefined ? respond.currency : file.currency;
    if (respond.kind === 'cacheable') body.cacheable = true;
    return json(body);
  }

  function legs(
    carrier: string,
    t: LegTemplate,
    from: string,
    to: string,
    date: string,
    cabin: string,
    via: string | undefined,
  ): unknown[] {
    const depart = `${date}T${t.depart}`;
    const arrive = `${addDaysIso(date, t.arriveDayOffset)}T${t.arrive}`;
    if (via === undefined)
      return [{ carrier, flightNumber: t.flightNumber, from, to, depart, arrive, cabin }];
    // why: the connection exists only to drive the engine's unknown-airport-tz path; times are template arithmetic.
    return [
      {
        carrier,
        flightNumber: t.flightNumber,
        from,
        to: via,
        depart,
        arrive: localPlusMinutes(depart, 120),
        cabin,
      },
      {
        carrier,
        flightNumber: String(Number(t.flightNumber) + 1000),
        from: via,
        to,
        depart: localPlusMinutes(depart, 180),
        arrive,
        cabin,
      },
    ];
  }

  function offerOf(
    o: OptionTemplate,
    index: number,
    p: Record<string, string>,
    nights: number,
    cal: CalendarPairFile,
    respond: Generated,
  ): Record<string, unknown> {
    const { origin = '', destination = '', departureDate = '', returnDate = '', cabin = '' } = p;
    const applies = respond.kind === 'variant' && (respond.scope === 'all-offers' || index === 0);
    const carrier = applies && respond.carrier !== undefined ? respond.carrier : o.carrier;
    const via = applies ? respond.connectVia : undefined;
    return {
      seller: o.seller,
      amountMinor: calendarPriceMinor(cal, departureDate, nights) + o.priceDeltaMinor,
      taxesIncluded: true,
      outbound: legs(carrier, o.outbound, origin, destination, departureDate, cabin, via),
      inbound: legs(carrier, o.inbound, destination, origin, returnDate, cabin, undefined),
      baggage: { cabinBag: o.cabinBagIncluded ? 'included' : 'not-included', checkedBags: o.checkedBags },
      selfTransfer: false,
    };
  }

  /** Shared request parsing for the itinerary routes. */
  function itineraryContext(url: URL, extra: string[]) {
    const dates = ['departureDate', 'returnDate'];
    const p = need(url, ['origin', 'destination', ...dates, 'cabin', ...extra], dates);
    if (p instanceof Response) return p;
    const pair = `${p.origin}-${p.destination}`;
    const cal = tree.calendar.get(pair);
    const it = tree.itinerary.get(pair);
    if (cal === undefined || it === undefined) return refuse(404, `no itinerary fixture for ${pair}`);
    const nights = daysBetweenIso(p.departureDate ?? '', p.returnDate ?? '');
    if (nights < 0) return refuse(400, 'returnDate before departureDate');
    return { p, cal, it, nights };
  }

  function header(
    p: Record<string, string>,
    respond: Generated,
    cal: CalendarPairFile,
  ): Record<string, unknown> {
    const base: Record<string, unknown> = {
      synthetic: true,
      origin: p.origin,
      destination: p.destination,
      departureDate: p.departureDate,
      returnDate: p.returnDate,
      cabin: p.cabin,
    };
    if (respond.kind !== 'no-currency')
      base.currency =
        respond.kind === 'variant' && respond.currency !== undefined ? respond.currency : cal.currency;
    return base;
  }

  function itinerary(respond: Generated, url: URL): Response {
    const c = itineraryContext(url, []);
    if (c instanceof Response) return c;
    const { p, cal, it, nights } = c;
    const base = header(p, respond, cal);
    if (it.chain) {
      const outbounds = respond.kind === 'empty' ? [] : it.options.map((_o, i) => `o${i}`);
      return json({
        ...base,
        chain: true,
        outboundOptions: outbounds.length,
        outbounds,
        failedExpansions: 0,
        offers: [],
      });
    }
    const expandTop = Number(url.searchParams.get('expandTop') ?? it.options.length);
    const options = it.options.slice(
      0,
      Number.isInteger(expandTop) && expandTop > 0 ? expandTop : it.options.length,
    );
    if (respond.kind === 'empty')
      return json({ ...base, chain: false, outboundOptions: 0, failedExpansions: 0, offers: [] });
    if (respond.kind === 'no-return-legs')
      return json({
        ...base,
        chain: false,
        outboundOptions: options.length,
        failedExpansions: options.length,
        offers: [],
      });
    const offers = options.map((o, i) => offerOf(o, i, p, nights, cal, respond));
    const failed = respond.kind === 'partial' ? Math.min(respond.failedExpansions, offers.length) : 0;
    return json({
      ...base,
      chain: false,
      outboundOptions: options.length,
      failedExpansions: failed,
      offers: offers.slice(0, offers.length - failed),
    });
  }

  function chainStep(respond: Generated, url: URL, step: 'return' | 'booking'): Response {
    const c = itineraryContext(url, ['outbound']);
    if (c instanceof Response) return c;
    const { p, cal, it, nights } = c;
    if (!it.chain) return refuse(404, `${p.origin}-${p.destination} is not a chained pair`);
    const id = /^o(\d+)$/.exec(p.outbound ?? '');
    const index = id === null ? -1 : Number(id[1]);
    const option = it.options[index];
    if (option === undefined) return refuse(404, `no outbound ${p.outbound ?? ''}`);
    const base = { ...header(p, respond, cal), outbound: p.outbound };
    if (respond.kind === 'empty' || respond.kind === 'no-return-legs') return json({ ...base, offers: [] });
    const offer = offerOf(option, index, p, nights, cal, respond);
    if (step === 'return') return json({ ...base, offers: [offer] });
    const agencyPrice =
      calendarPriceMinor(cal, p.departureDate ?? '', nights) + option.priceDeltaMinor - AGENCY_DISCOUNT_MINOR;
    return json({ ...base, offers: [{ ...offer, seller: 'Synthetic Agency', amountMinor: agencyPrice }] });
  }

  function route(respond: Generated, url: URL): Response {
    switch (url.pathname) {
      case '/health':
        return json({ synthetic: true, ok: true });
      case '/calendar':
        return calendar(respond, url);
      case '/itinerary':
        return itinerary(respond, url);
      case '/itinerary/return':
        return chainStep(respond, url, 'return');
      case '/itinerary/booking':
        return chainStep(respond, url, 'booking');
      default:
        return refuse(404, `no fixture route ${url.pathname}`);
    }
  }

  function render(respond: FixtureResponse, url: URL, request: Request): Response | Promise<Response> {
    switch (respond.kind) {
      case 'status':
        return json(
          respond.body ?? { synthetic: true, error: `synthetic HTTP ${respond.status}` },
          respond.status,
          respond.headers ?? {},
        );
      case 'malformed':
        return new Response('{"synthetic": true, "prices": [', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      case 'network':
        return Response.error();
      case 'hang':
        // why: answers only when the client gives up (abort or per-request timeout), and then with a network error:
        // msw 3 sends a request still pending at abort to the real network, and a rejection here would become a 500.
        return new Promise<Response>((resolve) => {
          if (request.signal.aborted) resolve(Response.error());
          request.signal.addEventListener('abort', () => resolve(Response.error()), { once: true });
        });
      case 'hold':
        return new Promise<Response>((resolve) => {
          const list = held.get(respond.id) ?? [];
          list.push({ url, request, settle: resolve });
          held.set(respond.id, list);
        });
      case 'normal':
      case 'empty':
      case 'no-fares':
      case 'no-currency':
      case 'no-return-legs':
      case 'partial':
      case 'variant':
      case 'cacheable':
        return route(respond, url);
      default: {
        // why: exhaustive (po-004) — a new kind must be handled here before it compiles.
        const unreachable: never = respond;
        throw new Error(`unhandled fixture response ${JSON.stringify(unreachable)}`);
      }
    }
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === SCENARIO_PATH) {
      if (request.method === 'DELETE') {
        reset();
        return new Response(null, { status: 204 });
      }
      if (request.method !== 'POST') return refuse(405, 'use POST or DELETE');
      const parsed = parseFixtureRules(await readJson(request));
      if (typeof parsed === 'string') return refuse(400, parsed);
      setRules(parsed);
      return json({ synthetic: true, rules: rules.length });
    }
    if (url.pathname === RELEASE_PATH) {
      if (request.method !== 'POST') return refuse(405, 'use POST');
      const body = await readJson(request);
      if (!isRecord(body) || typeof body.id !== 'string' || body.id === '')
        return refuse(400, 'body must be { id, respond? }');
      const respond =
        body.respond === undefined ? { kind: 'normal' as const } : parseFixtureResponse(body.respond);
      if (typeof respond === 'string') return refuse(400, respond);
      const waiting = held.get(body.id) ?? [];
      held.delete(body.id);
      for (const w of waiting) w.settle(render(respond, w.url, w.request));
      return json({ synthetic: true, released: waiting.length });
    }
    const inline = request.headers.get(SCENARIO_HEADER);
    let respond: FixtureResponse;
    if (inline === null) respond = pick(url);
    else {
      let parsedHeader: unknown;
      try {
        parsedHeader = JSON.parse(inline);
      } catch {
        return refuse(400, `${SCENARIO_HEADER} is not JSON`);
      }
      const r = parseFixtureResponse(parsedHeader);
      if (typeof r === 'string') return refuse(400, r);
      respond = r;
    }
    return render(respond, url, request);
  }

  return { handle, setRules, reset };
}
