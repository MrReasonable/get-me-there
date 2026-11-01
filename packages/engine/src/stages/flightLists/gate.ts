/**
 * Spec revision 55 §8.1 "The flight-list step": the step's own page gate, checks (a) and (c) of §8.2 for its pages. It
 * is never discovery's `pageGate`: it leaves no lane, marks no discovery cell and pushes no notice; it only refuses the
 * page with AbortedError, which the step (with the run's controller not aborted) reads as its window having closed.
 */
import { AbortedError } from '@gmt/core';
import type { EngineContext } from '../../context.js';
import type { RunState } from '../../run.js';
import { browserWindow } from '../../scheduler/browserWindow.js';
import { windowSetting } from '../browserGate.js';

/**
 * The gate the step passes as `beforeSend` (run by the provider once its limiter admits the page and immediately before
 * it is sent). It asks the heartbeat for a suspension first (which marks every run in flight as due a window check),
 * then reads the run's browser window from its stored row on the step's first page (check a, the step being a phase of
 * its own after discovery) and after a detected suspension (check c). Outside the window it throws AbortedError.
 */
export function flightPageGate(ctx: EngineContext, run: RunState): () => void {
  let first = true;
  return () => {
    ctx.heartbeat.checkBeforePage();
    if (!first && !run.windowCheckDue) return;
    first = false;
    run.windowCheckDue = false;
    const exec = ctx.repos.executions.get(run.executionId);
    // why: fail closed, as discovery's gate does: a row that cannot be read gives no window to load a page in
    const w = exec === null ? { open: false } : browserWindow(exec, windowSetting(ctx), ctx.clock.now());
    if (!w.open) throw new AbortedError('the flight-list step is past its browser window');
  };
}
