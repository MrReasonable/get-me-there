/** Spec §10 system routes: health, airports, providers, budget, scheduler jobs. */
import { statSync } from 'node:fs';
import { apiContract, DEFAULT_DISCOVERY_REFRESH_HOURS, microGbpToPence, type ProviderId } from '@gmt/core';
import type { z } from 'zod';
import { defaultDefinitionInput } from '../defaults.js';
import { hostAllowed } from '../middleware/hardening.js';
import {
  budgetScopes,
  planOf,
  providerBudget,
  providerScopes,
  usageOf,
  zeroCapBlocks,
} from '../read/usage.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { NO_INPUT, plain, route } from './define.js';
import type { HandlerTable, RouteContext } from './types.js';

type HealthDetail = z.infer<typeof apiContract.healthDetailSchema>;
type ProvidersResponse = z.infer<typeof apiContract.providersResponseSchema>;
type BudgetResponse = z.infer<typeof apiContract.budgetResponseSchema>;

function dbOk(ports: Ports): boolean {
  try {
    ports.db.raw.prepare('select 1 as one').get();
    return true;
  } catch {
    return false;
  }
}

/** Spec §10 `GET /health` minimal shape: no detail without auth. */
export function healthPublic(ctx: RouteContext): { ok: boolean; degraded: boolean } {
  return { ok: dbOk(ctx.ports), degraded: ctx.engine.status().degraded };
}

/** The file's size; 0 for an in-memory database (the contract has no "unknown"). */
function dbSizeBytes(path: string): number {
  if (path === ':memory:') return 0;
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Spec §10 authenticated `/health` detail. No database path (plan: `path: never`). */
export function healthDetail(ctx: RouteContext): HealthDetail {
  const base = healthPublic(ctx);
  const s = ctx.engine.status();
  return {
    ...base,
    db: { ok: base.ok, sizeBytes: dbSizeBytes(ctx.ports.config.databasePath) },
    // why: `healthy` would need a provider call; health never spends or waits, so it reports null (not checked).
    providers: ctx.ports.providers.map((p) => ({ providerId: p.id, configured: true, healthy: null })),
    scheduler: {
      jobCount: ctx.engine.scheduler.jobs().length,
      nextRun: s.nextRun,
      lastExecutionAt: s.lastExecutionAt,
      degraded: s.degraded,
      blockedSince: ctx.engine.scheduler.blockedSince(),
    },
  };
}

/** Ruling 5: a billed provider whose calls cost £0 is stopped by its call cap alone; the card names that cap. */
function capNoteOf(ctx: RouteContext, id: ProviderId): string | null {
  const b = providerBudget(ctx.ports.config, id);
  if (!b.billable || b.costPerCallMicroGbp > 0) return null;
  const [scope] = providerScopes(ctx.ports.config, id);
  const cap = scope === undefined ? null : usageOf(ctx.ports, scope).cap;
  if (cap === null) return null;
  const governs = API_TEXT.callCapGoverns(b.window, cap);
  // why: N2 (ruling 9): with a 0-call default, the card's "N calls are the hard stop" must not read as calls available.
  return ctx.ports.config.spend.executionMaxCalls === 0
    ? `${governs}; ${API_TEXT.zeroRunCapDefault}`
    : governs;
}

/**
 * Spec §10 `GET /providers`: config + capabilities + usage only (there is no providers table, plan decision 15), the
 * zero-cap notice, the plan presets (`discoveryRefreshHours` is core's DEFAULT_DISCOVERY_REFRESH_HOURS, decision 21).
 */
export function providersResponse(ctx: RouteContext): ProvidersResponse {
  const { config } = ctx.ports;
  const preset = defaultDefinitionInput(config, ctx.ports.providers);
  return {
    providers: ctx.ports.providers.map((p) => ({
      providerId: p.id,
      displayName: p.displayName,
      enabled: true,
      capabilities: { discovery: p.discovery?.info ?? null, verification: p.verification?.info ?? null },
      plan: planOf(config, p.id),
      usage: providerScopes(config, p.id).map((s) => usageOf(ctx.ports, s)),
      excludedFromSchedule: providerBudget(config, p.id).excludedFromSchedule,
      // why: spec §10/§12, ruling 5: only a call that costs money is stopped by a zero spend cap; say so where the operator looks.
      notices: zeroCapBlocks(config, p.id) ? [API_TEXT.zeroCapVerification] : [],
      capNote: capNoteOf(ctx, p.id),
    })),
    synthetic: ctx.ports.providers.some((p) => p.id === 'fixture'),
    presets: {
      policy: {
        maxCells: preset.verification.maxCells,
        topN: preset.verification.topN,
        expandTop: preset.verification.expandTop,
        bookingLinks: preset.verification.bookingLinks,
      },
      providers: preset.providers,
      budget: preset.budget,
      discoveryRefreshHours: DEFAULT_DISCOVERY_REFRESH_HOURS,
      schedulerTimezone: config.schedulerTimezone,
    },
    pointOfSale: config.pointOfSale,
  };
}

/** Spec §10 `GET /budget`: every window with bounds; the cap includes subscription fees once (spec §5.3, §12). */
export function budgetResponse(ctx: RouteContext): BudgetResponse {
  const { config } = ctx.ports;
  // why: the same sum as the engine's budgetFit: every registered billable provider's fixed fee, from the guard's entry.
  const fixedFeesMicroGbp = ctx.ports.providers
    .map((p) => providerBudget(config, p.id))
    .reduce((a, b) => a + (b.billable ? b.planFixedMicroGbp : 0), 0);
  const monthlyCapPence = microGbpToPence(config.spend.monthlyCapMicroGbp);
  return {
    scopes: budgetScopes(ctx.ports, null).map((s) => usageOf(ctx.ports, s)),
    monthlyCapMicroGbp: config.spend.monthlyCapMicroGbp,
    monthlyCapPence,
    fixedFeesMicroGbp,
    ceilingNote: API_TEXT.ceilingNote(monthlyCapPence, microGbpToPence(fixedFeesMicroGbp)),
  };
}

export const systemHandlers: HandlerTable = {
  /**
   * One public route with two shapes: the HEALTHCHECK gets the minimal one; the detail goes only to a caller with
   * valid credentials or, with auth off, a request whose Host is allowed (review SEC-2: the route is Host-exempt, so
   * a rebinding page must not read the detail through it).
   */
  'GET /api/health': plain((c, _input, ctx) => {
    const { config } = ctx.ports;
    const detail =
      c.get('authenticated') && (config.auth !== null || hostAllowed(config, c.req.header('host')));
    return c.json(detail ? healthDetail(ctx) : healthPublic(ctx));
  }),
  'GET /api/airports': route(
    { request: NO_INPUT, query: apiContract.airportsQuerySchema },
    (c, { query }, ctx) =>
      c.json(
        ctx.ports.repos.airports.search(query.q, 20).map((a) => ({
          iata: a.iata,
          name: a.name,
          city: a.city,
          country: a.country,
          tz: a.tz,
          metro: a.metro,
        })),
      ),
  ),
  'GET /api/providers': plain((c, _input, ctx) => c.json(providersResponse(ctx))),
  'GET /api/budget': plain((c, _input, ctx) => c.json(budgetResponse(ctx))),
  'GET /api/scheduler/jobs': plain((c, _input, ctx) => c.json({ jobs: ctx.engine.scheduler.jobs() })),
};
