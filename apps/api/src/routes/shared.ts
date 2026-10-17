/** Helpers every handler table uses. */
import type { SearchDefinition } from '@gmt/core';
import { ApiError } from '../errors.js';
import { API_TEXT } from '../text.js';
import type { RouteContext } from './types.js';

/** A path parameter the router guarantees; a missing one is a 400, never a crash. */
export function param(input: { params: Record<string, string> }, name: string): string {
  const v = input.params[name];
  if (v === undefined || v === '') throw new ApiError(400, 'validation', API_TEXT.validation('path'));
  return v;
}

/** A definition that exists and is not soft-deleted, else 404 `definition_not_found` (the id is not echoed). */
export function getLiveDefinition(ctx: RouteContext, id: string): SearchDefinition {
  const def = ctx.ports.repos.definitions.get(id);
  if (def === null || def.deletedAt !== null)
    throw new ApiError(404, 'definition_not_found', API_TEXT.definitionNotFound);
  return def;
}

/** The refusal of a request whose key is already in flight (decision 54): 429 `already_running`. */
const alreadyRunning = () => new ApiError(429, 'already_running', API_TEXT.alreadyRunning);

/**
 * The one in-flight guard (plan decisions 54, 58): a second request under the same key while one is awaiting is refused
 * with `busy()` — 429 `already_running` by default. Keys: the definition id for a run, resume or verify; `coverage-check`
 * for the coverage check; `tool` for the record tool (409 `tool_busy`, its contract code). The estimates are
 * synchronous, so they need no guard: nothing else runs while they do.
 */
export async function oneAtATime<T>(
  ctx: RouteContext,
  key: string,
  fn: () => T | Promise<T>,
  busy: () => ApiError = alreadyRunning,
): Promise<T> {
  if (ctx.busy.has(key)) throw busy();
  ctx.busy.add(key);
  try {
    return await fn();
  } finally {
    ctx.busy.delete(key);
  }
}
