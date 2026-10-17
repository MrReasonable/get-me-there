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
import { dirname, join, relative, resolve } from 'node:path';
import {
  AbortedError,
  addDays,
  BudgetExceeded,
  type Cabin,
  type CellKey,
  type Config,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  daysBetween,
  effectiveAge,
  type FlightProvider,
  formatAgeFull,
  formatPence,
  type Iata,
  type IsoDate,
  type IsoDateTime,
  type ItineraryQuery,
  type ItinerarySearchResult,
  iataSchema,
  monthOf,
  type Provenance,
  ProviderError,
  type ResponseCache,
  type TilePlan,
} from '@gmt/core';
import {
  createHttpKit,
  createRecorder,
  defaultRecordedRoot,
  type FixtureRecorder,
  type HttpKit,
  type HttpKitDeps,
} from '@gmt/providers';
import { safeMessage } from '../safeMessage.js';
import { httpLimitsFor, type Ports, providersFor } from '../wiring.js';
import { positiveInt, readFlags } from './args.js';
import { isInside } from './paths.js';
import {
  CALENDAR_OUT_DAYS,
  firstDayOf,
  monthAfter,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  TP_MAX_PAGES_PER_TILE,
} from './recordPlan.js';
import { checklist, type Seen, type SmokeCheck } from './smokeChecks.js';
import { openHiddenExecution, spendPosition, toolEstimate, type WorstCase } from './toolExecution.js';
import { EXIT, type ToolContext } from './types.js';

export type { SmokeCheck } from './smokeChecks.js';

/** The recordedBy signature on every file a command-line smoke writes (spec §5.5). */
export const SMOKE_RECORDED_BY = '@gmt/api smoke:live';
/** Outbounds the chain expands: one, so the chain is step 1, one step 2 and one step 3 (spec §5.4). */
export const SMOKE_EXPAND_TOP = 1;
/**
 * Departure days of the smoke query: the production SearchApi block for the 10–21-night band (9 × 20 = 180
 * combinations, plan decision 29), so the smoke is also WP5's "try a 9-day rectangle" row, and every day sits inside
 * one month, so Travelpayouts plans one month tile.
 */
export const SMOKE_DEPARTURE_DAYS = CALENDAR_OUT_DAYS;
export const SMOKE_CABIN: Cabin = 'economy';
export const SMOKE_USAGE =
  'usage: pnpm smoke:live --origin IATA --destination IATA --budget N [--dry-run] [--confirm-rerun]';
/** The decision-44 label for an offer the final step did not confirm. */
export const NOT_CONFIRMED = 'price not confirmed by the final step';

// why: provider identifiers in a fixed order, never airports; the free provider first, so a broken setup is learned
// before any credit is spent (plan decision 23 orders the record tool's probes the same way).
export const VENDORS = ['travelpayouts', 'searchapi'] as const;
export type Vendor = (typeof VENDORS)[number];
// why: a cache hit is not a call; the smoke must show that the vendor answers today (spec §9 item 7).
const NO_CACHE: ResponseCache = { get: () => undefined, set: () => undefined };
const VALUE_FLAGS: ReadonlySet<string> = new Set(['origin', 'destination', 'budget']);
const SWITCHES: ReadonlySet<string> = new Set(['confirm-rerun', 'dry-run']);

export interface SmokeArgs {
  origin: Iata;
  destination: Iata;
  /** SearchApi credits tool runs may have ledgered in the provider's budget window, this run included (decision 20). */
  budget: number;
}
export interface SmokeCli {
  args: SmokeArgs;
  /** Lifts only the cross-run refusal, as for recording; never a window without room, never the frozen cap. */
  confirmRerun: boolean;
  /** Prints the query, the worst case and the spend position; opens no execution and sends nothing (decision 66). */
  dryRun: boolean;
}
export type ParseSmokeResult = { ok: true; value: SmokeCli } | { ok: false; message: string };

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
  /** The tile stopped at its page cap: the cheapest of the rows read (decision 30). */
  truncated: boolean;
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

/** `--origin X --destination Y --budget N [--dry-run] [--confirm-rerun]` through the tools' one argv reader. */
export function parseSmokeArgs(argv: readonly string[]): ParseSmokeResult {
  const fail = (message: string): ParseSmokeResult => ({ ok: false, message: `${message}\n${SMOKE_USAGE}` });
  const read = readFlags(argv, VALUE_FLAGS, SWITCHES);
  if (!read.ok) return fail(read.message);
  const origin = iataSchema.safeParse(read.flags.get('origin') ?? '');
  const destination = iataSchema.safeParse(read.flags.get('destination') ?? '');
  if (!origin.success || !destination.success)
    return fail('--origin and --destination are required: one three-letter airport code each');
  const budgetRaw = read.flags.get('budget');
  if (budgetRaw === undefined)
    return fail(
      '--budget is required: the SearchApi credits tool runs may use in this budget window (spec §9 item 7)',
    );
  const budget = positiveInt(budgetRaw);
  if (budget === null) return fail('--budget must be a positive integer');
  return {
    ok: true,
    value: {
      args: { origin: origin.data, destination: destination.data, budget },
      confirmRerun: read.switches.has('confirm-rerun'),
      dryRun: read.switches.has('dry-run'),
    },
  };
}

/**
 * The one-tile query: departures on the first `SMOKE_DEPARTURE_DAYS` days of next month, 10–21 nights, economy. Next
 * month's 1st is always after today and nine days from the 1st never cross a month end, so Travelpayouts plans one
 * month tile; SearchApi's block for this band is nine days, so it plans one 9 × 20 rectangle. `runSmoke` still checks
 * `plan().length === 1` for each provider before any request.
 */
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery {
  const departureFrom = firstDayOf(monthAfter(monthOf(today), 1));
  return {
    origin,
    destination,
    departureFrom,
    departureTo: addDays(departureFrom, SMOKE_DEPARTURE_DAYS - 1),
    minNights: RECORD_MIN_NIGHTS,
    maxNights: RECORD_MAX_NIGHTS,
    cabin: SMOKE_CABIN,
    currency: 'GBP',
  };
}

/**
 * The run's stated worst case: SearchApi one calendar tile plus the chain's `1 + 2 × expandTop` (the adapter's own
 * estimate rule, spec §5.4); Travelpayouts one month tile at the page cap.
 */
export function smokeWorstCase(config: Config): WorstCase {
  return {
    credits: config.providers.searchapi === null ? 0 : 1 + 1 + 2 * SMOKE_EXPAND_TOP,
    freeCalls: config.providers.travelpayouts === null ? 0 : TP_MAX_PAGES_PER_TILE,
  };
}

/**
 * Where a command-line smoke writes: `<dirname(DATABASE_PATH)>/smoke/fixtures/recorded` (the recorder requires the
 * `fixtures/recorded` suffix), refused when that lies inside the repository's recorded tree (decision 61), compared as
 * true-case real paths (`isInside`). The data directory is the operator's (gitignored `data/` on a checkout, the volume
 * in a container), like the backups beside it.
 */
export function smokeFixtureTarget(
  databasePath: string,
  recordedTree: string = defaultRecordedRoot(),
): { root: string; recordedBy: string } | { refusal: string } {
  const root = join(dirname(resolve(databasePath)), 'smoke', 'fixtures', 'recorded');
  if (isInside(root, recordedTree))
    return {
      refusal: `DATABASE_PATH would put the smoke's fixtures in the recorded tree (${root}); move the database`,
    };
  return { root, recordedBy: SMOKE_RECORDED_BY };
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
  extra: { displayName: string; confirmed: boolean | null; truncated: boolean },
): SmokePrice | string {
  // why: both adapters ask for GBP (spec §5.2); the smoke compares pence only and reports any other currency.
  if (p.currency.toUpperCase() !== 'GBP') return `price in ${p.currency}; the smoke compares GBP only`;
  const cell: CellKey = {
    origin: p.origin,
    destination: p.destination,
    departureDate: p.departureDate,
    returnDate: p.returnDate,
  };
  return {
    pricePence: p.amountMinor,
    cell,
    nights: daysBetween(cell.departureDate, cell.returnDate),
    displayName: extra.displayName,
    confirmed: extra.confirmed,
    truncated: extra.truncated,
    provenance: {
      providerId: provider.id,
      sourceKind: info.sourceKind,
      fetchedAt,
      ...(p.providerObservedAt === undefined ? {} : { providerObservedAt: p.providerObservedAt }),
      maxAgeHours: info.maxAgeHours,
      fx: { converted: false },
      pointOfSale,
      cabin: SMOKE_CABIN,
    },
  };
}

/**
 * `£412 · LHR→JFK 2027-03-02–2027-03-16 (14n) · Aviasales cache · fetched … · observed …`, with "cheapest of the rows
 * read" for a truncated tile (decision 30) and the decision-44 label for an unconfirmed offer.
 */
export function describePrice(p: SmokePrice, now: IsoDateTime): string {
  const c = p.cell;
  return [
    `${formatPence(p.pricePence)}${p.truncated ? ' (cheapest of the rows read)' : ''}`,
    `${c.origin}→${c.destination} ${c.departureDate}–${c.returnDate} (${p.nights}n)`,
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
    return { report: report('error', 'configured but has no discovery capability'), plans: [], tile: null };
  const plans = cap.plan(q);
  const [first] = plans;
  if (plans.length !== 1 || first === undefined)
    return {
      report: report('error', `planned ${plans.length} tiles; the smoke query must plan exactly 1`),
      plans,
      tile: null,
    };
  let result: DiscoveryTileResult;
  try {
    result = await cap.fetchTile(first, q, ctx);
  } catch (e) {
    const why = describeFailure(e, ports);
    if (why === null) throw e;
    return { report: report('error', why), plans, tile: null };
  }
  if (result.kind === 'tile-error')
    return {
      report: report('error', describeFailure(result.error, ports) ?? 'tile error'),
      plans,
      tile: null,
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
    truncated: result.truncated === true,
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
 * The headline (decision 66): the cheapest price a seller listing confirmed, else the cheapest discovery price labelled
 * as a calendar price no itinerary search checked, with its age.
 */
function headline(reports: readonly SmokeProviderReport[], now: IsoDateTime): string {
  const confirmed = reports.find((r) => r.stage === 'itinerary')?.cheapestConfirmed ?? null;
  if (confirmed !== null) return `cheapest confirmed price ${describePrice(confirmed, now)}`;
  const calendar = reports
    .filter((r) => r.stage === 'discovery')
    .flatMap((r) => (r.cheapest === null ? [] : [r.cheapest]))
    .sort((a, b) => a.pricePence - b.pricePence)[0];
  return calendar === undefined
    ? 'no price found'
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
      `refusing: credits already ledgered to earlier tool runs plus this run's worst case exceed --budget ${cli.args.budget}; read the first line above and raise --budget only if you mean to spend more (plan decision 20)`,
    );

  const written: string[] = [];
  let recorder: FixtureRecorder | null = null;
  if (opts.fixtures !== null) {
    mkdirSync(opts.fixtures.root, { recursive: true });
    const inner = createRecorder({
      root: opts.fixtures.root,
      secrets: ports.secrets,
      clock: ports.clock,
      recordedBy: opts.fixtures.recordedBy,
    });
    // why: FixtureRecorder.record resolves to the path it wrote, so fixturesWritten is exact
    recorder = {
      record: async (r) => {
        const p = await inner.record(r);
        written.push(p);
        return p;
      },
    };
  }
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
  const http: HttpKit = {
    request: async (r) => {
      const res = await kit.request(r);
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
    for (const id of configured)
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
    const saCell = found.get('searchapi')?.report.cheapest?.cell;
    const skipped = (detail: string): Chain => ({
      report: blankReport('searchapi', 'itinerary')('skipped', detail),
      result: null,
    });
    if (!configured.includes('searchapi')) itinerary = null;
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
  const checks = checklist({ ports, q, executionId, runStart, cap, configured, found, itinerary, seen });
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
