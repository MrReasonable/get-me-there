/** Shared types of the route table (spec §10). */
import type { apiContract } from '@gmt/core';
import type { Engine } from '@gmt/engine';
import type { Context } from 'hono';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';

/** Every ROUTES path starts with this (spec §10); static files and the SPA fallback own everything else. */
export const API_PREFIX = '/api';

export interface AppVariables {
  /** True when the request carried valid basic-auth credentials, or auth is disabled by config. */
  authenticated: boolean;
}
export type AppEnv = { Variables: AppVariables };

export type ToolRunResponse = z.infer<typeof apiContract.toolRunResponseSchema>;
export type ToolRecordRequest = z.infer<typeof apiContract.toolRecordRequestSchema>;
export type ToolSmokeRequest = z.infer<typeof apiContract.toolSmokeRequestSchema>;
/**
 * The tools the HTTP surface runs in-process; an absent runner answers 503 tool_unavailable. why: named apart from
 * WP4b's `ToolRunners` in `bootstrap/tool.ts` (the CLI's runners, a different shape) so the two never shadow.
 */
export interface HttpToolRunners {
  record?: (args: ToolRecordRequest, signal: AbortSignal) => Promise<ToolRunResponse>;
  /** Spec §10 `/tools/smoke` (WP13): the smoke inside the app process, which holds app_lock. */
  smoke?: (args: ToolSmokeRequest, signal: AbortSignal) => Promise<ToolRunResponse>;
}

/** The raw inputs of one request: the JSON body (undefined when empty), the query record, the path parameters. */
export interface RawInput {
  body: unknown;
  query: Record<string, string> | undefined;
  params: Record<string, string>;
}
export interface RouteContext {
  ports: Ports;
  engine: Engine;
  tools: HttpToolRunners;
  /** Plan decisions 54, 58: the keys with a request in flight (`oneAtATime`): definitions, the coverage check, the tool. */
  busy: Set<string>;
}
/**
 * One route's handler with the schemas it validates against: the ROUTES entry's own `request` and `query` objects
 * (createApp checks identity), parsed exactly once before `handle` runs (plan decision 54).
 */
export interface RouteHandler {
  readonly request: z.ZodType;
  readonly query: z.ZodType;
  handle(c: Context<AppEnv>, raw: RawInput, ctx: RouteContext): Response | Promise<Response>;
}
/** Handlers keyed exactly as `${method} ${path}` of a ROUTES entry. */
export type HandlerTable = Readonly<Record<string, RouteHandler>>;
