import {
  type Cabin,
  type CapabilityInfo,
  type CellKey,
  type Clock,
  cabinSchema,
  cellKeyString,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  fromEpochDay,
  type IsoDateTime,
  type ItineraryQuery,
  type ItinerarySearchResult,
  type Logger,
  type PointOfSale,
  type ProviderContext,
  ProviderError,
  type RawCalendarPrice,
  type RawOffer,
  type SuppliedField,
  type SyntheticGateInput,
  syntheticAllowed,
  type TilePlan,
  toEpochDay,
} from '@gmt/core';
import type { HttpKit, HttpKitRequest, HttpKitResponse, ProviderHttpLimits } from '../http/types.js';
import { isExpansionFailure, parseError } from '../shared/errors.js';
import { NoteCounter } from '../shared/notes.js';
import { isRecord } from '../util.js';
import { FIXTURE_HOST, FIXTURE_ORIGIN } from './constants.js';
import { dated, envelope, offersOf, where } from './shapes.js';

/** Departure days per discovery tile. */
export const FIXTURE_TILE_DAYS = 7;
/** TTL for calendar responses the server marks cacheable. */
export const FIXTURE_CALENDAR_TTL_SECONDS = 3600;

/** Every cabin; the list is core's (arch-r2-008). */
const CABINS: readonly Cabin[] = cabinSchema.options;
const SUPPLIED: readonly SuppliedField[] = [
  'segments',
  'segmentTimes',
  'segmentCabins',
  'selfTransfer',
  'baggage',
  'seller',
  'price',
];
const INFO: CapabilityInfo = {
  sourceKind: 'synthetic',
  provenanceNote:
    'synthetic data from the fixture provider, generated for tests and local development; not a fare',
  maxAgeHours: 0,
};
/** Synthetic data has no market; spec §5.1 requires pointOfSale on every result. */
const FIXTURE_POINT_OF_SALE: PointOfSale = 'unknown';

/**
 * HTTP limits for the fixture provider (spec §5.3 billable rule: `fixture` iff HTTP 200 at the configured test cost;
 * spec §9 item 2: host allowlist is fixture.local only). WP4b's httpLimitsFor uses this.
 */
export function fixtureHttpLimits(o: {
  costPerCallMicroGbp: number;
  maxWaitSeconds: number;
  requestTimeoutSeconds: number;
}): ProviderHttpLimits {
  return {
    hosts: [FIXTURE_HOST],
    ratePerMinute: 6000,
    ratePerHour: 360_000,
    concurrency: 4,
    billable: 'http-200',
    costPerCallMicroGbp: o.costPerCallMicroGbp,
    maxWaitSeconds: o.maxWaitSeconds,
    requestTimeoutSeconds: o.requestTimeoutSeconds,
  };
}

function enumerate(q: DiscoveryQuery): CellKey[] {
  const out: CellKey[] = [];
  for (let d = toEpochDay(q.departureFrom); d <= toEpochDay(q.departureTo); d += 1) {
    for (let n = q.minNights; n <= q.maxNights; n += 1) {
      out.push({
        origin: q.origin,
        destination: q.destination,
        departureDate: fromEpochDay(d),
        returnDate: fromEpochDay(d + n),
      });
    }
  }
  return out;
}

/**
 * Pure, deterministic tiling (spec §5.2): blocks of FIXTURE_TILE_DAYS departure days from `departureFrom`, each a
 * `rectangle` spanning its covered cells. With `q.cells` set, re-plans over that subset. Tiles partition the cells.
 */
export function planFixtureTiles(q: DiscoveryQuery): TilePlan[] {
  // why: a cell of another pair would fall in no tile and vanish unreported; same refusal as the Travelpayouts tiler.
  if (q.cells?.some((c) => c.origin !== q.origin || c.destination !== q.destination))
    throw new Error('planFixtureTiles: every cell must belong to the query pair');
  const cells = q.cells ?? enumerate(q);
  const start = toEpochDay(q.departureFrom);
  const blocks = new Map<number, CellKey[]>();
  for (const c of cells) {
    const b = Math.floor((toEpochDay(c.departureDate) - start) / FIXTURE_TILE_DAYS);
    const list = blocks.get(b);
    if (list) list.push(c);
    else blocks.set(b, [c]);
  }
  return [...blocks.keys()]
    .sort((a, b) => a - b)
    .map((b, index): TilePlan => {
      const covered = blocks.get(b) ?? [];
      const deps = covered.map((c) => c.departureDate).sort();
      const rets = covered.map((c) => c.returnDate).sort();
      const departFrom = deps[0];
      const departTo = deps[deps.length - 1];
      const returnFrom = rets[0];
      const returnTo = rets[rets.length - 1];
      if (
        departFrom === undefined ||
        departTo === undefined ||
        returnFrom === undefined ||
        returnTo === undefined
      )
        throw new Error('planFixtureTiles: empty block');
      return {
        index,
        coveredCells: covered,
        request: { kind: 'rectangle', departFrom, departTo, returnFrom, returnTo },
      };
    });
}

const older = (a: IsoDateTime | undefined, b: IsoDateTime): IsoDateTime => (a === undefined || b < a ? b : a);

/**
 * The fixture provider (spec §5.5): an ordinary HTTP adapter against http://fixture.local through the real
 * http-kit, constructed only when syntheticAllowed(config). Every price is sourceKind 'synthetic'.
 */
export function fixtureProvider(opts: {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  config: SyntheticGateInput;
  costMicroGbp: number;
}): FlightProvider {
  if (!syntheticAllowed(opts.config))
    throw new Error('fixture provider refused: syntheticAllowed(config) is false (spec §5.5)');
  const log = opts.log.child({ providerId: 'fixture' });

  const call = (
    endpointPath: string,
    params: Record<string, string>,
    ctx: ProviderContext,
    tileIndex: number | null,
    cache: HttpKitRequest['cache'],
    ledgerCacheHit = true,
  ): Promise<HttpKitResponse> => {
    const url = new URL(endpointPath, FIXTURE_ORIGIN);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    // why: recordFixtures is always false — synthetic data is never recorded (spec §5.5).
    return opts.http.request({
      providerId: 'fixture',
      executionId: ctx.executionId,
      tileIndex,
      endpointPath,
      method: 'GET',
      url,
      headers: { accept: 'application/json' },
      cache,
      signal: ctx.signal,
      recordFixtures: false,
      // why: a later page of a paginated tile leaves no cache-hit row, so parity counts one row per tile (spec §8.1).
      ledgerCacheHit,
    });
  };
  // why: cached only when the server marks the body cacheable, so layer-A scenarios are never masked by default.
  const calendarCache: HttpKitRequest['cache'] = {
    ttlSeconds: FIXTURE_CALENDAR_TTL_SECONDS,
    accept: (b) => isRecord(b) && b.synthetic === true && b.cacheable === true,
  };

  async function fetchTile(
    plan: TilePlan,
    q: DiscoveryQuery,
    ctx: ProviderContext,
  ): Promise<DiscoveryTileResult> {
    const fail = (error: ProviderError): DiscoveryTileResult => ({
      kind: 'tile-error',
      index: plan.index,
      coveredCells: plan.coveredCells,
      error,
    });
    const r = plan.request;
    if (r.kind !== 'rectangle')
      return fail(parseError(`unsupported-tile-${r.kind}`, null, where('/calendar')));
    const params = {
      origin: q.origin,
      destination: q.destination,
      departFrom: r.departFrom,
      departTo: r.departTo,
      returnFrom: r.returnFrom,
      returnTo: r.returnTo,
      cabin: q.cabin,
      currency: q.currency,
    };
    const covered = new Map(plan.coveredCells.map((c) => [cellKeyString(c), c]));
    const prices: RawCalendarPrice[] = [];
    const noFares: CellKey[] = [];
    let dropped = 0;
    let fetchedAt: IsoDateTime | undefined;
    try {
      let page = 1;
      let pages = 1;
      do {
        const res = await call(
          '/calendar',
          page === 1 ? params : { ...params, page: String(page) },
          ctx,
          plan.index,
          calendarCache,
          page === 1,
        );
        // why: a multi-call result carries the oldest call's fetchedAt (spec §2).
        fetchedAt = older(fetchedAt, res.fetchedAt);
        const { b, currency } = envelope('/calendar', res.body, q.origin, q.destination);
        const { prices: rawPrices, noFares: rawNoFares, pages: total } = b;
        if (
          !Array.isArray(rawPrices) ||
          !Array.isArray(rawNoFares) ||
          typeof total !== 'number' ||
          !Number.isInteger(total) ||
          total < 1
        )
          throw parseError('malformed-envelope', null, where('/calendar'));
        pages = total;
        for (const raw of rawPrices) {
          const { departureDate, returnDate, e } = dated('/calendar', raw);
          const amount = e.amountMinor;
          if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0)
            throw parseError('malformed-entry', null, where('/calendar'));
          const cell = covered.get(
            cellKeyString({ origin: q.origin, destination: q.destination, departureDate, returnDate }),
          );
          if (cell === undefined) dropped += 1;
          else
            prices.push({
              ...cell,
              amountMinor: amount,
              currency,
              returnDateSource: 'vendor',
              vendorPriceMark: null,
            });
        }
        for (const raw of rawNoFares) {
          const { departureDate, returnDate } = dated('/calendar', raw);
          const cell = covered.get(
            cellKeyString({ origin: q.origin, destination: q.destination, departureDate, returnDate }),
          );
          if (cell === undefined) dropped += 1;
          else noFares.push(cell);
        }
        page += 1;
      } while (page <= pages);
    } catch (e) {
      // why: spec §8.1 — a ProviderError marks exactly this tile's cells; AbortedError and BudgetExceeded propagate.
      if (e instanceof ProviderError) return fail(e);
      throw e;
    }
    if (fetchedAt === undefined) throw new Error('fetchTile: no page fetched');
    // why: one notes grammar in the package (shared NoteCounter); an entry for no covered cell is outside this tile.
    const notes = new NoteCounter();
    notes.add('dropped-outside-tile', dropped);
    log.debug(
      { tileIndex: plan.index, prices: prices.length, noFares: noFares.length, dropped },
      'fixture tile',
    );
    return {
      kind: 'tile',
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt,
      pointOfSale: FIXTURE_POINT_OF_SALE,
      prices,
      noFares,
      notes: notes.list(),
    };
  }

  async function search(q: ItineraryQuery, ctx: ProviderContext): Promise<ItinerarySearchResult> {
    const params = {
      origin: q.origin,
      destination: q.destination,
      departureDate: q.departureDate,
      returnDate: q.returnDate,
      cabin: q.cabin,
      currency: q.currency,
      expandTop: String(q.expandTop),
    };
    const first = await call('/itinerary', params, ctx, null, 'never');
    const { b, currency } = envelope('/itinerary', first.body, q.origin, q.destination);
    const noReturnLegs = (): ProviderError =>
      new ProviderError({
        kind: 'upstream',
        retryable: false,
        providerId: 'fixture',
        reason: 'no-return-legs',
        message: 'fixture /itinerary: outbound options but no return legs',
      });
    const result = (
      offers: RawOffer[],
      failedExpansions: number,
      notes: string[],
      fetchedAt: IsoDateTime,
    ): ItinerarySearchResult => ({
      offers,
      coverage: offers.length > 0 ? 'priced' : 'empty',
      fetchedAt,
      pointOfSale: FIXTURE_POINT_OF_SALE,
      partial: failedExpansions > 0,
      failedExpansions,
      notes,
    });

    if (b.chain === true) {
      const outbounds = b.outbounds;
      if (!Array.isArray(outbounds) || !outbounds.every((o): o is string => typeof o === 'string'))
        throw parseError('malformed-envelope', null, where('/itinerary'));
      const offers: RawOffer[] = [];
      const notes: string[] = [];
      let failed = 0;
      let fetchedAt = first.fetchedAt;
      for (const outbound of outbounds.slice(0, q.expandTop)) {
        try {
          const ret = await call('/itinerary/return', { ...params, outbound }, ctx, null, 'never');
          fetchedAt = older(fetchedAt, ret.fetchedAt);
          const step = envelope('/itinerary/return', ret.body, q.origin, q.destination);
          offers.push(...offersOf('/itinerary/return', step.b, q, step.currency));
        } catch (e) {
          // why: spec §5.4 rev 12 — only a vendor or transport failure (upstream, network, parse) is a failed expansion;
          // auth, quota, rate-limit and limiter-timeout refusals, budget and abort stop the chain unchanged.
          if (!isExpansionFailure(e)) throw e;
          failed += 1;
          continue;
        }
        try {
          const book = await call('/itinerary/booking', { ...params, outbound }, ctx, null, 'never');
          fetchedAt = older(fetchedAt, book.fetchedAt);
          const step = envelope('/itinerary/booking', book.body, q.origin, q.destination);
          offers.push(...offersOf('/itinerary/booking', step.b, q, step.currency));
        } catch (e) {
          if (!isExpansionFailure(e)) throw e;
          notes.push(`booking-step-failed:${outbound}`);
        }
      }
      if (outbounds.length > 0 && offers.length === 0) throw noReturnLegs();
      return result(offers, failed, notes, fetchedAt);
    }

    const { outboundOptions, failedExpansions } = b;
    if (typeof outboundOptions !== 'number' || typeof failedExpansions !== 'number')
      throw parseError('malformed-envelope', null, where('/itinerary'));
    const offers = offersOf('/itinerary', b, q, currency);
    if (outboundOptions > 0 && offers.length === 0) throw noReturnLegs();
    return result(offers, failedExpansions, [], first.fetchedAt);
  }

  return {
    id: 'fixture',
    displayName: 'Fixture provider (synthetic)',
    suppliedFields: SUPPLIED,
    cabins: CABINS,
    discovery: { info: INFO, plan: planFixtureTiles, fetchTile },
    verification: {
      info: INFO,
      // why: an upper bound matching the SearchApi shape (step 1 + return and booking per expanded outbound); plain pairs use fewer.
      estimate: (q) => ({
        calls: 1 + 2 * q.expandTop,
        costMicroGbp: (1 + 2 * q.expandTop) * opts.costMicroGbp,
        seconds: 1 + 2 * q.expandTop,
        notes: ['fixture provider: synthetic calls'],
      }),
      search,
    },
    healthcheck: async () => ({ ok: true, detail: 'synthetic fixture provider; no upstream call' }),
  };
}
