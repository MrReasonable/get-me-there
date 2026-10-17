/** Spec §10 system routes: health, airports, providers, budget, scheduler jobs. */
import { statSync } from 'node:fs';
import {
  apiContract,
  type Config,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  microGbpToPence,
  type ProviderId,
} from '@gmt/core';
import type { z } from 'zod';
import { defaultDefinitionInput } from '../defaults.js';
import { hostAllowed } from '../middleware/hardening.js';
import { budgetScopes, providerLimits, providerScopes, usageOf } from '../read/usage.js';
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

function planOf(config: Config, id: ProviderId): ProvidersResponse['providers'][number]['plan'] {
  if (id === 'searchapi') return config.providers.searchapi?.plan ?? 'trial';
  return id === 'fixture' ? 'synthetic' : 'free';
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
      usage: providerScopes(p.id).map((s) => usageOf(ctx.ports, s)),
      excludedFromSchedule: providerLimits(config, p.id)?.excludedFromSchedule ?? false,
      // why: spec §10/§12: a billed provider enabled under a zero cap cannot verify; say so where the operator looks.
      notices:
        p.id === 'searchapi' && config.spend.monthlyCapMicroGbp === 0 ? [API_TEXT.zeroCapVerification] : [],
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
  const sa = config.providers.searchapi;
  const fixedFeesMicroGbp = sa !== null && sa.limits.window === 'month' ? sa.limits.planFixedMicroGbp : 0;
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
