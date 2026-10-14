import type { IsoDateTime, Reservation } from '@gmt/core';
import { classifyResponse } from './classify.js';
import type { HttpKitDeps, HttpKitRequest, ProviderHttpLimits } from './types.js';

/** The outcome of one successful HTTP attempt. */
export interface AttemptResult {
  status: number;
  body: unknown;
  fetchedAt: IsoDateTime;
}

/** Per-attempt inputs from the retry loop. */
export interface AttemptContext {
  attempt: number;
}

/**
 * One attempt of spec §5.3's retry body: budget.reserve → fetch → reservation.finalise. Reserve runs before
 * the request leaves the process on every attempt, so a refused cap means no upstream call.
 */
export async function runAttempt(
  deps: HttpKitDeps,
  r: HttpKitRequest,
  limits: ProviderHttpLimits,
  ctx: AttemptContext,
): Promise<AttemptResult> {
  // why: 'fx' is not a ProviderId in the BudgetGuard port and spec §5.6 says FX calls are never ledgered.
  const reservation: Reservation | null =
    r.providerId === 'fx'
      ? null
      : deps.budget.reserve({
          providerId: r.providerId,
          executionId: r.executionId,
          tileIndex: r.tileIndex,
          costMicroGbp: limits.costPerCallMicroGbp,
          httpAttempt: ctx.attempt,
          endpointPath: r.endpointPath,
        });
  const started = Date.now();
  const res = await fetch(r.url, {
    method: r.method,
    headers: r.headers,
    ...(r.body === undefined ? {} : { body: r.body }),
    redirect: 'error',
  });
  const text = await res.text();
  const ok = res.status >= 200 && res.status < 300;
  reservation?.finalise({
    outcome: ok ? 'ok' : 'error',
    httpStatus: res.status,
    durationMs: Date.now() - started,
  });
  const body: unknown = text === '' ? null : JSON.parse(text);
  if (!ok)
    throw classifyResponse({
      status: res.status,
      body,
      headers: res.headers,
      providerId: r.providerId,
      endpointPath: r.endpointPath,
    });
  return { status: res.status, body, fetchedAt: deps.clock.now() };
}
