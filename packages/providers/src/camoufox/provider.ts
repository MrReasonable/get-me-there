/**
 * The camoufox adapter (spec §2, §5.1, §5.2 rev 32; decisions 68, 69; brief Task 14.8). Discovery: one list-mode
 * page per cell through the host-side worker (POST /v1/page, the key in `x-gmt-worker-key`), parsed with core's one
 * copy of the wire contract. A price is one RawCalendarPrice with its return date labelled as the date asked for; a
 * "no flights" page leaves the cell out of prices and noFares, so the engine writes `no_data`; every other answer is a
 * tile-error (answer.ts). Spec revision 55 §2: also the flight lists (`flightLists`, flights.ts; POST /v1/flights).
 * No airport is named here (spec §1).
 */
import {
  CAMOUFOX_CLOCK_SKEW_MS,
  type Cabin,
  type CapabilityInfo,
  type CellIssue,
  type Clock,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  formatPence,
  GRID_HORIZON_DAYS,
  GRID_STEP_DAYS,
  GRID_TIMES,
  type Logger,
  type PageRequest,
  type ProviderContext,
  type ProviderError,
  pageRequestSchema,
  type Secret,
  type SharedSettings,
  type SuppliedField,
  type TilePlan,
  workerAnswerSchema,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';
import { parseError } from '../shared/errors.js';
import { camoufoxKeepAwake } from './awake.js';
import { flightListCapability } from './flights.js';
import { gridTileEstimate, planGridTiles } from './grid.js';
import { gridTile } from './gridTile.js';
import { fetchedAtWithinRequest, postToWorker } from './post.js';
import { camoufoxPreflight } from './preflight.js';
import { planSingleCells } from './tiles.js';

export const CAMOUFOX_DISPLAY_NAME = 'Google Flights via Camoufox';
/** Spec §2 Labels, verbatim. */
export const CAMOUFOX_DISCOVERY_INFO: CapabilityInfo = {
  sourceKind: 'scraped-self',
  maxAgeHours: 0,
  provenanceNote:
    "Google Flights prices via Camoufox: the cheapest round-trip price Google Flights listed for this day pair when this app's own Camoufox browser read the page on the machine running this app's browser worker, from that machine's address, in the currency the page states. Return date: the date asked for, which the page's search form showed; the listed options state only the departure. The operator turned this provider on. Constraints are not checked; no return leg, seller or baggage is read.",
};
/**
 * Spec §2 rev 34 (grid mode): Google's own pre-aggregated date grid, so the same assumed 24 h age as the SearchApi
 * calendar (PA-03), whole pounds (PA-10), the return date from the cell, and Google's mark kept as Google's.
 */
export const CAMOUFOX_GRID_INFO: CapabilityInfo = {
  sourceKind: 'scraped-self',
  maxAgeHours: 24,
  maxAgeAssumed: true,
  returnDateSource: 'grid-cell',
  provenanceNote:
    "Google Flights date grid via Camoufox: the round-trip price Google's date grid showed for this day pair when this app's own Camoufox browser read the page on the machine running this app's browser worker, from that machine's address. The grid shows whole pounds; the exact fare may differ by under £1. Google's date grid; age not stated (assumed ≤24h). Return date: read from the grid cell, checked against the grid's return row. A \"cheapest\" or \"low\" mark means Google's date grid marked this price so among the prices shown in that view; it is Google's, not this app's. The operator turned this provider on. Constraints are not checked; no return leg, seller or baggage is read.",
};
export const CAMOUFOX_SUPPLIED_FIELDS: readonly SuppliedField[] = ['price'];
export const CAMOUFOX_CABINS: readonly Cabin[] = ['economy'];
const PAGE_PATH = '/v1/page';
const WHERE = { providerId: 'camoufox' as const, endpointPath: PAGE_PATH };
export const RETURN_DATE_LABEL = 'return date: the date asked for';
/** The clock difference tolerated between the app and the host worker: core's one value. */
export const CLOCK_SKEW_MS = CAMOUFOX_CLOCK_SKEW_MS;

export interface CamoufoxProviderOptions {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  key: Secret;
  workerUrl: string;
  pointOfSale: string;
  /** Spec §12: the app's effective shared settings, which the preflight compares with the worker's by name. */
  sharedSettings?: SharedSettings;
  /**
   * Decision 82: the app's instance digest (a SHA-256 of the host name and the database's real path), sent on every
   * request as APP_INSTANCE_HEADER so the worker can report a second app in a month.
   */
  appInstance?: string;
  /** Spec §2 rev 34: grid mode and its per-page scroll cap; absent or `list`: one page per cell. */
  grid?: {
    mode: 'list' | 'grid';
    scrollCap: number;
    /** CAMOUFOX_GRID_SCROLL_SPACING_SECONDS, which the preflight checks against the worker's. */
    scrollSpacingSeconds: number;
    /** CAMOUFOX_PAGE_TIMEOUT_SECONDS, which the preflight checks against the worker's in grid mode. */
    pageTimeoutSeconds: number;
  };
  /**
   * Spec rev 56 §2 "The return phase", §12 (ruling A6): the timeout of a flights request with a return phase, core's
   * `flightRequestSeconds` of the app's page timeout and spacing, computed once by the wiring: with the booking read
   * (780 s at the defaults) and without it (600 s); and a flights request without a return phase, core's
   * `listRequestSeconds` (210 s: two page periods plus 30 s; 21.6 review M7, final review A-I1; the engine's gate holds it
   * to the same). Every other request keeps the
   * provider's own timeout.
   */
  flightRequestSeconds: { booking: number; returnsOnly: number; outboundOnly: number };
}

/** The detail and dropped count stored on a priced cell (prov-001, prov-003, prov-005). */
export function priceIssue(
  cell: TilePlan['coveredCells'][number],
  p: { amountMinor: number; tabMinor: number | null; optionsUnparsed: number; optionsOtherCell: number },
): CellIssue {
  const tabBelow = p.tabMinor !== null && p.tabMinor < p.amountMinor;
  const parts = [RETURN_DATE_LABEL];
  if (p.optionsUnparsed > 0) parts.push(`options unread: ${p.optionsUnparsed}`);
  // why: the honesty rule (ruling of 2026-10-18): a lower fare under the Cheapest tab that was not read is named, and
  // the cell is partial (offersDropped), so the higher minimum never passes for the cell's cheapest
  if (tabBelow && p.tabMinor !== null)
    parts.push(
      `Google shows a lower fare under Cheapest that could not be read (${formatPence(p.tabMinor)})`,
    );
  if (p.optionsOtherCell > 0) parts.push(`options for another cell: ${p.optionsOtherCell}`);
  return {
    cell,
    reason: 'parse',
    offersDropped: p.optionsUnparsed + (tabBelow ? 1 : 0),
    detail: parts.join('; '),
  };
}

/**
 * Fix round 1 (prov I1): the page was read but every option was for another day or airport. The engine writes the cell
 * `error` with reason `parse` and this detail: never a block, never `no_data` or `empty`.
 */
export function noneForCellIssue(
  cell: TilePlan['coveredCells'][number],
  p: { optionsOtherCell: number; optionsUnparsed: number },
): CellIssue {
  const parts = ['no option for this cell', `options for another cell: ${p.optionsOtherCell}`];
  if (p.optionsUnparsed > 0) parts.push(`options unread: ${p.optionsUnparsed}`);
  return { cell, reason: 'parse', offersDropped: p.optionsUnparsed, detail: parts.join('; ') };
}

export function camoufoxProvider(o: CamoufoxProviderOptions): FlightProvider {
  if (o.key.reveal().length < 32)
    throw new Error('camoufoxProvider: CAMOUFOX_WORKER_KEY must be at least 32 characters');
  const log = o.log.child({ providerId: 'camoufox' });
  async function fetchTile(
    plan: TilePlan,
    q: DiscoveryQuery,
    ctx: ProviderContext,
  ): Promise<DiscoveryTileResult> {
    const fail = (error: ProviderError): DiscoveryTileResult => {
      log.warn({ tileIndex: plan.index, kind: error.kind, message: error.message }, 'camoufox tile failed');
      return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error };
    };
    if (plan.request.kind === 'grid-path') return fetchGrid(plan, plan.request, q, ctx, fail);
    const [cell] = plan.coveredCells;
    if (cell === undefined || plan.coveredCells.length !== 1)
      return fail(parseError('not-one-cell', 'a camoufox tile is one cell', WHERE));
    const request: PageRequest | null =
      q.airportNames === undefined
        ? null
        : (pageRequestSchema.safeParse({
            mode: 'list',
            origin: cell.origin,
            destination: cell.destination,
            departureDate: cell.departureDate,
            returnDate: cell.returnDate,
            gl: o.pointOfSale,
            airportNames: q.airportNames,
          }).data ?? null);
    // why: fail closed before any request: without the dataset's names the worker cannot tell this cell's options apart.
    if (request === null)
      return fail(parseError('no-airport-names', 'the query carries no valid airport names', WHERE));
    const started = o.clock.now();
    const sent = await postToWorker(o, { path: PAGE_PATH, body: request, tileIndex: plan.index, ctx });
    if (!sent.ok) return fail(sent.error);
    const body = sent.body;
    const a = workerAnswerSchema.safeParse(body);
    if (!a.success || a.data.kind !== 'cells')
      return fail(parseError('unknown-answer', 'the worker answered what this build cannot read', WHERE));
    const answer = a.data;
    // why: prov-010: the page was read between this request's start and now (post.ts's one rule, clock skew included)
    if (!fetchedAtWithinRequest(answer.fetchedAt, started, o.clock.now()))
      return fail(
        parseError('fetched-at-out-of-range', `fetchedAt ${answer.fetchedAt} is outside this request`, WHERE),
      );
    const base = {
      kind: 'tile' as const,
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt: answer.fetchedAt,
      pointOfSale: answer.pointOfSale,
      notes: answer.notes,
    };
    if (answer.cell.status === 'no-flights') return { ...base, prices: [], noFares: [] };
    if (answer.cell.status === 'none-for-cell')
      return { ...base, prices: [], noFares: [], cellIssues: [noneForCellIssue(cell, answer.cell)] };
    return {
      ...base,
      // why: spec §7 rev 34: list mode's return date is the one it asked for, which the search form showed
      prices: [
        {
          ...cell,
          amountMinor: answer.cell.amountMinor,
          currency: answer.currency,
          returnDateSource: 'asked',
          vendorPriceMark: null,
        },
      ],
      noFares: [],
      cellIssues: [priceIssue(cell, answer.cell)],
    };
  }

  /** One grid page (spec §2 rev 34): the path, its planned scrolls on the reservation, the answer mapped (gridTile.ts). */
  async function fetchGrid(
    plan: TilePlan,
    path: Extract<TilePlan['request'], { kind: 'grid-path' }>,
    q: DiscoveryQuery,
    ctx: ProviderContext,
    fail: (e: ProviderError) => DiscoveryTileResult,
  ): Promise<DiscoveryTileResult> {
    // why: spec §2: the page may make every scroll of its path (the planner kept it within CAMOUFOX_GRID_SCROLL_CAP)
    const allowance = path.moves.length;
    const request = pageRequestSchema.safeParse({
      mode: 'grid',
      origin: q.origin,
      destination: q.destination,
      gl: o.pointOfSale,
      start: path.start,
      moves: path.moves,
      reads: path.reads,
      scrollAllowance: allowance,
    });
    if (!request.success)
      return fail(parseError('bad-grid-path', 'the grid path is not a valid request', WHERE));
    const started = o.clock.now();
    // why: ruling 12: the reservation records the page's planned scrolls
    const sent = await postToWorker(o, {
      path: PAGE_PATH,
      body: request.data,
      tileIndex: plan.index,
      ctx,
      scrolls: allowance,
    });
    if (!sent.ok) return fail(sent.error);
    const body = sent.body;
    const a = workerAnswerSchema.safeParse(body);
    if (!a.success || a.data.kind !== 'grid')
      return fail(parseError('unknown-answer', 'the worker answered what this build cannot read', WHERE));
    if (!fetchedAtWithinRequest(a.data.fetchedAt, started, o.clock.now()))
      return fail(
        parseError('fetched-at-out-of-range', `fetchedAt ${a.data.fetchedAt} is outside this request`, WHERE),
      );
    return gridTile(plan, a.data);
  }

  const grid = o.grid?.mode === 'grid' ? o.grid : null;
  // why: CB-7: a scroll takes the measured time, or the configured spacing when that is longer (spacing binds then)
  const timesOf = (g: { scrollSpacingSeconds: number }): typeof GRID_TIMES => ({
    ...GRID_TIMES,
    scrollSeconds: Math.max(GRID_TIMES.scrollSeconds, g.scrollSpacingSeconds),
  });
  const plan = (q: DiscoveryQuery): TilePlan[] => {
    if (grid === null) return planSingleCells(q);
    return planGridTiles(q, {
      stepDays: GRID_STEP_DAYS,
      scrollCap: grid.scrollCap,
      // why: CA 10: the operator's date, as the worker's near-today check takes it
      today: o.clock.todayLondon(),
      horizonDays: GRID_HORIZON_DAYS,
      times: timesOf(grid),
    });
  };

  return {
    id: 'camoufox',
    displayName: CAMOUFOX_DISPLAY_NAME,
    suppliedFields: CAMOUFOX_SUPPLIED_FIELDS,
    cabins: CAMOUFOX_CABINS,
    discovery: {
      info: grid === null ? CAMOUFOX_DISCOVERY_INFO : CAMOUFOX_GRID_INFO,
      plan,
      fetchTile,
      ...(grid === null
        ? {}
        : {
            estimateTile: (t: TilePlan) => gridTileEstimate(t, timesOf(grid)),
            interleavePairs: true as const,
          }),
      preflight: (ctx) =>
        camoufoxPreflight(
          {
            http: o.http,
            key: o.key,
            workerUrl: o.workerUrl,
            ...(o.sharedSettings === undefined ? {} : { sharedSettings: o.sharedSettings }),
            ...(o.appInstance === undefined ? {} : { appInstance: o.appInstance }),
            ...(grid === null
              ? {}
              : {
                  grid: {
                    scrollCap: grid.scrollCap,
                    spacingSeconds: grid.scrollSpacingSeconds,
                    pageTimeoutSeconds: grid.pageTimeoutSeconds,
                  },
                }),
          },
          ctx,
        ),
    },
    // why: spec rev 55 §2 "The flight-list read": the same worker, its own route; its preflight is discovery's
    flightLists: flightListCapability(o),
    // why: spec §2 "The keep-awake lease": the engine holds the machine awake through the worker while a run is in progress
    keepAwake: camoufoxKeepAwake({ ...o, log }),
    // why: decision 24: healthchecks probe nothing; the preflight is the engine's only call that asks the worker.
    healthcheck: async () => ({
      ok: true,
      detail: 'not probed: worker configured; no request sent (decision 24: healthchecks probe nothing)',
    }),
  };
}
