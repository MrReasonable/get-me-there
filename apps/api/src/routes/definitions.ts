/** Spec §10 definitions CRUD, both estimate routes and the coverage check; spec §8.2 schedule sync. */
import {
  apiContract,
  budgetScopeLabel,
  countCells,
  type DefinitionInput,
  type SearchDefinition,
  validateSearchSpace,
} from '@gmt/core';
import { confirmationOf, parseCron } from '@gmt/engine';
import { defaultDefinitionInput } from '../defaults.js';
import { ApiError, fieldsDetail, issuesToFields } from '../errors.js';
import {
  definitionResponse,
  deletedResponse,
  inputOf,
  mergeDefinition,
  sentCovers,
} from '../read/definitions.js';
import { airportLookup, currentSpace, isDraft } from '../read/space.js';
import { API_TEXT } from '../text.js';
import { NO_INPUT, plain, route } from './define.js';
import { getLiveDefinition, oneAtATime, param } from './shared.js';
import type { HandlerTable, RouteContext } from './types.js';

/** The in-flight key of the coverage check, which names no saved definition (decision 54). */
const COVERAGE_CHECK = 'coverage-check';

/** The explicit confirmation a create or update body may carry (decisions 37, 42). */
interface SentConfirmation {
  confirmedCostPence?: number | undefined;
  confirmedCalls?: number | undefined;
}

/**
 * Spec §7, decisions 37, 43 and 54: the stored confirmation is set only from an explicit operator value carrying both
 * pence and calls that cover the worst-case figures, and what is stored is WP7's `confirmationOf(estimate)` (every
 * line, blocked ones included), never the shown totals; otherwise nothing is stored and the response carries
 * needsConfirmation.
 */
function applyConfirmation(
  def: SearchDefinition,
  sent: SentConfirmation,
  ctx: RouteContext,
): SearchDefinition {
  const { confirmedCostPence: pence, confirmedCalls: calls } = sent;
  if (pence === undefined || calls === undefined || isDraft(def)) return def;
  const estimate = ctx.engine.estimate(def, ctx.ports.clock.todayLondon());
  if (!sentCovers({ pence, calls }, estimate)) return def;
  const worst = confirmationOf(estimate);
  ctx.ports.repos.definitions.setConfirmed(def.id, worst);
  return { ...def, confirmedCostPence: worst.pence, confirmedCalls: worst.calls };
}

/** Spec §10 estimate routes: `{ estimate, budgetFit }` so the form shows both before the create click. */
function estimateResponse(def: DefinitionInput | SearchDefinition, ctx: RouteContext) {
  return {
    estimate: ctx.engine.estimate(def, ctx.ports.clock.todayLondon()),
    budgetFit: ctx.engine.budgetFit(def),
  };
}

/** Spec §8.2: register when enabled with a cron, otherwise unregister, in the same request. */
export function syncSchedule(def: SearchDefinition, ctx: RouteContext): void {
  if (def.enabled && def.scheduleCron !== null && def.deletedAt === null) ctx.engine.scheduler.register(def);
  else ctx.engine.scheduler.unregister(def.id);
}

/** True when the save turns a schedule on or changes it (decision 25 judges the monthly fit only then). */
function scheduleChanges(next: DefinitionInput, before: SearchDefinition | null): boolean {
  if (!next.enabled || next.scheduleCron === null) return false;
  return (
    before === null ||
    !before.enabled ||
    before.scheduleCron !== next.scheduleCron ||
    before.scheduleTz !== next.scheduleTz
  );
}

/**
 * Save-time validation of the whole (merged) definition: cron through the scheduler's `parseCron` (spec §8.2, the sole
 * validator), drafts may not be enabled, every named provider must be configured (a production config never offers
 * `fixture`, spec §5.5), then the contract shape, zero-cell windows (422, spec §6.1), `validateSearchSpace` (airports,
 * metro codes, nights, caps, alwaysInclude) and, when the save turns a schedule on or changes it, the monthly fit of
 * every provider-month scope (decision 25), matched by core's scope label (decision 54).
 */
export function validateForSave(
  def: DefinitionInput,
  ctx: RouteContext,
  before: SearchDefinition | null,
): DefinitionInput {
  if (def.scheduleCron !== null) {
    const cron = parseCron(def.scheduleCron, def.scheduleTz);
    if (!cron.ok)
      throw new ApiError(
        422,
        'invalid_cron',
        API_TEXT.invalidCron(cron.reason),
        fieldsDetail([{ field: 'scheduleCron', message: cron.reason }]),
      );
  }
  const configured = new Set(ctx.ports.providers.map((p) => p.id));
  for (const stage of ['discovery', 'verification'] as const) {
    const unknown = def.providers[stage].find((id) => !configured.has(id));
    if (unknown !== undefined)
      throw new ApiError(
        422,
        'unknown_provider',
        API_TEXT.unknownProvider(unknown),
        fieldsDetail([{ field: `providers.${stage}`, message: API_TEXT.unknownProvider(unknown) }]),
      );
  }
  if (isDraft(def)) {
    if (def.enabled)
      throw new ApiError(
        422,
        'draft_cannot_enable',
        API_TEXT.draftCannotEnable,
        fieldsDetail([{ field: 'enabled', message: API_TEXT.draftCannotEnable }]),
      );
    return def;
  }
  const shape = apiContract.definitionCreateRequestSchema.safeParse(def);
  if (!shape.success)
    throw new ApiError(
      422,
      'invalid_definition',
      API_TEXT.invalidDefinition,
      fieldsDetail(issuesToFields(shape.error.issues)),
    );
  const today = ctx.ports.clock.todayLondon();
  if (countCells(currentSpace(def, today)) <= 0)
    throw new ApiError(
      422,
      'zero_cells',
      API_TEXT.zeroCells,
      fieldsDetail([{ field: 'window', message: API_TEXT.zeroCells }]),
    );
  const v = validateSearchSpace(
    def,
    today,
    airportLookup(ctx.ports.repos.airports),
    ctx.ports.config.maxCellsPerDefinition,
  );
  if (!v.ok)
    throw new ApiError(422, 'invalid_definition', API_TEXT.invalidDefinition, fieldsDetail(v.errors));
  if (scheduleChanges(def, before)) {
    const monthScopes = new Set(
      ctx.ports.providers.map((p) => budgetScopeLabel({ kind: 'provider-month', providerId: p.id })),
    );
    const over = ctx.engine
      .budgetFit(def)
      .perScope.filter((s) => monthScopes.has(s.scope) && !s.fits)
      .map((s) => s.scope);
    if (over.length > 0)
      throw new ApiError(
        422,
        'schedule_over_budget',
        API_TEXT.scheduleOverBudget(over),
        fieldsDetail([{ field: 'scheduleCron', message: API_TEXT.scheduleOverBudget(over) }]),
      );
  }
  return def;
}

export const definitionHandlers: HandlerTable = {
  'GET /api/definitions': plain((c, _input, ctx) =>
    c.json(ctx.ports.repos.definitions.list().map((d) => definitionResponse(d, ctx))),
  ),

  'POST /api/definitions': route(
    { request: apiContract.definitionCreateOptionalSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      // why: spec §10: no body creates the plan-aware default, a draft without airports.
      if (body === undefined) {
        const draft = ctx.ports.repos.definitions.create(
          validateForSave(defaultDefinitionInput(ctx.ports.config, ctx.ports.providers), ctx, null),
        );
        return c.json(definitionResponse(draft, ctx), 201);
      }
      const { confirmedCostPence, confirmedCalls, ...def } = body;
      const created = applyConfirmation(
        ctx.ports.repos.definitions.create(validateForSave(def, ctx, null)),
        { confirmedCostPence, confirmedCalls },
        ctx,
      );
      syncSchedule(created, ctx);
      return c.json(definitionResponse(created, ctx), 201);
    },
  ),

  'POST /api/definitions/estimate': route(
    { request: apiContract.definitionCreateRequestSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      const { confirmedCostPence: _p, confirmedCalls: _c, ...def } = body;
      // why: the unsaved body is estimated, not scheduled, so its enabled flag and schedule fit do not matter here.
      validateForSave({ ...def, enabled: false }, ctx, null);
      return c.json(estimateResponse(def, ctx));
    },
  ),

  'GET /api/definitions/:id': plain((c, input, ctx) =>
    c.json(definitionResponse(getLiveDefinition(ctx, param(input, 'id')), ctx)),
  ),

  'PUT /api/definitions/:id': route(
    { request: apiContract.definitionUpdateRequestSchema, query: NO_INPUT },
    (c, input, ctx) => {
      const existing = getLiveDefinition(ctx, param(input, 'id'));
      const { confirmedCostPence, confirmedCalls, ...patch } = input.body;
      const merged = validateForSave(mergeDefinition(inputOf(existing), patch), ctx, existing);
      const updated = applyConfirmation(
        ctx.ports.repos.definitions.update(existing.id, merged),
        { confirmedCostPence, confirmedCalls },
        ctx,
      );
      syncSchedule(updated, ctx);
      return c.json(definitionResponse(updated, ctx));
    },
  ),

  'DELETE /api/definitions/:id': plain((c, input, ctx) => {
    const existing = getLiveDefinition(ctx, param(input, 'id'));
    ctx.ports.repos.definitions.softDelete(existing.id);
    ctx.engine.scheduler.unregister(existing.id);
    return c.json(deletedResponse(existing, ctx));
  }),

  'POST /api/definitions/:id/estimate': plain((c, input, ctx) => {
    const def = getLiveDefinition(ctx, param(input, 'id'));
    if (isDraft(def)) throw new ApiError(422, 'draft_definition', API_TEXT.draftNoEstimate);
    return c.json(estimateResponse(def, ctx));
  }),

  'POST /api/definitions/coverage-check': route(
    { request: apiContract.coverageCheckRequestSchema, query: NO_INPUT },
    (c, { body }, ctx) => {
      // why: spec §10: the check runs free Travelpayouts month tiles and never calls a billed provider.
      if (!ctx.ports.providers.some((p) => p.id === 'travelpayouts'))
        throw new ApiError(409, 'coverage_check_unavailable', API_TEXT.coverageCheckUnavailable);
      return oneAtATime(ctx, COVERAGE_CHECK, async () => c.json(await ctx.engine.coverageCheck(body)));
    },
  ),
};
