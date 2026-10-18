/**
 * The smoke's camoufox stage and rows (brief Task 14.13; cost-013, prov-014, TS-19; split from smokeChecks.ts in fix
 * round 1, arch M15). The stage reads the worker's `/v1/status` (never ledgered), then runs one list tile for the
 * query's first cell (at most one page load) through the real adapter and the run's http-kit. The rows read the
 * worker's own answer for the facts the tile reports (fix round 1, prov M4): its currency, its point of sale and its
 * cell status, and the error's code for a stop, never the wording of a message. `look` rows are for the operator; a
 * stop exits 1 with its cool-down end.
 */
import {
  AbortedError,
  CAMOUFOX_JS_VERSION,
  type CapabilityInfo,
  type CellKey,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  daysBetween,
  type FlightProvider,
  formatPence,
  londonDateOf,
  searchLinkFor,
  WORKER_KEY_HEADER,
  type WorkerAnswer,
  type WorkerStatus,
  workerAnswerSchema,
  workerStatusSchema,
} from '@gmt/core';
import { CAMOUFOX_DISCOVERY_INFO, type HttpKit } from '@gmt/providers';
import { safeMessage } from '../safeMessage.js';
import type { Ports } from '../wiring.js';
import type { Seen, SmokeCheck } from './smokeChecks.js';
import type { Ctx } from './smokeStages.js';

/** What the camoufox stage of the smoke saw: the worker's status, the one tile, its cell and the worker's answer. */
export interface CamoufoxRun {
  status: WorkerStatus | null;
  /** Why the status could not be read (unreachable, or an answer this build cannot read). */
  statusError: string | null;
  tile: DiscoveryTileResult | null;
  cell: CellKey | null;
  info: CapabilityInfo | null;
  /** The worker's own `cells` answer for the page, when it answered one. */
  answer: Extract<WorkerAnswer, { kind: 'cells' }> | null;
}

/** The SOCS cookie's stated lifetime in days (13 months; the worker refuses an older capture). */
export const SOCS_MAX_DAYS = 396;
export const CAMOUFOX_ROWS = [
  'camoufox worker',
  'camoufox signed out',
  'camoufox consent',
  'camoufox settings match',
  'camoufox one page',
  'camoufox not blocked',
  'camoufox cell',
  'camoufox partial',
  'camoufox provenance',
  'camoufox selectors',
  'camoufox compare',
] as const;
type Row = (typeof CAMOUFOX_ROWS)[number];

/** The stage. Never throws for a worker failure (the rows say what happened); an abort or a spend refusal propagates. */
export async function camoufoxStage(
  ports: Ports,
  provider: FlightProvider | undefined,
  q: DiscoveryQuery,
  ctx: Ctx,
  http: HttpKit,
  seen: readonly Seen[],
): Promise<CamoufoxRun> {
  const cfg = ports.config.providers.camoufox;
  const cap = provider?.discovery;
  const none = { tile: null, cell: null, info: null, answer: null };
  if (cfg === null || cap === undefined) return { status: null, statusError: 'not configured', ...none };
  let status: CamoufoxRun['status'] = null;
  let statusError: string | null = null;
  try {
    const res = await http.request({
      providerId: 'camoufox-status',
      executionId: ctx.executionId,
      tileIndex: null,
      endpointPath: '/v1/status',
      method: 'GET',
      url: new URL('/v1/status', cfg.workerUrl),
      headers: { [WORKER_KEY_HEADER]: cfg.key.reveal(), accept: 'application/json' },
      cache: 'never',
      signal: ctx.signal,
      recordFixtures: false,
    });
    const parsed = workerStatusSchema.safeParse(res.body);
    if (parsed.success) status = parsed.data;
    else statusError = 'an answer this build of the worker protocol cannot read';
  } catch (e) {
    if (e instanceof AbortedError) throw e;
    statusError = safeMessage(e, ports.secrets);
  }
  const names = (iata: string): string[] => {
    const a = ports.repos.airports.get(iata);
    return a === null ? [] : [a.name];
  };
  const query: DiscoveryQuery = {
    ...q,
    airportNames: { origin: names(q.origin), destination: names(q.destination) },
  };
  const plan = cap.plan(query)[0];
  if (plan === undefined) return { status, statusError, ...none, info: cap.info };
  const before = seen.length;
  const tile = await cap.fetchTile({ ...plan, index: 0 }, query, ctx);
  const body = seen
    .slice(before)
    .find((x) => x.providerId === 'camoufox' && x.url.pathname === '/v1/page')?.body;
  const a = workerAnswerSchema.safeParse(body);
  return {
    status,
    statusError,
    tile,
    cell: plan.coveredCells[0] ?? null,
    info: cap.info,
    answer: a.success && a.data.kind === 'cells' ? a.data : null,
  };
}

/** The eleven rows; each is skip when camoufox is not configured. */
export function camoufoxChecks(ports: Ports, run: CamoufoxRun | null, executionId: string): SmokeCheck[] {
  const cfg = ports.config.providers.camoufox;
  if (run === null || cfg === null)
    return CAMOUFOX_ROWS.map((name) => ({ name, status: 'skip', detail: 'not configured' }));
  const checks: SmokeCheck[] = [];
  const add = (name: Row, status: SmokeCheck['status'], detail: string): void => {
    checks.push({ name, status, detail });
  };
  const s = run.status;
  const now = ports.clock.now();

  add(
    'camoufox worker',
    s === null ? 'fail' : s.versions.camoufoxJs === CAMOUFOX_JS_VERSION ? 'pass' : 'fail',
    s === null
      ? `not reachable: ${run.statusError ?? 'no answer'}`
      : `camoufox-js ${s.versions.camoufoxJs}, Camoufox ${s.versions.binary}`,
  );
  add(
    'camoufox signed out',
    s === null ? 'fail' : s.accountCookie.found || s.signedInRefusal ? 'fail' : 'pass',
    s === null
      ? 'no status'
      : s.accountCookie.found
        ? `account cookies ${s.accountCookie.names.join(', ')} (checked ${s.accountCookie.checkedAt})`
        : s.signedInRefusal
          ? 'a signed-in refusal stands: run clear-signed-in'
          : `no account cookie (checked ${s.accountCookie.checkedAt})`,
  );
  const error = run.tile?.kind === 'tile-error' ? run.tile.error : null;
  // why: fix round 1 (arch I1): the error's code, never its wording
  const consentStop = error?.reason === 'blocked:consent-unhandled';
  const captured = s?.socsCapturedAt ?? null;
  const fresh = captured !== null && daysBetween(londonDateOf(captured), londonDateOf(now)) <= SOCS_MAX_DAYS;
  add(
    'camoufox consent',
    consentStop || !fresh ? 'fail' : s?.socsStable === true ? 'pass' : 'look',
    consentStop
      ? 'a consent page appeared (the saved Reject all choice did not hold)'
      : !fresh
        ? 'no SOCS capture younger than 13 months: run capture-socs'
        : `SOCS captured ${captured ?? ''}${s?.socsStable === true ? '' : '; its stability is not yet proved by a recording (SOCS_STABLE false)'}`,
  );
  const same =
    s !== null && s.cooldownHours === cfg.cooldownHours && s.pageTimeoutSeconds === cfg.pageTimeoutSeconds;
  add(
    'camoufox settings match',
    s === null ? 'fail' : same ? 'pass' : 'fail',
    s === null
      ? 'no status'
      : `cool-down ${s.cooldownHours} h (app ${cfg.cooldownHours}), page timeout ${s.pageTimeoutSeconds} s (app ${cfg.pageTimeoutSeconds})`,
  );
  const rows = ports.db.raw
    .prepare<[string], { pageClass: string | null }>(
      "SELECT page_class AS pageClass FROM provider_requests WHERE execution_id = ? AND provider_id = 'camoufox' ORDER BY id",
    )
    .all(executionId);
  const pages = rows.filter((r) => r.pageClass !== 'no-page').length;
  const waits = rows.length - pages;
  add(
    'camoufox one page',
    pages === 1 ? 'pass' : pages > 1 ? 'fail' : 'look',
    `${pages} page(s) loaded${waits > 0 ? `; ${waits} spacing wait(s) or refusals that loaded no page` : ''}`,
  );
  const blocked = error !== null && error.kind === 'blocked';
  const ok = run.tile?.kind === 'tile';
  add(
    'camoufox not blocked',
    ok ? 'pass' : 'fail',
    ok ? 'the page was read' : error === null ? 'no tile' : `${error.kind}: ${error.message}`,
  );
  const tile = run.tile?.kind === 'tile' ? run.tile : null;
  const answer = run.answer;
  if (tile === null || run.cell === null || answer === null) {
    for (const name of ['camoufox cell', 'camoufox partial', 'camoufox provenance'] as const)
      add(name, 'skip', blocked ? 'blocked' : 'no page read');
  } else {
    const cell = run.cell;
    const c = answer.cell;
    // why: the price's dates are the request's echo (the adapter builds them from the cell asked for); what this row
    // checks is the worker's own cell status, and that the stored price is the worker's
    const price = tile.prices[0];
    add(
      'camoufox cell',
      c.status === 'price'
        ? price !== undefined && price.amountMinor === c.amountMinor
          ? 'pass'
          : 'fail'
        : c.status === 'none-for-cell'
          ? 'fail'
          : 'look',
      c.status === 'price'
        ? `${formatPence(c.amountMinor)} for ${cell.departureDate}–${cell.returnDate} (the dates asked for; the page's search form showed them, the options state only the departure)`
        : c.status === 'none-for-cell'
          ? `no option for ${cell.departureDate}–${cell.returnDate}; every option was for another cell (${c.optionsOtherCell})`
          : `no price for ${cell.departureDate}–${cell.returnDate} (the page listed no flights)`,
    );
    const issue = tile.cellIssues?.[0];
    add(
      'camoufox partial',
      issue !== undefined && issue.offersDropped > 0 ? 'look' : 'pass',
      issue === undefined ? 'every option read' : issue.detail,
    );
    const info = run.info;
    const labelled =
      info !== null &&
      info.sourceKind === 'scraped-self' &&
      info.maxAgeHours === 0 &&
      info.provenanceNote === CAMOUFOX_DISCOVERY_INFO.provenanceNote;
    const stored = tile.pointOfSale === answer.pointOfSale && answer.currency === 'GBP';
    const market = answer.pointOfSale === ports.config.pointOfSale;
    add(
      'camoufox provenance',
      !labelled || !stored ? 'fail' : market ? 'pass' : 'look',
      `scraped-self, maxAgeHours ${info?.maxAgeHours ?? '?'}, ${answer.currency}, point of sale ${answer.pointOfSale} as the page stated${market ? '' : ` (POINT_OF_SALE is ${ports.config.pointOfSale})`}`,
    );
  }
  const falseFlags =
    s === null
      ? []
      : Object.entries(s.flags)
          .filter(([, v]) => !v)
          .map(([k]) => k);
  add(
    'camoufox selectors',
    s === null ? 'fail' : falseFlags.length > 0 ? 'look' : 'pass',
    s === null
      ? 'no status'
      : `selectors ${s.versions.selectors}, grammar ${s.versions.grammar}; ${falseFlags.length > 0 ? `still unverified: ${falseFlags.join(', ')}` : 'every flag verified'}`,
  );
  const link = run.cell === null ? null : searchLinkFor('camoufox', run.cell, 'economy');
  add(
    'camoufox compare',
    tile === null ? 'skip' : 'look',
    tile === null || link === null
      ? blocked
        ? 'blocked'
        : 'no page read'
      : `open ${link.url} and compare the price by eye`,
  );
  return checks;
}
