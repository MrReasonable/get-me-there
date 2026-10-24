/** Spec §8.1, §10: start, read, cancel and resume executions; single-cell verify. */
import { apiContract, type Execution } from '@gmt/core';
import type { StartResult } from '@gmt/engine';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ApiError, type Details, scrubDetails } from '../errors.js';
import { activeExecution, executionResponse } from '../read/executions.js';
import { cellInSpace, currentSpace } from '../read/space.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { getLiveDefinition, oneAtATime, param } from './shared.js';
import type { AppEnv, HandlerTable, RouteContext } from './types.js';

type Refusal = Extract<StartResult, { ok: false }>;

const START_STATUS: Record<Refusal['code'], ContentfulStatusCode> = {
  active: 409,
  cap: 409,
  confirm: 409,
  disabled: 409,
  window: 422,
  not_found: 404,
  // why: spec §7 rev 36 — only a scheduled start can lose its firing; the API never starts one, so this is a guard
  'firing-taken': 409,
  // why: a request that arrives while the app is stopping is refused rather than started into a closing database
  'shutting-down': 503,
};

/** Spec §10: 409 on an active execution or a cap breach naming the cap; 422 for a zero-cell window. */
export function startError(r: Refusal): ApiError {
  const details: Details | undefined =
    r.details !== null && typeof r.details === 'object' ? scrubDetails(r.details) : undefined;
  return new ApiError(START_STATUS[r.code], r.code, r.message, details);
}

function getExecution(ctx: RouteContext, id: string): Execution {
  const e = ctx.ports.repos.executions.get(id);
  if (e === null) throw new ApiError(404, 'execution_not_found', API_TEXT.executionNotFound);
  return e;
}

/** `startExecutionResponseSchema` for start and verify (202). */
function accepted(c: Context<AppEnv>, r: StartResult) {
  if (!r.ok) throw startError(r);
  return c.json({ executionId: r.executionId }, 202);
}

/** The confirmation fields a start or verify body carries, passed on only when sent (decisions 37, 43). */
function confirmation(b: { confirmCostPence?: number | undefined; confirmCalls?: number | undefined }) {
  return {
    ...(b.confirmCostPence === undefined ? {} : { confirmCostPence: b.confirmCostPence }),
    ...(b.confirmCalls === undefined ? {} : { confirmCalls: b.confirmCalls }),
  };
}

export const executionHandlers: HandlerTable = {
  'POST /api/definitions/:id/executions': route(
    { request: apiContract.startExecutionRequestSchema, query: NO_INPUT },
    (c, input, ctx) => {
      const def = getLiveDefinition(ctx, param(input, 'id'));
      return oneAtATime(ctx, def.id, async () =>
        accepted(c, await ctx.engine.start(def.id, { trigger: 'manual', ...confirmation(input.body) })),
      );
    },
  ),

  'GET /api/executions/active': plain((c, _input, ctx) => c.json(activeExecution(ctx.ports, ctx.engine))),

  'GET /api/executions/:id': plain((c, input, ctx) =>
    c.json(executionResponse(ctx.ports, getExecution(ctx, param(input, 'id')))),
  ),

  'POST /api/executions/:id/cancel': plain(async (c, input, ctx) => {
    const e = getExecution(ctx, param(input, 'id'));
    if (!(await ctx.engine.cancel(e.id)))
      throw new ApiError(409, 'not_cancellable', API_TEXT.notCancellable(e.status));
    return c.json(executionResponse(ctx.ports, getExecution(ctx, e.id)));
  }),

  'POST /api/executions/:id/resume': plain((c, input, ctx) => {
    const e = getExecution(ctx, param(input, 'id'));
    return oneAtATime(ctx, e.definitionId, async () => {
      // why: the API's resume is the operator's manual resume (spec §8.1): it re-enables disabled providers.
      const r = await ctx.engine.resume(e.id, { manual: true });
      if (!r.ok) throw startError(r);
      return c.json(executionResponse(ctx.ports, getExecution(ctx, r.executionId)));
    });
  }),

  'POST /api/cells/verify': route(
    { request: apiContract.verifyCellRequestSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      const def = getLiveDefinition(ctx, body.definitionId);
      if (def.providers.verification.length === 0)
        throw new ApiError(422, 'no_verification_provider', API_TEXT.noVerificationProvider);
      if (!cellInSpace(currentSpace(def, ctx.ports.clock.todayLondon()), body.cell))
        throw new ApiError(422, 'cell_not_in_space', API_TEXT.cellNotInSpace, { cell: body.cell });
      for (const code of [body.cell.origin, body.cell.destination]) {
        if (!ctx.ports.repos.airports.exists(code))
          throw new ApiError(422, 'unknown_airport', API_TEXT.unknownAirport(code));
      }
      // why: N2 (ruling 9): a definition that allows 0 billed calls can start no child; the refusal names the fix.
      if (def.budget.maxCalls === 0) {
        const preview = ctx.engine.childCapPreview(def.id, body.cell);
        const need = preview.ok ? preview.needCalls : ctx.ports.config.spend.childMaxCalls;
        throw new ApiError(409, 'cap', API_TEXT.verifyZeroRunCap(need));
      }
      return oneAtATime(ctx, def.id, async () =>
        accepted(c, await ctx.engine.verifyCell(def.id, body.cell, confirmation(body))),
      );
    },
  ),
};
