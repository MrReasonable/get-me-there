import {
  AbortedError,
  type Execution,
  LEFT_FOR_TEXT,
  type LeftFor,
  leftForOf,
  type ProviderId,
  type SearchDefinition,
  type SkipDetail,
} from '@gmt/core';
import type { EngineContext } from '../context.js';
import { lineKey } from '../lines.js';
import { type Lane, markRemaining, type RunState, resumableCells } from '../run.js';
import {
  type BrowserWindowSetting,
  browserWindow,
  loadsBrowserPages,
  resumeLeavesBrowserCells,
} from '../scheduler/browserWindow.js';
import { buildSnapshot, sellsCabin } from '../snapshot.js';

/** The operator's notice when a run reaches its browser window's end (decision 83), sent once per execution. */
export const BROWSER_WINDOW_NOTICE = 'browser pages left: this run is past its browser window';

/** The settings a window check reads, live from the config at each check (decision 83: never frozen into the run). */
export function windowSetting(ctx: Pick<EngineContext, 'config'>): BrowserWindowSetting {
  return { mode: ctx.config.camoufoxBrowserWindow, stuckAfterHours: ctx.config.stuckAfterHours };
}

/**
 * Review S6: who fetches a definition's left browser cells, read now: whether its scheduled runs, and a run started by
 * hand, would still use the browser provider (configured and enabled, so in the snapshot such a run would take).
 */
export function browserLeftFor(ctx: EngineContext, def: SearchDefinition): LeftFor {
  const uses = (trigger: 'schedule' | 'manual') =>
    buildSnapshot(ctx, def, trigger).snapshot.providers.discovery.some(loadsBrowserPages);
  return leftForOf(def, { scheduled: uses('schedule'), manual: uses('manual') });
}

/**
 * Review S7: the run's other discovery providers still searching: in its snapshot, selling its cabin, neither disabled
 * nor blocked for budget, and with a lane that has not stopped.
 */
function otherDiscoveryRunning(ctx: EngineContext, run: RunState): boolean {
  return run.snapshot.providers.discovery.some((id) => {
    if (loadsBrowserPages(id) || run.disabled.has(id) || !sellsCabin(ctx, id, run.snapshot.cabin))
      return false;
    if (run.blocked.has(lineKey('discovery', id))) return false;
    const lane = run.lanes.get(`discovery|${id}`);
    return lane === undefined || (!lane.budgetOut && !lane.intake.signal.aborted);
  });
}

/**
 * The once-per-execution notice. It has its own kind, so the per-execution and per-day dedupe of a real
 * `provider_disabled` notice never hides it, and it never hides one (spec §8.1 notices). It names who fetches the cells
 * as View D does (review R12, S6), and says the other providers carry on only when one is still searching in this run
 * (review S7).
 */
export function browserWindowNotice(ctx: EngineContext, run: RunState): RunState['notices'][number] {
  const def = ctx.repos.definitions.get(run.definitionId);
  const leftFor = LEFT_FOR_TEXT[def === null ? 'no-longer-used' : browserLeftFor(ctx, def)];
  const rest = otherDiscoveryRunning(ctx, run)
    ? 'the other providers carry on'
    : 'the run stops its browser part with no other discovery provider left to run';
  return {
    kind: 'browser_window',
    detail: `${BROWSER_WINDOW_NOTICE}. Its remaining browser cells are ${leftFor}; ${rest}.`,
  };
}

/**
 * Stops the lane loading browser pages: no more tiles, and every remaining cell of the provider (all but the ones in
 * flight, which settleLane marks once they come back not_run) becomes `skipped:scheduled_only` with `detail`.
 */
function leaveLane(
  ctx: EngineContext,
  run: RunState,
  providerId: ProviderId,
  lane: Lane,
  detail: SkipDetail,
): number {
  lane.windowOut = detail;
  lane.intake.abort();
  return markRemaining(ctx, run, 'discovery', providerId, 'scheduled_only', lane.inFlight, detail);
}

/**
 * When a browser tile is picked: false once the lane has stopped loading pages, and always for a catch-up (decision
 * 79), whose remaining browser cells are then left `scheduled_only` (`catch-up-no-browser`) whatever state they were
 * in, so the rule never rests on how the start seeded them. Other providers and children are never gated.
 */
export function mayLoadPage(ctx: EngineContext, run: RunState, providerId: ProviderId, lane: Lane): boolean {
  if (!loadsBrowserPages(providerId) || run.isChild) return true;
  if (lane.windowOut !== null) return false;
  if (!run.isCatchUp) return true;
  const left = leaveLane(ctx, run, providerId, lane, 'catch-up-no-browser');
  run.log.child({ providerId }).warn({ left }, 'catch-up: browser cells left unloaded');
  return false;
}

/**
 * Decision 83 checks (a) and (c), run by the provider once its rate limiter admits the page and immediately before the
 * request is sent (ProviderContext.beforeSend), so a page that waited for the limiter across a sleep is checked when it
 * would really start. The heartbeat is asked whether the machine slept since its last beat; when a check is due (the
 * pass's first page, or after a detected suspension) the window is read from the stored row. Outside it the lane stops
 * (`outside-browser-window`), the operator is told once, and the call is abandoned with AbortedError, so its own cells
 * come back not_run and settleLane leaves them for the next scheduled run too. A run is never otherwise cut mid-flight.
 */
export function pageGate(ctx: EngineContext, run: RunState, providerId: ProviderId, lane: Lane): () => void {
  return () => {
    ctx.heartbeat.checkBeforePage();
    if (lane.windowOut !== null) throw new AbortedError();
    if (!run.windowCheckDue) return;
    run.windowCheckDue = false;
    const exec = ctx.repos.executions.get(run.executionId);
    // why: fail closed — a row that cannot be read gives no window to load a page in
    const w =
      exec === null ? { open: false, end: null } : browserWindow(exec, windowSetting(ctx), ctx.clock.now());
    if (w.open) return;
    const left = leaveLane(ctx, run, providerId, lane, 'outside-browser-window');
    run.notices.push(browserWindowNotice(ctx, run));
    run.log
      .child({ providerId })
      .info({ windowEnd: w.end, left }, 'browser window passed; pages left for the next scheduled run');
    throw new AbortedError();
  };
}

/**
 * Decision 79/83 check (b), at any resume, before it prices or cap-checks anything: the browser providers whose
 * remaining cells this resume must leave unloaded, and the detail they are left with. A catch-up leaves them all
 * (`catch-up-no-browser`, never a window question); any other run past its window leaves them
 * (`outside-browser-window`); a child, a run inside its window, or a definition without a browser provider leaves none.
 */
export function browserLeftAtResume(
  ctx: EngineContext,
  exec: Execution,
): { providers: ProviderId[]; detail: SkipDetail } {
  const detail = exec.isCatchUp ? 'catch-up-no-browser' : 'outside-browser-window';
  if (!resumeLeavesBrowserCells(exec, windowSetting(ctx), ctx.clock.now())) return { providers: [], detail };
  return { providers: exec.snapshot.providers.discovery.filter(loadsBrowserPages), detail };
}

/**
 * Inside a resume's claim: the cells the pass would fetch for `providerId` (the resume query, departed cells already
 * marked) become `skipped:scheduled_only` with `detail`. Returns how many.
 */
export function leaveAtResume(
  ctx: EngineContext,
  executionId: string,
  providerId: ProviderId,
  manual: boolean,
  detail: SkipDetail,
): number {
  const cells = resumableCells(ctx, executionId, 'discovery', providerId, manual);
  for (const cell of cells)
    ctx.repos.cells.setOutcome(executionId, cell, 'discovery', providerId, {
      status: 'skipped',
      reason: 'scheduled_only',
      skipDetail: detail,
    });
  return cells.length;
}
