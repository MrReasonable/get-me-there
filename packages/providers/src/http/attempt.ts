import { AbortedError, type IsoDateTime, type Reservation } from '@gmt/core';
import {
  bodyReadFailed,
  bodyTooLarge,
  classifyResponse,
  classifyThrown,
  connectionRefused,
  finishError,
  malformedBody,
  redirectRefused,
  requestTimeout,
} from './classify.js';
import { scrubSecrets } from './scrub.js';
import {
  type HttpKitDeps,
  type HttpKitRequest,
  ledgeredId,
  type ProviderHttpLimits,
  type ResponseFacts,
} from './types.js';

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
  // why: 'fx' and 'camoufox-status' are not ProviderIds in the BudgetGuard port; neither is ever ledgered (spec §5.3, §5.6).
  const ledgered = ledgeredId(r.providerId);
  const reservation: Reservation | null =
    ledgered === null
      ? null
      : deps.budget.reserve({
          providerId: ledgered,
          executionId: r.executionId,
          tileIndex: r.tileIndex,
          costMicroGbp: limits.costPerCallMicroGbp,
          httpAttempt: ctx.attempt,
          endpointPath: r.endpointPath,
        });
  // why: durations use Date.now() so vitest fake timers drive them; instants (fetchedAt) use the Clock port.
  const started = Date.now();
  // why: spec §5.3 rev 32: a pages-only provider states, per attempt, whether a page was loaded (`page_class`).
  let classOverride: 'no-page' | undefined;
  let responseFacts: { status: number | null; headers: Headers | null } = { status: null, headers: null };
  const finalise = (outcome: 'ok' | 'error' | 'unknown', httpStatus?: number): void => {
    const pageClass =
      limits.pageClass === undefined ? undefined : (classOverride ?? limits.pageClass(responseFacts));
    reservation?.finalise({
      outcome,
      durationMs: Date.now() - started,
      ...(httpStatus === undefined ? {} : { httpStatus }),
      ...(pageClass === undefined ? {} : { pageClass }),
    });
  };
  // why: setTimeout + AbortController rather than AbortSignal.timeout, whose Node-internal timer vitest cannot fake.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), limits.requestTimeoutSeconds * 1000);
  const signal = AbortSignal.any([r.signal, timeout.signal]);
  // why: path, never URL; no headers, no body (spec §14).
  const logFailure = (stage: 'request' | 'body'): void =>
    deps.log.warn(
      {
        providerId: r.providerId,
        endpointPath: r.endpointPath,
        attempt: ctx.attempt,
        stage,
        failure: r.signal.aborted ? 'aborted' : timeout.signal.aborted ? 'timeout' : 'network',
      },
      'http attempt failed',
    );

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
    logFailure('request');
    if (r.signal.aborted) {
      finalise('unknown');
      throw new AbortedError();
    }
    if (timeout.signal.aborted) {
      finalise('unknown');
      throw requestTimeout(w, limits.billable, limits.retryTransport !== false);
    }
    const thrown = classifyThrown(err, w, {
      ...(limits.retryTransport === undefined ? {} : { retryTransport: limits.retryTransport }),
      ...(limits.connectRefusedKind === undefined ? {} : { connectRefusedKind: limits.connectRefusedKind }),
    });
    // why: a refused connection sent nothing, so it loaded nothing (decision 69: `no-page`).
    if (connectionRefused(err)) classOverride = 'no-page';
    finalise('error');
    throw thrown;
  }

  const status = res.status;
  responseFacts = { status, headers: res.headers };
  // why (cost-001): once a 200 status line has arrived a billed vendor has charged the call, so a body failure is
  // finalised 'unknown' with the status (counted by the cap predicate) and not retried.
  const billed200 = limits.billable === 'http-200' && status === 200;
  let text: string | null;
  try {
    text = await readCapped(res, signal);
  } catch {
    logFailure('body');
    if (r.signal.aborted) {
      finalise('unknown', status);
      throw new AbortedError();
    }
    if (timeout.signal.aborted) {
      finalise('unknown', status);
      throw requestTimeout(w, limits.billable, limits.retryTransport !== false);
    }
    finalise(billed200 ? 'unknown' : 'error', status);
    throw bodyReadFailed(w, status, billed200, limits.retryTransport !== false);
  } finally {
    clearTimeout(timer);
  }

  const ok = status >= 200 && status < 300;
  const fetchedAt = deps.clock.now();
  finalise(ok ? 'ok' : 'error', status);
  deps.log.debug(
    {
      providerId: r.providerId,
      endpointPath: r.endpointPath,
      attempt: ctx.attempt,
      httpStatus: status,
      durationMs: Date.now() - started,
    },
    'http attempt',
  );
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

  if (r.recordFixtures && deps.recorder !== undefined) {
    // why: before classification, so 429/quota/400 bodies are captured (spec §9 item 7); a refusal fails the request.
    await deps.recorder.record({
      providerId: r.providerId,
      endpointPath: r.endpointPath,
      request: r,
      status,
      body,
      fetchedAt,
      responseHeaders: res.headers,
    });
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
