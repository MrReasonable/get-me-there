import type { ProviderId } from './types/provenance.js';

/** Strip query string and userinfo from every URL inside a message. Spec §5.3: no sink ever holds a full URL. */
export function stripUrlsInText(text: string): string {
  return text.replace(/https?:\/\/[^\s)'"]+/g, (raw) => {
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return '<url>';
    }
  });
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'quota'
  | 'upstream'
  | 'parse'
  | 'network'
  | 'limiter-timeout';

/** Spec §5.1. Thrown by http-kit (classified) and adapters (parse); never retried at adapter level. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly reason: string | undefined;
  readonly retryable: boolean;
  readonly httpStatus: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly providerId: ProviderId | 'fx' | undefined;
  constructor(p: {
    kind: ProviderErrorKind;
    retryable: boolean;
    message: string;
    reason?: string;
    httpStatus?: number;
    retryAfterSeconds?: number;
    providerId?: ProviderId | 'fx';
  }) {
    super(stripUrlsInText(p.message));
    this.name = 'ProviderError';
    this.kind = p.kind;
    this.reason = p.reason;
    this.retryable = p.retryable;
    this.httpStatus = p.httpStatus;
    this.retryAfterSeconds = p.retryAfterSeconds;
    this.providerId = p.providerId;
  }
}

export type BudgetScopeKind =
  | 'execution-calls'
  | 'execution-free-calls'
  | 'execution-cost'
  | 'provider-month'
  | 'provider-lifetime'
  | 'global-month';

/** Spec §5.1. Raised by BudgetGuard.reserve before any fetch; never recorded as a cell `error`. */
export class BudgetExceeded extends Error {
  readonly scope: BudgetScopeKind;
  readonly cap: number;
  readonly current: number;
  readonly requested: number;
  readonly providerId: ProviderId | undefined;
  constructor(p: {
    scope: BudgetScopeKind;
    cap: number;
    current: number;
    requested: number;
    providerId?: ProviderId;
  }) {
    super(
      `budget exceeded: ${p.scope} cap ${p.cap}, current ${p.current}, requested ${p.requested}${
        p.providerId ? ` (${p.providerId})` : ''
      }`,
    );
    this.name = 'BudgetExceeded';
    this.scope = p.scope;
    this.cap = p.cap;
    this.current = p.current;
    this.requested = p.requested;
    this.providerId = p.providerId;
  }
}

/** Spec §5.1. Cancel or SIGTERM; the cell returns to `not_run`. */
export class AbortedError extends Error {
  constructor(message = 'aborted') {
    super(message);
    this.name = 'AbortedError';
  }
}

export type NormalisationReason =
  | 'fx-unavailable'
  | 'currency-unsupported'
  | 'unknown-airport-tz'
  | 'no-return-legs'
  | 'unmappable-carrier'
  | 'bad-local-time'
  | 'cell-mismatch';

/** Spec §5.6. An offer that cannot be normalised is dropped and counted; never guessed. */
export class NormalisationError extends Error {
  readonly reason: NormalisationReason;
  readonly detail: string | undefined;
  constructor(reason: NormalisationReason, detail?: string) {
    super(detail ? `${reason}: ${stripUrlsInText(detail)}` : reason);
    this.name = 'NormalisationError';
    this.reason = reason;
    this.detail = detail;
  }
}
