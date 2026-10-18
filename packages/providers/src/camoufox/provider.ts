/**
 * The camoufox adapter (spec §2, §5.1, §5.2 rev 32; decisions 68, 69; brief Task 14.8). Discovery only: one list-mode
 * page per cell through the host-side worker (POST /v1/page, the key in `x-gmt-worker-key`), parsed with core's one
 * copy of the wire contract. A price is one RawCalendarPrice with its return date labelled as the date asked for; a
 * "no flights" page leaves the cell out of prices and noFares, so the engine writes `no_data`; every other answer is a
 * tile-error (answer.ts). No airport is named here (spec §1).
 */
import {
  type Cabin,
  type CapabilityInfo,
  type CellIssue,
  type Clock,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  type FlightProvider,
  type Logger,
  type PageRequest,
  type ProviderContext,
  ProviderError,
  pageRequestSchema,
  type Secret,
  type SuppliedField,
  type TilePlan,
  WORKER_KEY_HEADER,
  workerAnswerSchema,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';
import { parseError } from '../shared/errors.js';
import { camoufoxPreflight } from './preflight.js';
import { planSingleCells } from './tiles.js';

export const CAMOUFOX_DISPLAY_NAME = 'Google Flights via Camoufox';
/** Spec §2 Labels, verbatim. */
export const CAMOUFOX_DISCOVERY_INFO: CapabilityInfo = {
  sourceKind: 'scraped-self',
  maxAgeHours: 0,
  provenanceNote:
    "Google Flights prices via Camoufox: the cheapest round-trip price Google Flights listed for this day pair when this app's own Camoufox browser read the page on the operator's machine, from the operator's IP address, in the currency the page states. Return date: the date asked for, which the page's search form showed; the listed options state only the departure. Camoufox presents a generated browser fingerprint; Google's terms do not permit this automated access; the operator turned it on. Constraints are not checked; no return leg, seller or baggage is read.",
};
export const CAMOUFOX_SUPPLIED_FIELDS: readonly SuppliedField[] = ['price'];
export const CAMOUFOX_CABINS: readonly Cabin[] = ['economy'];
const PAGE_PATH = '/v1/page';
const WHERE = { providerId: 'camoufox' as const, endpointPath: PAGE_PATH };
export const RETURN_DATE_LABEL = 'return date: the date asked for';

export interface CamoufoxProviderOptions {
  http: HttpKit;
  log: Logger;
  clock: Clock;
  key: Secret;
  workerUrl: string;
  pointOfSale: string;
}

/** The detail and dropped count stored on a priced cell (prov-001, prov-003, prov-005). */
export function priceIssue(
  cell: TilePlan['coveredCells'][number],
  p: { amountMinor: number; tabMinor: number | null; optionsUnparsed: number; optionsOtherCell: number },
): CellIssue {
  const tabBelow = p.tabMinor !== null && p.tabMinor < p.amountMinor;
  const parts = [RETURN_DATE_LABEL];
  if (p.optionsUnparsed > 0) parts.push(`options unread: ${p.optionsUnparsed}`);
  if (tabBelow) parts.push('the Cheapest tab showed a lower price');
  if (p.optionsOtherCell > 0) parts.push(`options for another cell: ${p.optionsOtherCell}`);
  return {
    cell,
    reason: 'parse',
    offersDropped: p.optionsUnparsed + (tabBelow ? 1 : 0),
    detail: parts.join('; '),
  };
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
        },
        body: JSON.stringify(request),
        cache: 'never',
        signal: ctx.signal,
        recordFixtures: ctx.recordFixtures,
      });
      body = res.body;
    } catch (e) {
      if (e instanceof ProviderError) return fail(e);
      throw e;
    }
    const a = workerAnswerSchema.safeParse(body);
    if (!a.success || a.data.kind !== 'cells')
      return fail(parseError('unknown-answer', 'the worker answered what this build cannot read', WHERE));
    const answer = a.data;
    // why: prov-010: the page was read between this request's start and now; anything else is not this request's page.
    if (answer.fetchedAt < started || answer.fetchedAt > o.clock.now())
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
    return {
      ...base,
      prices: [{ ...cell, amountMinor: answer.cell.amountMinor, currency: answer.currency }],
      noFares: [],
      cellIssues: [priceIssue(cell, answer.cell)],
    };
  }

  return {
    id: 'camoufox',
    displayName: CAMOUFOX_DISPLAY_NAME,
    suppliedFields: CAMOUFOX_SUPPLIED_FIELDS,
    cabins: CAMOUFOX_CABINS,
    discovery: {
      info: CAMOUFOX_DISCOVERY_INFO,
      plan: planSingleCells,
      fetchTile,
      preflight: (ctx) => camoufoxPreflight({ http: o.http, key: o.key, workerUrl: o.workerUrl }, ctx),
    },
    // why: decision 24: healthchecks probe nothing; the preflight is the engine's only call that asks the worker.
    healthcheck: async () => ({
      ok: true,
      detail: 'not probed: worker configured; no request sent (decision 24: healthchecks probe nothing)',
    }),
  };
}
