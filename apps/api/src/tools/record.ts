/**
 * `pnpm record:fixtures` (spec §9 item 7, §5.3 Recorder, §2 facts 1–8, §16 WP4b).
 * Hand-built vendor requests through the real http-kit, recorder and SqliteBudgetGuard. The
 * adapters (WP5, WP6) do not exist yet and later replay what this records.
 */
import { mkdirSync } from 'node:fs';
import { AbortedError, asIsoDate, BudgetExceeded, type Config, ProviderError } from '@gmt/core';
import {
  createHttpKit,
  createRecorder,
  type FixtureRecorder,
  type HttpKit,
  type HttpKitDeps,
  type HttpKitRequest,
  type HttpKitResponse,
} from '@gmt/providers';
import { safeMessage } from '../safeMessage.js';
import type { Ports } from '../wiring.js';
import { budgetPosition, openRecordingExecution } from './recordExecution.js';
import { type EndpointKey, ParamLog, paramRules, writeAllowlist } from './recordParams.js';
import {
  type CellDates,
  formatPlan,
  freeCallMisfit,
  type PlannedCall,
  planCalls,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  type RecordArgs,
  type RecordCli,
  TP_MAX_PAGES_PER_TILE,
} from './recordPlan.js';
import { assessRun, formatSummary, ledgerLine, retryAttemptLines, sessionOfCalls } from './recordReport.js';
import {
  bookingOptions,
  calendarParams,
  cheapestCalendarCell,
  cheapestOption,
  dataRowCount,
  flightsParams,
  INVALID_SEARCHAPI_KEY,
  INVALID_TRAVELPAYOUTS_TOKEN,
  recordingLimits,
  saUrl,
  TP_PAGE_LIMIT,
  tpUrl,
} from './recordRequests.js';
import {
  EXIT,
  type RecordedCall,
  RecordingFailedError,
  type RecordSummary,
  type ToolContext,
} from './types.js';

export type { RecordArgs } from './recordPlan.js';

/**
 * recordedBy signature on every file a real run records (spec §5.5). WP4's verifier accepts any non-blank signature;
 * the committed-tree manifest (checkWorkedExampleTree) is the only check that requires this one.
 */
export const RECORDED_BY = '@gmt/api record:fixtures';

// why: one sanitiser for every apps/api sink (src/safeMessage.ts); re-exported here, where the plan contract names it
export { safeMessage };

/** Why the configuration cannot record, or null (exit 78 in the tool bootstrap). */
export function recordPrecheck(c: Config): string | null {
  if (c.providers.travelpayouts === null || c.providers.searchapi === null)
    return 'record:fixtures needs TRAVELPAYOUTS_TOKEN and SEARCHAPI_KEY in the environment (.env)';
  // why: the committed tree is the public worked example's, recorded at point of sale GB (spec §2; po-009)
  if (c.pointOfSale !== 'GB') return `record:fixtures records at POINT_OF_SALE=GB; got ${c.pointOfSale}`;
  return null;
}

/** Wraps the recorder so every file written while a call runs (retries included) is attributed to that call. */
function tracking(inner: FixtureRecorder): { recorder: FixtureRecorder; take(): string[] } {
  let written: string[] = [];
  return {
    recorder: {
      record: async (r) => {
        const p = await inner.record(r);
        written.push(p);
        return p;
      },
    },
    take: () => {
      const out = written;
      written = [];
      return out;
    },
  };
}

type Sent =
  | { ok: true; res: HttpKitResponse }
  | { ok: false; status: RecordedCall['status']; detail: string };

/** One request; the guard, abort and provider errors become results, anything else (recorder refusal, SQLite) propagates. */
async function send(http: HttpKit, req: HttpKitRequest): Promise<Sent> {
  try {
    return { ok: true, res: await http.request(req) };
  } catch (e) {
    if (e instanceof BudgetExceeded)
      return { ok: false, status: 'skipped', detail: `refused by the guard: ${e.scope}` };
    if (e instanceof AbortedError)
      return {
        ok: false,
        status: 'aborted',
        detail: 'aborted (an attempt already sent is ledgered unknown, counted)',
      };
    if (e instanceof ProviderError) {
      if (e.httpStatus !== undefined) return { ok: false, status: e.httpStatus, detail: e.kind };
      // why: WP4 finalises a timeout `unknown` (counted) but a socket failure `error` (not counted, and retried), so
      // only the latter can leave a vendor charge the ledger does not show (cost-wp4b-r2-003)
      return e.message.endsWith('[timeout]')
        ? { ok: false, status: 'no-response', detail: 'timeout (ledgered unknown, counted)' }
        : {
            ok: false,
            status: 'no-response',
            detail:
              'network (ledgered error, NOT counted: if the dashboard drop exceeds the ledger, this call is why)',
          };
    }
    throw e;
  }
}

function providerOf(call: PlannedCall): 'travelpayouts' | 'searchapi' {
  return call.spec.kind.startsWith('tp-') ? 'travelpayouts' : 'searchapi';
}

/** Whole pence of a vendor's GBP price, or null for anything not a finite number (hard rule 7). */
function toPence(price: number | undefined): number | null {
  return price !== undefined && Number.isFinite(price) ? Math.round(price * 100) : null;
}

/**
 * Runs the plan through the real http-kit + recorder + guard (spec §9 item 7), under the hidden recording execution.
 * Every request is cache 'never' (the vendor answers it) and recordFixtures true (the recorder sees it). The execution
 * ends `completed` when the plan ran to its end, with errorText naming any required call not as planned and any guard
 * refusal (prov-wp04b-r2-004); `cancelled` on abort; `cancelled` with errorText 'record:fixtures failed: …' when anything
 * threw (ExecutionStatus has no 'failed'), the error then rethrown as a RecordingFailedError whose cause is the original.
 */
export async function recordFixtures(
  ports: Ports,
  args: RecordArgs,
  ctx: { signal: AbortSignal; recordedRoot: string; recordedBy: string; plan?: readonly PlannedCall[] },
): Promise<RecordSummary> {
  const tp = ports.config.providers.travelpayouts;
  const sa = ports.config.providers.searchapi;
  const refusal = recordPrecheck(ports.config);
  if (tp === null || sa === null || refusal !== null)
    throw new Error(refusal ?? 'record:fixtures needs both providers');
  // why: runRecord passes the plan it printed, so the approved list is the list that runs (arch-023)
  const plan = ctx.plan ?? planCalls(args, ports.repos.airports.sharedMetro(args.origins));
  const misfit = freeCallMisfit(plan, ports.config.spend.executionMaxFreeCalls);
  if (misfit !== null) throw new Error(misfit);
  // why: the recorder refuses a missing or misplaced root; it is built before the hidden execution opens, so such a
  // refusal never leaves a 'running' execution behind (prov-wp04b-r3-003)
  const recorder = createRecorder({
    root: ctx.recordedRoot,
    secrets: ports.secrets,
    clock: ports.clock,
    recordedBy: ctx.recordedBy,
  });
  const executionId = openRecordingExecution(ports, args, plan);
  let run: PlanRun | null = null;
  try {
    run = new PlanRun(ports, plan, executionId, recorder, ctx, recordingLimits(tp, sa, ports.config));
    await run.execute();
  } catch (e) {
    const message = safeMessage(e, ports.secrets);
    ports.repos.executions.setStatus(executionId, 'cancelled', {
      finishedAt: ports.clock.now(),
      errorText: `record:fixtures failed: ${message}`,
    });
    const partial = run?.usage() ?? { calls: [], creditsUsed: 0, freeCalls: 0, session: null };
    throw new RecordingFailedError(`record:fixtures failed: ${message}`, partial, { cause: e });
  }
  const summary = run.summary();
  const guardStops = summary.calls.filter(
    (c) => c.detail?.startsWith('refused by the guard') === true,
  ).length;
  const verdict = assessRun(plan, summary);
  const notes = [
    ...(verdict.notAsExpected.length > 0
      ? [`required calls not as expected: ${verdict.notAsExpected.join(', ')}`]
      : []),
    // why: a step 3 that answered 200 without a priced booking option leaves requiredOk false with every status as
    // planned (prov-wp04b-r2-004)
    ...(verdict.chainComplete ? [] : ['chain incomplete']),
    ...(guardStops > 0 ? [`${guardStops} call(s) refused by the guard`] : []),
  ];
  const aborted = ctx.signal.aborted;
  ports.repos.executions.setStatus(executionId, aborted ? 'cancelled' : 'completed', {
    finishedAt: ports.clock.now(),
    // why: completed, not paused_budget — paused_budget is an active status, and this execution is never resumed (cost-wp4b-012)
    errorText: aborted ? 'aborted' : notes.length > 0 ? notes.join('; ') : null,
  });
  return summary;
}

/** One run of the plan: the state the chain threads from call to call. */
class PlanRun {
  private readonly calls: RecordedCall[] = [];
  private readonly params = new ParamLog(paramRules());
  private readonly track: ReturnType<typeof tracking>;
  private readonly kit: HttpKit;
  private readonly gl: string;
  private cell: CellDates | null = null;
  private departureToken: string | null = null;
  private bookingToken: string | null = null;
  private tileIndex = 0;
  private readonly chain: RecordSummary['chain'] = {
    currency: 'GBP',
    step1PricePence: null,
    step2PricePence: null,
    step3Options: [],
  };

  constructor(
    private readonly ports: Ports,
    private readonly plan: readonly PlannedCall[],
    private readonly executionId: string,
    recorder: FixtureRecorder,
    private readonly ctx: { signal: AbortSignal; recordedRoot: string },
    limits: HttpKitDeps['limits'],
  ) {
    this.track = tracking(recorder);
    this.gl = ports.config.pointOfSale.toLowerCase();
    this.kit = createHttpKit({
      budget: ports.budget,
      cache: ports.cache,
      clock: ports.clock,
      log: ports.log,
      // why: both providers are configured here, so secrets is non-empty as HttpKitDeps requires
      secrets: ports.secrets,
      syntheticAllowed: false,
      recorder: this.track.recorder,
      limits,
    });
  }

  private request(
    providerId: 'travelpayouts' | 'searchapi',
    url: URL,
    headers: Record<string, string>,
    tile: number | null,
  ): HttpKitRequest {
    return {
      providerId,
      executionId: this.executionId,
      tileIndex: tile,
      endpointPath: url.pathname,
      method: 'GET',
      url,
      headers,
      cache: 'never',
      signal: this.ctx.signal,
      recordFixtures: true,
    };
  }

  /** Validates before the request leaves; adds the parameters to the allowlist only when the vendor answered. */
  private async exec(
    id: string,
    providerId: 'travelpayouts' | 'searchapi',
    key: EndpointKey,
    req: HttpKitRequest,
  ): Promise<Sent> {
    this.params.validate(key, req.url.searchParams);
    const r = await send(this.kit, req);
    const files = this.track.take();
    if (r.ok || typeof r.status === 'number') this.params.observe(key, req.url.searchParams);
    this.calls.push({
      id,
      providerId,
      status: r.ok ? r.res.status : r.status,
      file: files.at(-1) ?? null,
      files,
      detail: r.ok ? null : r.detail,
    });
    return r;
  }

  /**
   * Required calls run so far that did not answer as planned (a page counts for its tile). why: once one has failed,
   * the run must be repeated and its session cannot be committed, so no SearchApi credit is spent on it (cost I-1).
   */
  private requiredNotAsPlanned(): string[] {
    const planned = new Map(this.plan.map((p) => [p.id, p] as const));
    return this.calls
      .filter((c) => {
        const p = planned.get(c.id.replace(/p\d+$/, ''));
        return p?.required === true && !(typeof c.status === 'number' && p.expect.includes(c.status));
      })
      .map((c) => c.id);
  }

  private skip(call: PlannedCall, detail: string): void {
    this.calls.push({
      id: call.id,
      providerId: providerOf(call),
      status: 'skipped',
      file: null,
      files: [],
      detail,
    });
  }

  async execute(): Promise<void> {
    const tp = this.ports.config.providers.travelpayouts;
    const sa = this.ports.config.providers.searchapi;
    if (tp === null || sa === null) throw new Error('record:fixtures needs both providers');
    const tpHeaders = (token: string): Record<string, string> => ({ 'X-Access-Token': token });
    const saHeaders = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });
    let calendarAnswered = false;
    let doomed: string | null = null;
    for (const call of this.plan) {
      if (this.ctx.signal.aborted) {
        this.skip(call, 'aborted before send');
        continue;
      }
      const s = call.spec;
      if (s.kind === 'sa-calendar') {
        // why: SA-02 is the first billed call; a run already doomed spends nothing more (cost I-1, plan decision 30)
        const failed = this.requiredNotAsPlanned();
        if (failed.length > 0)
          doomed = `skipped: required call(s) ${failed.join(', ')} not as planned; the run must be repeated`;
      }
      if (doomed !== null && s.kind.startsWith('sa-') && s.kind !== 'sa-auth') {
        this.skip(call, doomed);
        continue;
      }
      switch (s.kind) {
        case 'tp-tile': {
          const tile = this.tileIndex++;
          for (let page = 1; ; page++) {
            const url = tpUrl(s.origin, s.destination, s.month, page);
            const id = page === 1 ? call.id : `${call.id}p${page}`;
            const r = await this.exec(
              id,
              'travelpayouts',
              'prices_for_dates',
              this.request('travelpayouts', url, tpHeaders(tp.token.reveal()), tile),
            );
            if (!r.ok || dataRowCount(r.res.body) < TP_PAGE_LIMIT) break;
            if (page === TP_MAX_PAGES_PER_TILE) {
              const last = this.calls.at(-1);
              // why: a vendor ignoring `page` must not page to the per-run cap (cost-wp4b-r2-002)
              if (last !== undefined)
                last.detail = `page cap reached (${TP_MAX_PAGES_PER_TILE} pages of ${TP_PAGE_LIMIT} rows)`;
              break;
            }
          }
          break;
        }
        case 'tp-auth': {
          const url = tpUrl(s.origin, s.destination, s.month, 1);
          await this.exec(
            call.id,
            'travelpayouts',
            'prices_for_dates',
            this.request('travelpayouts', url, tpHeaders(INVALID_TRAVELPAYOUTS_TOKEN), null),
          );
          break;
        }
        case 'sa-calendar': {
          const url = saUrl(calendarParams(s.origin, s.destination, s.rect, this.gl));
          const r = await this.exec(
            call.id,
            'searchapi',
            'google_flights_calendar',
            this.request('searchapi', url, saHeaders(sa.key.reveal()), this.tileIndex++),
          );
          if (r.ok)
            this.cell = cheapestCalendarCell(
              r.res.body,
              { minNights: RECORD_MIN_NIGHTS, maxNights: RECORD_MAX_NIGHTS },
              s.rect,
            );
          calendarAnswered = this.cell !== null;
          break;
        }
        case 'sa-over-limit': {
          // why: without a usable calendar the chain is doomed and the run must be repeated, so nothing more is spent (cost-wp4b-r2-004)
          if (!calendarAnswered) {
            this.skip(call, 'skipped: calendar SA-02 gave no usable cell; the run must be repeated');
            break;
          }
          const url = saUrl(calendarParams(s.origin, s.destination, s.rect, this.gl));
          await this.exec(
            call.id,
            'searchapi',
            'google_flights_calendar',
            this.request('searchapi', url, saHeaders(sa.key.reveal()), this.tileIndex++),
          );
          break;
        }
        case 'sa-step1':
        case 'sa-step2':
        case 'sa-step3': {
          const token =
            s.kind === 'sa-step1'
              ? {}
              : s.kind === 'sa-step2'
                ? this.departureToken === null
                  ? null
                  : { departure_token: this.departureToken }
                : this.bookingToken === null
                  ? null
                  : { booking_token: this.bookingToken };
          if (this.cell === null || token === null) {
            this.skip(
              call,
              'chain prerequisite missing (no priced in-band cell or no token from the previous step)',
            );
            break;
          }
          const url = saUrl(flightsParams(s.origin, s.destination, this.cell, this.gl, token));
          const r = await this.exec(
            call.id,
            'searchapi',
            'google_flights',
            this.request('searchapi', url, saHeaders(sa.key.reveal()), null),
          );
          if (!r.ok) break;
          if (s.kind === 'sa-step1') {
            const o = cheapestOption(r.res.body, 'departure_token');
            this.departureToken = o?.token ?? null;
            this.chain.step1PricePence = toPence(o?.price);
          } else if (s.kind === 'sa-step2') {
            const o = cheapestOption(r.res.body, 'booking_token');
            this.bookingToken = o?.token ?? null;
            this.chain.step2PricePence = toPence(o?.price);
          } else {
            this.chain.step3Options = bookingOptions(r.res.body).flatMap((o) => {
              const pricePence = toPence(o.price);
              return pricePence === null ? [] : [{ bookWith: o.bookWith, pricePence }];
            });
          }
          break;
        }
        case 'sa-auth': {
          const url = saUrl(flightsParams(s.origin, s.destination, s.cell, this.gl, {}));
          await this.exec(
            call.id,
            'searchapi',
            'google_flights',
            this.request('searchapi', url, saHeaders(INVALID_SEARCHAPI_KEY), null),
          );
          break;
        }
        default: {
          const unhandled: never = s;
          throw new Error(`unhandled call ${JSON.stringify(unhandled)}`);
        }
      }
    }
    if (this.calls.some((c) => c.files.length > 0)) {
      // why: the UTC date, as in the recorded files' names (recordedAt.slice(0, 10))
      const date = asIsoDate(this.ports.clock.now().slice(0, 10));
      writeAllowlist(this.ctx.recordedRoot, this.params.document('travelpayouts', date));
      writeAllowlist(this.ctx.recordedRoot, this.params.document('searchapi', date));
    }
  }

  usage(): { calls: RecordedCall[]; creditsUsed: number; freeCalls: number; session: string | null } {
    return {
      calls: this.calls,
      creditsUsed: this.ports.budget.usage({ kind: 'execution-calls', executionId: this.executionId }).calls,
      freeCalls: this.ports.budget.usage({ kind: 'execution-free-calls', executionId: this.executionId })
        .calls,
      session: sessionOfCalls(this.calls),
    };
  }

  summary(): RecordSummary {
    return { ...this.usage(), chain: this.chain };
  }
}

/**
 * The `record` tool (spec §7 tool bootstrap, §9 item 7). Prints the plan and the budget position; a dry run stops
 * there. A live run refuses (exit 65) when a provider window lacks room for the worst case, or when its worst case
 * plus credits already ledgered to earlier tool runs would exceed --budget, unless --confirm-rerun (plan decision 20).
 * The ledger line and the session id are printed on every path that opened an execution (cost-wp4b-006, prov-wp04b-r2-005).
 */
export async function runRecord(ports: Ports, cli: RecordCli, ctx: ToolContext): Promise<number> {
  const a = cli.args;
  const metro = ports.repos.airports.sharedMetro(a.origins);
  const plan = planCalls(a, metro);
  for (const line of formatPlan(plan)) ctx.out(line);
  ctx.out(`metro from the airports table: ${metro ?? 'none (each origin airport is tiled)'}`);
  ctx.out(`recording into: ${ctx.recordedRoot}`);
  const maxFree = ports.config.spend.executionMaxFreeCalls;
  ctx.out(`Travelpayouts per-run cap (EXECUTION_MAX_FREE_CALLS): ${maxFree}`);
  const misfit = freeCallMisfit(plan, maxFree);
  if (misfit !== null) {
    ctx.err(misfit);
    return EXIT.badConfig;
  }
  const position = budgetPosition(ports, a, plan);
  for (const line of position.lines) ctx.out(line);
  if (cli.dryRun) return EXIT.ok;
  if (position.windowRefusals.length > 0) {
    ctx.err(`refusing: ${position.windowRefusals.join('; ')} (never start what cannot finish)`);
    return EXIT.spendRefused;
  }
  if (position.rerunNeedsConfirm && !cli.confirmRerun) {
    ctx.err(
      `refusing: credits already ledgered to earlier tool runs plus this run's worst case exceed --budget ${a.budget}; stop and ask before re-running, then pass --confirm-rerun (plan decision 20)`,
    );
    return EXIT.spendRefused;
  }
  // why: `--out DIR` names a directory that may not exist yet, and the recorder requires its root (prov-wp04b-r3-003)
  mkdirSync(ctx.recordedRoot, { recursive: true });
  let summary: RecordSummary;
  try {
    summary = await recordFixtures(ports, a, {
      signal: ctx.signal,
      recordedRoot: ctx.recordedRoot,
      recordedBy: ctx.recordedBy,
      plan,
    });
  } catch (e) {
    if (!(e instanceof RecordingFailedError)) throw e;
    for (const x of e.partial.calls)
      ctx.out(`${x.id} ${String(x.status)}${x.files.length === 0 ? '' : ` → ${x.files.join(', ')}`}`);
    for (const line of retryAttemptLines(e.partial.calls)) ctx.out(line);
    ctx.err(e.message);
    ctx.out(`session: ${e.partial.session ?? 'none (nothing recorded)'}`);
    ctx.out(ledgerLine(e.partial, a));
    return EXIT.failed;
  }
  const verdict = assessRun(plan, summary);
  for (const line of formatSummary(summary, verdict, a, plan)) ctx.out(line);
  return verdict.requiredOk && !ctx.signal.aborted ? EXIT.ok : EXIT.failed;
}
