import { AbortedError, type IsoDateTime, type Reservation } from '@gmt/core';
import {
  bodyReadFailed,
  bodyTooLarge,
  classifyResponse,
  classifyThrown,
  finishError,
  malformedBody,
  redirectRefused,
  requestTimeout,
} from './classify.js';
import { scrubSecrets } from './scrub.js';
import type { HttpKitDeps, HttpKitRequest, ProviderHttpLimits, ResponseFacts } from './types.js';

/** Response bodies above this are refused (sec-014): a misbehaving vendor cannot exhaust memory. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** The outcome of one successful HTTP attempt; `body` is already scrubbed of every secret. */
export interface AttemptResult {
  status: number;
  body: unknown;
  fetchedAt: IsoDateTime;
}

/** Per-attempt inputs from the retry loop. */
export interface AttemptContext {
  attempt: number;
  secondsToHourRefresh: () => number;
}

/** Rejects with the signal's reason as soon as it aborts, whether or not `p` itself honours the signal. */
export function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** Reads the body as text, or null when it exceeds MAX_BODY_BYTES (declared or streamed). */
async function readCapped(res: Response, signal: AbortSignal): Promise<string | null> {
  if (Number(res.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
    await res.body?.cancel();
    return null;
  }
  if (res.body === null) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await raceAbort(reader.read(), signal);
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function scrubbedHeaders(h: Headers, deps: HttpKitDeps): Headers {
  const out = new Headers();
  h.forEach((value, name) => {
    out.set(name, scrubSecrets(value, deps.secrets));
  });
  return out;
}

/**
 * One attempt of spec §5.3's retry body: budget.reserve → fetch → reservation.finalise → classify.
 * - reserve runs before the request leaves the process (BudgetExceeded propagates, nothing is sent);
 * - fetch uses `redirect: 'error'` and the per-request timeout combined with the caller's signal;
 * - finalise runs exactly once per reserve: `ok` for 2xx (even a malformed body: the vendor billed it), `error`
 *   for any other status or a socket failure, `unknown` for timeout and abort and for a billed 200 whose body
 *   then fails; an abort finalises `unknown` before AbortedError propagates.
 */
export async function runAttempt(
  deps: HttpKitDeps,
  r: HttpKitRequest,
  limits: ProviderHttpLimits,
  ctx: AttemptContext,
): Promise<AttemptResult> {
  if (r.signal.aborted) throw new AbortedError();
  const w = { providerId: r.providerId, endpointPath: r.endpointPath };
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
  // why: durations use Date.now() so vitest fake timers drive them; instants (fetchedAt) use the Clock port.
  const started = Date.now();
  const finalise = (outcome: 'ok' | 'error' | 'unknown', httpStatus?: number): void =>
    reservation?.finalise({
      outcome,
      durationMs: Date.now() - started,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    });
  // why: setTimeout + AbortController rather than AbortSignal.timeout, whose Node-internal timer vitest cannot fake.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), limits.requestTimeoutSeconds * 1000);
  const signal = AbortSignal.any([r.signal, timeout.signal]);

  let res: Response;
  try {
    const init: RequestInit = {
      method: r.method,
      headers: r.headers,
      ...(r.body === undefined ? {} : { body: r.body }),
      redirect: 'error',
      signal,
    };
    // why: spec §5.3 rev 11 — the gated in-process seam (fixture.local only); every other host goes to globalThis.fetch.
    const inProcess = deps.inProcessHosts?.[r.url.hostname];
    res = await raceAbort(inProcess ? inProcess(new Request(r.url, init)) : fetch(r.url, init), signal);
    if (res.type === 'error') throw new TypeError('network error');
  } catch (err) {
    clearTimeout(timer);
    if (r.signal.aborted) {
      finalise('unknown');
      throw new AbortedError();
    }
    if (timeout.signal.aborted) {
      finalise('unknown');
      throw requestTimeout(w, limits.billable);
    }
    finalise('error');
    throw classifyThrown(err, w);
  }

  const status = res.status;
  // why (cost-001): once a 200 status line has arrived a billed vendor has charged the call, so a body failure is
  // finalised 'unknown' with the status (counted by the cap predicate) and not retried.
  const billed200 = limits.billable === 'http-200' && status === 200;
  let text: string | null;
  try {
    text = await readCapped(res, signal);
  } catch {
    if (r.signal.aborted) {
      finalise('unknown', status);
      throw new AbortedError();
    }
    if (timeout.signal.aborted) {
      finalise('unknown', status);
      throw requestTimeout(w, limits.billable);
    }
    finalise(billed200 ? 'unknown' : 'error', status);
    throw bodyReadFailed(w, status, billed200);
  } finally {
    clearTimeout(timer);
  }

  const ok = status >= 200 && status < 300;
  const fetchedAt = deps.clock.now();
  finalise(ok ? 'ok' : 'error', status);
  if (status >= 300 && status < 400) throw redirectRefused(w, status);
  if (text === null) throw bodyTooLarge(w, status);

  let body: unknown;
  let malformed = false;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = text;
    malformed = true;
  }

  const scrubbed = scrubSecrets(body, deps.secrets);
  if (!ok) {
    const facts: ResponseFacts = {
      status,
      body: scrubbed,
      headers: scrubbedHeaders(res.headers, deps),
      ...w,
    };
    const raw = limits.classifyError?.(facts) ?? classifyResponse(facts);
    throw finishError(raw, {
      facts,
      limits,
      now: deps.clock.now(),
      secrets: deps.secrets,
      secondsToHourRefresh: ctx.secondsToHourRefresh,
    });
  }
  if (malformed) throw malformedBody(w, status);
  return { status, body: scrubbed, fetchedAt };
}
