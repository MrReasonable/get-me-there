import type { ProviderErrorKind } from '../errors.js';
import type { IsoDateTime } from '../types/ids.js';
import type { ProviderId } from '../types/provenance.js';

/** Spec §5.3 cap scopes. */
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  /** A provider's own cap within one execution (camoufox pages, spec §2); labelled `provider-execution:<provider>`. */
  | { kind: 'provider-execution'; executionId: string; providerId: ProviderId }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };

/**
 * The wire label of a scope (`execution-calls`, `provider-month:searchapi`, `global-month`): the one formatter the
 * budget-fit scopes, the usage rows and the schedule refusal share (plan decision 54; WP7's budgetFit formats the same).
 */
export function budgetScopeLabel(s: BudgetScope): string {
  return 'providerId' in s ? `${s.kind}:${s.providerId}` : s.kind;
}

/**
 * Ruling 2 (decision 67): "window not used by this plan" and "no cap" are different facts. `windowUsed` is false only
 * for a provider window the provider's plan does not use (the month window of a lifetime trial, the lifetime window of
 * a monthly plan); its `cap` is then null and means nothing. With `windowUsed` true, a null `cap` means no cap is
 * configured for the scope. Execution and global scopes are always used.
 */
export interface Usage {
  calls: number;
  costMicroGbp: number;
  cap: number | null;
  windowUsed: boolean;
  windowStart: IsoDateTime | null;
  windowEnd: IsoDateTime | null;
  /**
   * Spec rev 55 §8.1 (ruling A32): on a `provider-execution` scope, the flight-list pages spent against the run's own
   * flight allowance (`ExecutionBudget.flightListPages`; `cap` 0 when the snapshot sets none). `calls` and `cap` above
   * count the grid or list pages only. Absent on every other scope.
   */
  flightLists?: { calls: number; cap: number };
}

/**
 * `pageClass` (spec §5.3 rev 32, decision 69): for a pages-only provider (camoufox), whether the attempt loaded a
 * Google page; a `no-page` row stays in the ledger but counts toward neither page cap. Absent for every other provider.
 */
export interface Reservation {
  id: string;
  finalise(r: {
    outcome: 'ok' | 'error' | 'unknown';
    httpStatus?: number;
    durationMs: number;
    pageClass?: 'page' | 'no-page';
    /** Spec §7 rev 34: the scroll clicks a camoufox grid page made, from its answer; absent when no answer came. */
    scrollCount?: number;
    /**
     * Spec rev 56 §5.1 (R-zero): a camoufox flights request's documents loaded, the answer's `pagesLoaded` (0 admitted);
     * absent keeps the plan on an unknown attempt, else 1 on a contacted page.
     */
    pageCount?: number;
  }): void;
  /**
   * Records the adapters' own class of a failed call (http-kit's `ProviderError.kind`) on the finalised row (WP18, V3):
   * the one classification, kept where the call is ledgered, so the Status report never re-derives it from a status code.
   */
  classify(kind: ProviderErrorKind): void;
}

/** What `reserve` is asked (spec §5.1, §5.3). */
export interface ReserveParams {
  providerId: ProviderId;
  executionId: string | null;
  tileIndex: number | null;
  costMicroGbp: number;
  httpAttempt: number;
  endpointPath: string;
  /**
   * Spec §2 rev 34: a camoufox grid page's planned scrolls; they must fit what the provider's run and month scroll
   * caps leave, and the pending row holds them until it finalises.
   */
  scrolls?: number;
  /**
   * Spec rev 56 §5.1: the planned page count (default 1; `FLIGHT_LIST_PAGES_PER_PAIR_MAX` for a flights request with a
   * return phase), checked against the page caps; a camoufox page scope's `calls` in `usage()` is the page sum.
   */
  pages?: number;
}

/**
 * Spec §5.1 / §5.3. `reserve` runs its cap predicates and the pending ledger insert in one
 * BEGIN IMMEDIATE transaction before every HTTP attempt. Per-execution caps come from the
 * execution's snapshot budget, never from config at reserve time.
 */
export interface BudgetGuard {
  reserve(p: ReserveParams): Reservation;
  recordCacheHit(p: {
    providerId: ProviderId;
    executionId: string | null;
    tileIndex: number | null;
    endpointPath: string;
  }): void;
  usage(scope: BudgetScope): Usage;
  /** Upstream attempts since `since`; http-kit seeds its hourly reservoir from it after a restart. */
  recentCalls(providerId: ProviderId, since: IsoDateTime): number;
  /**
   * Spec §2 rev 34 (fix round 1, CA 1): the scrolls a provider's run and month scroll caps leave (the lesser, never
   * below 0), or null when no scroll cap applies; a camoufox grid page asks for no more.
   */
  scrollsLeft(providerId: ProviderId, executionId: string | null): number | null;
  /**
   * W3 (cb-b1-004): the scroll clicks the ledger counts for a provider in its current month window, or null when no
   * monthly scroll cap applies to it; the providers view reports it, and `gmt browser counts` rewrites from it.
   */
  scrollsThisMonth(providerId: ProviderId): number | null;
}
