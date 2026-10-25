/**
 * The worker answer map (spec §5.2 rev 32; brief §6, Task 14.8): every non-2xx answer becomes one ProviderError with a
 * message that words the page kind as the operator reads it in `last_error` (brief Task 14.10's copy) and a bracketed
 * code. 423 `blocked` and `cooling-down` → `blocked`; 409 → `parse`; 504 `not-ready` → `parse` (`page-not-ready`);
 * 502 → `upstream`; 429 `spacing` → `rate-limit` (http-kit waits its Retry-After); 401 → `auth`; 400 → `parse`.
 * None is retried but the spacing (http-kit's NEVER_RETRIED and `retryTransport: false` hold the rest).
 */
import {
  type BlockedPage,
  type IsoDateTime,
  ProviderError,
  type ProviderErrorKind,
  workerAnswerSchema,
} from '@gmt/core';
import type { ResponseFacts } from '../http/types.js';

/** brief Task 14.10: each page kind worded distinctly; only a real CAPTCHA is called a challenge page (prov-008). */
export const BLOCKED_WORDS: Readonly<Record<BlockedPage, string>> = {
  captcha: 'Google showed a challenge page (CAPTCHA)',
  'unusual-traffic': 'Google reported unusual traffic',
  'consent-unhandled': 'Google showed its cookie page (the rejection did not hold)',
  'sign-in': 'Google asked to sign in',
  'signed-in': 'the browser profile was signed in',
  'off-allowlist': 'Google sent the browser elsewhere',
  unrecognised: "Google's page was not one this app reads (it may have changed)",
};
export const coolingDownWords = (until: string): string =>
  `cooling down until ${until}; Google was not contacted`;

function error(
  f: ResponseFacts,
  kind: ProviderErrorKind,
  detail: string,
  code: string,
  retryable = false,
  cooldownUntil?: IsoDateTime,
): ProviderError {
  return new ProviderError({
    kind,
    retryable,
    httpStatus: f.status,
    providerId: 'camoufox',
    message: `camoufox ${f.endpointPath}: ${detail} [${code}]`,
    // why: fix round 1 (arch I1): the code as data, so a reader never parses the message
    reason: code,
    ...(cooldownUntil === undefined ? {} : { cooldownUntil }),
  });
}

export function classifyWorkerAnswer(f: ResponseFacts): ProviderError {
  if (f.status === 401) return error(f, 'auth', 'the worker refused CAMOUFOX_WORKER_KEY', 'worker-key');
  if (f.status === 400) return error(f, 'parse', 'the worker refused the page request', 'bad-request');
  const a = workerAnswerSchema.safeParse(f.body);
  if (!a.success)
    return error(f, 'parse', `HTTP ${f.status} with an answer this build cannot read`, 'unknown-answer');
  const answer = a.data;
  switch (answer.kind) {
    case 'blocked':
      return error(
        f,
        'blocked',
        `${BLOCKED_WORDS[answer.page]}; cooling down until ${answer.cooldownUntil}`,
        `blocked:${answer.page}`,
        false,
        answer.cooldownUntil,
      );
    case 'cooling-down':
      return error(
        f,
        'blocked',
        `${coolingDownWords(answer.cooldownUntil)} (${answer.cause})`,
        `cooling-down:${answer.cause}`,
        false,
        answer.cooldownUntil,
      );
    case 'spacing':
      return error(f, 'rate-limit', 'the worker asked to wait for its spacing', 'spacing', true);
    case 'mode-unavailable':
      return error(
        f,
        'parse',
        'the worker does not serve grid pages (CAMOUFOX_MODE, GRID_VERIFIED)',
        'mode-unavailable',
      );
    case 'not-ready':
      return error(
        f,
        'parse',
        `the page did not settle within ${Math.round(answer.elapsedMs / 1000)} s`,
        'page-not-ready',
      );
    case 'browser-error':
      return error(
        f,
        'upstream',
        `the worker's browser failed at ${answer.stage}`,
        `browser-error:${answer.stage}`,
      );
    case 'monthly-cap':
      // why: decision 82: the worker's own monthly cap, across every caller; the adapter turns it into BudgetExceeded
      return error(
        f,
        'quota',
        `the worker's monthly page cap (${answer.cap}) is reached until ${answer.windowEnd}; Google was not contacted`,
        'monthly-cap',
      );
    case 'cells':
    case 'grid':
      return error(f, 'parse', `HTTP ${f.status} with a ${answer.kind} answer`, 'unexpected-status');
  }
}
