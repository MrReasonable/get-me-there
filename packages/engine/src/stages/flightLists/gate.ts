/**
 * Spec revision 56 §8.1 "The flight-list step" and §8.2: the step's own page gate, checks (a) and (c) of §8.2 for its
 * requests, held to each request's own seconds (R-window). It is never discovery's `pageGate`: it leaves no lane, marks
 * no discovery cell and pushes no notice; it only refuses the request with AbortedError, which the step (with the run's
 * controller not aborted) reads as its window having closed.
 */
import { AbortedError } from '@gmt/core';
import type { EngineContext } from '../../context.js';
import type { RunState } from '../../run.js';
import { browserWindow } from '../../scheduler/browserWindow.js';
import { windowSetting } from '../browserGate.js';

/**
 * The seconds the run's browser window has left now: Infinity under `CAMOUFOX_BROWSER_WINDOW=any`, a negative number
 * once it has closed, and -Infinity when the run's row cannot be read (fail closed, as discovery's gate does).
 */
export function windowSecondsLeft(ctx: EngineContext, run: RunState): number {
  const exec = ctx.repos.executions.get(run.executionId);
  if (exec === null) return Number.NEGATIVE_INFINITY;
  const now = ctx.clock.now();
  const w = browserWindow(exec, windowSetting(ctx), now);
  if (!w.open) return Number.NEGATIVE_INFINITY;
  return w.end === null ? Number.POSITIVE_INFINITY : (Date.parse(w.end) - Date.parse(now)) / 1000;
}

/**
 * The gate the step passes as `beforeSend` for one request of `requestSeconds` (run by the provider once the browser
 * lease and its limiter admit the request, immediately before it is sent). It asks the heartbeat for a suspension
 * (which marks every run in flight as due a window check, check c), then re-reads the run's browser window from its
 * stored row (ruling R-gate of the 20.9 review) and refuses with AbortedError when the window closes before the request's
 * own seconds have run (R-window: `flightRequestSeconds` with a return phase, the list page's request timeout without),
 * so no page starts past the window's end.
 */
export function flightPageGate(ctx: EngineContext, run: RunState): (requestSeconds: number) => () => void {
  return (requestSeconds) => () => {
    ctx.heartbeat.checkBeforePage();
    // why: the window must outlast the whole request, not just its start (spec rev 56 §8.2, cost-r3-007)
    if (windowSecondsLeft(ctx, run) < requestSeconds)
      throw new AbortedError('the flight-list step is past its browser window');
  };
}
