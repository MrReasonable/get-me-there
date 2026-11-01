/**
 * The one way the camoufox adapter posts a page request to its host-side worker (spec §2, §5.2; spec revision 55 §2;
 * 20.7 review finding 4): `POST <path>` on the worker's own origin, the key in `x-gmt-worker-key`, the app instance in
 * APP_INSTANCE_HEADER (decision 82), never cached, through http-kit (one ledger row per attempt, the page class from the
 * worker's contacted header). A ProviderError comes back as `{ ok: false }`, but the worker's monthly cap, which is
 * thrown as BudgetExceeded (`throwIfMonthly`); anything else is rethrown.
 */
import { APP_INSTANCE_HEADER, type ProviderContext, ProviderError, WORKER_KEY_HEADER } from '@gmt/core';
import { throwIfMonthly } from './answer.js';
import type { CamoufoxProviderOptions } from './provider.js';

export interface WorkerPost {
  /** `/v1/page` or `/v1/flights`: the route and the ledger's `endpoint_path`. */
  path: string;
  /** The request, already parsed by core's schema. */
  body: unknown;
  /** The tile's index, or null for a flight list. */
  tileIndex: number | null;
  ctx: ProviderContext;
  /** A grid page's allowed scrolls, which the reservation checks against the caps (ruling 12). */
  scrolls?: number;
}

export async function postToWorker(
  o: Pick<CamoufoxProviderOptions, 'http' | 'key' | 'workerUrl' | 'appInstance'>,
  p: WorkerPost,
): Promise<{ ok: true; body: unknown } | { ok: false; error: ProviderError }> {
  try {
    const res = await o.http.request({
      providerId: 'camoufox',
      executionId: p.ctx.executionId,
      tileIndex: p.tileIndex,
      endpointPath: p.path,
      method: 'POST',
      url: new URL(p.path, o.workerUrl),
      headers: {
        [WORKER_KEY_HEADER]: o.key.reveal(),
        'content-type': 'application/json',
        accept: 'application/json',
        ...(o.appInstance === undefined ? {} : { [APP_INSTANCE_HEADER]: o.appInstance }),
      },
      body: JSON.stringify(p.body),
      cache: 'never',
      signal: p.ctx.signal,
      recordFixtures: p.ctx.recordFixtures,
      ...(p.scrolls === undefined ? {} : { scrolls: p.scrolls }),
      ...(p.ctx.beforeSend === undefined ? {} : { beforeSend: p.ctx.beforeSend }),
    });
    return { ok: true, body: res.body };
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    throwIfMonthly(e);
    return { ok: false, error: e };
  }
}
