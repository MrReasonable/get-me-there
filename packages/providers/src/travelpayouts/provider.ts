/**
 * Travelpayouts / Aviasales Data API adapter (WP6). Spec §2 (Travelpayouts row, fact 1), §5.1, §5.2 (rev 17), §6.9,
 * §8.1. Discovery only: cached round-trip prices from /aviasales/v3/prices_for_dates, one month tile per
 * (origin airport, destination airport) pair and departure month, always queried by airport code and never by metro
 * code (plan decision 34, spec rev 17), every page through http-kit. Returns raw vendor shapes; the engine normalises (spec §5.6).
 * No airport is named here (spec §1).
 */
import {
  type Cabin,
  type CapabilityInfo,
  type CellIssue,
  type Clock,
  cellKeyString,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type IsoDateTime,
  type Logger,
  type ProviderContext,
  ProviderError,
  type Secret,
  type SuppliedField,
  type TilePlan,
} from '@gmt/core';
import { canonicalJson } from '../http/recorder.js';
import type { HttpKit } from '../http/types.js';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import { parseError } from '../shared/errors.js';
import { FIXED_PARAMS, PAGE_LIMIT, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST } from './params.js';
import { attributeRows, cacheableBody, type ResponseCurrency, readEnvelope, WHERE } from './response.js';
import { planMonthTiles, type TileParams, tileParams } from './tiles.js';

/**
 * Spec §2 Travelpayouts row: authorised-cached, 48 h. The vendor says prices_for_dates holds round-trip prices
 * (one_way=false) that Aviasales users found within the last 48 hours (docs/providers.md, help article 203956163), so
 * the note attributes that description to the vendor. Rows carry no `found_at`, but each row's own link carries the
 * day it was searched and the recordings show rows 4 to 7 days old, so that day is the row's observation time
 * (plan decision 35; searchedAt) and the 48 hours is only the fallback for a link without it. The vendor states no
 * passenger count, so the note names none (ruling 4); WP13's smoke row compares a recorded price with the vendor's own
 * search page. "Economy" is the spec's treatment, not a vendor statement. The note avoids every §11 banned word (tested).
 */
/** The vendor's declared freshness window in hours; also the longest response-cache TTL accepted. */
const MAX_AGE_HOURS = 48;
export const TRAVELPAYOUTS_INFO: CapabilityInfo = {
  sourceKind: 'authorised-cached',
  maxAgeHours: MAX_AGE_HOURS,
  provenanceNote:
    "Travelpayouts describes these as cached round-trip prices that Aviasales users found within the last 48 hours (vendor's declaration). A row's own search link carries the day it was searched, which is used as its observation time; the 48 hours applies only to a row whose link has no search date. From the authorised Travelpayouts Data API; cabin not stated by the vendor, treated as economy; point of sale unknown; not a fare quote; constraints are not checked.",
};
/**
 * Spec §5.2: from recorded fixtures only. A row names one airline, one flight number and transfer counts, which is
 * not a segment list, so only the price is supplied; Task 6.9 pins the recorded row keys so a new field fails a test.
 */
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[] = ['price'];
/** Spec §5.2: treated as economy only (the vendor states no cabin); the engine never calls this provider for another cabin. */
export const TRAVELPAYOUTS_CABINS: readonly Cabin[] = ['economy'];
/** Spec §2: no market is sent and the vendor derives it from the origin, so every tile's point of sale is unknown. */
export const TRAVELPAYOUTS_POINT_OF_SALE = 'unknown' as const;
/**
 * Most pages read for one tile. why: a loop guard. 3 pages (3000 rows) is the cap WP4b's recorder uses (plan decision
 * 26), so every page the adapter can ask for is one a recording can hold, and it bounds the free calls a vendor that
 * ignores `page` could cost (each page is a ledger row). The recorded worked-example months hold at most 4 rows and one
 * page each; the replay test fails if a recorded tile ever reaches the cap. A tile that reaches it is marked `truncated` (its priced cells hold the cheapest
 * of the rows read) and reports an `upstream` issue for each covered cell it did not price (spec §3: an unsearched
 * cell never reads as searched).
 */
export const MAX_PAGES = 3;

/** The plan's constructor options, field for field. */
export interface TravelpayoutsProviderOptions {
  http: HttpKit;
  log: Logger;
  /** Kept for every adapter (plan decision 24); timestamps come from http-kit's fetchedAt. */
  clock: Clock;
  /** TRAVELPAYOUTS_TOKEN; sent only in the X-Access-Token header (spec §2 fact 8). Must not be empty. */
  token: Secret;
  /**
   * Response cache window: TRAVELPAYOUTS_CACHE_TTL_HOURS × 3600. Inside it, a repeat of an identical request (a
   * re-run or resumed scan) is a cache hit; every pair's tile is its own request, so there is no sibling dedup.
   */
  cacheTtlSeconds: number;
  paramsAllowlist: ParamsAllowlist;
}

/** The request URL for one page of a tile. The token never appears here (spec §2 fact 8: header only). */
export function buildRequestUrl(tp: TileParams, page: number): URL {
  const url = new URL(`https://${TRAVELPAYOUTS_HOST}${PRICES_FOR_DATES_PATH}`);
  url.searchParams.set('origin', tp.origin);
  url.searchParams.set('destination', tp.destination);
  url.searchParams.set('departure_at', tp.month);
  for (const [name, value] of Object.entries(FIXED_PARAMS)) url.searchParams.set(name, value);
  url.searchParams.set('page', String(page));
  return url;
}

const older = (a: IsoDateTime | undefined, b: IsoDateTime): IsoDateTime => (a === undefined || b < a ? b : a);

/** Spec §5.1 FlightProvider for Travelpayouts: discovery capability only, no verification. */
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  if (!Number.isSafeInteger(opts.cacheTtlSeconds) || opts.cacheTtlSeconds < 0) {
    throw new Error('travelpayoutsProvider: cacheTtlSeconds must be a non-negative integer');
  }
  // why: a cached body older than the vendor's own freshness window would replay as current scan input.
  const maxTtl = MAX_AGE_HOURS * 3600;
  if (opts.cacheTtlSeconds > maxTtl) {
    throw new Error(
      `travelpayoutsProvider: cacheTtlSeconds must not exceed the ${maxTtl} s freshness window`,
    );
  }
  // why: fail closed; an empty token could only produce 401s, each a ledger row and a disabled provider.
  if (opts.token.reveal().length === 0)
    throw new Error('travelpayoutsProvider: TRAVELPAYOUTS_TOKEN is empty');
  const log = opts.log.child({ providerId: 'travelpayouts' });

  function tileError(plan: TilePlan, error: ProviderError): DiscoveryTileResult {
    log.warn(
      { tileIndex: plan.index, kind: error.kind, message: error.message },
      'travelpayouts tile failed',
    );
    return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error };
  }

  /** Every page of one tile, in order; throws ProviderError (classified or parse), BudgetExceeded or AbortedError. */
  async function readPages(plan: TilePlan, tp: TileParams, ctx: ProviderContext) {
    const rows: unknown[] = [];
    let currency: ResponseCurrency | undefined;
    let fetchedAt: IsoDateTime | undefined;
    let previous: string | undefined;
    let pages = 0;
    let truncated = false;
    for (let page = 1; ; page += 1) {
      const url = buildRequestUrl(tp, page);
      // why: fail closed before anything leaves the process (spec §5.2 allowlist of names and values).
      assertRequestAllowed(opts.paramsAllowlist, PRICES_FOR_DATES_PATH, url);
      const res = await opts.http.request({
        providerId: 'travelpayouts',
        executionId: ctx.executionId,
        tileIndex: plan.index,
        endpointPath: PRICES_FOR_DATES_PATH,
        method: 'GET',
        url,
        headers: { 'X-Access-Token': opts.token.reveal(), Accept: 'application/json' },
        cache: { ttlSeconds: opts.cacheTtlSeconds, accept: cacheableBody },
        signal: ctx.signal,
        recordFixtures: ctx.recordFixtures,
        // why: the ledger's unit is the tile (plan decision 24); only the first page of a cached tile leaves a row.
        ledgerCacheHit: page === 1,
      });
      pages += 1;
      // why: spec §2, fetchedAt of a multi-call result is the oldest call; ISO strings order lexically.
      fetchedAt = older(fetchedAt, res.fetchedAt);
      const env = readEnvelope(res.body);
      // why: every page states its own currency (spec §2), so no page's amounts take another page's currency.
      if (currency !== undefined && env.currency.code !== currency.code) {
        throw parseError(
          'currency-changed-between-pages',
          `page ${page} is in ${env.currency.code}, page 1 in ${currency.code}`,
          WHERE,
        );
      }
      currency = env.currency;
      rows.push(...env.rows);
      if (env.rows.length < PAGE_LIMIT) break;
      // why: a vendor that ignores `page` returns the same full page forever; stop at the second copy (cost-wp06-004).
      const fingerprint = canonicalJson(env.rows);
      if (fingerprint === previous)
        throw parseError('page-repeated', `page ${page} repeats page ${page - 1}`, WHERE);
      previous = fingerprint;
      if (page === MAX_PAGES) {
        truncated = true;
        break;
      }
    }
    // why: unreachable; the loop runs at least once and sets both (kept for the type checker).
    if (currency === undefined || fetchedAt === undefined) throw new Error('travelpayouts: no page was read');
    return { rows, currency, fetchedAt, pages, truncated };
  }

  /**
   * Spec §5.2: one tile, all of its pages (limit=1000, page=1..n until a short page, at most MAX_PAGES), each sent
   * through http-kit under the tile's index. Spec §8.1: a ProviderError on any page makes the whole tile a
   * tile-error (no partial prices); BudgetExceeded and AbortedError propagate to the engine.
   */
  async function fetchTile(
    plan: TilePlan,
    q: DiscoveryQuery,
    ctx: ProviderContext,
  ): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, q);
    let read: Awaited<ReturnType<typeof readPages>>;
    let attribution: ReturnType<typeof attributeRows>;
    try {
      read = await readPages(plan, tp, ctx);
      attribution = attributeRows(read.rows, {
        coveredCells: plan.coveredCells,
        origin: tp.origin,
        destination: tp.destination,
        minNights: q.minNights,
        maxNights: q.maxNights,
        currency: read.currency,
      });
    } catch (e) {
      // why: only classified vendor failures become a tile-error; no adapter-level retry (spec §5.2).
      if (e instanceof ProviderError) return tileError(plan, e);
      throw e;
    }
    const { notes } = attribution;
    // why: an airport-code query returns rows for that airport only (decision 34). A row for another origin or
    // destination means the request was not an airport pair (for example a metro code reached the adapter), and
    // pricing nothing would read every covered cell as no_data, so the tile fails loudly instead (decision 35).
    const foreign = notes.get('dropped-other-origin') + notes.get('dropped-other-destination');
    if (foreign > 0) {
      return tileError(
        plan,
        parseError(
          'airport-mismatch',
          `${foreign} row${foreign === 1 ? '' : 's'} named an airport other than ${tp.origin} to ${tp.destination}; Travelpayouts is queried by airport code only`,
          WHERE,
        ),
      );
    }
    notes.add('rows-received', read.rows.length);
    notes.add('pages', read.pages);
    const cellIssues: CellIssue[] = [...attribution.cellIssues];
    if (read.truncated) {
      // why: spec §3, rows on unread pages may price any cell still without one, so each such cell is an error
      // (reason upstream), never no_data; cells already priced or already reported keep their result (ruling 10).
      notes.add('pages-truncated', MAX_PAGES);
      const done = new Set([
        ...attribution.prices.map(cellKeyString),
        ...cellIssues.map((i) => cellKeyString(i.cell)),
      ]);
      for (const cell of plan.coveredCells) {
        if (done.has(cellKeyString(cell))) continue;
        cellIssues.push({
          cell,
          reason: 'upstream',
          offersDropped: 0,
          detail: `pagination truncated at ${MAX_PAGES} pages`,
        });
      }
    }
    log.debug(
      { tileIndex: plan.index, prices: attribution.prices.length, notes: notes.list() },
      'travelpayouts tile read',
    );
    return {
      kind: 'tile',
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt: read.fetchedAt,
      pointOfSale: TRAVELPAYOUTS_POINT_OF_SALE,
      prices: attribution.prices,
      // why: a cache never proves "no fares", so noFares is always empty (spec §5.2 authorised-cached).
      noFares: [],
      notes: notes.list(),
      ...(cellIssues.length > 0 ? { cellIssues } : {}),
      // why: prices on a capped tile are the cheapest of the rows read; WP7 labels them so (ruling 5).
      ...(read.truncated ? { truncated: true } : {}),
    };
  }

  return {
    id: 'travelpayouts',
    displayName: 'Aviasales cache',
    suppliedFields: TRAVELPAYOUTS_SUPPLIED_FIELDS,
    cabins: TRAVELPAYOUTS_CABINS,
    discovery: { info: TRAVELPAYOUTS_INFO, plan: (q) => planMonthTiles(q), fetchTile },
    // why: stateless like every adapter (plan decision 24). A probe needs an airport pair, and no airport is named in
    // code (spec §1); the token was checked at construction.
    healthcheck: async () => ({
      ok: true,
      detail: 'not probed: token configured; the healthcheck sends no request',
    }),
  };
}
