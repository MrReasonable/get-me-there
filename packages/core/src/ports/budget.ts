import type { IsoDateTime } from '../types/ids.js';
import type { ProviderId } from '../types/provenance.js';

/** Spec §5.3 cap scopes. */
export type BudgetScope =
  | { kind: 'execution-calls' | 'execution-free-calls' | 'execution-cost'; executionId: string }
  | { kind: 'provider-month' | 'provider-lifetime'; providerId: ProviderId }
  | { kind: 'global-month' };

/** `cap` is null for a window the plan does not use and for a scope with no cap configured. */
export interface Usage {
  calls: number;
  costMicroGbp: number;
  cap: number | null;
  windowStart: IsoDateTime | null;
  windowEnd: IsoDateTime | null;
}

export interface Reservation {
  id: string;
  finalise(r: { outcome: 'ok' | 'error' | 'unknown'; httpStatus?: number; durationMs: number }): void;
}

/**
 * Spec §5.1 / §5.3. `reserve` runs its cap predicates and the pending ledger insert in one
 * BEGIN IMMEDIATE transaction before every HTTP attempt. Per-execution caps come from the
 * execution's snapshot budget, never from config at reserve time.
 */
export interface BudgetGuard {
  reserve(p: {
    providerId: ProviderId;
    executionId: string | null;
    tileIndex: number | null;
    costMicroGbp: number;
    httpAttempt: number;
    endpointPath: string;
  }): Reservation;
  recordCacheHit(p: { providerId: ProviderId; executionId: string | null; tileIndex: number | null; endpointPath: string }): void;
  usage(scope: BudgetScope): Usage;
  /** Upstream attempts since `since`; http-kit seeds its hourly reservoir from it after a restart. */
  recentCalls(providerId: ProviderId, since: IsoDateTime): number;
}
