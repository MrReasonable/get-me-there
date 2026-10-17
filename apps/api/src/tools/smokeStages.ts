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
  type TilePlan,
  withAssumedBound,
} from '@gmt/core';
import { safeMessage } from '../safeMessage.js';
import type { Ports } from '../wiring.js';
import { SMOKE_CABIN, SMOKE_EXPAND_TOP } from './smokeArgs.js';
import { openJawOnly } from './smokeChecks.js';

/** The decision-44 label for an offer the final step did not confirm. */
export const NOT_CONFIRMED = 'price not confirmed by the final step';

// why: provider identifiers in a fixed order, never airports; the free provider first, so a broken setup is learned
// before any credit is spent: a setup failure there skips SearchApi entirely (plan decision 23 orders the record
// tool's probes the same way; cost review M1).
export const VENDORS = ['travelpayouts', 'searchapi'] as const;
export type Vendor = (typeof VENDORS)[number];
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
  info: {
    sourceKind: Provenance['sourceKind'];
    maxAgeHours: Provenance['maxAgeHours'];
    maxAgeAssumed?: boolean | undefined;
  },
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
    // why: N4 (pie-007): the smoke prints the age line the views print, so an assumed bound reads "assumed" here too.
    provenance: withAssumedBound(
      {
        providerId: provider.id,
        sourceKind: info.sourceKind,
        fetchedAt,
        ...(p.providerObservedAt === undefined ? {} : { providerObservedAt: p.providerObservedAt }),
        maxAgeHours: info.maxAgeHours,
        fx: money.fx,
        pointOfSale,
        cabin: SMOKE_CABIN,
      },
      info,
    ),
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
export type Ctx = { executionId: string; signal: AbortSignal; recordFixtures: boolean };

export function blankReport(providerId: Vendor, stage: SmokeProviderReport['stage']) {
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
export async function discover(
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
export async function chain(
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
