/**
 * Settings plan ruling 6: the restart in place a save asks for. The new settings are read by the next pass of `main`,
 * so a save closes the running app with `closed` resolving `'reload'`. With nothing in flight (no execution pending or
 * running, `executions.oldestInFlight()`, and no on-demand flight read) it closes at once; otherwise the engine is held
 * (`holdForReload`: anything new is refused, the runs in flight keep the settings they started with) and the close
 * follows the last run's end of any kind, checked on each run's and each read's settle through the engine's second
 * observer (EngineOptions.runWatch). A tool run inside the app (`/tools/record`, `/tools/smoke`) runs outside the
 * engine, so the tools route tells the reloader of its start and end: the restart waits for it as for a run, and its
 * end checks again. Two saves during a run give one restart. A check that throws (the in-flight read failed) is
 * logged and checked again RESTART_RETRY_MS later, and again after each further failure, so a restart waiting on the
 * last run's settle is never lost; nothing is stopped while the check cannot tell whether work is in flight.
 */
import type { Logger, Secret } from '@gmt/core';
import type { RunWatch } from '@gmt/engine';
import { safeMessage } from '../safeMessage.js';

/** What a save asks of the running app (the route context's port). */
export interface ReloadPort {
  /** 'now' when nothing is in flight; else 'after-runs', the restart following the last run's end. */
  request(): 'now' | 'after-runs';
  /** True while a save waits for the runs in flight (`GET /api/settings` `pending`). */
  pending(): boolean;
  /**
   * True from the first save until this pass closes: the engine is held and nothing new may start, including once the
   * restart has begun (when `pending` is already false).
   */
  held(): boolean;
  /** A tool run inside the app began; `label` names it while the restart waits for it. */
  toolStarted(label: string): void;
  /** That tool run ended, however it ended: the restart may go now. */
  toolEnded(): void;
  /** The tool runs in flight, by label. */
  tools(): string[];
}

/** How long after a failed check the restart is checked again (the check is retried until it answers). */
export const RESTART_RETRY_MS = 5_000;

export interface Reloader extends ReloadPort {
  /** The engine's second observer (EngineOptions.runWatch): each end checks whether the restart may go. */
  readonly watch: RunWatch;
  /** The app is closing for another reason (a signal): nothing more is checked and no restart begins. */
  stop(): void;
}

export function createReloader(o: {
  /** True when no execution is pending or running and no flight read is in flight. */
  idle: () => boolean;
  /** Holds the engine: nothing new starts from now on (Engine.holdForReload). */
  hold: () => void;
  /** Begins the close for the next pass; called at most once, never inside the caller's own turn. */
  reload: () => void;
  log: Logger;
  secrets: readonly Secret[];
}): Reloader {
  let requested = false;
  let fired = false;
  let stopped = false;
  let retry: NodeJS.Timeout | null = null;
  const tools: string[] = [];
  const idle = (): boolean => tools.length === 0 && o.idle();
  const cancelRetry = (): void => {
    if (retry !== null) clearTimeout(retry);
    retry = null;
  };
  const fire = (): void => {
    fired = true;
    cancelRetry();
    // why: a save's route answers in the turn it asks; the close (which stops accepting first) begins after it
    queueMicrotask(o.reload);
  };
  const check = (): void => {
    if (!requested || fired || stopped) return;
    try {
      if (idle()) fire();
    } catch (e) {
      // why: told from the run registry's settle; a throw there would reject the run's own settle and the shutdown's
      o.log.error({ err: { message: safeMessage(e, o.secrets) } }, 'restart check failed');
      // why: the failed check may have been the last run's settle, which no later event repeats; without a retry the
      // engine would stay held with nothing to release it. One retry at a time; unref, as the server keeps the
      // process alive while it serves.
      if (retry === null) {
        retry = setTimeout(() => {
          retry = null;
          check();
        }, RESTART_RETRY_MS);
        retry.unref();
      }
    }
  };
  return {
    request: () => {
      if (!requested) {
        requested = true;
        o.hold();
      }
      // why: the same guarded check as a settle's, so a failing read answers the save 'after-runs' and is retried
      check();
      return fired ? 'now' : 'after-runs';
    },
    pending: () => requested && !fired && !stopped,
    held: () => requested,
    toolStarted: (label) => {
      tools.push(label);
    },
    toolEnded: () => {
      tools.shift();
      check();
    },
    tools: () => [...tools],
    watch: { started: () => undefined, ended: check },
    stop: () => {
      stopped = true;
      cancelRetry();
    },
  };
}
