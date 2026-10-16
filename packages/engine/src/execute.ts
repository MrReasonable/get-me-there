import type { ExecutionStatus, IsoDateTime, OperatorMessageKind } from '@gmt/core';
import type { ExecutionPatch } from '@gmt/db';
import type { EngineContext } from './context.js';
import { errorText, type RunState, type StopReason, stopRun } from './run.js';
import { runDiscovery } from './stages/discovery.js';
import { breachText, formatInstant } from './text.js';

/** Runs one pass: discovery, then finish. Any error a stage lets escape stops the pass as fatal. */
export async function execute(ctx: EngineContext, run: RunState): Promise<void> {
  try {
    await runDiscovery(ctx, run);
  } catch (err) {
    stopRun(run, { kind: 'fatal', message: errorText(err) });
  }
  await finish(ctx, run);
}

export interface Notice {
  kind: OperatorMessageKind;
  detail: string;
}

/** Maps a stop reason to the execution status, patch and operator notice of spec §8.1. Pure; `tz` renders instants. */
export function finalStatus(
  stop: StopReason | null,
  now: IsoDateTime,
  tz: string,
): { status: ExecutionStatus; patch: ExecutionPatch; notice: Notice | null } {
  if (stop === null)
    return {
      status: 'completed',
      patch: { finishedAt: now, resumeAfter: null, errorText: null },
      notice: null,
    };
  switch (stop.kind) {
    case 'sigterm':
      // why: spec §8.1 "SIGTERM: … status interrupted without incrementing the counter"
      return {
        status: 'interrupted',
        patch: {},
        notice: {
          kind: 'interrupted',
          detail: 'The app stopped during this run; cells that were in flight went back to not searched.',
        },
      };
    case 'cancel':
      return { status: 'cancelled', patch: { finishedAt: now, resumeAfter: null }, notice: null };
    case 'limiter-timeout':
      return {
        status: 'paused_error',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_error',
          detail:
            stop.resumeAfter === null
              ? 'A provider rate window is full and its reopening time is not known; resume the run manually.'
              : `A provider rate window is full; the run resumes automatically on ${formatInstant(stop.resumeAfter, tz)}.`,
        },
      };
    case 'budget': {
      const e = stop.error;
      const when =
        stop.resumeAfter === null
          ? 'It needs a cap change, or a manual resume after editing the definition.'
          : `It resumes automatically on ${formatInstant(stop.resumeAfter, tz)}, when the cap window reopens.`;
      return {
        status: 'paused_budget',
        patch: { resumeAfter: stop.resumeAfter },
        notice: {
          kind: 'paused_budget',
          detail: `The cap was reached: ${breachText(e.scope, e.providerId ?? null, e.cap, e.current, e.requested, 'the next call needed')}. ${when}`,
        },
      };
    }
    case 'all-disabled':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null },
        notice: {
          kind: 'paused_error',
          detail: `Every ${stop.stage} provider was disabled after errors; resume manually once the cause is fixed.`,
        },
      };
    case 'fatal':
      return {
        status: 'paused_error',
        patch: { resumeAfter: null, errorText: stop.message },
        notice: { kind: 'paused_error', detail: `The run stopped on an internal error: ${stop.message}` },
      };
  }
}

/** Writes the pass's final status. The status write is the last act (Task 7.2 puts notifications before it). */
export async function finish(ctx: EngineContext, run: RunState): Promise<void> {
  const { status, patch } = finalStatus(run.stop, ctx.clock.now(), run.snapshot.scheduleTz);
  ctx.repos.executions.setStatus(run.executionId, status, patch);
  if (patch.resumeAfter !== undefined && patch.resumeAfter !== null)
    ctx.hooks.scheduleResume(run.executionId, run.definitionId, patch.resumeAfter);
  run.log.info({ status }, 'execution: pass finished');
}
