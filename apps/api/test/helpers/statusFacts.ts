// A fully healthy StatusFacts and the variations the Status tests apply (brief WP18 Task 18.2). The worked example only.
import { asIsoDateTime, type EffectiveAge, type IsoDateTime } from '@gmt/core';
import type {
  DataFacts,
  ProviderFacts,
  StatusFacts,
  WorkerFacts,
  WorkerStatusFacts,
} from '../../src/read/statusFacts.js';

export const NOW = asIsoDateTime('2026-10-14T09:00:00.000Z');
export const ago = (ms: number): IsoDateTime => asIsoDateTime(new Date(Date.parse(NOW) - ms).toISOString());
export const inFuture = (ms: number): IsoDateTime => ago(-ms);
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const observed = (hours: number): EffectiveAge => ({
  kind: 'observed',
  fetchedHours: hours,
  observedHours: hours,
});

export function healthyData(over: Partial<DataFacts> = {}): DataFacts {
  return {
    definitionId: 'def-1',
    name: 'London to New York',
    latest: { status: 'completed', at: ago(2 * HOUR), isCatchUp: false, skipCode: null },
    coverage: {
      buckets: { priced: 90, empty: 5, no_data: 3, error: 0, skipped: 0, not_run: 2, reused: 0 },
      total: 100,
    },
    ages: { newest: observed(1), oldest: observed(30), stale: false },
    leftNotes: [],
    runningSince: null,
    behindSchedule: false,
    browserOnlyScheduled: false,
    ...over,
  };
}

export function okWorkerStatus(over: Partial<WorkerStatusFacts> = {}): WorkerStatusFacts {
  return {
    coolingDownUntil: null,
    cooldownCause: null,
    formVerified: true,
    diffs: [],
    appInstances: 1,
    monthly: { pages: 10, scrolls: 20, readable: true },
    consent: { kind: 'socs', expiresAt: inFuture(200 * DAY), boundedBy: 'capture' },
    socsCapturedAt: ago(10 * DAY),
    ...over,
  };
}

export function healthyWorker(over: Partial<WorkerFacts> = {}): WorkerFacts {
  return {
    read: { kind: 'ok', status: okWorkerStatus() },
    refusal: { kind: 'none' },
    browserWindow: 'scheduled',
    caps: { pages: 1500, scrolls: 6000 },
    ...over,
  };
}

export const travelpayouts = (over: Partial<ProviderFacts> = {}): ProviderFacts => ({
  id: 'travelpayouts',
  displayName: 'Travelpayouts',
  configured: true,
  lastCall: { at: ago(2 * HOUR), result: 'ok' },
  usage: { used: 120, cap: 50_000, window: 'month' },
  trialLeft: null,
  ...over,
});
export const searchApi = (over: Partial<ProviderFacts> = {}): ProviderFacts => ({
  id: 'searchapi',
  displayName: 'SearchApi',
  configured: false,
  lastCall: null,
  usage: null,
  trialLeft: null,
  ...over,
});

export function healthyFacts(over: Partial<StatusFacts> = {}): StatusFacts {
  return {
    now: NOW,
    tz: 'Europe/London',
    mode: 'native',
    version: 'abc1234',
    app: { version: 'abc1234', startedAt: ago(3 * DAY), loopback: true, authOn: true },
    database: { answers: true, sizeBytes: 5_242_880, pendingMigrations: 0 },
    backupNewestAt: ago(5 * HOUR),
    schedule: {
      scheduledDefinitions: 1,
      jobCount: 1,
      degraded: false,
      blockedSince: null,
      lastExecutionAt: ago(2 * HOUR),
      nextRun: inFuture(20 * HOUR),
      catchUp: null,
      skippedMissed: null,
      clashes: [],
    },
    data: [healthyData()],
    priceSources: { usable: ['Travelpayouts'] },
    providers: [travelpayouts(), searchApi()],
    synthetic: false,
    worker: healthyWorker(),
    email: { configured: true, last: null },
    ...over,
  };
}
