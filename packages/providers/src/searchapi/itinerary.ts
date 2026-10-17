import {
  AbortedError,
  BudgetExceeded,
  type CostEstimate,
  type IsoDateTime,
  type ItineraryQuery,
  type ItinerarySearchResult,
  type Logger,
  type ProviderContext,
  ProviderError,
  type RawOffer,
  type RawSegment,
  type Secret,
} from '@gmt/core';
import type { HttpKit, HttpKitResponse } from '../http/types.js';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import { isExpansionFailure, parseError } from '../shared/errors.js';
import { majorToMinor } from '../shared/money.js';
import { NoteCounter } from '../shared/notes.js';
import { bookingOffers, statedAirline, step3NamesAirline, toRawSegments } from './offers.js';
import { authHeaders, flightsParams, SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_WHERE, toUrl } from './params.js';
import { currencySupported, minorOrDrop, type VendorOption } from './shapes.js';
import { parseBooking, parseFlights, toRouteHistory } from './steps.js';

/** What `search` needs; built once by `searchApiProvider`. */
export interface ItineraryDeps {
  http: HttpKit;
  log: Logger;
  key: Secret;
  pointOfSale: string;
  allowlist: ParamsAllowlist;
}

/** Slowest calendar call measured on 2026-10-14 (spec §2: 9–29 s); itinerary latency was not measured separately. */
export const WORST_SECONDS_PER_CALL = 29;

/** Spec §5.4: `bookingLinks` is forced true for SearchApi. */
export function assertBookingLinks(q: ItineraryQuery): void {
  if (q.bookingLinks !== true)
    throw new TypeError('searchapi itinerary queries require bookingLinks: true (spec §5.4)');
}

/**
 * `VerificationCapability.estimate`: calls = 1 + expandTop × 2 (spec §5.4), priced at the configured
 * `limits.costPerCallMicroGbp`, the same rate http-kit ledgers every reservation with (spec §12 override
 * SEARCHAPI_COST_PER_CALL_MICRO_GBP included), so estimate and ledger never disagree.
 */
export function estimateItinerary(q: ItineraryQuery, costPerCallMicroGbp: number): CostEstimate {
  assertBookingLinks(q);
  const calls = 1 + q.expandTop * 2;
  return {
    calls,
    costMicroGbp: calls * costPerCallMicroGbp,
    seconds: calls * WORST_SECONDS_PER_CALL,
    notes: [
      `1 outbound search + ${q.expandTop} × (return search + booking options)`,
      `${costPerCallMicroGbp} µGBP per call, the configured SearchApi rate`,
      `${WORST_SECONDS_PER_CALL} s per call, the slowest calendar call measured on 2026-10-14`,
    ],
  };
}

/**
 * The chain's `currency-unsupported` error (spec §3: a normalisation reason, never `parse`; plan decision 29):
 * non-retryable `upstream`, the message naming the step.
 */
function currencyUnsupported(message: string): ProviderError {
  return new ProviderError({
    kind: 'upstream',
    reason: 'currency-unsupported',
    retryable: false,
    providerId: 'searchapi',
    message,
  });
}

/** A refused reservation or an operator cancel: the chain stops (plan decisions 24 and 25). */
function isChainStop(err: unknown): err is BudgetExceeded | AbortedError {
  return err instanceof BudgetExceeded || err instanceof AbortedError;
}

async function send(
  d: ItineraryDeps,
  params: Record<string, string>,
  ctx: ProviderContext,
): Promise<HttpKitResponse> {
  const url = toUrl(params);
  assertRequestAllowed(d.allowlist, SEARCHAPI_ENDPOINT_PATH, url);
  // why: every google_flights response carries departure or booking tokens; spec §5.3: token-bearing responses
  // are never cached.
  return d.http.request({
    providerId: 'searchapi',
    executionId: ctx.executionId,
    tileIndex: null,
    endpointPath: SEARCHAPI_ENDPOINT_PATH,
    method: 'GET',
    url,
    headers: authHeaders(d.key),
    cache: 'never',
    signal: ctx.signal,
    recordFixtures: ctx.recordFixtures,
  });
}

/** A priced option with its converted legs. */
interface Usable {
  option: VendorOption;
  minor: number;
  segs: RawSegment[];
}

/**
 * `VerificationCapability.search` for SearchApi: the spec §5.4 chain.
 * - Step 1: options sorted by price (sent with sort_by=price, then sorted locally; "cheapest" holds over the
 *   options the vendor returned only). Zero options → `empty`; options but none priced and usable →
 *   `upstream`/`no-priced-options`; a currency core does not know → `upstream`/`currency-unsupported`.
 * - Step 2 for the `expandTop` cheapest: every priced return option is an offer, `verified: false`, whose seller is
 *   the airline the vendor states on the first outbound flight; with no stated airline those offers are dropped and
 *   counted (`no-airline-skipped-step2`), never given an invented seller (plan decision 27), and the result is partial (decision 41). Returns whose prices
 *   were all dropped are not "no legs": if no outbound yields a usable leg the cell is `currency-unsupported` or
 *   `parse`, never `no-return-legs`.
 * - Step 3 for the cheapest return per outbound: every usable booking option is an offer, `verified: true`; the
 *   step-2 price stays as the airline-direct offer (still `verified: false`) only when no step-3 option names that
 *   airline. A failed step 3, none possible (no booking_token), or one whose non-split options were all unusable
 *   keeps the step-2 offer and marks the result partial.
 * - Only upstream, network and parse count as a failed expansion; every other error propagates. A
 *   BudgetExceeded or AbortedError after offers were gathered returns them with partial: true (written with reason
 *   `partial-expansion`, plan decisions 24 and 27) so a resume does not re-bill the chain; before any offer it
 *   propagates.
 * `fetchedAt` is the oldest step's (spec §2).
 */
export async function searchItinerary(
  d: ItineraryDeps,
  q: ItineraryQuery,
  ctx: ProviderContext,
): Promise<ItinerarySearchResult> {
  assertBookingLinks(q);
  const gl = d.pointOfSale.toLowerCase();
  const notes = new NoteCounter();
  const base = flightsParams(q, d.pointOfSale);

  const s1 = await send(d, base, ctx);
  const r1 = parseFlights(s1.body, gl, 'step 1');
  const fetched: IsoDateTime[] = [s1.fetchedAt];
  const routeHistory = toRouteHistory(r1.priceHistory, r1.currency, notes);
  if (r1.options.length === 0) {
    return {
      offers: [],
      coverage: 'empty',
      fetchedAt: s1.fetchedAt,
      pointOfSale: r1.pointOfSale,
      partial: false,
      failedExpansions: 0,
      notes: notes.list(),
      routeHistory,
    };
  }
  if (!currencySupported(r1.currency)) {
    // why: spec §8.1: currency-unsupported is a normalisation reason, never parse; stopping here spends no step-2 call
    // on prices that could only be dropped.
    throw currencyUnsupported(
      `searchapi step 1: prices in ${r1.currency}, which has no known minor-unit exponent`,
    );
  }

  const usable1: Array<Usable & { token: string }> = [];
  for (const o of r1.options) {
    const segs = toRawSegments(o.flights);
    const minor = o.price === undefined ? null : majorToMinor(o.price, r1.currency);
    if (o.price === undefined) notes.add('unpriced-skipped-step1');
    else if (o.departure_token === undefined) notes.add('no-departure-token-step1');
    else if (segs === null) notes.add('unusable-segments-step1');
    else if (minor === null) notes.add('unusable-price-step1');
    else usable1.push({ option: o, minor, segs, token: o.departure_token });
  }
  if (usable1.length === 0 && r1.options.some((o) => o.price !== undefined)) {
    // why: decision 31: the vendor priced options the adapter could not use; that is a parse fault, not "no prices".
    throw parseError(
      'unusable-step1-options',
      `step 1: ${r1.options.length} options and none usable (${notes.list().join(', ')})`,
      SEARCHAPI_WHERE,
    );
  }
  if (usable1.length === 0) {
    // why: spec §5.4: every step-1 option unpriced → upstream, reason no-priced-options, non-retryable on resume.
    throw new ProviderError({
      kind: 'upstream',
      reason: 'no-priced-options',
      retryable: false,
      providerId: 'searchapi',
      message: `searchapi step 1: ${r1.options.length} options and none priced`,
    });
  }
  const expand = [...usable1].sort((a, b) => a.minor - b.minor).slice(0, q.expandTop); // stable: vendor order breaks ties

  const offers: RawOffer[] = [];
  const add = (o: RawOffer | null): void => {
    if (o !== null) offers.push(o);
  };
  let failed = 0;
  let withLegs = 0;
  // why: returns the vendor priced but the adapter could not use are not "no legs" (PA2-04); their reasons decide
  // the cell's error when no outbound yields a usable leg.
  const legDrops = new Set<'currency-unsupported' | 'parse'>();
  let partial = false;
  let stop: BudgetExceeded | AbortedError | null = null;
  for (const out of expand) {
    let r2: ReturnType<typeof parseFlights>;
    try {
      const s2 = await send(d, { ...base, departure_token: out.token }, ctx);
      fetched.push(s2.fetchedAt);
      r2 = parseFlights(s2.body, gl, 'step 2');
    } catch (err) {
      if (isExpansionFailure(err)) {
        failed += 1;
        notes.add('expansion-failed');
        continue;
      }
      if (isChainStop(err) && offers.length > 0) {
        stop = err;
        break;
      }
      throw err;
    }
    const returns: Usable[] = [];
    const dropped = new Set<'currency-unsupported' | 'parse'>();
    for (const o of r2.options) {
      const segs = toRawSegments(o.flights);
      if (o.price === undefined) notes.add('unpriced-skipped-step2');
      else if (segs === null) notes.add('unusable-segments-step2');
      else {
        const m = minorOrDrop(o.price, r2.currency, notes);
        if (m.minor === null) dropped.add(m.dropped);
        else returns.push({ option: o, minor: m.minor, segs });
      }
    }
    if (returns.length === 0) {
      if (dropped.size > 0) {
        // why: decision 31 (PA3-02): this outbound's fares were present and are missing from the cell.
        partial = true;
        notes.add('returns-dropped-for-outbound');
        for (const reason of dropped) legDrops.add(reason);
      } else notes.add('no-return-legs-for-outbound'); // spec §5.4: contributes nothing, not a failure
      continue;
    }
    withLegs += 1;
    // why: never invent a seller (plan decision 24): only an airline the vendor states names a step-2 offer.
    const airline = statedAirline(out.option.flights);
    if (airline === null) {
      notes.add('no-airline-skipped-step2', returns.length);
      // why: plan decision 41: the vendor priced these returns and none can be written, so the cell's minimum may be
      // above the vendor's; it is never written complete.
      partial = true;
    }
    const step2Offer = (r: Usable): RawOffer | null =>
      airline === null
        ? null
        : {
            outbound: out.segs,
            inbound: r.segs,
            seller: airline,
            requestedCabin: q.cabin,
            amountMinor: r.minor,
            currency: r2.currency,
            booking: { kind: 'none' },
            // why: a step-2 price is SearchApi's declaration of Google's fare for the airline, never a seller
            // listing (plan decision 27): WP7 writes it unverified, whatever later happens at step 3.
            verified: false,
          };
    const cheapest = returns.reduce((m, r) => (r.minor < m.minor ? r : m));
    for (const r of returns) if (r !== cheapest) add(step2Offer(r));
    const direct = step2Offer(cheapest);
    const bookingToken = cheapest.option.booking_token;
    if (bookingToken === undefined) {
      // why: spec §5.4: step 3 always runs, because a seller can undercut the airline; without it the cell is partial.
      notes.add('no-booking-token-step2');
      partial = true;
      add(direct);
      continue;
    }
    let step3: RawOffer[];
    try {
      const s3 = await send(d, { ...base, booking_token: bookingToken }, ctx);
      fetched.push(s3.fetchedAt);
      const r3 = parseBooking(s3.body, gl);
      if (!currencySupported(r3.currency)) legDrops.add('currency-unsupported');
      step3 = bookingOffers(
        { cabin: q.cabin, outbound: out.segs, inbound: cheapest.segs },
        r3.options,
        r3.currency,
        notes,
      );
      // why: seller prices step 3 exists to find were present but unusable, so the cheapest may be lower than shown
      // (PA2-03); only split bookings are excluded by rule and leave the result whole.
      if (step3.length === 0 && r3.options.some((o) => o.is_split_booking !== true)) {
        partial = true;
        notes.add('booking-options-unusable-step3');
      }
    } catch (err) {
      if (isExpansionFailure(err)) {
        // why: spec §5.4: a failed step 3 keeps the step-2 airline offer and the cell is priced with partial: true.
        partial = true;
        notes.add('booking-options-failed');
        add(direct);
        continue;
      }
      if (isChainStop(err)) {
        add(direct);
        if (offers.length > 0) {
          stop = err;
          break;
        }
      }
      throw err;
    }
    offers.push(...step3);
    if (direct !== null && !step3NamesAirline(step3, direct.seller)) {
      add(direct);
      if (step3.length > 0) notes.add('airline-direct-kept');
    }
  }

  if (stop !== null) {
    notes.add(stop instanceof BudgetExceeded ? 'chain-stopped-budget' : 'chain-stopped-abort');
    d.log.info(
      { offers: offers.length, notes: notes.list() },
      'searchapi chain stopped; returning the offers already paid for',
    );
  } else if (withLegs === 0 && legDrops.has('currency-unsupported')) {
    throw currencyUnsupported(
      `searchapi step 2: return prices in a currency with no known minor-unit exponent`,
    );
  } else if (withLegs === 0 && legDrops.size > 0) {
    throw parseError(
      'unusable-return-prices',
      'step 2: every priced return had an unusable price',
      SEARCHAPI_WHERE,
    );
  } else if (withLegs === 0) {
    throw new ProviderError({
      kind: 'upstream',
      reason: 'no-return-legs',
      retryable: false,
      providerId: 'searchapi',
      message: `searchapi: ${expand.length} outbound expansions produced no return legs (${failed} failed)`,
    });
  }
  if (offers.length === 0) {
    // why: decision 31 (PA3-01): the vendor priced return legs but no offer survived (no stated airline and no usable
    // step-3 listing). A priced result without offers would be written `empty`, positive evidence of no fares.
    if (legDrops.has('currency-unsupported'))
      throw currencyUnsupported(
        'searchapi: no usable offer; prices in a currency with no known minor-unit exponent',
      );
    throw parseError(
      'no-usable-offers',
      `priced legs but no offer attributable to a stated seller (${notes.list().join(', ')})`,
      SEARCHAPI_WHERE,
    );
  }
  const fetchedAt = fetched.reduce((a, b) => (b < a ? b : a));
  d.log.debug(
    { offers: offers.length, failedExpansions: failed, notes: notes.list() },
    'searchapi itinerary chain parsed',
  );
  return {
    offers,
    coverage: 'priced',
    fetchedAt,
    pointOfSale: r1.pointOfSale,
    partial: partial || failed > 0 || stop !== null,
    failedExpansions: failed,
    notes: notes.list(),
    routeHistory,
  };
}
