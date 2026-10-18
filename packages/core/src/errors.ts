import type { IsoDateTime } from './types/ids.js';
import type { ProviderId } from './types/provenance.js';

/**
 * A relative path (`/a/b`) or a schemeless host (`api.example.com`, optionally with a path) followed by a query or
 * fragment; group 1 is the part kept. Prose such as `why?` has neither a leading slash nor a host, so it is left alone.
 */
const BARE_URL_QUERY =
  /(?<![\w/:])((?:\/|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?::\d+)?)[^\s?#)'"]*)[?#][^\s)'"]*/g;

/**
 * Strip query string and userinfo from every URL inside a message, and the query and fragment from relative and
 * schemeless URLs (prov-M7). Spec §5.3: no sink ever holds a full URL.
 */
export function stripUrlsInText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s)'"]+/gi, (raw) => {
      try {
        const u = new URL(raw);
        return `${u.protocol}//${u.host}${u.pathname}`;
      } catch {
        return '<url>';
      }
    })
    .replace(BARE_URL_QUERY, '$1');
}

export type ProviderErrorKind =
  | 'auth'
  | 'rate-limit'
  | 'quota'
  | 'upstream'
  | 'parse'
  | 'network'
  | 'limiter-timeout'
  // why: camoufox only (spec §5.1 rev 32): a page the worker stopped on, and a worker that refused the connection; never retried.
  | 'blocked'
  | 'provider-unavailable';

/** Spec §5.1. Thrown by http-kit (classified) and adapters (parse); never retried at adapter level. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly reason: string | undefined;
  readonly retryable: boolean;
  readonly httpStatus: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly providerId: ProviderId | 'fx' | undefined;
  /** A `blocked` error's cool-down end, as the worker stated it (fix round 1, arch I1); keys the once-per-cool-down notice. */
  readonly cooldownUntil: IsoDateTime | undefined;
  constructor(p: {
    kind: ProviderErrorKind;
    retryable: boolean;
    message: string;
    reason?: string;
    httpStatus?: number;
    retryAfterSeconds?: number;
    providerId?: ProviderId | 'fx';
    cooldownUntil?: IsoDateTime;
  }) {
    super(stripUrlsInText(p.message));
    this.name = 'ProviderError';
    this.kind = p.kind;
    this.reason = p.reason;
    this.retryable = p.retryable;
    this.httpStatus = p.httpStatus;
    this.retryAfterSeconds = p.retryAfterSeconds;
    this.providerId = p.providerId;
    this.cooldownUntil = p.cooldownUntil;
  }
}

/** The once-per-cool-down notice key (cost-015): one spelling for the engine's block path and its preflight. */
export function cooldownNoticeKey(providerId: ProviderId, until: IsoDateTime): string {
  return `${providerId}-cooldown:${until}`;
}

export type BudgetScopeKind =
  | 'execution-calls'
  | 'execution-free-calls'
  | 'execution-cost'
  // why: a provider's own per-execution cap (camoufox pages), read from the execution's snapshot (decision 69).
  | 'provider-execution'
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
  /** What the cap counts when it is not calls: `scrolls` for the camoufox grid's scroll caps (spec §2 rev 34). */
  readonly unit: 'scrolls' | undefined;
  constructor(p: {
    scope: BudgetScopeKind;
    cap: number;
    current: number;
    requested: number;
    providerId?: ProviderId;
    unit?: 'scrolls';
  }) {
    super(
      `budget exceeded: ${p.scope}${p.unit === undefined ? '' : ` ${p.unit}`} cap ${p.cap}, current ${p.current}, requested ${p.requested}${
        p.providerId ? ` (${p.providerId})` : ''
      }`,
    );
    this.unit = p.unit;
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
    // why: `detail` is an enumerable own property that error serialisers copy into logs, so it holds the stripped text.
    const safe = detail === undefined ? undefined : stripUrlsInText(detail);
    super(safe ? `${reason}: ${safe}` : reason);
    this.name = 'NormalisationError';
    this.reason = reason;
    this.detail = safe;
  }
}
