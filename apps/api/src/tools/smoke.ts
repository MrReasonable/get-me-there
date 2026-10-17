/**
 * `pnpm smoke:live` and `POST /api/tools/smoke` (spec §9 item 7, §10, §13; plan "Wiring and bootstraps", decisions 20,
 * 23, 27, 29, 34, 35, 39, 44, 61, 62, 65, 66). One small, ledgered run against the operator's real keys: one discovery
 * tile per configured provider (a query sized so `plan()` yields one tile each), then one SearchApi itinerary chain for
 * the cheapest SearchApi cell, through the real adapters, a dedicated http-kit with no response cache (the vendor must
 * answer today) and the production SqliteBudgetGuard. Spend follows the recording rules through the same helpers
 * (`toolExecution.ts`): the worst case is stated up front, `spendPosition`'s window and cross-run checks refuse with 65
 * before any request, and the hidden tool execution freezes min(--budget, worst case) as its cap, so the guard refuses
 * any reservation beyond it before the fetch. `--dry-run` prints the plan and the spend position and sends nothing.
 * The result is a checklist (`smokeChecks.ts`) the operator reads beside the vendors' own pages.
 *
 * Fixtures: a command-line run writes dated recordings beside the database (`<data dir>/smoke/fixtures/recorded`),
 * never into the repository's recorded tree (decision 61); a run inside the app process (the route) writes none and
 * says so.
 */
import { mkdirSync } from 'node:fs';
import { relative } from 'node:path';
import {
  AbortedError,
  BudgetExceeded,
  type CellKey,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  daysBetween,
  effectiveAge,
  type FlightProvider,
  formatAgeFull,
  formatPence,
  type IsoDateTime,
  type ItineraryQuery,
  type ItinerarySearchResult,
  NormalisationError,
  normaliseOffer,
  type Provenance,
  ProviderError,
  priceInGbp,
  type RawOffer,
  type ResponseCache,
  type TilePlan,
} from '@gmt/core';
import { createHttpKit, createRecorder, type HttpKit, type HttpKitDeps } from '@gmt/providers';
import { safeMessage } from '../safeMessage.js';
import { httpLimitsFor, type Ports, providersFor } from '../wiring.js';
import { SMOKE_CABIN, SMOKE_EXPAND_TOP, type SmokeCli, smokeQuery, smokeWorstCase } from './smokeArgs.js';
import { type Answer, checklist, openJawOnly, type Seen, type SmokeCheck } from './smokeChecks.js';
import {
  openHiddenExecution,
  spendPosition,
  toolEstimate,
  tracking,
  type WorstCase,
} from './toolExecution.js';
import { EXIT, type ToolContext } from './types.js';

export type { SmokeCheck } from './smokeChecks.js';

/** The decision-44 label for an offer the final step did not confirm. */
export const NOT_CONFIRMED = 'price not confirmed by the final step';

// why: provider identifiers in a fixed order, never airports; the free provider first, so a broken setup is learned
// before any credit is spent: a setup failure there skips SearchApi entirely (plan decision 23 orders the record
// tool's probes the same way; cost review M1).
export const VENDORS = ['travelpayouts', 'searchapi'] as const;
export type Vendor = (typeof VENDORS)[number];
// why: a cache hit is not a call; the smoke must show that the vendor answers today (spec §9 item 7).
const NO_CACHE: ResponseCache = { get: () => undefined, set: () => undefined };
/** The cheapest price one source returned, in pence, with the provenance the adapter declares for it. */
export interface SmokePrice {
  pricePence: number;
  cell: CellKey;
  nights: number;
  /** The source, and for an itinerary offer its seller wording (decision 44: only a confirmed price is "sold by"). */
  displayName: string;
  provenance: Provenance;
  /** False for an itinerary offer the final step did not confirm; true for a confirmed offer; calendar prices: null. */
  confirmed: boolean | null;
  /**
   * The cheapest of the rows read, not of the tile (decision 30): the tile stopped at its page cap, or a covered cell had
   * rows the adapter could not use for another reason than an open-jaw drop (provenance review, fix round 1).
   */
  truncated: boolean;
  /**
   * pft-005: an itinerary offer's time each way and stops, from core's normaliseOffer (the engine's own step), so the
   * headline never hides a 41-hour fare; null for a calendar price, which states neither, or when it could not be computed.
   */
  journey: { outboundMinutes: number; inboundMinutes: number; stopsOut: number; stopsIn: number } | null;
}
export interface SmokeProviderReport {
  providerId: Vendor;
  stage: 'discovery' | 'itinerary';
  status: 'priced' | 'empty' | 'error' | 'skipped';
  prices: number;
  cheapest: SmokePrice | null;
  /** Itinerary only: the cheapest offer a seller listing confirmed (the summary's headline, decision 66). */
  cheapestConfirmed: SmokePrice | null;
  detail: string;
}
export interface SmokeResult {
  exitCode: number;
  summary: string;
  lines: string[];
  checks: SmokeCheck[];
  reports: SmokeProviderReport[];
  /** Paths relative to the fixture root; always empty for a run inside the app process or a dry run. */
  fixturesWritten: string[];
  executionId: string | null;
}

/** The hidden tool execution: the run's space, min(--budget, worst case) as its cap, and its stored estimate. */
function openSmokeExecution(ports: Ports, q: DiscoveryQuery, worst: WorstCase, budget: number): string {
  const tp = ports.config.providers.travelpayouts !== null;
  const sa = ports.config.providers.searchapi !== null;
  const chainCalls = 1 + 2 * SMOKE_EXPAND_TOP;
  return openHiddenExecution(ports, {
    tool: 'smoke:live',
    origins: [q.origin],
    destinations: [q.destination],
    from: q.departureFrom,
    to: q.departureTo,
    minNights: q.minNights,
    maxNights: q.maxNights,
    cabin: q.cabin,
    expandTop: SMOKE_EXPAND_TOP,
    budget,
    worst,
    maxFreeCalls: worst.freeCalls,
    estimate: toolEstimate(
      ports,
      [
        ...(tp
          ? [
              {
                providerId: 'travelpayouts' as const,
                stage: 'discovery' as const,
                calls: worst.freeCalls,
                planCalls: 1,
              },
            ]
          : []),
        ...(sa
          ? [
              { providerId: 'searchapi' as const, stage: 'discovery' as const, calls: 1, planCalls: 1 },
              {
                providerId: 'searchapi' as const,
                stage: 'verification' as const,
                calls: chainCalls,
                planCalls: chainCalls,
              },
            ]
          : []),
      ],
      'smoke:live: one tile per configured provider (Travelpayouts at the page cap), one SearchApi chain expanding one outbound',
    ),
  });
}

/** A provider failure as one URL-free, secret-free phrase; anything that is not a request result propagates. */
function describeFailure(e: unknown, ports: Ports): string | null {
  if (e instanceof BudgetExceeded) return `refused by the guard before the request: ${e.scope}`;
  if (e instanceof AbortedError) return 'aborted';
  if (e instanceof ProviderError)
    return `${e.kind}${e.reason === undefined ? '' : ` (${e.reason})`}: ${safeMessage(e, ports.secrets)}`;
  return null;
}

/** A vendor amount in pence with the provenance the adapter declares (spec §3), or why it cannot be shown. */
function priceOf(
  provider: FlightProvider,
  info: { sourceKind: Provenance['sourceKind']; maxAgeHours: Provenance['maxAgeHours'] },
  p: { amountMinor: number; currency: string; providerObservedAt?: IsoDateTime } & CellKey,
  fetchedAt: IsoDateTime,
  pointOfSale: string,
  extra: {
    displayName: string;
    confirmed: boolean | null;
    truncated: boolean;
    journey?: SmokePrice['journey'];
  },
): SmokePrice | string {
  // why: both adapters ask for GBP (spec §5.2). Core's one money step (spec §5.6) passes GBP through with its integer
  // check; with no rate lookup, any other currency throws, and the smoke reports it instead of comparing (arch M1).
  let money: ReturnType<typeof priceInGbp>;
  try {
    money = priceInGbp(p, () => null);
  } catch (e) {
    if (e instanceof NormalisationError)
      return `price in ${p.currency.toUpperCase()}; the smoke compares GBP only`;
    if (e instanceof RangeError) return `unusable amount ${p.amountMinor} ${p.currency.toUpperCase()}`;
    throw e;
  }
  const cell: CellKey = {
    origin: p.origin,
    destination: p.destination,
    departureDate: p.departureDate,
    returnDate: p.returnDate,
  };
  return {
    pricePence: money.pricePence,
    cell,
    nights: daysBetween(cell.departureDate, cell.returnDate),
    displayName: extra.displayName,
    confirmed: extra.confirmed,
    truncated: extra.truncated,
    journey: extra.journey ?? null,
    provenance: {
      providerId: provider.id,
      sourceKind: info.sourceKind,
      fetchedAt,
      ...(p.providerObservedAt === undefined ? {} : { providerObservedAt: p.providerObservedAt }),
      maxAgeHours: info.maxAgeHours,
      fx: money.fx,
      pointOfSale,
      cabin: SMOKE_CABIN,
    },
  };
}

const hoursMinutes = (m: number): string => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
const stops = (n: number): string => (n === 0 ? 'nonstop' : `${n} ${n === 1 ? 'stop' : 'stops'}`);

/**
 * pft-005: an offer's time each way and stops through core's normaliseOffer, as the engine computes them; null when the
 * offer cannot be normalised (an airport with no time zone, a cell mismatch), so nothing is guessed.
 */
function journeyOf(
  o: RawOffer,
  cell: CellKey,
  provider: FlightProvider,
  ports: Ports,
): SmokePrice['journey'] {
  let r: ReturnType<typeof normaliseOffer>;
  try {
    r = normaliseOffer(o, cell, {
      providerId: provider.id,
      cabin: SMOKE_CABIN,
      tzOf: (iata) => ports.repos.airports.tzOf(iata),
      rateFor: () => null,
    });
  } catch (e) {
    // why: an unusable amount is priceOf's to report (RangeError); the journey just goes unsaid.
    if (e instanceof RangeError) return null;
    throw e;
  }
  if (!r.ok) return null;
  const { outboundMinutes, inboundMinutes, stopsOut, stopsIn } = r.itinerary;
  // why: a direction without segment times has no duration; say nothing rather than a partial journey.
  if (outboundMinutes === undefined || inboundMinutes === undefined) return null;
  return { outboundMinutes, inboundMinutes, stopsOut, stopsIn };
}

/**
 * `£412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched … · observed …`, with "cheapest of the rows
 * read" for a truncated or partly unusable tile (decision 30) and the decision-44 label for an unconfirmed offer.
 */
export function describePrice(p: SmokePrice, now: IsoDateTime): string {
  const c = p.cell;
  const j = p.journey;
  return [
    `${formatPence(p.pricePence)}${p.truncated ? ' (cheapest of the rows read)' : ''}`,
    `${c.origin}→${c.destination} ${c.departureDate}–${c.returnDate} (${p.nights}n)`,
    ...(j === null
      ? []
      : [
          `out ${hoursMinutes(j.outboundMinutes)} ${stops(j.stopsOut)}, back ${hoursMinutes(j.inboundMinutes)} ${stops(j.stopsIn)}`,
        ]),
    p.displayName,
    formatAgeFull(effectiveAge(p.provenance, now)),
    ...(p.confirmed === false ? [NOT_CONFIRMED] : []),
  ].join(' · ');
}

type Tile = Extract<DiscoveryTileResult, { kind: 'tile' }>;
export interface Discovery {
  report: SmokeProviderReport;
  plans: TilePlan[];
  tile: Tile | null;
  /**
   * The failure was the setup's, not the vendor's day: an auth or quota refusal that will not pass on a retry, or a
   * provider that could not plan the one tile. After the free provider fails this way no credit is spent (cost M1).
   */
  setupFailure?: true;
}
export interface Chain {
  report: SmokeProviderReport;
  result: ItinerarySearchResult | null;
}
type Ctx = { executionId: string; signal: AbortSignal; recordFixtures: boolean };

function blankReport(providerId: Vendor, stage: SmokeProviderReport['stage']) {
  return (status: SmokeProviderReport['status'], detail: string): SmokeProviderReport => ({
    providerId,
    stage,
    status,
    prices: 0,
    cheapest: null,
    cheapestConfirmed: null,
    detail,
  });
}

/** An auth or quota refusal that a retry will not lift: the operator's key or plan, not the vendor's day. */
function setupFailure(e: unknown): { setupFailure?: true } {
  return e instanceof ProviderError && !e.retryable && (e.kind === 'auth' || e.kind === 'quota')
    ? { setupFailure: true }
    : {};
}

/** One provider's one tile. A plan of any other length is reported and nothing is fetched. */
async function discover(
  ports: Ports,
  id: Vendor,
  provider: FlightProvider | undefined,
  q: DiscoveryQuery,
  ctx: Ctx,
): Promise<Discovery> {
  const report = blankReport(id, 'discovery');
  const cap = provider?.discovery;
  if (provider === undefined || cap === undefined)
    return {
      report: report('error', 'configured but has no discovery capability'),
      plans: [],
      tile: null,
      setupFailure: true,
    };
  const plans = cap.plan(q);
  const [first] = plans;
  if (plans.length !== 1 || first === undefined)
    return {
      report: report('error', `planned ${plans.length} tiles; the smoke query must plan exactly 1`),
      plans,
      tile: null,
      setupFailure: true,
    };
  let result: DiscoveryTileResult;
  try {
    result = await cap.fetchTile(first, q, ctx);
  } catch (e) {
    const why = describeFailure(e, ports);
    if (why === null) throw e;
    return { report: report('error', why), plans, tile: null, ...setupFailure(e) };
  }
  if (result.kind === 'tile-error')
    return {
      report: report('error', describeFailure(result.error, ports) ?? 'tile error'),
      plans,
      tile: null,
      ...setupFailure(result.error),
    };
  // why: a partial tile is reported on its line, never hidden behind "priced" (prov-wp13-r1-003)
  const issues = result.cellIssues ?? [];
  const partial = [
    ...(result.truncated === true ? ['stopped at the page cap'] : []),
    ...(issues.length > 0 ? [`${issues.length} cell(s) with dropped or unread rows`] : []),
  ].join('; ');
  const prices = [...result.prices].sort((a, b) => a.amountMinor - b.amountMinor);
  const [cheapestRaw] = prices;
  if (cheapestRaw === undefined) {
    // why: an empty Aviasales tile is absence from a cache; an empty SearchApi grid is the vendor's own answer (spec §5.2)
    const none =
      id === 'travelpayouts'
        ? `no row in the Aviasales cache for these days (${result.noFares.length} cell(s) without fares)`
        : `the vendor returned no price for these days (${result.noFares.length} cell(s) without fares)`;
    return {
      report: report('empty', [none, partial].filter((s) => s !== '').join('; ')),
      plans,
      tile: result,
    };
  }
  const priced = priceOf(provider, cap.info, cheapestRaw, result.fetchedAt, result.pointOfSale, {
    displayName: provider.displayName,
    confirmed: null,
    // why: unusable rows (bad price, bad link) leave a covered cell's cheapest unknown, like a page never read; open-jaw
    // rows were never this route's, so dropping them leaves the price whole (decision 39)
    truncated: result.truncated === true || issues.some((x) => !openJawOnly(x.detail)),
  });
  if (typeof priced === 'string') return { report: report('error', priced), plans, tile: result };
  return {
    report: { ...report('priced', partial), prices: prices.length, cheapest: priced },
    plans,
    tile: result,
  };
}

/** The SearchApi chain for the cheapest SearchApi cell (spec §5.4), expanding one outbound. */
async function chain(
  ports: Ports,
  provider: FlightProvider | undefined,
  cell: CellKey,
  ctx: Ctx,
): Promise<Chain> {
  const report = blankReport('searchapi', 'itinerary');
  const cap = provider?.verification;
  if (provider === undefined || cap === undefined)
    return { report: report('error', 'configured but has no itinerary capability'), result: null };
  const q: ItineraryQuery = {
    ...cell,
    cabin: SMOKE_CABIN,
    adults: 1,
    currency: 'GBP',
    expandTop: SMOKE_EXPAND_TOP,
    bookingLinks: true,
  };
  let result: ItinerarySearchResult;
  try {
    result = await cap.search(q, ctx);
  } catch (e) {
    const why = describeFailure(e, ports);
    if (why === null) throw e;
    return { report: report('error', why), result: null };
  }
  const offers = [...result.offers].sort((a, b) => a.amountMinor - b.amountMinor);
  const [best] = offers;
  if (best === undefined) return { report: report('empty', 'the chain returned no offer'), result };
  // why: decision 44: only a price a seller listing confirmed is "sold by"; a step-2 price names the airline the
  // vendor states and carries the unconfirmed label
  const shown = (o: (typeof offers)[number]): SmokePrice | string =>
    priceOf(
      provider,
      cap.info,
      { ...cell, amountMinor: o.amountMinor, currency: o.currency },
      result.fetchedAt,
      result.pointOfSale,
      {
        displayName: o.verified
          ? `${provider.displayName}, sold by ${o.seller}`
          : `${provider.displayName}, airline stated by the vendor: ${o.seller}`,
        confirmed: o.verified,
        truncated: false,
        journey: journeyOf(o, cell, provider, ports),
      },
    );
  const priced = shown(best);
  if (typeof priced === 'string') return { report: report('error', priced), result };
  const confirmedOffer = offers.find((o) => o.verified);
  const confirmed = confirmedOffer === undefined ? null : shown(confirmedOffer);
  return {
    report: {
      ...report('priced', result.partial ? 'partial: not every step answered' : ''),
      prices: offers.length,
      cheapest: priced,
      cheapestConfirmed: typeof confirmed === 'string' ? null : confirmed,
    },
    result,
  };
}

/**
 * The headline (decision 66): the cheapest price a seller listing confirmed, else the cheapest discovery price with its
 * age, labelled by what the chain did with its cell: "not checked by an itinerary search" for a cell the chain never
 * searched; for the cell it searched and priced without a confirmation, that fact and the chain's own cheapest offer
 * with its decision-44 label (provenance review, fix round 1).
 */
function headline(reports: readonly SmokeProviderReport[], now: IsoDateTime): string {
  const itinerary = reports.find((r) => r.stage === 'itinerary');
  const confirmed = itinerary?.cheapestConfirmed ?? null;
  if (confirmed !== null) return `cheapest confirmed price ${describePrice(confirmed, now)}`;
  const calendar = reports
    .filter((r) => r.stage === 'discovery')
    .flatMap((r) => (r.cheapest === null ? [] : [r.cheapest]))
    .sort((a, b) => a.pricePence - b.pricePence)[0];
  if (calendar === undefined) return 'no price found';
  const searched = itinerary?.status === 'priced' ? itinerary.cheapest : null;
  const sameCell =
    searched !== null &&
    searched.cell.origin === calendar.cell.origin &&
    searched.cell.destination === calendar.cell.destination &&
    searched.cell.departureDate === calendar.cell.departureDate &&
    searched.cell.returnDate === calendar.cell.returnDate;
  return sameCell
    ? `cheapest calendar price ${describePrice(calendar, now)} · itinerary search found no confirmed price; its cheapest: ${formatPence(searched.pricePence)} · ${searched.displayName} · ${NOT_CONFIRMED}`
    : `cheapest calendar price ${describePrice(calendar, now)} · not checked by an itinerary search`;
}

const MARK: Record<SmokeCheck['status'], string> = { pass: 'ok  ', fail: 'FAIL', skip: 'skip', look: 'look' };

/**
 * Spec §9 item 7. Never throws for a vendor failure: the exit code carries it (plan exit-code table: 0 every
 * configured provider priced and no check failed; 1 a provider error, an abort or a failed check; 2 zero providers; 3
 * no error but a tile or the chain held no price; 64 bad airports; 65 spend refused). A dry run stops after the spend
 * position with 0 and sends nothing. Anything else (SQLite, a recorder refusal) cancels the hidden execution and
 * propagates, as for recording.
 */
export async function runSmoke(
  ports: Ports,
  cli: SmokeCli,
  opts: { signal: AbortSignal; fixtures: { root: string; recordedBy: string } | null },
): Promise<SmokeResult> {
  const lines: string[] = [];
  const say = (l: string): void => {
    lines.push(safeMessage(l, ports.secrets));
  };
  const finish = (exitCode: number, summary: string): SmokeResult => ({
    exitCode,
    summary,
    lines,
    checks: [],
    reports: [],
    fixturesWritten: [],
    executionId: null,
  });
  const refuse = (exitCode: number, message: string): SmokeResult => {
    say(message);
    return finish(exitCode, message);
  };

  const { origin, destination } = cli.args;
  if (origin === destination) return refuse(EXIT.usage, 'origin and destination must differ');
  for (const code of [origin, destination]) {
    if (ports.repos.airports.exists(code)) continue;
    const members = ports.repos.airports.airportsOfMetro(code);
    return refuse(
      EXIT.usage,
      members.length > 0
        ? `${code} is a city code; the smoke takes one airport (${members.join(', ')})`
        : `unknown airport ${code}: not in the airports table`,
    );
  }
  const configured = VENDORS.filter((v) => ports.config.providers[v] !== null);
  if (configured.length === 0)
    return refuse(EXIT.smokeNoProviders, 'no provider configured: set TRAVELPAYOUTS_TOKEN or SEARCHAPI_KEY');

  const q = smokeQuery(ports.clock.todayLondon(), origin, destination);
  const worst = smokeWorstCase(ports.config);
  const cap = Math.min(cli.args.budget, worst.credits);
  say(
    `smoke: ${origin}→${destination} departures ${q.departureFrom}–${q.departureTo}, ${q.minNights}–${q.maxNights} nights; one tile per provider${configured.includes('searchapi') ? ', then one SearchApi itinerary chain' : ''}`,
  );
  say(
    `this run: at most ${worst.credits} SearchApi credit(s), frozen at ${cap} by --budget ${cli.args.budget}; at most ${worst.freeCalls} free Travelpayouts call(s)`,
  );
  const position = spendPosition(ports, worst, cli.args.budget);
  for (const l of position.lines) say(l);
  if (cli.dryRun) {
    say('dry run: nothing sent, no execution opened');
    return finish(EXIT.ok, 'dry run: nothing sent');
  }
  if (position.windowRefusals.length > 0)
    return refuse(
      EXIT.spendRefused,
      `refusing: ${position.windowRefusals.join('; ')} (never start what cannot finish)`,
    );
  if (position.rerunNeedsConfirm && !cli.confirmRerun)
    return refuse(
      EXIT.spendRefused,
      `refusing: credits already ledgered to earlier tool runs plus this run's worst case exceed --budget ${cli.args.budget}; read the 'SearchApi credits already ledgered' line above and raise --budget only if you mean to spend more (plan decision 20)`,
    );

  // why: the recorder's paths are collected exactly by the tools' one wrapper (toolExecution.ts `tracking`)
  let track: ReturnType<typeof tracking> | null = null;
  if (opts.fixtures !== null) {
    mkdirSync(opts.fixtures.root, { recursive: true });
    track = tracking(
      createRecorder({
        root: opts.fixtures.root,
        secrets: ports.secrets,
        clock: ports.clock,
        recordedBy: opts.fixtures.recordedBy,
      }),
    );
  }
  const recorder = track?.recorder ?? null;
  const log = ports.log.child({ tool: 'smoke' });
  const seen: Seen[] = [];
  const all = httpLimitsFor(ports.config);
  // why: the two vendors only: the smoke never calls the fixture provider (a test database may have the synthetic gate
  // open; the bootstrap and the route refuse it for a real run) nor the FX host.
  const limits: HttpKitDeps['limits'] = {
    ...(all.travelpayouts === undefined ? {} : { travelpayouts: all.travelpayouts }),
    ...(all.searchapi === undefined ? {} : { searchapi: all.searchapi }),
  };
  const kit = createHttpKit({
    budget: ports.budget,
    cache: NO_CACHE,
    limits,
    clock: ports.clock,
    log,
    secrets: ports.secrets,
    syntheticAllowed: false,
    ...(recorder === null ? {} : { recorder }),
  });
  // why: the checklist reads what the vendors answered (step prices, request parameters) from this run only
  // why: the ledger check matches every answer, thrown ones too, against the ledger by endpoint and status (cost M2)
  const answers: Answer[] = [];
  const http: HttpKit = {
    request: async (r) => {
      let res: Awaited<ReturnType<HttpKit['request']>>;
      try {
        res = await kit.request(r);
      } catch (e) {
        if (e instanceof ProviderError && e.httpStatus !== undefined)
          answers.push({ providerId: r.providerId, endpointPath: r.endpointPath, status: e.httpStatus });
        throw e;
      }
      answers.push({ providerId: r.providerId, endpointPath: r.endpointPath, status: res.status });
      seen.push({ providerId: r.providerId, tileIndex: r.tileIndex, url: r.url, body: res.body });
      return res;
    },
    stats: () => kit.stats(),
  };
  const providers = providersFor(ports.config, { http, log, clock: ports.clock }).filter((p) =>
    configured.some((id) => id === p.id),
  );
  const runStart = ports.clock.now();
  const executionId = openSmokeExecution(ports, q, worst, cli.args.budget);
  const ctx: Ctx = { executionId, signal: opts.signal, recordFixtures: recorder !== null };

  const found = new Map<Vendor, Discovery>();
  let itinerary: Chain | null = null;
  try {
    const blocked = 'Travelpayouts failed first (auth, quota or configuration); no credit spent';
    for (const id of configured) {
      // why: cost review M1: a setup failure on the free provider stops the run before SearchApi spends a credit
      if (id === 'searchapi' && found.get('travelpayouts')?.setupFailure === true) {
        found.set(id, { report: blankReport(id, 'discovery')('skipped', blocked), plans: [], tile: null });
        continue;
      }
      found.set(
        id,
        await discover(
          ports,
          id,
          providers.find((p) => p.id === id),
          q,
          ctx,
        ),
      );
    }
    const saCell = found.get('searchapi')?.report.cheapest?.cell;
    const skipped = (detail: string): Chain => ({
      report: blankReport('searchapi', 'itinerary')('skipped', detail),
      result: null,
    });
    if (!configured.includes('searchapi')) itinerary = null;
    else if (found.get('travelpayouts')?.setupFailure === true) itinerary = skipped(blocked);
    else if (opts.signal.aborted) itinerary = skipped('aborted before the chain');
    else if (saCell === undefined)
      // why: no priced calendar cell, so the chain has nothing to search; no credit is spent on it (cost I-1)
      itinerary = skipped('no priced SearchApi calendar cell');
    else
      itinerary = await chain(
        ports,
        providers.find((p) => p.id === 'searchapi'),
        saCell,
        ctx,
      );
  } catch (e) {
    ports.repos.executions.setStatus(executionId, 'cancelled', {
      finishedAt: ports.clock.now(),
      errorText: `smoke:live failed: ${safeMessage(e, ports.secrets)}`,
    });
    throw e;
  }

  const reports = [...found.values()]
    .map((d) => d.report)
    .concat(itinerary === null ? [] : [itinerary.report]);
  const checks = checklist({
    ports,
    q,
    executionId,
    runStart,
    cap,
    configured,
    found,
    itinerary,
    seen,
    answers,
  });
  const written = track?.take() ?? [];
  const now = ports.clock.now();
  for (const r of reports)
    say(
      `${r.providerId} ${r.stage}: ${r.status}${r.prices > 0 ? ` · ${r.prices} price(s)` : ''}${r.cheapest === null ? '' : ` · cheapest ${describePrice(r.cheapest, now)}`}${r.detail === '' ? '' : ` · ${r.detail}`}`,
    );
  say('checklist:');
  for (const c of checks) say(`  [${MARK[c.status]}] ${c.name}: ${c.detail}`);
  const summary = headline(reports, now);
  say(summary);
  say(
    opts.fixtures === null
      ? 'fixtures not written (app process)'
      : `fixtures written: ${written.length} under ${opts.fixtures.root} (local-only, never committed)`,
  );

  const failed =
    opts.signal.aborted ||
    reports.some((r) => r.status === 'error') ||
    checks.some((c) => c.status === 'fail');
  const exitCode = failed
    ? EXIT.failed
    : reports.some((r) => r.status === 'empty')
      ? EXIT.smokeEmpty
      : EXIT.ok;
  ports.repos.executions.setStatus(executionId, opts.signal.aborted ? 'cancelled' : 'completed', {
    finishedAt: now,
    errorText: exitCode === EXIT.ok ? null : `smoke:live exit ${exitCode}`,
  });
  const root = opts.fixtures?.root;
  return {
    exitCode,
    summary,
    lines,
    checks,
    reports,
    fixturesWritten: root === undefined ? [] : written.map((f) => relative(root, f)).sort(),
    executionId,
  };
}

/**
 * The `smoke` runner of the tool bootstrap (spec §9 item 7): runs the smoke with its fixtures beside the database and
 * prints every line; refusals go to stderr. Returns the exit code.
 */
export async function runSmokeTool(ports: Ports, cli: SmokeCli, ctx: ToolContext): Promise<number> {
  const r = await runSmoke(ports, cli, {
    signal: ctx.signal,
    fixtures: { root: ctx.recordedRoot, recordedBy: ctx.recordedBy },
  });
  const refused = r.executionId === null && r.exitCode !== EXIT.ok;
  for (const line of r.lines) (refused ? ctx.err : ctx.out)(line);
  return r.exitCode;
}
