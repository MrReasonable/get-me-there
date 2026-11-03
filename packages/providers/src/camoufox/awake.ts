/**
 * The keep-awake lease, the app's side (spec §2 "The keep-awake lease"): `POST /v1/awake` on the worker's own origin
 * under the unledgered `camoufox-status` id (never a ledger row, its own limiter, so it takes no page token), the key
 * in `x-gmt-worker-key` and the app instance in APP_INSTANCE_HEADER. `hold(seconds)` asks for a lease from now,
 * `release` sends 0. Neither ever throws: a worker that cannot be reached, refuses, or answers what this build cannot
 * read is logged at warn and the run goes on; the lease then runs out on the worker by itself. An abort (the app
 * shutting down) ends the request quietly.
 */
import {
  AbortedError,
  APP_INSTANCE_HEADER,
  AWAKE_ENDPOINT_PATH,
  awakeAnswerSchema,
  type KeepAwakeCapability,
  ProviderError,
  WORKER_KEY_HEADER,
} from '@gmt/core';
import type { CamoufoxProviderOptions } from './provider.js';

const NOT_TAKEN = 'keep-awake: the browser worker did not take the lease';

export function camoufoxKeepAwake(
  o: Pick<CamoufoxProviderOptions, 'http' | 'key' | 'workerUrl' | 'appInstance' | 'log'>,
): KeepAwakeCapability {
  const ask = async (seconds: number, signal: AbortSignal): Promise<void> => {
    let body: unknown;
    try {
      const res = await o.http.request({
        providerId: 'camoufox-status',
        executionId: null,
        tileIndex: null,
        endpointPath: AWAKE_ENDPOINT_PATH,
        method: 'POST',
        url: new URL(AWAKE_ENDPOINT_PATH, o.workerUrl),
        headers: {
          [WORKER_KEY_HEADER]: o.key.reveal(),
          'content-type': 'application/json',
          accept: 'application/json',
          ...(o.appInstance === undefined ? {} : { [APP_INSTANCE_HEADER]: o.appInstance }),
        },
        body: JSON.stringify({ seconds }),
        cache: 'never',
        signal,
        recordFixtures: false,
      });
      body = res.body;
    } catch (e) {
      if (e instanceof AbortedError) return;
      // why: the error's class only: its message may name the worker's origin, never needed here
      o.log.warn(
        { seconds, kind: e instanceof ProviderError ? e.kind : 'unknown', httpStatus: httpStatusOf(e) },
        NOT_TAKEN,
      );
      return;
    }
    const a = awakeAnswerSchema.safeParse(body);
    if (!a.success) {
      o.log.warn({ seconds, kind: 'unreadable', httpStatus: null }, NOT_TAKEN);
      return;
    }
    o.log.debug({ seconds, ...a.data }, 'keep-awake: the browser worker answered');
  };
  return {
    hold: (seconds, signal) => ask(seconds, signal),
    release: (signal) => ask(0, signal),
  };
}

function httpStatusOf(e: unknown): number | null {
  return e instanceof ProviderError ? (e.httpStatus ?? null) : null;
}
