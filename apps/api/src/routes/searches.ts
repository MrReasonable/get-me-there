/**
 * Spec revision 55 §10: the first screen's cards (`GET /definitions/cards`), Search now's one press
 * (`POST /definitions/create-and-start`) and the undo of a remove (`POST /definitions/:id/restore`).
 */
import {
  apiContract,
  BUDGET_SCOPE_KINDS,
  type CreateAndStartRequest,
  type CreateAndStartResponse,
  type Estimate,
  type IsoDateTime,
  microGbpToPence,
  type StartRefusalCode,
} from '@gmt/core';
import type { StartResult } from '@gmt/engine';
import { z } from 'zod';
import { ApiError } from '../errors.js';
import { assembleCards } from '../read/cards.js';
import { definitionResponse } from '../read/definitions.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { syncSchedule, validateForSave } from './definitions.js';
import { param } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

/** How many `requestKey`s create-and-start remembers (spec revision 55 §10): the oldest goes first. */
export const REQUEST_KEYS_KEPT = 100;

/**
 * Spec revision 55 §7, §10: the shown totals of an estimate, the runnable (unblocked) lines' pence and calls, which the
 * sentence beside Search now and Repeat weekly's Save shows and which they store as the confirmation when the sent
 * figures cover them. WP8's PUT keeps storing `confirmationOf`'s worst case over every line.
 */
export function runnableTotalsOf(e: Pick<Estimate, 'perProvider'>): { pence: number; calls: number } {
  const runnable = e.perProvider.filter((p) => p.blocked === null);
  return {
    pence: microGbpToPence(runnable.reduce((a, p) => a + p.costMicroGbp, 0)),
    calls: runnable.reduce((a, p) => a + p.calls, 0),
  };
}

const confirmDetails = z.looseObject({ estimatePence: z.number().int(), totalCalls: z.number().int() });
const capDetails = z.looseObject({
  breaches: z.array(z.looseObject({ scope: z.enum(BUDGET_SCOPE_KINDS), providerId: z.string().nullable() })),
});

/** The end of the window a cap refusal's first breach resets with, when its scope has one (a month's). */
function resetsAtOf(ctx: RouteContext, details: unknown): IsoDateTime | null {
  const parsed = capDetails.safeParse(details);
  const b = parsed.success ? parsed.data.breaches[0] : undefined;
  if (b === undefined) return null;
  const providerId = ctx.ports.providers.find((p) => p.id === b.providerId)?.id;
  if (b.scope === 'global-month') return ctx.ports.budget.usage({ kind: 'global-month' }).windowEnd;
  if ((b.scope === 'provider-month' || b.scope === 'provider-lifetime') && providerId !== undefined)
    return ctx.ports.budget.usage({ kind: b.scope, providerId }).windowEnd;
  return null;
}

/**
 * A refused start in the answer's words (spec revision 55 §10): its code, worded by the web, and the figures the words
 * need; never the engine's message. A code create-and-start cannot meet (the new search has no other run, and is no
 * scheduled firing) answers `failed`.
 */
function refusalOf(
  ctx: RouteContext,
  r: Extract<StartResult, { ok: false }>,
): NonNullable<CreateAndStartResponse['refusal']> {
  const code: StartRefusalCode =
    r.code === 'cap' ||
    r.code === 'confirm' ||
    r.code === 'window' ||
    r.code === 'disabled' ||
    r.code === 'shutting-down'
      ? r.code
      : 'failed';
  const confirm = code === 'confirm' ? confirmDetails.safeParse(r.details) : null;
  return {
    code,
    estimatePence: confirm?.success === true ? confirm.data.estimatePence : null,
    totalCalls: confirm?.success === true ? confirm.data.totalCalls : null,
    resetsAt: code === 'cap' ? resetsAtOf(ctx, r.details) : null,
  };
}

/**
 * Search now's one press (spec revision 55 §10): validate as a create does (a zero-cell window is 422 and creates
 * nothing), recompute the estimate, create the search, store the sent figures as its confirmation only when they cover
 * the recomputed shown totals (`runnableTotalsOf`), then start a manual run with them and `requireCovered`. A refused
 * start keeps the saved search and is answered in the body; a start that throws answers `failed`.
 */
async function createAndStart(
  ctx: RouteContext,
  body: CreateAndStartRequest,
): Promise<CreateAndStartResponse> {
  const { confirmCostPence, confirmCalls, requestKey: _key, ...fields } = body;
  const input = validateForSave(fields, ctx, null);
  const shown = runnableTotalsOf(ctx.engine.estimate(input, ctx.ports.clock.todayLondon()));
  const covers = confirmCostPence >= shown.pence && confirmCalls >= shown.calls;
  const created = ctx.ports.repos.definitions.create(
    covers ? { ...input, confirmedCostPence: confirmCostPence, confirmedCalls: confirmCalls } : input,
  );
  syncSchedule(created, ctx);
  let refusal: CreateAndStartResponse['refusal'] = null;
  let executionId: string | null = null;
  try {
    const r = await ctx.engine.start(created.id, {
      trigger: 'manual',
      confirmCostPence,
      confirmCalls,
      requireCovered: true,
    });
    if (r.ok) executionId = r.executionId;
    else refusal = refusalOf(ctx, r);
  } catch (err) {
    // why: the search is saved whatever the start does; the page states the failure and offers Search again. The
    // message stays in the log, URL-free and with every secret scrubbed
    ctx.ports.log.error(
      { definitionId: created.id, err: { message: safeMessage(err, ctx.ports.secrets) } },
      'create-and-start: the start failed',
    );
    refusal = { code: 'failed', estimatePence: null, totalCalls: null, resetsAt: null };
  }
  const definition = definitionResponse(ctx.ports.repos.definitions.get(created.id) ?? created, ctx);
  return { definition, executionId, refusal };
}

export const searchHandlers: HandlerTable = {
  'GET /api/definitions/cards': plain((c, _input, ctx) =>
    c.json(assembleCards(ctx.ports, ctx.engine, ctx.ports.clock.now())),
  ),

  'POST /api/definitions/create-and-start': route(
    { request: apiContract.createAndStartRequestSchema, query: NO_INPUT },
    async (c, { body }, ctx) => {
      const known = ctx.creates.get(body.requestKey);
      // why: the same press sent again (a retry, a double click) answers the first request's result and creates nothing
      if (known !== undefined) return c.json(await known, 200);
      const pending = createAndStart(ctx, body);
      ctx.creates.set(body.requestKey, pending);
      // why: a bounded map, the oldest key first out (a Map iterates in insertion order)
      for (const k of ctx.creates.keys()) {
        if (ctx.creates.size <= REQUEST_KEYS_KEPT) break;
        ctx.creates.delete(k);
      }
      try {
        return c.json(await pending, 201);
      } catch (err) {
        // why: a rejected request (a 422, say) leaves no key behind, so a corrected press is a new request
        if (ctx.creates.get(body.requestKey) === pending) ctx.creates.delete(body.requestKey);
        throw err;
      }
    },
  ),

  'POST /api/definitions/:id/restore': plain((c, input, ctx) => {
    const id = param(input, 'id');
    const done =
      ctx.ports.repos.definitions.get(id) === null ? 'missing' : ctx.ports.repos.definitions.restore(id);
    if (done !== 'restored') throw new ApiError(404, 'definition_not_found', API_TEXT.definitionNotFound);
    const def = ctx.ports.repos.definitions.get(id);
    if (def === null) throw new ApiError(404, 'definition_not_found', API_TEXT.definitionNotFound);
    // why: revision 55 §8.2 — a restore re-registers the job of a search that is scheduled, in the same request
    syncSchedule(def, ctx);
    return c.json(definitionResponse(def, ctx));
  }),
};
