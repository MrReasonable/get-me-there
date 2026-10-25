/**
 * The camoufox adapter (spec §2, §5.1, §5.2 rev 32; decisions 68, 69; brief Task 14.8). Discovery only: one list-mode
 * page per cell through the host-side worker (POST /v1/page, the key in `x-gmt-worker-key`), parsed with core's one
 * copy of the wire contract. A price is one RawCalendarPrice with its return date labelled as the date asked for; a
 * "no flights" page leaves the cell out of prices and noFares, so the engine writes `no_data`; every other answer is a
 * tile-error (answer.ts). No airport is named here (spec §1).
 */
import {
  APP_INSTANCE_HEADER,
  BudgetExceeded,
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
  ProviderError,
  pageRequestSchema,
  type Secret,
  type SharedSettings,
  type SuppliedField,
  sharedInt,
  type TilePlan,
  WORKER_KEY_HEADER,
  workerAnswerSchema,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';
import { parseError } from '../shared/errors.js';
import { gridTileEstimate, planGridTiles } from './grid.js';
import { gridTile } from './gridTile.js';
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
const shifted = (at: string, ms: number): string => new Date(Date.parse(at) + ms).toISOString();

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
  /**
   * Spec §2 rev 34: grid mode and the run's page and scroll caps, which the planner splits across the stage's pairs
   * (`DiscoveryQuery.share`); absent or `list`: one page per cell.
   */
  grid?: {
    mode: 'list' | 'grid';
    executionPageCap: number;
    executionScrollCap: number;
    scrollCap: number;
    /** CAMOUFOX_GRID_SCROLL_SPACING_SECONDS, which the preflight checks against the worker's. */
    scrollSpacingSeconds: number;
    /** CAMOUFOX_PAGE_TIMEOUT_SECONDS, which the preflight checks against the worker's in grid mode. */
    pageTimeoutSeconds: number;
  };
  /**
   * Fix round 1 (CA 1): the scrolls the run's and the month's scroll caps leave for camoufox (the budget guard's), or
   * null for no cap. A grid page asks for, and reserves, no more than that.
   */
  scrollsLeft?: (executionId: string | null) => number | null;
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
  // why: decision 82: the worker's own monthly caps, as BudgetExceeded at provider-month (the ledger's scope)
  const monthlyCap = (unit: 'pages' | 'scrolls'): BudgetExceeded => {
    const name = unit === 'pages' ? 'CAMOUFOX_MONTHLY_PAGE_CAP' : 'CAMOUFOX_MONTHLY_SCROLL_CAP';
    const cap = o.sharedSettings === undefined ? 0 : sharedInt(o.sharedSettings, name);
    return new BudgetExceeded({
      scope: 'provider-month',
      providerId: 'camoufox',
      cap,
      current: cap,
      requested: 1,
      ...(unit === 'scrolls' ? { unit: 'scrolls' as const } : {}),
    });
  };
  /** The executions whose last grid page met the worker's monthly scroll cap: their next grid tile stops there. */
  const scrollsSpent = new Set<string | null>();
  const throwIfMonthly = (e: ProviderError): void => {
    if (e.reason === 'monthly-cap') throw monthlyCap('pages');
  };
  const instanceHeader = o.appInstance === undefined ? {} : { [APP_INSTANCE_HEADER]: o.appInstance };

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
    let body: unknown;
    try {
      const res = await o.http.request({
        providerId: 'camoufox',
        executionId: ctx.executionId,
        tileIndex: plan.index,
        endpointPath: PAGE_PATH,
        method: 'POST',
        url: new URL(PAGE_PATH, o.workerUrl),
        headers: {
          [WORKER_KEY_HEADER]: o.key.reveal(),
          'content-type': 'application/json',
          accept: 'application/json',
          ...instanceHeader,
        },
        body: JSON.stringify(request),
        cache: 'never',
        signal: ctx.signal,
        recordFixtures: ctx.recordFixtures,
        ...(ctx.beforeSend === undefined ? {} : { beforeSend: ctx.beforeSend }),
      });
      body = res.body;
    } catch (e) {
      if (e instanceof ProviderError) {
        throwIfMonthly(e);
        return fail(e);
      }
      throw e;
    }
    const a = workerAnswerSchema.safeParse(body);
    if (!a.success || a.data.kind !== 'cells')
      return fail(parseError('unknown-answer', 'the worker answered what this build cannot read', WHERE));
    const answer = a.data;
    // why: prov-010: the page was read between this request's start and now; anything else is not this request's page.
    // The app may run in a container whose clock differs a little from the host worker's: CLOCK_SKEW_MS either way.
    if (
      answer.fetchedAt < shifted(started, -CLOCK_SKEW_MS) ||
      answer.fetchedAt > shifted(o.clock.now(), CLOCK_SKEW_MS)
    )
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
    // why: fix round 1 (CA 1): spec §2 rev 34: the page asks for what the caps leave; the worker stops there (`allowance`)
    // and the unreached cells are resumable issues, while a page with no scroll left still reads its first block
    if (scrollsSpent.has(ctx.executionId)) throw monthlyCap('scrolls');
    const left = o.scrollsLeft?.(ctx.executionId) ?? null;
    // why: CodeRabbit on PR #9 and re-review N2: a page whose first read view lies past what the caps leave (a 0-night
    // lead scroll with none left) drops its lead scrolls and reads the view it opens on, a day later on the returns;
    // the cells that view does not show stay resumable issues, and the page keeps its ledger row
    const firstRead = Math.max(0, path.reads.indexOf(true));
    const leadDropped = left !== null && firstRead > left;
    const moves = leadDropped ? path.moves.slice(firstRead) : path.moves;
    const reads = leadDropped ? [true, ...path.reads.slice(firstRead + 1)] : path.reads;
    const allowance = left === null ? moves.length : Math.max(0, Math.min(moves.length, left));
    const request = pageRequestSchema.safeParse({
      mode: 'grid',
      origin: q.origin,
      destination: q.destination,
      gl: o.pointOfSale,
      start: path.start,
      moves,
      reads,
      scrollAllowance: allowance,
    });
    if (!request.success)
      return fail(parseError('bad-grid-path', 'the grid path is not a valid request', WHERE));
    const started = o.clock.now();
    let body: unknown;
    try {
      const res = await o.http.request({
        providerId: 'camoufox',
        executionId: ctx.executionId,
        tileIndex: plan.index,
        endpointPath: PAGE_PATH,
        method: 'POST',
        url: new URL(PAGE_PATH, o.workerUrl),
        headers: {
          [WORKER_KEY_HEADER]: o.key.reveal(),
          'content-type': 'application/json',
          accept: 'application/json',
          ...instanceHeader,
        },
        body: JSON.stringify(request.data),
        cache: 'never',
        signal: ctx.signal,
        recordFixtures: ctx.recordFixtures,
        // why: ruling 12: the reservation checks the page's allowed scrolls against the run's and the month's caps
        scrolls: allowance,
        ...(ctx.beforeSend === undefined ? {} : { beforeSend: ctx.beforeSend }),
      });
      body = res.body;
    } catch (e) {
      if (e instanceof ProviderError) {
        throwIfMonthly(e);
        return fail(e);
      }
      throw e;
    }
    const a = workerAnswerSchema.safeParse(body);
    if (!a.success || a.data.kind !== 'grid')
      return fail(parseError('unknown-answer', 'the worker answered what this build cannot read', WHERE));
    if (
      a.data.fetchedAt < shifted(started, -CLOCK_SKEW_MS) ||
      a.data.fetchedAt > shifted(o.clock.now(), CLOCK_SKEW_MS)
    )
      return fail(
        parseError('fetched-at-out-of-range', `fetchedAt ${a.data.fetchedAt} is outside this request`, WHERE),
      );
    // why: decision 82: a page that stopped short of what it asked for at its allowance met the worker's monthly scroll
    // cap; this page's views stand, and the next grid tile of the run stops at provider-month
    if (a.data.ended === 'allowance' && a.data.scrolls < allowance) scrollsSpent.add(ctx.executionId);
    const mapped = gridTile(plan, a.data);
    return leadDropped && mapped.kind === 'tile'
      ? { ...mapped, notes: [...mapped.notes, 'lead-scroll-dropped'] }
      : mapped;
  }

  const grid = o.grid?.mode === 'grid' ? o.grid : null;
  // why: CB-7: a scroll takes the measured time, or the configured spacing when that is longer (spacing binds then)
  const timesOf = (g: { scrollSpacingSeconds: number }): typeof GRID_TIMES => ({
    ...GRID_TIMES,
    scrollSeconds: Math.max(GRID_TIMES.scrollSeconds, g.scrollSpacingSeconds),
  });
  const plan = (q: DiscoveryQuery): TilePlan[] => {
    if (grid === null) return planSingleCells(q);
    const pairs = Math.max(1, q.share?.pairs ?? 1);
    return planGridTiles(q, {
      stepDays: GRID_STEP_DAYS,
      scrollCap: grid.scrollCap,
      pageAllowance: Math.floor(grid.executionPageCap / pairs),
      scrollAllowance: Math.floor(grid.executionScrollCap / pairs),
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
    // why: decision 24: healthchecks probe nothing; the preflight is the engine's only call that asks the worker.
    healthcheck: async () => ({
      ok: true,
      detail: 'not probed: worker configured; no request sent (decision 24: healthchecks probe nothing)',
    }),
  };
}
