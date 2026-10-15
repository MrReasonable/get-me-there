/**
 * Travelpayouts / Aviasales Data API adapter (WP6). Spec §2 (Travelpayouts row, fact 1), §5.1, §5.2 (rev 14), §6.9,
 * §8.1. Discovery only: cached round-trip prices from /aviasales/v3/prices_for_dates, one month tile per
 * (origin, destination) pair and departure month, queried by the metro code when two or more of the definition's
 * origins share it, every page through http-kit. Returns raw vendor shapes; the engine normalises (spec §5.6).
 * No airport is named here (spec §1).
 */
import {
  type Cabin,
  type CapabilityInfo,
  type Clock,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type Logger,
  type ProviderContext,
  ProviderError,
  type Secret,
  type SuppliedField,
  type TilePlan,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import { NoteCounter } from '../shared/notes.js';
import { FIXED_PARAMS, PRICES_FOR_DATES_PATH, TRAVELPAYOUTS_HOST } from './params.js';
import { cacheableBody, readEnvelope } from './response.js';
import { type MetroLookup, planMonthTiles, type TileParams, tileParams } from './tiles.js';

/**
 * Spec §2 Travelpayouts row: authorised-cached, 48 h. The vendor says prices_for_dates holds round-trip prices
 * (one_way=false) that Aviasales users found within the last 48 hours (docs/providers.md, help article 203956163);
 * rows carry no timestamp (spike fact 1), so the 48 hours is the vendor's declared horizon, never a measured age, and
 * the note attributes the whole description to the vendor. The vendor states no passenger count, so the note names
 * none (ruling 4); WP13's smoke row compares a recorded price with the vendor's own search page. The note avoids every
 * §11 banned word (tested).
 */
export const TRAVELPAYOUTS_INFO: CapabilityInfo = {
  sourceKind: 'authorised-cached',
  maxAgeHours: 48,
  provenanceNote:
    "Travelpayouts describes these as cached round-trip prices that Aviasales users found within the last 48 hours (vendor's declaration; rows carry no timestamp). From the authorised Travelpayouts Data API. Economy only; point of sale unknown; not a fare quote; constraints are not checked.",
};
/**
 * Spec §5.2: from recorded fixtures only. A row names one airline, one flight number and transfer counts, which is
 * not a segment list, so only the price is supplied; Task 6.9 pins the recorded row keys so a new field fails a test.
 */
export const TRAVELPAYOUTS_SUPPLIED_FIELDS: readonly SuppliedField[] = ['price'];
/** Spec §2 fact 1 and §5.2: trip_class is ignored, so economy only; the engine never calls this provider for another cabin. */
export const TRAVELPAYOUTS_CABINS: readonly Cabin[] = ['economy'];
/** Spec §2: market is ignored, so every tile's point of sale is unknown. */
export const TRAVELPAYOUTS_POINT_OF_SALE = 'unknown' as const;
/** The plan's constructor options, field for field. */
export interface TravelpayoutsProviderOptions {
  http: HttpKit;
  log: Logger;
  /** Kept for every adapter (plan decision 24); timestamps come from http-kit's fetchedAt. */
  clock: Clock;
  /** TRAVELPAYOUTS_TOKEN; sent only in the X-Access-Token header (spec §2 fact 8). Must not be empty. */
  token: Secret;
  /**
   * Response cache window: TRAVELPAYOUTS_CACHE_TTL_HOURS × 3600. Inside it, a sibling pair's identical metro request
   * is a cache hit. 0 disables that dedup: upstream calls become O × D × M instead of D × M (logged at construction).
   */
  cacheTtlSeconds: number;
  paramsAllowlist: ParamsAllowlist;
  airports: MetroLookup;
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

/** Spec §5.1 FlightProvider for Travelpayouts. First cut: one page, rows counted but not yet attributed (Task 6.5). */
export function travelpayoutsProvider(opts: TravelpayoutsProviderOptions): FlightProvider {
  const log = opts.log.child({ providerId: 'travelpayouts' });

  async function fetchTile(
    plan: TilePlan,
    q: DiscoveryQuery,
    ctx: ProviderContext,
  ): Promise<DiscoveryTileResult> {
    const tp = tileParams(plan, q, opts.airports);
    const url = buildRequestUrl(tp, 1);
    // why: fail closed before anything leaves the process (spec §5.2 allowlist of names and values).
    assertRequestAllowed(opts.paramsAllowlist, PRICES_FOR_DATES_PATH, url);
    try {
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
      });
      const env = readEnvelope(res.body);
      const notes = new NoteCounter();
      notes.add('rows-received', env.rows.length);
      notes.add('pages', 1);
      return {
        kind: 'tile',
        index: plan.index,
        coveredCells: plan.coveredCells,
        fetchedAt: res.fetchedAt,
        pointOfSale: TRAVELPAYOUTS_POINT_OF_SALE,
        prices: [],
        noFares: [],
        notes: notes.list(),
      };
    } catch (e) {
      // why: BudgetExceeded and AbortedError belong to the engine (spec §8.1); only ProviderError becomes a tile-error.
      if (e instanceof ProviderError) {
        log.warn({ tileIndex: plan.index, kind: e.kind, message: e.message }, 'travelpayouts tile failed');
        return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error: e };
      }
      throw e;
    }
  }

  return {
    id: 'travelpayouts',
    displayName: 'Aviasales cache',
    suppliedFields: TRAVELPAYOUTS_SUPPLIED_FIELDS,
    cabins: TRAVELPAYOUTS_CABINS,
    discovery: { info: TRAVELPAYOUTS_INFO, plan: (q) => planMonthTiles(q), fetchTile },
    healthcheck: async () => ({ ok: true, detail: 'token configured' }),
  };
}
