/**
 * The unledgered preflight (spec §2 "Before planning camoufox tiles, the engine reads the worker's /v1/status";
 * decision 69; cost-015): GET /v1/status under `camoufox-status`, never a ledger row. A cool-down or a standing
 * signed-in refusal skips the provider's cells `provider_disabled` (with the end, which keys the once-per-cool-down
 * notice); a worker that cannot be reached, or answers what this build cannot read, skips them `provider_unavailable`.
 */
import {
  AbortedError,
  type PreflightResult,
  type ProviderContext,
  ProviderError,
  type Secret,
  WORKER_KEY_HEADER,
  workerStatusSchema,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';

export const UNREACHABLE = 'browser worker not reachable';
/** Fix round 1 (arch M9, prov M1): the distinct details, so a wrong key never reads as an absent worker. */
export const KEY_REFUSED = 'the worker refused CAMOUFOX_WORKER_KEY (the app and worker.env differ)';
export const UNREADABLE = "the worker's status could not be read by this build (versions differ?)";
export const SIGNED_IN_REFUSED = 'signed-in profile refused';

export async function camoufoxPreflight(
  o: { http: HttpKit; key: Secret; workerUrl: string },
  ctx: ProviderContext,
): Promise<PreflightResult> {
  let body: unknown;
  try {
    const res = await o.http.request({
      providerId: 'camoufox-status',
      executionId: ctx.executionId,
      tileIndex: null,
      endpointPath: '/v1/status',
      method: 'GET',
      url: new URL('/v1/status', o.workerUrl),
      headers: { [WORKER_KEY_HEADER]: o.key.reveal(), accept: 'application/json' },
      cache: 'never',
      signal: ctx.signal,
      recordFixtures: false,
    });
    body = res.body;
  } catch (e) {
    if (e instanceof AbortedError) throw e;
    // why: a wrong key is a configuration fault: provider_disabled, which a resume does not retry on every run
    if (e instanceof ProviderError && e.kind === 'auth')
      return { ok: false, skip: 'provider_disabled', detail: KEY_REFUSED };
    if (e instanceof ProviderError && e.httpStatus !== undefined)
      return {
        ok: false,
        skip: 'provider_unavailable',
        detail: `the browser worker answered HTTP ${e.httpStatus}`,
      };
    return { ok: false, skip: 'provider_unavailable', detail: UNREACHABLE };
  }
  const s = workerStatusSchema.safeParse(body);
  if (!s.success) return { ok: false, skip: 'provider_unavailable', detail: UNREADABLE };
  const st = s.data;
  if (st.coolingDownUntil !== null)
    return {
      ok: false,
      skip: 'provider_disabled',
      detail: `cooling down until ${st.coolingDownUntil} (${st.cooldownCause ?? 'unknown'})`,
      until: st.coolingDownUntil,
    };
  if (st.signedInRefusal || st.accountCookie.found)
    return { ok: false, skip: 'provider_disabled', detail: SIGNED_IN_REFUSED };
  return { ok: true };
}
