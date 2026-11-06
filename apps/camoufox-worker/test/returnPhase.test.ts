// Spec revision 56 §2 "The return phase" (WP21 Task 21.3): the page session's return phase over the fake browser, as
// session.test.ts runs a page. No navigation seam: an activation's document navigation is the fake guard seeing a
// main-frame request, refused by the gate. Every name here is synthetic (the recorded name forms on the worked
// example's airports, with the synthetic carrier QQ Air and sellers QQ Travel and QQ Fares), never a recording's.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  asIata,
  asIsoDate,
  bookingReturnOf,
  FLIGHT_LIST_PAGES_PER_PAIR_MAX,
  type FlightLimits,
  type FlightsRequest,
  selectOutbound,
  type WorkerAnswer,
  workerAnswerSchema,
} from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pageBudget } from '../src/budget.js';
import { CooldownStore } from '../src/cooldown.js';
import { createDriver, type Driver, type RequestLike } from '../src/driver.js';
import type { FlightsRead } from '../src/flights.js';
import type { GuardState } from '../src/guard.js';
import { OFFER_GRAMMAR_VERSION } from '../src/offers.js';
import { Pacer } from '../src/pacer.js';
import { Refusal } from '../src/refusal.js';
import { flightsWithPicks, refusalOf, returnPhase, unverifiedReturns } from '../src/returnPhase.js';
import { SELECTORS, type Selectors } from '../src/selectors.js';
import { PageSession, pageCapMs } from '../src/session.js';
import { loadSocs } from '../src/socs.js';
import { type Deadline, DeadlineExceeded } from '../src/timers.js';
import { FakeContext } from './support/fakeContext.js';
import { descendants, type FakeNode, FakePage, n, resultsTree, text, viewMore } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { SYNTHETIC_REJECT } from './support/socsValues.js';
import { fakeTimers, flush } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const CAPTURE = {
  value: SYNTHETIC_REJECT,
  domain: '.google.com',
  path: '/',
  expires: 1_800_000_000,
  secure: true,
  sameSite: 'Lax',
  capturedAt: '2026-10-18T04:00:00.000Z',
};
const LIMITS: FlightLimits = {
  maxJourneyMinutes: 1500,
  maxStops: 1,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
const REQ: FlightsRequest & { returnLimits: FlightLimits } = {
  mode: 'flights',
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2026-11-05'),
  returnDate: asIsoDate('2026-11-15'),
  gl: 'GB',
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
    otherOrigins: [],
    otherDestinations: [],
  },
  returnLimits: LIMITS,
  booking: true,
};
const URL0 =
  'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2026-11-05+returning+2026-11-15&curr=GBP&hl=en-GB&gl=GB';
const LANDED = 'https://www.google.com/travel/flights/search?tfs=x';
const RETURN_URL = 'https://www.google.com/travel/flights/search?tfs=r';
const BOOKING_URL = 'https://www.google.com/travel/flights/booking?tfs=b';
const versions = { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' };
/** A verified entry's flags (the module's darwin-arm64 values) with both select flags on, as the flip will set them. */
const VERIFIED: Selectors = { ...SELECTORS, RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };

// ---- the synthetic page: names, trees ----

/** An outbound option's name in the recorded form (LHR to JFK on the departure day). */
function ob(
  pounds: number | string,
  o: { stops?: string; dur?: string; arrivesOn?: string; on?: string } = {},
) {
  const on = o.on ?? 'Thursday, November 5';
  return (
    `From ${pounds} British pounds round trip total. ${o.stops ?? '1 stop'} flight with QQ Air. Leaves Heathrow Airport ` +
    `at 9:05 on ${on} and arrives at John F. Kennedy International Airport at 19:05 on ${o.arrivesOn ?? on}. Total ` +
    `duration ${o.dur ?? '10 hrs'}. Select flight`
  );
}
/** A return option's name in the recorded form (JFK to LHR on the return day, arriving the next day). */
function rt(pounds: number | string, o: { stops?: string; dur?: string } = {}) {
  return (
    `From ${pounds} British pounds round trip total. ${o.stops ?? '1 stop'} flight with QQ Air. Leaves John F. Kennedy ` +
    'International Airport at 18:30 on Sunday, November 15 and arrives at Heathrow Airport at 9:45 on Monday, November ' +
    `16. Total duration ${o.dur ?? '10 hrs 15 min'}. Select flight`
  );
}
const offer = (seller: string, pounds: string, fare?: string, currency = 'British pounds') =>
  `Continue to book with ${seller}${fare === undefined ? '' : `, ${fare}`} for ${pounds} ${currency}`;

// The fixture's outbound list, in page order: another day's option, an unparsable name, £451 at 1,600 min (over the
// journey limit), £478 at 600 min with 2 stops (over the stops limit), £478 at 600 min with 1 stop (the right pick:
// index 2 of `flights`, neither first in page order nor the cheapest), £520 at 700 min
const OTHER_DAY = ob(300, { on: 'Friday, November 6' });
const GIBBERISH = 'From 999 British pounds round trip total. Gibberish';
const O451 = ob(451, { dur: '26 hrs 40 min', arrivesOn: 'Friday, November 6' });
const O478S2 = ob(478, { stops: '2 stops' });
const PICK = ob(478);
const O520 = ob(520, { dur: '11 hrs 40 min' });
const OUT = [OTHER_DAY, GIBBERISH, O451, O478S2, PICK, O520];

const R1204 = rt('1,204', { stops: 'Nonstop', dur: '7 hrs 15 min' });
const R1180 = rt('1,180');
const R1250 = rt('1,250', { stops: '2 stops' });
const RETURNS = [R1204, R1180, R1250];
const MORE = '2 more booking options';
const GROUPED = 'View QQ Travel, QQ Fares 1,250 British pounds options';
const INITIAL = [offer('QQ Fares', '1,195', 'Economy Basic'), offer('QQ Travel', '1,210')];
const EXPANDED = [
  offer('QQ Travel', '1,210'),
  offer('QQ Travel', '1,180'),
  offer('QQ Fares', '1,195', 'Economy Basic'),
];

/** A Best view whose search form shows another departure date. */
function mismatched(): FakeNode {
  const t = best();
  for (const c of descendants([t]))
    if (c.role === 'textbox' && c.name === 'Departure') c.value = 'Fri, 6 Nov';
  return t;
}
const links = (names: string[]) => names.map((x) => n('listitem', '', [n('link', x)]));
const best = (names: string[] = OUT, extra: FakeNode[] = []) =>
  resultsTree({ top: links(names), other: [], tab: 'Cheapest from 451 British pounds', extra });
const cheapest = (names: string[] = OUT, extra: FakeNode[] = []) => {
  const t = best(names, extra);
  for (const c of descendants([t])) if (c.role === 'tab' && c.name?.startsWith('Cheapest')) c.selected = true;
  // the Cheapest view shows no "N results returned." line
  t.children = (t.children ?? []).filter((c) => !/results returned/.test(c.name ?? ''));
  return t;
};
const returnTree = (
  names: string[] = RETURNS,
  o: { currency?: string; heading?: string | null; extra?: FakeNode[]; noFlights?: boolean } = {},
) =>
  n('document', 'Google Flights', [
    n('main', '', [
      ...(o.heading === null ? [] : [n('heading', o.heading ?? 'Returning flights')]),
      n('list', '', links(names)),
      ...(o.noFlights === true ? [text('No results returned')] : []),
      ...(o.extra ?? []),
    ]),
    viewMore(),
    n('button', `Currency ${o.currency ?? 'GBP'}`),
    n('button', 'Location·United Kingdom'),
  ]);
/** The price-comparison note's two recorded forms (2026-11-01, 2026-11-02), or none. */
const NOTES = {
  low: ['£1,180 is low for Economy – £270 cheaper than usual'],
  typical: ['£1,180 is typical for economy'],
  none: [],
} as const satisfies Record<string, readonly string[]>;
const bookingTree = (
  offers: string[] = INITIAL,
  o: { more?: string[]; grouped?: number; note?: keyof typeof NOTES; outbound?: string[] } = {},
) =>
  n('document', 'Google Flights', [
    n('main', '', [
      // why: the page's price-comparison note, whose wording follows the fare; never a fact the view is recognised by
      ...NOTES[o.note ?? 'low'].map((x) => n('heading', x)),
      ...offers.map((x) => n('button', x)),
      ...Array.from({ length: o.grouped ?? 1 }, () => n('button', GROUPED)),
      ...(o.more ?? [MORE]).map((x) => n('button', x)),
      ...links(o.outbound ?? []),
    ]),
    n('button', 'Currency GBP'),
  ]);

// ---- the session over the fake browser ----

/** What a press shows: the trees after it (the pre-press tree is kept for two polls first), and the URL. */
interface Shows {
  trees: FakeNode[];
  url?: string;
  /** Runs at the press (a navigation the page starts, a pacer record written). */
  also?: (p: FakePage, c: FakeContext) => void;
}
interface Opts {
  selectors?: Selectors;
  req?: FlightsRequest;
  /** Each load's Best tree and the Cheapest trees after its tab click (the first load's, then the reload's). */
  loads?: Array<{ best: FakeNode[]; cheapest: FakeNode[] }>;
  /** What each activated name shows next; a name absent here changes nothing. */
  press?: Record<string, Shows>;
  /** The first navigation's hops (a refused first load). */
  hops?: string[];
  shape?: (c: FakeContext) => void;
  page?: (p: FakePage, c: FakeContext) => void;
  /** Wraps the session's driver (a call that lets the page start a navigation at a chosen read). */
  driver?: (d: Driver, c: FakeContext) => Driver;
}
const DEFAULT_PRESS = (): Record<string, Shows> => ({
  [PICK]: { trees: [returnTree()], url: RETURN_URL },
  [R1180]: { trees: [bookingTree()], url: BOOKING_URL },
  [MORE]: { trees: [bookingTree(EXPANDED, { more: [] })] },
});

function setup(o: Opts = {}) {
  const dataDir = tmpDir();
  writeFileSync(join(dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
  const profileDir = join(dataDir, 'profile');
  mkdirSync(profileDir);
  const timers = fakeTimers();
  const clock = timers.clock;
  const contexts: FakeContext[] = [];
  const cooldown = new CooldownStore({ dir: dataDir, challengeHours: 48, clock });
  const pacer = new Pacer({ dir: dataDir, minSpacingSeconds: 30, clock });
  const refusal = new Refusal({ dir: dataDir, clock });
  const log = memoryLog();
  const loads = o.loads ?? [
    { best: [best()], cheapest: [cheapest()] },
    { best: [best()], cheapest: [cheapest()] },
  ];
  const press = o.press ?? DEFAULT_PRESS();
  const seen: {
    guard: GuardState | null;
    gateAtPress: boolean[];
    gateAtTab: boolean[];
    gateAtGoto: boolean[];
  } = {
    guard: null,
    gateAtPress: [],
    gateAtTab: [],
    gateAtGoto: [],
  };
  const session = new PageSession({
    launch: async () => {
      const c = new FakeContext();
      c.navigations = [{ hops: o.hops ?? [URL0, LANDED], tree: best() }];
      c.onNewPage = (p) => {
        let load = 0;
        let shown: FakeNode = best();
        const show = (trees: FakeNode[]) => {
          shown = trees.at(-1) ?? shown;
          p.setTrees(trees);
        };
        const goto = p.goto.bind(p);
        p.goto = async (u, opts) => {
          seen.gateAtGoto.push(seen.guard?.activationGate ?? false);
          const r = await goto(u, opts);
          show(loads[Math.min(load, loads.length - 1)]?.best ?? [best()]);
          load++;
          return r;
        };
        p.onClick = (x) => {
          if (x.role === 'tab') {
            seen.gateAtTab.push(seen.guard?.activationGate ?? false);
            show(loads[Math.min(load - 1, loads.length - 1)]?.cheapest ?? [cheapest()]);
            return;
          }
          seen.gateAtPress.push(seen.guard?.activationGate ?? false);
          const next = press[x.name ?? ''];
          if (next === undefined) return;
          next.also?.(p, c);
          if (next.url !== undefined) p.setUrl(next.url);
          // why: the fake keeps the pre-click tree for two polls after a click before swapping
          const before = shown;
          show([before, before, ...next.trees]);
        };
        o.page?.(p, c);
      };
      o.shape?.(c);
      contexts.push(c);
      mkdirSync(profileDir, { recursive: true });
      return c;
    },
    profileDir,
    socs: loadSocs(dataDir, clock),
    cooldown,
    pacer,
    refusal,
    clock,
    timers,
    selectors: o.selectors ?? VERIFIED,
    pageTimeoutMs: 90_000,
    log,
    versions,
    driverFor: (p, g, S) => {
      seen.guard = g;
      const d = createDriver(p, g, S);
      const c = contexts.at(-1);
      return o.driver === undefined || c === undefined ? d : o.driver(d, c);
    },
  });
  const page0 = (): FakePage => {
    const p = contexts[0]?.pages[0];
    if (p === undefined) throw new Error('no page opened');
    return p;
  };
  return {
    dataDir,
    profileDir,
    timers,
    clock,
    contexts,
    cooldown,
    pacer,
    refusal,
    session,
    seen,
    page0,
    log,
  };
}
type Setup = ReturnType<typeof setup>;

type Flights = Extract<WorkerAnswer, { kind: 'flights' }>;
function flightsOf(a: WorkerAnswer): Flights {
  if (a.kind !== 'flights') throw new Error(`expected a flights answer, got ${a.kind}`);
  return a;
}
/** A navigation request in the main frame, as the page would start one (the request event, then the route). */
function navigate(c: FakeContext, url: string): void {
  const r: RequestLike = {
    url: () => url,
    method: () => 'GET',
    isNavigationRequest: () => true,
    redirectedFrom: () => null,
    frame: () => ({ url: () => url, parentFrame: () => null }),
  };
  c.emitRequest(r);
  void c.routeRequest(r);
}
/** A main-frame navigation the route alone sees (no request event, so no hop): the guard's refusal is its only record. */
function routeOnly(c: FakeContext, url: string): void {
  void c.routeRequest({
    url: () => url,
    method: () => 'GET',
    isNavigationRequest: () => true,
    redirectedFrom: () => null,
    frame: () => ({ url: () => '', parentFrame: () => null }),
  });
}
const flight = (pounds: number, o: { stops?: number; minutes?: number; offset?: number } = {}) => ({
  departsLocal: '09:05',
  arrivesLocal: '19:05',
  arrivesDayOffset: o.offset ?? 0,
  durationMinutes: o.minutes ?? 600,
  stops: o.stops ?? 1,
  carriers: ['QQ Air'],
  operatedBy: null,
  amountMinor: pounds * 100,
});
const FOUR = [
  flight(451, { minutes: 1600, offset: 1 }),
  flight(478, { stops: 2 }),
  flight(478),
  flight(520, { minutes: 700 }),
];

/**
 * The one helper every transient end is asserted through: a flights answer with the outbound flights intact (never
 * not-ready or blocked), no cool-down, `pagesLoaded` the literal loaded, the page closed and the
 * SOCS read-back run after.
 */
function expectTransient(t: Setup, a: WorkerAnswer, loaded: number): Flights {
  const f = flightsOf(a);
  expect(workerAnswerSchema.safeParse(a).success).toBe(true);
  expect(f.flights.length).toBeGreaterThan(0);
  expect(f.pagesLoaded).toBe(loaded);
  expect(t.cooldown.active()).toBeNull();
  expect(t.page0().calls.closed).toBeGreaterThan(0);
  expect(t.contexts[0]?.cookieCalls.length).toBeGreaterThan(1);
  return f;
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('the whole phase (spec rev 56 §2: the outbound, its returns, the shown pairing’s booking options)', () => {
  it('selects the right outbound, reads its returns, books bookingReturnOf’s pick, opens the expansion and reads every offer', async () => {
    const t = setup();
    const r = await t.session.page(REQ);
    const a = flightsOf(r.answer);
    expect(workerAnswerSchema.safeParse(r.answer).success).toBe(true);
    expect(a.flights).toEqual(FOUR);
    expect(a.cheapestView).toBe('cheapest');
    const ret = a.returns;
    expect(ret).toBeDefined();
    if (ret === undefined) return;
    expect(ret.status).toBe('read');
    expect(ret.rule).toBeNull();
    expect(ret.limits).toEqual(LIMITS);
    expect(ret.attempts).toHaveLength(1);
    expect(ret.attempts[0]).toMatchObject({
      outboundIndex: 2,
      outboundFits: true,
      listed: 'returns',
      moreListed: true,
    });
    expect(ret.attempts[0]?.returns.map((x) => x.fromMinor)).toEqual([120_400, 118_000, 125_000]);
    // why: preflight P9 (the brief's L1183 corrected): £520 at 700 min fits and was never tried
    expect(ret.triedAll).toBe(false);
    expect(ret.booking).toEqual({
      status: 'read',
      rule: null,
      attempt: 0,
      returnIndex: 1,
      expanded: true,
      offers: [
        { seller: 'QQ Travel', fare: null, priceMinor: 118_000 },
        { seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 },
        { seller: 'QQ Travel', fare: null, priceMinor: 121_000 },
      ],
      unparsed: 0,
      nonGbp: 0,
      grouped: 1,
      moreControl: false,
      offersStated: null,
    });
    // why: R-pick: the worker books exactly the return core's one rule picks
    expect(ret.booking?.returnIndex).toBe(bookingReturnOf(ret, a.flights)?.returnIndex);
    // why: Review Focus 1: one selection rule, end to end
    expect(selectOutbound(a.flights, LIMITS).index).toBe(ret.attempts[0]?.outboundIndex);
    const p = t.page0();
    expect(p.calls.clicks).toEqual(['tab:Cheapest from 451 British pounds']);
    expect(p.calls.actions).toEqual([
      `focus:link:${PICK}`,
      `press:Enter:link:${PICK}:focused`,
      `focus:link:${R1180}`,
      `press:Enter:link:${R1180}:focused`,
      `focus:button:${MORE}`,
      `press:Enter:button:${MORE}:focused`,
    ]);
    // why: R-worst: the gate is on at every press and off at the tab and the load
    expect(t.seen.gateAtPress).toEqual([true, true, true]);
    expect(t.seen.gateAtTab).toEqual([false]);
    expect(t.seen.gateAtGoto).toEqual([false]);
    expect(t.seen.guard?.activationGate).toBe(false);
    expect(a.pagesLoaded).toBe(1);
    expect('nextLoadNotBefore' in a).toBe(false);
    expect(a.versions).toEqual({ ...versions, offerGrammar: OFFER_GRAMMAR_VERSION });
    expect(Date.parse(a.fetchedAt)).toBe(t.timers.now());
    expect(t.cooldown.active()).toBeNull();
    // why: an answer never carries a button's name, only its parsed seller, fare and price
    expect(JSON.stringify(r.answer)).not.toContain('Continue to book');
  });
  it('R-pick: two fitting returns tied on the "from" price, the later shorter: the shorter is booked', async () => {
    const LONG = rt('1,180', { dur: '12 hrs' });
    const SHORT = rt('1,180', { dur: '9 hrs' });
    const t = setup({
      press: {
        [PICK]: { trees: [returnTree([LONG, SHORT])], url: RETURN_URL },
        [SHORT]: { trees: [bookingTree()], url: BOOKING_URL },
        [MORE]: { trees: [bookingTree(EXPANDED, { more: [] })] },
      },
    });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.booking?.returnIndex).toBe(1);
    expect(a.returns === undefined ? null : bookingReturnOf(a.returns, a.flights)?.returnIndex).toBe(1);
    expect(t.page0().calls.presses).toContain(`Enter:link:${SHORT}`);
  });
  it('a pick outside the 30: only the dearest fits; it is kept, replacing the dearest non-pick, and the counts come from the 31 read', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ob(400 + i, { stops: '2 stops' }));
    const DEAR = ob(900);
    const t = setup({
      loads: [{ best: [best([...many, DEAR])], cheapest: [cheapest([...many, DEAR])] }],
      press: {
        [DEAR]: { trees: [returnTree()], url: RETURN_URL },
        [R1180]: { trees: [bookingTree()], url: BOOKING_URL },
        [MORE]: { trees: [bookingTree(EXPANDED, { more: [] })] },
      },
    });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.flights).toHaveLength(30);
    const idx = a.returns?.attempts[0]?.outboundIndex ?? -1;
    expect(a.flights[idx]?.amountMinor).toBe(90_000);
    // the dropped flight is the dearest non-pick (£429); the pick sits in page order (last)
    expect(a.flights.map((f) => f.amountMinor)).not.toContain(42_900);
    expect(idx).toBe(29);
    expect(a.minMinor).toBe(40_000);
    expect(t.page0().calls.presses[0]).toBe(`Enter:link:${DEAR}`);
  });
  it('the return view’s links are read by the return pattern, never the outbound one', async () => {
    // why: an outbound pattern that reads only the departing leg's names, so a read by it would find no return
    const S: Selectors = {
      ...VERIFIED,
      results: {
        ...VERIFIED.results,
        resultLink: /^From [\d,]+ [A-Za-z ]+ round trip total\. .* Leaves Heathrow Airport /,
      },
    };
    const t = setup({ selectors: S });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.attempts[0]?.returns.map((x) => x.fromMinor)).toEqual([120_400, 118_000, 125_000]);
    expect(a.returns?.booking?.status).toBe('read');
  });
});

describe('the second attempt (Ian’s ruling 2: the next outbound, from a fresh load of the list page)', () => {
  const R2S1 = rt('1,300', { stops: '2 stops' });
  const R2S2 = rt('1,350', { stops: '2 stops' });
  const R1400 = rt('1,400');
  const second = (o: Partial<Opts> = {}, extra: Record<string, Shows> = {}): Opts => ({
    press: {
      [PICK]: { trees: [returnTree([R2S1, R2S2])], url: RETURN_URL },
      [O520]: { trees: [returnTree([R1400, rt('1,500', { stops: 'Nonstop' })])], url: RETURN_URL },
      [R1400]: { trees: [bookingTree()], url: BOOKING_URL },
      [R2S1]: { trees: [bookingTree()], url: BOOKING_URL },
      [MORE]: { trees: [bookingTree(EXPANDED, { more: [] })] },
      ...extra,
    },
    ...o,
  });
  it('no return of the first fits and a second outbound does: the spaced reload, the second selection, the booking on attempt 1', async () => {
    const t = setup(second());
    const ms: number[] = [];
    const deadline = t.timers.deadline.bind(t.timers);
    t.timers.deadline = (x) => {
      ms.push(x);
      return deadline(x);
    };
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(workerAnswerSchema.safeParse(a).success).toBe(true);
    const p = t.page0();
    expect(p.calls.gotos.map((g) => g.url)).toEqual([URL0, URL0]);
    expect(p.calls.clicks).toEqual([
      'tab:Cheapest from 451 British pounds',
      'tab:Cheapest from 451 British pounds',
    ]);
    expect(p.calls.actions).toEqual([
      `focus:link:${PICK}`,
      `press:Enter:link:${PICK}:focused`,
      `focus:link:${O520}`,
      `press:Enter:link:${O520}:focused`,
      `focus:link:${R1400}`,
      `press:Enter:link:${R1400}:focused`,
      `focus:button:${MORE}`,
      `press:Enter:button:${MORE}:focused`,
    ]);
    expect(a.returns?.status).toBe('read');
    expect(a.returns?.rule).toBeNull();
    expect(a.returns?.attempts.map((x) => x.outboundIndex)).toEqual([2, 3]);
    expect(a.returns?.attempts[1]?.outboundFits).toBe(true);
    expect(a.returns?.booking).toMatchObject({ status: 'read', attempt: 1, returnIndex: 0 });
    // no third fitting outbound: £451 and the two-stop £478 are over a limit
    expect(a.returns?.triedAll).toBe(true);
    expect(a.pagesLoaded).toBe(2);
    expect(t.seen.gateAtGoto).toEqual([false, false]);
    // why: R-spacing: the reload's start plus the spacing
    const last = t.pacer.lastPageAt();
    expect(a.nextLoadNotBefore).toBe(new Date(Date.parse(last ?? '') + 30_000).toISOString());
    // why: prov-int-r3-004: the budget's deadlines in order (every deadline of 30 s or more is the budget's): the first
    // view, its Cheapest flow, the selection, the spacing, the reload, its Cheapest flow, the second selection, the
    // return's selection and the expansion
    expect(ms.filter((x) => x >= 30_000)).toEqual([
      90_000, 90_000, 90_000, 30_000, 90_000, 90_000, 90_000, 90_000, 90_000,
    ]);
  });
  it('a second document the page loads by itself, with no reload, still states the next start (R-spacing)', async () => {
    let lists = 0;
    const t = setup({
      driver: (d, c) => ({
        ...d,
        listFacts: async (...args: Parameters<Driver['listFacts']>) => {
          lists++;
          // why: the outbound list's read: the page loads another results document of its own accord
          if (lists === 1) navigate(c, 'https://www.google.com/travel/flights/search?tfs=again');
          return d.listFacts(...args);
        },
      }),
    });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.status).toBe('read');
    expect(a.pagesLoaded).toBe(2);
    // why: the pacer's one start, the first load's, plus the spacing
    expect(t.pacer.lastPageAt()).toBe('2026-10-18T05:00:00.000Z');
    expect(a.nextLoadNotBefore).toBe('2026-10-18T05:00:30.000Z');
  });
  it('the reload’s Cheapest flow gets a full page period even when fake time is past 180 s at the reload', async () => {
    const fetching = n('document', '', [text('Fetching results')]);
    const loading = n('document', '', [
      n('tablist', '', [n('tab', 'Cheapest from 451 British pounds', [], { selected: true })]),
      text('Fetching results'),
    ]);
    const slowReturn = (trees: FakeNode[]) => [
      ...Array(20).fill(returnTree([R2S1], { extra: [text('Fetching results')] })),
      ...trees,
    ];
    const t = setup({
      ...second(),
      loads: [
        { best: [...Array(40).fill(fetching), best()], cheapest: [...Array(30).fill(loading), cheapest()] },
        { best: [best()], cheapest: [cheapest()] },
      ],
      press: {
        ...second().press,
        [PICK]: { trees: slowReturn([returnTree([R2S1, R2S2])]), url: RETURN_URL },
      },
    });
    const ms: Array<{ ms: number; at: number }> = [];
    const deadline = t.timers.deadline.bind(t.timers);
    t.timers.deadline = (x) => {
      ms.push({ ms: x, at: t.timers.now() });
      return deadline(x);
    };
    const start = t.timers.now();
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.attempts).toHaveLength(2);
    const budget = ms.filter((x) => x.ms >= 30_000);
    // the reload's Cheapest deadline (the sixth) starts past 180 s and is still a whole page period
    expect((budget[5]?.at ?? 0) - start).toBeGreaterThan(180_000);
    expect(budget[5]?.ms).toBe(90_000);
  });
  it('triedAll is false when a third fitting outbound remains', async () => {
    const O530 = ob(530, { dur: '11 hrs 40 min' });
    const names = [...OUT, O530];
    const t = setup({
      ...second(),
      loads: [
        { best: [best(names)], cheapest: [cheapest(names)] },
        { best: [best(names)], cheapest: [cheapest(names)] },
      ],
    });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.attempts).toHaveLength(2);
    expect(a.returns?.triedAll).toBe(false);
  });
  it('no second attempt when no further outbound fits: one attempt, the booking of bookingReturnOf’s pick (none fitting)', async () => {
    const names = [OTHER_DAY, GIBBERISH, O451, O478S2, PICK];
    const t = setup({
      ...second(),
      loads: [{ best: [best(names)], cheapest: [cheapest(names)] }],
    });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(t.page0().calls.gotos).toHaveLength(1);
    expect(a.returns?.attempts).toHaveLength(1);
    expect(a.returns?.triedAll).toBe(true);
    // the cheapest of all by the one order: £1,300 (both two-stop)
    expect(a.returns?.booking).toMatchObject({ status: 'read', attempt: 0, returnIndex: 0 });
    expect(a.pagesLoaded).toBe(1);
  });
  // why: review of the phase: with every flight read already tried, the next selection has nothing left to select
  it('one flight read, its returns all over a limit: one attempt, no second selection attempted', async () => {
    const t = setup({
      ...second(),
      loads: [{ best: [best([PICK])], cheapest: [cheapest([PICK])] }],
    });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.attempts).toHaveLength(1);
    expect(a.returns?.triedAll).toBe(true);
    expect(t.page0().calls.gotos).toHaveLength(1);
  });
  it('two flights read, the first’s returns all over a limit: the second, the one left untried, is selected', async () => {
    const names = [PICK, O520];
    const t = setup({
      ...second(),
      loads: [
        { best: [best(names)], cheapest: [cheapest(names)] },
        { best: [best(names)], cheapest: [cheapest(names)] },
      ],
    });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.attempts.map((x) => x.outboundIndex)).toEqual([0, 1]);
    expect(a.returns?.triedAll).toBe(true);
    expect(t.page0().calls.gotos).toHaveLength(2);
  });
  it('a return outside the departure window still fits (the windows apply to the outbound only): no second attempt', async () => {
    const t = setup();
    const window = { from: '08:00', to: '10:00' };
    const a = flightsOf(
      (await t.session.page({ ...REQ, returnLimits: { ...LIMITS, departureWindowLocal: window } })).answer,
    );
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: null,
      booking: { status: 'read', attempt: 0, returnIndex: 1 },
    });
    expect(a.returns?.attempts).toHaveLength(1);
    expect(t.page0().calls.gotos).toHaveLength(1);
  });
  it('a request with booking false makes the same second attempt and no booking read', async () => {
    const t = setup(second());
    const a = flightsOf((await t.session.page({ ...REQ, booking: false })).answer);
    expect(a.returns?.status).toBe('read');
    expect(a.returns?.attempts).toHaveLength(2);
    expect(a.returns?.booking).toBeNull();
    expect(t.page0().calls.actions).toHaveLength(4);
    expect(a.versions).toEqual(versions);
  });
  it.each([
    [
      'a Best fallback (the reload’s Cheapest view never settles)',
      {
        best: [best()],
        cheapest: [
          n('document', '', [
            n('tablist', '', [n('tab', 'Cheapest from 451 British pounds', [], { selected: true })]),
            text('Fetching results'),
          ]),
        ],
      },
      'reload:best-fallback',
    ],
    [
      "Google's no-flights line",
      {
        best: [n('document', '', [...(resultsTree().children?.slice(0, 4) ?? []), text('No flights found')])],
        cheapest: [cheapest()],
      },
      'reload:no-flights',
    ],
    ['a form mismatch', { best: [mismatched()], cheapest: [cheapest()] }, 'reload:search-form:mismatch'],
    [
      'no option read',
      { best: [best([GIBBERISH])], cheapest: [cheapest([GIBBERISH])] },
      'reload:no-options-read',
    ],
  ])(
    'a reload that ends other than on a settled Cheapest view (%s): read, one attempt, no cool-down, the booking skipped',
    async (_what, reload, rule) => {
      const t = setup({ ...second(), loads: [{ best: [best()], cheapest: [cheapest()] }, reload] });
      const a = expectTransient(t, (await t.session.page(REQ)).answer, 2);
      expect(a.returns).toMatchObject({ status: 'read', rule, booking: { status: 'skipped', rule } });
      expect(a.returns?.attempts).toHaveLength(1);
    },
  );
  it('a genuine block after the second selection is the page’s stop', async () => {
    const t = setup(
      second({}, { [O520]: { trees: [n('document', '', [text('please show you are not a robot')])] } }),
    );
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({
      kind: 'blocked',
      page: 'captcha',
      rule: 'challenge-text',
      pagesLoaded: 2,
    });
  });
  it('a navigation past the reservation during the reload’s served sequence: read, rule reload:page-reservation', async () => {
    let gotos = 0;
    const t = setup({
      ...second(),
      shape: (c) => {
        c.afterGoto = (jar) => {
          gotos++;
          if (gotos === 2) navigate(c, 'https://www.google.com/travel/flights?q=third');
          return jar;
        };
      },
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 2);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'reload:page-reservation',
      booking: { status: 'skipped', rule: 'reload:page-reservation' },
    });
  });
  it('a reloaded list in another currency: read, rule reload:currency', async () => {
    const usd = cheapest();
    for (const c of descendants([usd]))
      if (c.role === 'button' && c.name === 'Currency GBP') c.name = 'Currency USD';
    const t = setup({
      ...second(),
      loads: [
        { best: [best()], cheapest: [cheapest()] },
        { best: [best()], cheapest: [usd] },
      ],
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 2);
    expect(a.returns).toMatchObject({ status: 'read', rule: 'reload:currency' });
  });
  it('a genuine blocked kind on the reload is the page’s stop, with its cool-down', async () => {
    const t = setup({
      ...second(),
      loads: [
        { best: [best()], cheapest: [cheapest()] },
        { best: [best(OUT, [text('Our systems have detected unusual traffic')])], cheapest: [cheapest()] },
      ],
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unusual-traffic', pagesLoaded: 2 });
    expect(t.cooldown.active()?.cause).toBe('unusual-traffic');
    // the stop is the reload's own: no second outbound is selected on the blocked page
    expect(t.page0().calls.actions).toEqual([`focus:link:${PICK}`, `press:Enter:link:${PICK}:focused`]);
  });
  it('the spacing wait running out of its own budget: read, rule spacing, one attempt, the booking read of attempt 0', async () => {
    const t = setup(
      second(
        {},
        {
          [PICK]: {
            trees: [returnTree([R2S1, R2S2])],
            url: RETURN_URL,
            // why: a last start in the future: the wait outlasts the spacing's own budget (fake time not advanced)
            also: () =>
              writeFileSync(
                join(t.dataDir, 'pacer.json'),
                JSON.stringify({ lastPageAt: new Date(t.timers.now() + 60_000).toISOString() }),
              ),
          },
        },
      ),
    );
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'read', rule: 'spacing' });
    expect(a.returns?.attempts).toHaveLength(1);
    expect(a.returns?.booking).toMatchObject({ status: 'read', attempt: 0 });
    expect(t.page0().calls.gotos).toHaveLength(1);
  });
  // why: review I1: a reload whose load fails for any reason but a refusal or the deadline keeps everything read
  it('a reload whose load fails with a network error: read, rule reload:goto, one attempt, the booking skipped, nextLoadNotBefore stated (M5)', async () => {
    let gotos = 0;
    const t = setup({
      ...second(),
      page: (p) => {
        const goto = p.goto.bind(p);
        p.goto = async (u, o) => {
          gotos++;
          // why: the second load fails before any request reaches the guard, so nothing is counted
          if (gotos === 2) throw new Error('net::ERR_CONNECTION_RESET');
          return goto(u, o);
        };
      },
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'reload:goto',
      booking: { status: 'skipped', rule: 'reload:goto' },
    });
    expect(a.returns?.attempts).toHaveLength(1);
    // why: review M5: the pacer was re-claimed for the reload, so the next load waits from that start
    const last = t.pacer.lastPageAt();
    expect(a.nextLoadNotBefore).toBe(new Date(Date.parse(last ?? '') + 30_000).toISOString());
  });
  it('a reload whose load fails with a plain error as the deadline expires: reload:not-settled, never not-ready', async () => {
    let gotos = 0;
    const t = setup({
      ...second(),
      page: (p) => {
        const goto = p.goto.bind(p);
        p.goto = async (u, o) => {
          gotos++;
          if (gotos === 2) {
            // why: the error the browser gives at the same moment as the step's own deadline (its own timeout)
            t.timers.runOut();
            throw new Error('Timeout exceeded while navigating');
          }
          return goto(u, o);
        };
      },
    });
    // why: the browser's own error reaches the phase first: the deadline's race passes the call through untouched
    const deadline = t.timers.deadline.bind(t.timers);
    t.timers.deadline = (ms) => {
      const d = deadline(ms);
      return { ...d, race: (x) => x };
    };
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'reload:not-settled',
      booking: { status: 'skipped', rule: 'reload:not-settled' },
    });
  });
  it('the reloaded list’s read at its deadline: read, rule reload:not-settled, the booking skipped', async () => {
    let lists = 0;
    const t = setup({
      ...second(),
      driver: (d) => ({
        ...d,
        listFacts: async (...args: Parameters<Driver['listFacts']>) => {
          lists++;
          // why: read 3 is the reloaded list page's
          if (lists === 3) throw new DeadlineExceeded();
          return d.listFacts(...args);
        },
      }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 2);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'reload:not-settled',
      booking: { status: 'skipped', rule: 'reload:not-settled' },
    });
    expect(a.returns?.attempts).toHaveLength(1);
  });
  it('a reload the guard refuses (its load sent off the allowlist): read, rule reload:guard-refused:off-allowlist', async () => {
    let gotos = 0;
    const t = setup({
      ...second(),
      page: (p, c) => {
        const goto = p.goto.bind(p);
        p.goto = async (u, o) => {
          gotos++;
          if (gotos === 2) {
            navigate(c, 'https://seller.example/checkout');
            throw new Error('net::ERR_BLOCKED_BY_CLIENT');
          }
          return goto(u, o);
        };
      },
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'reload:guard-refused:off-allowlist',
      booking: { status: 'skipped', rule: 'reload:guard-refused:off-allowlist' },
    });
  });
  it('a consent refusal during the reload is the page’s stop, never a reload end', async () => {
    let gotos = 0;
    const t = setup({
      ...second(),
      shape: (c) => {
        c.afterGoto = (jar) => {
          gotos++;
          if (gotos === 2) routeOnly(c, 'https://consent.google.com/ml');
          return jar;
        };
      },
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({
      kind: 'blocked',
      page: 'consent-unhandled',
      rule: 'guard-refused:consent-unhandled',
    });
  });
  it('a spacing wait that fails with an error of its own (an unwritable pacer record): read, rule reload:browser-error', async () => {
    const reclaim = vi
      .spyOn(Pacer.prototype, 'reclaim')
      .mockRejectedValueOnce(new Error('EACCES: permission denied'));
    const t = setup(second());
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'reload:browser-error',
      booking: { status: 'skipped', rule: 'reload:browser-error' },
    });
    expect(a.returns?.attempts).toHaveLength(1);
    expect(t.page0().calls.gotos).toHaveLength(1);
    reclaim.mockRestore();
  });
  // why: review M4: a second outbound whose selection failed is no attempt: it is not placed among the 30 (no flight
  // the list kept is dropped for it), and it still counts as untried for triedAll
  it('a failed second selection of an outbound outside the 30: the kept 30 unchanged, triedAll false', async () => {
    const many = Array.from({ length: 29 }, (_, i) => ob(400 + i, { stops: '2 stops' }));
    const DEAR = ob(900);
    const names = [...many, PICK, DEAR];
    const t = setup(
      second(
        {
          loads: [
            { best: [best(names)], cheapest: [cheapest(names)] },
            { best: [best(names)], cheapest: [cheapest(names)] },
          ],
        },
        // why: DEAR's press changes nothing
        {},
      ),
    );
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 2);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'select-outbound:no-activation',
      booking: { status: 'skipped', rule: 'second-selection' },
    });
    expect(t.page0().calls.presses).toContain(`Enter:link:${DEAR}`);
    expect(a.returns?.attempts).toHaveLength(1);
    expect(a.flights).toHaveLength(30);
    expect(a.flights.map((f) => f.amountMinor)).not.toContain(90_000);
    expect(a.flights.map((f) => f.amountMinor)).toContain(42_800);
    expect(a.flights[a.returns?.attempts[0]?.outboundIndex ?? -1]?.amountMinor).toBe(47_800);
    expect(a.returns?.triedAll).toBe(false);
  });
  it('a second selection that fails: read with its rule, one attempt, the booking skipped second-selection (A13)', async () => {
    const t = setup(second({}, { [O520]: { trees: [cheapest()] } }));
    // why: the second outbound's press changes nothing
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 2);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'select-outbound:no-activation',
      booking: { status: 'skipped', rule: 'second-selection' },
    });
    expect(a.returns?.attempts).toHaveLength(1);
  });
});

describe('the phase’s other ends', () => {
  it('no outbound fits: one attempt on the cheapest flight, outboundFits false, no second attempt, the booking of bookingReturnOf’s pick', async () => {
    const t = setup({
      press: {
        [O451]: { trees: [returnTree()], url: RETURN_URL },
        [R1180]: { trees: [bookingTree()], url: BOOKING_URL },
        [MORE]: { trees: [bookingTree(EXPANDED, { more: [] })] },
      },
    });
    const a = flightsOf(
      (await t.session.page({ ...REQ, returnLimits: { ...LIMITS, maxJourneyMinutes: 60 } })).answer,
    );
    expect(a.returns?.attempts).toEqual([expect.objectContaining({ outboundIndex: 0, outboundFits: false })]);
    expect(t.page0().calls.gotos).toHaveLength(1);
    expect(a.returns?.booking).toMatchObject({ status: 'read', attempt: 0, returnIndex: 1 });
  });
  it.each([
    [
      "Google's no-flights line",
      [
        n('document', '', [
          ...(resultsTree().children ?? []).filter((c) => c.role !== 'main' && c.role !== 'text'),
          text('No flights found'),
        ]),
      ],
    ],
    ['every option for another cell', [best([OTHER_DAY])]],
  ])('no-outbound (%s): nothing activated, the booking no-pairing, one page', async (_what, trees) => {
    const t = setup({ loads: [{ best: trees, cheapest: trees.map((x) => x) }] });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns).toEqual({
      limits: LIMITS,
      status: 'no-outbound',
      rule: null,
      attempts: [],
      triedAll: true,
      booking: {
        status: 'no-pairing',
        rule: null,
        attempt: null,
        returnIndex: null,
        expanded: false,
        moreControl: false,
        grouped: 0,
        offers: [],
        unparsed: 0,
        nonGbp: 0,
        offersStated: null,
      },
    });
    expect(t.page0().calls.actions).toEqual([]);
    expect(a.flights).toEqual([]);
    expect(a.pagesLoaded).toBe(1);
  });
  it('a read attempt whose returns are all another cell’s: listed none-for-cell, the booking no-pairing', async () => {
    // why: no further outbound fits (no £520), so no second attempt follows the empty one
    const names = [OTHER_DAY, GIBBERISH, O451, O478S2, PICK];
    const t = setup({
      loads: [{ best: [best(names)], cheapest: [cheapest(names)] }],
      press: { [PICK]: { trees: [returnTree([ob(1100, { on: 'Monday, November 16' })])], url: RETURN_URL } },
    });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.attempts[0]).toMatchObject({ listed: 'none-for-cell', returns: [] });
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: null,
      booking: { status: 'no-pairing', rule: null },
    });
    expect(t.page0().calls.actions).toHaveLength(2);
  });
  it.each([
    ['the Best fallback', { ...VERIFIED }, 'fallback'],
    ['no Cheapest flow (null)', { ...VERIFIED, CHEAPEST_FLOW_VERIFIED: false }, 'none'],
  ] as const)(
    'not the Cheapest view (%s, R-view): nothing activated, skipped not-cheapest-view, the flights intact',
    async (_what, S, how) => {
      const t = setup({
        selectors: S,
        loads: [
          {
            best: [best()],
            // why: a Cheapest view that keeps fetching never settles, so the flow falls back to the list as it stands
            cheapest: how === 'fallback' ? [cheapest(OUT, [text('Fetching results')])] : [cheapest()],
          },
        ],
      });
      const a = flightsOf((await t.session.page(REQ)).answer);
      expect(a.flights).toEqual(FOUR);
      expect(a.returns).toMatchObject({
        status: 'skipped',
        rule: 'not-cheapest-view',
        attempts: [],
        booking: { status: 'skipped', rule: 'not-cheapest-view' },
      });
      expect(t.page0().calls.actions).toEqual([]);
    },
  );
  it('RETURN_SELECT_VERIFIED false: nothing activated, not-verified both, no page counts, the list page’s budget', async () => {
    const t = setup({ selectors: { ...VERIFIED, RETURN_SELECT_VERIFIED: false } });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns).toMatchObject({
      status: 'not-verified',
      rule: null,
      attempts: [],
      booking: { status: 'not-verified' },
    });
    expect('pagesLoaded' in a).toBe(false);
    expect(t.page0().calls.actions).toEqual([]);
  });
  it('BOOKING_SELECT_VERIFIED false alone: the returns read, nothing activated after them, the booking not-verified', async () => {
    const t = setup({ selectors: { ...VERIFIED, BOOKING_SELECT_VERIFIED: false } });
    const a = flightsOf((await t.session.page(REQ)).answer);
    expect(a.returns?.status).toBe('read');
    expect(a.returns?.booking?.status).toBe('not-verified');
    expect(t.page0().calls.actions).toEqual([`focus:link:${PICK}`, `press:Enter:link:${PICK}:focused`]);
    expect(a.versions).toEqual(versions);
  });
  it('booking false: booking null, nothing activated after the returns', async () => {
    const t = setup();
    const a = flightsOf((await t.session.page({ ...REQ, booking: false })).answer);
    expect(a.returns).toMatchObject({ status: 'read', rule: null, booking: null });
    expect(t.page0().calls.actions).toHaveLength(2);
  });
  it('a request without returnLimits: nothing activated, no returns, no pagesLoaded key', async () => {
    const t = setup();
    const { returnLimits: _l, booking: _b, ...plain } = REQ;
    const a = flightsOf((await t.session.page(plain)).answer);
    expect('returns' in a).toBe(false);
    expect('pagesLoaded' in a).toBe(false);
    expect(t.page0().calls.actions).toEqual([]);
  });
});

describe('the reservation (cost-r3-002)', () => {
  it('a main-frame navigation past the request’s 2 pages is aborted (page-reservation), the phase unrecognised', async () => {
    const t = setup({
      shape: (c) => {
        let first = true;
        c.afterGoto = (jar) => {
          if (first) {
            first = false;
            for (let i = 0; i < FLIGHT_LIST_PAGES_PER_PAIR_MAX; i++)
              navigate(c, 'https://www.google.com/travel/flights?q=again');
          }
          return jar;
        };
      },
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, FLIGHT_LIST_PAGES_PER_PAIR_MAX);
    expect(a.returns).toMatchObject({ status: 'unrecognised', rule: 'page-reservation', attempts: [] });
    expect(t.page0().calls.actions).toEqual([]);
    expect(t.seen.guard?.reservation).toBe(2);
  });
  it('a refused first load: blocked with pagesLoaded 0 (R-zero)', async () => {
    const t = setup({ hops: ['https://consent.google.com/ml?continue=x'] });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'consent-unhandled', pagesLoaded: 0 });
  });
  it('answers before any load state pagesLoaded 0: the spacing, a cool-down', async () => {
    const t = setup();
    await t.session.page(REQ);
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'spacing', pagesLoaded: 0 });
    t.clock.advance(60_000);
    t.cooldown.start('captcha', 1);
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'cooling-down', pagesLoaded: 0 });
  });
});

describe('transient ends of the return step (each through the shared helper)', () => {
  const press = (shows: Partial<Record<string, Shows>>): Record<string, Shows> => {
    const out: Record<string, Shows> = {};
    for (const [k, v] of Object.entries(shows)) if (v !== undefined) out[k] = v;
    return out;
  };
  it('the view never changes (Enter changed nothing): not-settled select-outbound:no-activation', async () => {
    const t = setup({ press: {} });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'not-settled',
      rule: 'select-outbound:no-activation',
      attempts: [],
    });
    expect(a.returns?.booking).toMatchObject({ status: 'skipped', rule: 'select-outbound:no-activation' });
  });
  it('the tree changes but lacks the heading: unrecognised not-return-view', async () => {
    const t = setup({
      press: press({ [PICK]: { trees: [returnTree(RETURNS, { heading: null })], url: RETURN_URL } }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'unrecognised', rule: 'not-return-view' });
  });
  it('a changed view with the no-flights line and no link: not-settled, never settled on the line', async () => {
    const t = setup({
      press: press({ [PICK]: { trees: [returnTree([], { noFlights: true })], url: RETURN_URL } }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'not-settled', rule: 'select-outbound:not-settled' });
  });
  it('two links of the pick’s name: select-failed select-outbound:find-outbound, nothing activated', async () => {
    const names = [...OUT, PICK];
    const t = setup({ loads: [{ best: [best(names)], cheapest: [cheapest(names)] }] });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'select-failed', rule: 'select-outbound:find-outbound' });
    expect(t.page0().calls.actions).toEqual([]);
  });
  it('the press never resolves (fake time past CLICK_TIMEOUT_MS): select-failed select-outbound:press-outbound', async () => {
    const hanging = cheapest();
    for (const c of descendants([hanging])) if (c.role === 'link' && c.name === PICK) c.pressHang = true;
    const t = setup({
      loads: [{ best: [best()], cheapest: [hanging] }],
      page: (p) => {
        p.onHang = () => setImmediate(() => t.timers.runOut());
      },
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'select-failed', rule: 'select-outbound:press-outbound' });
  });
  it('the deadline expires during the return view’s listFacts: not-settled select-outbound:list-facts', async () => {
    const view = returnTree();
    // why: fix round 2: listFacts reads the button's name in one page call with no count before it, so the read hangs
    for (const c of descendants([view])) if (c.role === 'button' && c.name === 'Currency GBP') c.hang = true;
    const t = setup({
      press: press({ [PICK]: { trees: [view], url: RETURN_URL } }),
      page: (p) => {
        p.onHang = () => setImmediate(() => t.timers.runOut());
      },
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'not-settled', rule: 'select-outbound:list-facts' });
  });
  // why: review I1: an activation's call that fails with the browser's own error as the step's deadline expires is the
  // deadline's end (not-settled), never the page's not-ready
  it('the press fails with a plain error as the deadline expires: not-settled select-outbound:activate', async () => {
    const t = setup({
      press: press({
        [PICK]: {
          trees: [returnTree()],
          url: RETURN_URL,
          also: () => {
            // why: the selection's own page period (the last 90 s deadline) expires: the press step's shorter
            // deadline ends first, then that one (each fire is synchronous; no time is waited)
            const period = periods.at(-1);
            for (let i = 0; i < 5 && period?.expired() === false; i++) t.timers.runOut();
            expect(period?.expired()).toBe(true);
            throw new Error('Target page, context or browser has been closed');
          },
        },
      }),
    });
    const periods: Deadline[] = [];
    const deadline = t.timers.deadline.bind(t.timers);
    t.timers.deadline = (ms) => {
      const d = deadline(ms);
      if (ms === 90_000) periods.push(d);
      return { ...d, race: (x) => x };
    };
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'not-settled',
      rule: 'select-outbound:activate',
      attempts: [],
    });
  });
  it('the return view in another currency: unrecognised currency', async () => {
    const t = setup({
      press: press({ [PICK]: { trees: [returnTree(RETURNS, { currency: 'USD' })], url: RETURN_URL } }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'unrecognised', rule: 'currency' });
  });
  it('a main-frame navigation during the activation (allowlisted): aborted by the gate, nothing fetched, unrecognised unexpected-navigation (R-worst)', async () => {
    const t = setup({
      press: press({
        [PICK]: { trees: [returnTree()], url: RETURN_URL, also: (_p, c) => navigate(c, BOOKING_URL) },
      }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'unrecognised', rule: 'unexpected-navigation', attempts: [] });
    expect(t.seen.guard?.gateRefusals).toBe(1);
  });
  // why: the route alone (no hop for the classifier to read), so only the guard's record can end the poll
  it.each([
    ['an allowlisted one, held by the gate', BOOKING_URL, 'unexpected-navigation'],
    ['one off the allowlist, refused', 'https://seller.example/checkout', 'guard-refused:off-allowlist'],
  ])(
    'a navigation at a press that changes nothing (%s): the poll ends at once with it, the gate off after',
    async (_what, url, rule) => {
      const t = setup({ press: { [PICK]: { trees: [], also: (_p, c) => routeOnly(c, url) } } });
      const start = t.timers.now();
      const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
      expect(a.returns).toMatchObject({ status: 'unrecognised', rule, attempts: [] });
      // why: the poll that saw the navigation ends the step, never the step's 90 s deadline
      expect(Date.parse(a.fetchedAt) - start).toBeLessThan(90_000);
      expect(t.seen.guard?.activationGate).toBe(false);
    },
  );
  it.each([
    ['the view before the press, read at its deadline', 1, false, 'not-settled', 'select-outbound:pre-read'],
    [
      'the view before the press, read with the browser’s own error',
      1,
      true,
      'unrecognised',
      'select-outbound:browser-error',
    ],
    [
      'a poll after the press, read with the browser’s own error',
      2,
      true,
      'unrecognised',
      'select-outbound:browser-error',
    ],
  ])('%s: the step’s end, the outbound flights kept', async (_what, nth, browser, status, rule) => {
    let reads = 0;
    const t = setup({
      driver: (d) => ({
        ...d,
        readFacts: async (...args: Parameters<Driver['readFacts']>) => {
          if (args[2] === 'returns') {
            reads++;
            if (reads === nth)
              throw browser
                ? new Error('Target page, context or browser has been closed')
                : new DeadlineExceeded();
          }
          return d.readFacts(...args);
        },
      }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.flights).toEqual(FOUR);
    expect(a.returns).toMatchObject({ status, rule, attempts: [] });
  });
  it('a navigation refused while the return view is read: that refusal, never a read attempt (R-refused)', async () => {
    let lists = 0;
    const t = setup({
      driver: (d, c) => ({
        ...d,
        listFacts: async (...args: Parameters<Driver['listFacts']>) => {
          const f = await d.listFacts(...args);
          lists++;
          // why: read 1 is the outbound list's, read 2 the return view's
          if (lists === 2) navigate(c, 'https://seller.example/checkout');
          return f;
        },
      }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'unrecognised',
      rule: 'guard-refused:off-allowlist',
      attempts: [],
    });
    expect(t.page0().calls.actions).toHaveLength(2);
  });
});

describe('a selection that fails as a step (two links of the pick’s name: find-outbound)', () => {
  const twice = [...OUT, PICK];
  const loads = [{ best: [best(twice)], cheapest: [cheapest(twice)] }];
  it('the failed step’s page is classified once, with the gate off', async () => {
    const gates: boolean[] = [];
    const t = setup({
      loads,
      driver: (d) => ({
        ...d,
        readFacts: async (...args: Parameters<Driver['readFacts']>) => {
          if (args[2] === 'returns') gates.push(t.seen.guard?.activationGate ?? true);
          return d.readFacts(...args);
        },
      }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({ status: 'select-failed', rule: 'select-outbound:find-outbound' });
    // the view before the press, then the failed step's one classification
    expect(gates).toEqual([false, false]);
  });
  it('a navigation refused as the selection fails: that refusal, never select-failed', async () => {
    const t = setup({
      loads,
      driver: (d, c) => ({
        ...d,
        clickOutbound: async (...args: Parameters<Driver['clickOutbound']>) => {
          navigate(c, 'https://seller.example/checkout');
          return d.clickOutbound(...args);
        },
      }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'unrecognised',
      rule: 'guard-refused:off-allowlist',
      attempts: [],
    });
  });
  it('the failed step’s classification meeting the deadline: select-failed with the selection’s step, never an error', async () => {
    const periods: Deadline[] = [];
    let reads = 0;
    const t = setup({
      loads,
      driver: (d) => ({
        ...d,
        readFacts: async (...args: Parameters<Driver['readFacts']>) => {
          if (args[2] === 'returns') {
            reads++;
            // why: read 2 is the classification: the selection's page period expires as it starts
            const period = periods.at(-1);
            if (reads === 2) for (let i = 0; i < 10 && period?.expired() === false; i++) t.timers.runOut();
          }
          return d.readFacts(...args);
        },
      }),
    });
    const deadline = t.timers.deadline.bind(t.timers);
    t.timers.deadline = (ms) => {
      const dl = deadline(ms);
      if (ms === 90_000) periods.push(dl);
      return dl;
    };
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(periods.at(-1)?.expired()).toBe(true);
    expect(a.returns).toMatchObject({ status: 'select-failed', rule: 'select-outbound:find-outbound' });
  });
});

describe('transient ends of the booking step (the returns intact, returns read)', () => {
  const withPress = (extra: Record<string, Shows | undefined>): Record<string, Shows> => {
    const out: Record<string, Shows> = { ...DEFAULT_PRESS() };
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) delete out[k];
      else out[k] = v;
    }
    return out;
  };
  const answered = async (t: Setup) => {
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns?.status).toBe('read');
    expect(a.returns?.attempts[0]?.returns).toHaveLength(3);
    return a;
  };
  const booked = async (t: Setup) => (await answered(t)).returns?.booking;
  /** The answer's versions once the offer reader ran: the offer grammar's date stated. */
  const withGrammar = { ...versions, offerGrammar: OFFER_GRAMMAR_VERSION };
  it('the return’s press changes nothing: not-settled select-return:no-activation', async () => {
    const t = setup({ press: withPress({ [R1180]: undefined }) });
    const a = await answered(t);
    expect(a.returns?.booking).toMatchObject({
      status: 'not-settled',
      rule: 'select-return:no-activation',
      attempt: 0,
      returnIndex: 1,
      expanded: false,
      offers: [],
    });
    // why: no booking view was read, so the offer reader never ran
    expect(a.versions).toEqual(versions);
  });
  it.each([
    [1, 'the booking view’s read', 'not-settled', 'select-return:booking-facts', 4],
    [2, 'the read after the expansion', 'expand-failed', 'select-more-options:booking-facts', 6],
  ])('booking read %i (%s) at its deadline: %s %s', async (at, _what, status, rule, actions) => {
    let reads = 0;
    const t = setup({
      driver: (d) => ({
        ...d,
        bookingFacts: async (dl) => {
          reads++;
          if (reads === at) throw new DeadlineExceeded();
          return d.bookingFacts(dl);
        },
      }),
    });
    expect(await booked(t)).toMatchObject({ status, rule, expanded: false });
    expect(t.page0().calls.actions).toHaveLength(actions);
  });
  it.each([
    ['off the booking path', { trees: [bookingTree()], url: RETURN_URL }],
    ['with an outbound link', { trees: [bookingTree(INITIAL, { outbound: [O451] })], url: BOOKING_URL }],
  ])('a changed view %s: unrecognised not-booking-view', async (_what, shows) => {
    const t = setup({ press: withPress({ [R1180]: shows }) });
    expect(await booked(t)).toMatchObject({ status: 'unrecognised', rule: 'not-booking-view', offers: [] });
  });
  // why: the controller's ruling of 2026-11-02: the view is recognised without the price-comparison note
  it.each(['none', 'typical'] as const)(
    'the booking view with the note %s: read, every offer',
    async (note) => {
      const t = setup({
        press: withPress({
          [R1180]: { trees: [bookingTree(INITIAL, { more: [], note })], url: BOOKING_URL },
        }),
      });
      expect(await booked(t)).toMatchObject({ status: 'read', rule: null, expanded: false });
    },
  );
  // why: review M1 (ruled): the URL moving to the booking path is the activation's change, so a booking view without
  // an offer changed, and never settles (the booking settle needs an offer): it ends at its deadline as not-settled
  it('a view without an offer: not-settled select-return:not-settled, never unrecognised', async () => {
    const t = setup({ press: withPress({ [R1180]: { trees: [bookingTree([])], url: BOOKING_URL } }) });
    expect(await booked(t)).toMatchObject({ status: 'not-settled', rule: 'select-return:not-settled' });
  });
  it('two links of the return’s name: select-failed select-return:find-return', async () => {
    const t = setup({
      press: withPress({ [PICK]: { trees: [returnTree([...RETURNS, R1180])], url: RETURN_URL } }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns?.booking).toMatchObject({ status: 'select-failed', rule: 'select-return:find-return' });
  });
  it('the expansion control absent: read, expanded false, the offers read before it', async () => {
    const t = setup({
      press: withPress({ [R1180]: { trees: [bookingTree(INITIAL, { more: [] })], url: BOOKING_URL } }),
    });
    const a = await answered(t);
    expect(a.returns?.booking).toMatchObject({
      status: 'read',
      rule: null,
      expanded: false,
      moreControl: false,
      offers: [
        { seller: 'QQ Fares', fare: 'Economy Basic', priceMinor: 119_500 },
        { seller: 'QQ Travel', fare: null, priceMinor: 121_000 },
      ],
    });
    expect(a.versions).toEqual(withGrammar);
    expect(t.page0().calls.actions).toHaveLength(4);
  });
  it('two or more expansion controls: unrecognised more-options-count, nothing pressed, no offer kept (A9)', async () => {
    const t = setup({
      press: withPress({
        [R1180]: {
          trees: [bookingTree(INITIAL, { more: [MORE, '3 more booking options'] })],
          url: BOOKING_URL,
        },
      }),
    });
    // why: review M2: the end keeps no offer (A9), but its counts as read
    const a = await answered(t);
    expect(a.versions).toEqual(withGrammar);
    expect(a.returns?.booking).toMatchObject({
      status: 'unrecognised',
      rule: 'more-options-count',
      expanded: false,
      offers: [],
      offersStated: null,
      grouped: 1,
      moreControl: true,
      unparsed: 0,
      nonGbp: 0,
    });
    expect(t.page0().calls.actions).toHaveLength(4);
  });
  it('the expansion’s press changes nothing: expand-failed select-more-options:no-activation, the offers read before it kept', async () => {
    const t = setup({ press: withPress({ [MORE]: undefined }) });
    const b = await booked(t);
    expect(b).toMatchObject({
      status: 'expand-failed',
      rule: 'select-more-options:no-activation',
      expanded: false,
      moreControl: true,
      grouped: 1,
    });
    expect(b?.offers.map((o) => o.priceMinor)).toEqual([119_500, 121_000]);
  });
  it('the expansion’s settle runs out after a change: expand-failed select-more-options:not-settled', async () => {
    const fetchingView = bookingTree(EXPANDED, { more: [] });
    fetchingView.children?.push(text('Fetching results'));
    const t = setup({ press: withPress({ [MORE]: { trees: [fetchingView] } }) });
    expect(await booked(t)).toMatchObject({
      status: 'expand-failed',
      rule: 'select-more-options:not-settled',
      expanded: false,
    });
  });
  it.each([R1180, MORE])(
    'a navigation during the activation of %s: unrecognised unexpected-navigation, nothing loaded',
    async (name) => {
      const base = DEFAULT_PRESS()[name];
      const t = setup({
        press: withPress({
          [name]: {
            trees: base?.trees ?? [],
            ...(base?.url === undefined ? {} : { url: base.url }),
            also: (_p, c) => navigate(c, BOOKING_URL),
          },
        }),
      });
      const a = await answered(t);
      const b = a.returns?.booking;
      expect(b).toMatchObject({
        status: 'unrecognised',
        rule: 'unexpected-navigation',
        expanded: false,
        offers: [],
      });
      // why: review M2: the expansion's end keeps the counts of the view read before it; the return's read none
      expect([b?.grouped, b?.moreControl]).toEqual(name === MORE ? [1, true] : [0, false]);
      // the offer reader ran on the booking view before the expansion; never before the return's view was read
      expect(a.versions).toEqual(name === MORE ? withGrammar : versions);
    },
  );
  // why: review M3: a seller's navigation refused between the booking view's settle and its read ends the read with
  // that refusal (never a `read` booking over a page the guard refused), before and after the expansion
  it.each([
    [1, 'the first read', 4, false],
    [2, 'the read after the expansion', 6, true],
  ])(
    'a navigation refused during booking read %i (%s): unrecognised guard-refused:off-allowlist',
    async (at, _what, actions, grammar) => {
      let reads = 0;
      const t = setup({
        driver: (d, c) => ({
          ...d,
          bookingFacts: async (dl) => {
            const f = await d.bookingFacts(dl);
            reads++;
            if (reads === at) navigate(c, 'https://seller.example/checkout');
            return f;
          },
        }),
      });
      const a = await answered(t);
      expect(a.returns?.booking).toMatchObject({
        status: 'unrecognised',
        rule: 'guard-refused:off-allowlist',
        offers: [],
      });
      // the offer grammar is stated only once the offer reader ran (after the first read, before the expansion)
      expect(a.versions).toEqual(grammar ? withGrammar : versions);
      expect(t.page0().calls.actions).toHaveLength(actions);
      expect(t.cooldown.active()).toBeNull();
    },
  );
  it('an offer in another currency before the expansion: unrecognised currency, nothing pressed after', async () => {
    const t = setup({
      press: withPress({
        [R1180]: {
          trees: [bookingTree([...INITIAL, offer('QQ Air', '900', undefined, 'Euros')])],
          url: BOOKING_URL,
        },
      }),
    });
    const a = await answered(t);
    expect(a.versions).toEqual(withGrammar);
    expect(a.returns?.booking).toMatchObject({
      status: 'unrecognised',
      rule: 'currency',
      offers: [],
      nonGbp: 1,
      unparsed: 0,
      grouped: 1,
      moreControl: true,
      expanded: false,
    });
    expect(t.page0().calls.actions).toHaveLength(4);
  });
  it('an offer in another currency: unrecognised currency (prov-int-r3-008)', async () => {
    const t = setup({
      press: withPress({
        [MORE]: {
          trees: [
            bookingTree([...EXPANDED, offer('QQ Air', '1,000', undefined, 'US dollars')], { more: [] }),
          ],
        },
      }),
    });
    const a = await answered(t);
    expect(a.versions).toEqual(withGrammar);
    expect(a.returns?.booking).toMatchObject({
      status: 'unrecognised',
      rule: 'currency',
      offers: [],
      nonGbp: 1,
      moreControl: false,
      expanded: true,
    });
  });
  // why: review M2: a view whose every offer the grammar refused keeps the count of what it refused
  const REFUSED = [
    offer('QQ Travel', '1,180', undefined, 'Galleons'),
    offer('QQ Fares', '1,195', undefined, 'Sickles'),
  ];
  it('every offer refused, no expansion control: unrecognised no-offers-read, the refused counted', async () => {
    const t = setup({
      press: withPress({ [R1180]: { trees: [bookingTree(REFUSED, { more: [] })], url: BOOKING_URL } }),
    });
    expect(await booked(t)).toMatchObject({
      status: 'unrecognised',
      rule: 'no-offers-read',
      offers: [],
      unparsed: 2,
      nonGbp: 0,
      grouped: 1,
      expanded: false,
    });
  });
  it('every offer refused after the expansion: unrecognised no-offers-read, expanded, the refused counted', async () => {
    const t = setup({
      press: withPress({ [MORE]: { trees: [bookingTree([...REFUSED, REFUSED[0] ?? ''], { more: [] })] } }),
    });
    expect(await booked(t)).toMatchObject({
      status: 'unrecognised',
      rule: 'no-offers-read',
      offers: [],
      unparsed: 3,
      expanded: true,
    });
  });
  it('every initial offer refused and the expansion failing: unrecognised no-offers-read, the refused counted', async () => {
    const t = setup({
      press: withPress({ [R1180]: { trees: [bookingTree(REFUSED)], url: BOOKING_URL }, [MORE]: undefined }),
    });
    expect(await booked(t)).toMatchObject({
      status: 'unrecognised',
      rule: 'no-offers-read',
      offers: [],
      unparsed: 2,
      moreControl: true,
      expanded: false,
    });
  });
});

describe('genuine blocks after an activation are the page’s stop (as on a Best-view poll)', () => {
  const blocks: Array<[string, FakeNode, string, string]> = [
    ['captcha', n('document', '', [text('please show you are not a robot')]), 'captcha', 'challenge-text'],
    ['sign-in heading', n('document', '', [n('heading', 'Sign in')]), 'sign-in', 'sign-in-heading'],
    [
      'account control',
      n('document', '', [n('button', 'Google Account: QQ')]),
      'signed-in',
      'account-control',
    ],
    [
      'unusual traffic',
      n('document', '', [text('unusual traffic from your network')]),
      'unusual-traffic',
      'unusual-traffic-text',
    ],
  ];
  for (const name of [PICK, R1180, MORE])
    it.each(blocks)(`after the activation of ${name.slice(0, 18)}…: %s`, async (_what, tree, page, rule) => {
      const t = setup({ press: { ...DEFAULT_PRESS(), [name]: { trees: [tree] } } });
      const r = await t.session.page(REQ);
      expect(r.answer).toMatchObject({ kind: 'blocked', page, rule, pagesLoaded: 1 });
      expect(t.cooldown.active()?.cause).toBe(page);
    });
  it('a consent host after an activation (a hop, no request) is consent-unhandled with its cool-down and wipe', async () => {
    const t = setup({
      press: {
        ...DEFAULT_PRESS(),
        [PICK]: {
          trees: [returnTree()],
          also: (p) =>
            p.emitFrameNavigated({ url: () => 'https://consent.google.com/ml', parentFrame: () => null }),
        },
      },
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({
      kind: 'blocked',
      page: 'consent-unhandled',
      rule: 'consent-host',
      pagesLoaded: 1,
    });
    expect(existsSync(t.profileDir)).toBe(false);
  });
});

describe('a refusal or a block the phase meets before or around an activation', () => {
  it('a consent refusal during the outbound read (no hop) is the page’s stop when the phase starts', async () => {
    const t = setup({
      shape: (c) => {
        let first = true;
        c.afterGoto = (jar) => {
          if (first) {
            first = false;
            // why: the route alone, no request event: the refusal is the guard's only record of it
            void c.routeRequest({
              url: () => 'https://consent.google.com/ml',
              method: () => 'GET',
              isNavigationRequest: () => true,
              redirectedFrom: () => null,
              frame: () => ({ url: () => '', parentFrame: () => null }),
            });
          }
          return jar;
        };
      },
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({
      kind: 'blocked',
      page: 'consent-unhandled',
      rule: 'guard-refused:consent-unhandled',
    });
    expect(t.page0().calls.actions).toEqual([]);
  });
  it('a press that never resolves on a page that turned into a challenge: the failed step is classified, the stop its cool-down', async () => {
    const hanging = cheapest();
    for (const c of descendants([hanging])) if (c.role === 'link' && c.name === PICK) c.pressHang = true;
    const t = setup({
      loads: [{ best: [best()], cheapest: [hanging] }],
      page: (p) => {
        p.onHang = () => {
          p.setTrees([n('document', '', [text('please show you are not a robot')])]);
          setImmediate(() => t.timers.runOut());
        };
      },
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({
      kind: 'blocked',
      page: 'captcha',
      rule: 'challenge-text',
      pagesLoaded: 1,
    });
  });
});

describe('the guard after an activation (R-refused: the refusal read before classifying)', () => {
  it.each([
    ['a seller’s host', 'https://www.example-airline.test/book'],
    ['a non-flights path on the allowlisted host', 'https://www.google.com/travel/clk/f?u=x'],
  ])(
    '%s: aborted, nothing fetched, unrecognised guard-refused:off-allowlist, no cool-down (sec-002)',
    async (_what, url) => {
      const t = setup({
        press: { ...DEFAULT_PRESS(), [PICK]: { trees: [returnTree()], also: (_p, c) => navigate(c, url) } },
      });
      const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
      expect(a.returns).toMatchObject({ status: 'unrecognised', rule: 'guard-refused:off-allowlist' });
      expect(t.seen.guard?.documentLoads).toBe(1);
    },
  );
  it.each([
    ['consent-unhandled', 'https://consent.google.com/ml'],
    ['sign-in', 'https://accounts.google.com/ServiceLogin'],
  ] as const)('a refusal of kind %s is the page’s stop with its cool-down', async (page, url) => {
    const t = setup({
      press: {
        ...DEFAULT_PRESS(),
        [R1180]: { trees: [bookingTree()], url: BOOKING_URL, also: (_p, c) => navigate(c, url) },
      },
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({ kind: 'blocked', page, rule: `guard-refused:${page}`, pagesLoaded: 1 });
    expect(t.cooldown.active()?.cause).toBe(page);
    if (page === 'consent-unhandled') expect(existsSync(t.profileDir)).toBe(false);
  });
});

// Final review A-M1: the browser's own error inside a step (not a deadline end, not a guard refusal) ends that step
// with its transient status and the rule `<step>:browser-error`; the outbound read and every return read before it are
// kept in a flights answer, never a whole-answer browser-error.
describe('a browser error inside the return phase keeps what was read (final review A-M1)', () => {
  const CLOSED = 'Target page, context or browser has been closed';
  /** A driver whose `method` throws the browser's error on its `nth` call (1-based); every other call passes. */
  const failing =
    (method: 'listFacts' | 'bookingFacts', nth: number, message = CLOSED) =>
    (d: Driver): Driver => {
      let calls = 0;
      const real = d[method].bind(d);
      const wrapped: Driver[typeof method] = async (...args: Parameters<Driver[typeof method]>) => {
        calls++;
        if (calls === nth) throw new Error(message);
        // why: the real reader, untouched, for every other call
        return Reflect.apply(real, d, args);
      };
      return { ...d, [method]: wrapped };
    };
  it('the return view’s read fails: unrecognised select-outbound:browser-error, the outbound flights kept', async () => {
    // why: listFacts call 1 is the outbound read, call 2 the return view's
    const t = setup({ driver: failing('listFacts', 2) });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.flights).toEqual(FOUR);
    expect(a.returns).toMatchObject({
      status: 'unrecognised',
      rule: 'select-outbound:browser-error',
      attempts: [],
      booking: { status: 'skipped', rule: 'select-outbound:browser-error' },
    });
  });
  it('the failed step and the error’s text logged at warn, without a URL’s query, cut to 200 characters', async () => {
    const long = `${CLOSED} while reading https://www.google.com/travel/flights/search?tfs=r ${'x'.repeat(300)}`;
    const t = setup({ driver: failing('listFacts', 2, long) });
    expectTransient(t, (await t.session.page(REQ)).answer, 1);
    const line = t.log.lines.find((l) => l.msg === 'return phase step failed in the browser');
    expect(line).toMatchObject({ level: 'warn', o: { flow: 'select-outbound' } });
    const o = line?.o ?? {};
    expect(Object.keys(o).sort()).toEqual(['error', 'flow']);
    const error = 'error' in o ? String(o.error) : '';
    expect(error).toHaveLength(200);
    expect(error.startsWith(`${CLOSED} while reading `)).toBe(true);
    expect(error).not.toContain('tfs=');
  });
  it('a browser error after a navigation the guard refused is that refusal: unrecognised guard-refused:off-allowlist', async () => {
    let lists = 0;
    const t = setup({
      driver: (d, c) => ({
        ...d,
        listFacts: async (...args: Parameters<Driver['listFacts']>) => {
          lists++;
          if (lists === 2) {
            navigate(c, 'https://seller.example/checkout');
            throw new Error(CLOSED);
          }
          return d.listFacts(...args);
        },
      }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'unrecognised',
      rule: 'guard-refused:off-allowlist',
      attempts: [],
    });
    expect(t.log.lines.some((l) => l.msg === 'return phase step failed in the browser')).toBe(false);
  });
  it('the selection’s press fails with the browser’s own error: unrecognised select-outbound:browser-error', async () => {
    const t = setup({
      driver: (d) => ({
        ...d,
        clickOutbound: async () => {
          throw new Error(CLOSED);
        },
      }),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns).toMatchObject({
      status: 'unrecognised',
      rule: 'select-outbound:browser-error',
      attempts: [],
    });
  });
  it('the second selection’s return view read fails: read, rule select-outbound:browser-error, the booking skipped second-selection', async () => {
    const t = setup({
      press: {
        [PICK]: { trees: [returnTree([rt('1,300', { stops: '2 stops' })])], url: RETURN_URL },
        [O520]: { trees: [returnTree()], url: RETURN_URL },
      },
      // why: read 4 is the second selection's return view (1 the list, 2 the first return view, 3 the reloaded list)
      driver: failing('listFacts', 4),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 2);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'select-outbound:browser-error',
      booking: { status: 'skipped', rule: 'second-selection' },
    });
    expect(a.returns?.attempts).toHaveLength(1);
  });
  it('the reload’s read fails: read, rule reload:browser-error, attempt 0’s returns kept, the booking skipped', async () => {
    const R2S1 = rt('1,300', { stops: '2 stops' });
    const t = setup({
      press: {
        [PICK]: { trees: [returnTree([R2S1])], url: RETURN_URL },
        [R2S1]: { trees: [bookingTree()], url: BOOKING_URL },
      },
      // why: call 3 is the reloaded list page's read
      driver: failing('listFacts', 3),
    });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 2);
    expect(a.returns).toMatchObject({
      status: 'read',
      rule: 'reload:browser-error',
      booking: { status: 'skipped', rule: 'reload:browser-error' },
    });
    expect(a.returns?.attempts).toHaveLength(1);
    expect(a.returns?.attempts[0]?.returns).toHaveLength(1);
  });
  it('the booking view’s read fails: the returns read, the booking unrecognised select-return:browser-error', async () => {
    const t = setup({ driver: failing('bookingFacts', 1) });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns?.status).toBe('read');
    expect(a.returns?.attempts[0]?.returns).toHaveLength(3);
    expect(a.returns?.booking).toMatchObject({
      status: 'unrecognised',
      rule: 'select-return:browser-error',
      attempt: 0,
      returnIndex: 1,
      offers: [],
    });
  });
  it('the read after the expansion fails: expand-failed select-more-options:browser-error, the offers before it kept', async () => {
    const t = setup({ driver: failing('bookingFacts', 2) });
    const a = expectTransient(t, (await t.session.page(REQ)).answer, 1);
    expect(a.returns?.booking).toMatchObject({
      status: 'expand-failed',
      rule: 'select-more-options:browser-error',
      expanded: false,
    });
    expect(a.returns?.booking?.offers.map((o) => o.priceMinor)).toEqual([119_500, 121_000]);
    expect(a.versions.offerGrammar).toBe(OFFER_GRAMMAR_VERSION);
  });
});

describe('budgets (spec rev 56 §2: the page budget, the admission, the spacing before the reload only)', () => {
  it('the page budget is the literal 750,000 ms for a booking read, 570,000 without, 180,000 without returnLimits', () => {
    const { returnLimits: _l, booking: _b, ...plain } = REQ;
    expect(pageCapMs(REQ, VERIFIED, 90_000, 30_000)).toBe(750_000);
    expect(pageCapMs({ ...REQ, booking: false }, VERIFIED, 90_000, 30_000)).toBe(570_000);
    expect(pageCapMs(plain, VERIFIED, 90_000, 30_000)).toBe(180_000);
    expect(pageCapMs(REQ, { ...VERIFIED, RETURN_SELECT_VERIFIED: false }, 90_000, 30_000)).toBe(180_000);
    expect(pageCapMs(REQ, { ...VERIFIED, BOOKING_SELECT_VERIFIED: false }, 90_000, 30_000)).toBe(570_000);
  });
  // why: final review A-I1: a request arriving during a return phase waits for the phase's whole cap (750 s) and the
  // page's bounded close, not one spacing
  it('a request while a return phase is in flight is answered spacing for the rest of its 750 s cap and its close', async () => {
    const t = setup();
    const first = t.session.page(REQ);
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'spacing', retryAfterSeconds: 760 });
    await first;
  });
  it('the reservation is the literal 2 (core’s FLIGHT_LIST_PAGES_PER_PAIR_MAX)', async () => {
    const t = setup();
    await t.session.page(REQ);
    expect(t.seen.guard?.reservation).toBe(2);
    expect(FLIGHT_LIST_PAGES_PER_PAIR_MAX).toBe(2);
  });
  it('no spacing wait precedes an activation: only the reload is spaced', async () => {
    const reclaim = vi.spyOn(Pacer.prototype, 'reclaim');
    const t = setup();
    await t.session.page(REQ);
    expect(reclaim).not.toHaveBeenCalled();
    // every sleep is a 2 s poll, or the read-back's and the close's 5 s bounds
    expect(t.timers.sleeps.every((x) => x === 2000 || x === 5000)).toBe(true);
    const s = setup({
      press: {
        [PICK]: { trees: [returnTree([rt('1,300', { stops: '2 stops' })])], url: RETURN_URL },
        [O520]: { trees: [returnTree()], url: RETURN_URL },
        [R1180]: { trees: [bookingTree()], url: BOOKING_URL },
        [MORE]: { trees: [bookingTree(EXPANDED, { more: [] })] },
      },
    });
    await s.session.page(REQ);
    expect(reclaim).toHaveBeenCalledTimes(1);
    reclaim.mockRestore();
  });
});

// why: the event-driven helpers above wait on promises; this flushes nothing but satisfies the shared import
void flush;

describe('the phase’s pure helpers', () => {
  const f = (pounds: number) => flight(pounds);
  it('flightsWithPicks: a pick already kept changes nothing; one outside replaces the dearest non-pick, ties the later', () => {
    const parsed = [f(500), f(400), f(500), f(300)].map((flight) => ({ flight }));
    const kept = parsed.map((p) => p.flight);
    expect(flightsWithPicks(parsed, kept, [1]).flights).toEqual(kept);
    // a full list (30): build 31 parsed, the 30 cheapest kept, the 31st (dearest) picked
    const many = Array.from({ length: 31 }, (_, i) => ({
      flight: f(i === 30 ? 999 : i === 29 || i === 5 ? 800 : 100 + i),
    }));
    const keep30 = many.slice(0, 30).map((p) => p.flight);
    const r = flightsWithPicks(many, keep30, [30]);
    expect(r.flights).toHaveLength(30);
    // the two £800 flights tie as the dearest: the later in page order (29) is dropped
    expect(r.flights).toContain(many[5]?.flight);
    expect(r.flights).not.toContain(many[29]?.flight);
    expect(r.indexOf(30)).toBe(29);
    expect(r.indexOf(5)).toBe(5);
    // never a pick dropped: with the later £800 picked, the other £800 (the dearest non-pick) goes
    const both = flightsWithPicks(many, keep30, [29, 30]);
    expect(both.flights).toContain(many[29]?.flight);
    expect(both.flights).not.toContain(many[5]?.flight);
    // a short list takes the pick without dropping any
    expect(flightsWithPicks(parsed, kept.slice(0, 2), [3]).flights).toHaveLength(3);
  });
  it('flightsWithPicks: a pick outside a full list drops the dearest non-pick wherever it sits, never growing the list', () => {
    // 31 read; the dearest (index 1, £999) left out of the 30 kept and picked: the dearest kept flight (£800) goes
    const many = Array.from({ length: 31 }, (_, i) => ({
      flight: f(i === 1 ? 999 : i === 7 ? 800 : 100 + i),
    }));
    const r = flightsWithPicks(
      many,
      many.filter((_, i) => i !== 1).map((p) => p.flight),
      [1],
    );
    expect(r.flights).toHaveLength(30);
    expect(r.flights).not.toContain(many[7]?.flight);
    expect(r.indexOf(1)).toBe(1);
    // the dearest kept flight first in page order (index 0) is the one dropped
    const first = Array.from({ length: 31 }, (_, i) => ({
      flight: f(i === 0 ? 800 : i === 30 ? 999 : 100 + i),
    }));
    const r0 = flightsWithPicks(
      first,
      first.slice(0, 30).map((p) => p.flight),
      [30],
    );
    expect(r0.flights).toEqual(first.slice(1).map((p) => p.flight));
  });
  it('flightsWithPicks: the flights in page order, a pick before the kept flights placed first; an index no flight has never placed', () => {
    const parsed = [f(900), f(400), f(500), f(300)].map((flight) => ({ flight }));
    const kept = parsed.slice(1).map((p) => p.flight);
    const r = flightsWithPicks(parsed, kept, [0]);
    expect(r.flights).toEqual(parsed.map((p) => p.flight));
    expect([0, 1, 2, 3].map((i) => r.indexOf(i))).toEqual([0, 1, 2, 3]);
    expect(flightsWithPicks(parsed, kept, [9]).flights).toEqual(kept);
  });
  it('returnPhase: no outbound unless the read lists flights and parsed one; nothing activated, the kept flights as they are', async () => {
    const timers = fakeTimers();
    const page = new FakePage(null);
    const guard: GuardState = {
      hops: [],
      frameUrls: [],
      refused: null,
      documentLoads: 1,
      documentStarts: 1,
      activationGate: false,
      gateRefusals: 0,
      reservation: 2,
      held: null,
    };
    const run = (outbound: FlightsRead) =>
      returnPhase({
        driver: createDriver(page, guard, VERIFIED),
        guard,
        budget: pageBudget(timers, 90_000, timers.now()),
        pacer: { reclaim: async () => undefined, spacingMs: 30_000 },
        url: URL0,
        req: REQ,
        outbound,
        view: 'cheapest',
        S: VERIFIED,
        timers,
        log: memoryLog(),
        pollMs: 2000,
        startedAt: timers.now(),
        pageTimeoutMs: 90_000,
      });
    const kept = f(478);
    const none = (triedAll: boolean) => ({
      limits: LIMITS,
      status: 'no-outbound',
      rule: null,
      attempts: [],
      triedAll,
      booking: expect.objectContaining({ status: 'no-pairing', rule: null, attempt: null }),
    });
    // a read listing flights with none parsed, and one with a flight parsed but none listed for the cell
    expect(await run({ ...emptyRead(), flights: [kept] })).toEqual({
      returns: none(true),
      flights: [kept],
      offerGrammar: null,
    });
    expect(
      await run({ ...emptyRead(), listed: 'none-for-cell', parsed: [{ flight: kept, name: PICK }] }),
    ).toEqual({ returns: none(false), flights: [], offerGrammar: null });
    expect(page.calls.actions).toEqual([]);
  });
  it('unverifiedReturns: not-verified, no attempt, the booking not-verified or null, triedAll by the limits', () => {
    const outbound = { ...emptyRead(), parsed: [{ flight: f(400), name: 'x' }] };
    const r = unverifiedReturns(REQ, outbound);
    expect(r).toEqual({
      limits: LIMITS,
      status: 'not-verified',
      rule: null,
      attempts: [],
      triedAll: false,
      booking: expect.objectContaining({ status: 'not-verified', rule: null, offers: [] }),
    });
    expect(unverifiedReturns({ ...REQ, booking: false }, outbound).booking).toBeNull();
    expect(unverifiedReturns({ ...REQ, returnLimits: { ...LIMITS, maxStops: 0 } }, outbound).triedAll).toBe(
      true,
    );
    expect(unverifiedReturns(REQ, null).triedAll).toBe(true);
  });
  it('refusalOf: consent and sign-in stop the page, other refusals and held navigations are unrecognised, none is null', () => {
    expect(refusalOf({ refused: 'consent-unhandled', held: null })).toEqual({
      kind: 'stop',
      page: 'consent-unhandled',
      rule: 'guard-refused:consent-unhandled',
    });
    expect(refusalOf({ refused: 'sign-in', held: 'page-reservation' })).toMatchObject({
      kind: 'stop',
      page: 'sign-in',
    });
    expect(refusalOf({ refused: 'off-allowlist', held: 'unexpected-navigation' })).toEqual({
      kind: 'end',
      status: 'unrecognised',
      rule: 'guard-refused:off-allowlist',
    });
    expect(refusalOf({ refused: null, held: 'page-reservation' })).toEqual({
      kind: 'end',
      status: 'unrecognised',
      rule: 'page-reservation',
    });
    expect(refusalOf({ refused: null, held: null })).toBeNull();
  });
});

/** A flights read with nothing in it but what a helper test sets. */
function emptyRead(): FlightsRead {
  return {
    minMinor: null,
    tabMinor: null,
    optionsUnparsed: 0,
    optionsOtherCell: 0,
    parsedForThisCell: 0,
    resultsStated: null,
    resultsSeen: 0,
    currency: 'GBP',
    pointOfSale: 'GB',
    listed: 'flights',
    flights: [],
    names: [],
    parsed: [],
    rejected: [],
  };
}
