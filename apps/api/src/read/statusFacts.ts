/**
 * The facts the Status report is built from (spec §10 `GET /status`, brief WP18 §6): plain data gathered by
 * `statusSources.ts` and turned into checks by `status.ts`'s pure builders. Nothing here carries a key, a password, a
 * database path or any text a vendor, a worker, a file or an SMTP server wrote: enums, counts, instants and names the
 * app itself holds.
 */
import type {
  Buckets,
  EffectiveAge,
  ExecutionStatus,
  IsoDateTime,
  ProviderId,
  SharedWorkerSetting,
  SkipCode,
  StartRefusalReason,
} from '@gmt/core';

export type StatusMode = 'native' | 'container' | 'dev';

export interface AppFacts {
  version: string;
  startedAt: IsoDateTime;
  loopback: boolean;
  authOn: boolean;
}

export interface DatabaseFacts {
  answers: boolean;
  sizeBytes: number;
  pendingMigrations: number;
}

export interface ScheduleFacts {
  /** Enabled, undeleted definitions with a schedule. */
  scheduledDefinitions: number;
  jobCount: number;
  degraded: boolean;
  blockedSince: IsoDateTime | null;
  lastExecutionAt: IsoDateTime | null;
  nextRun: IsoDateTime | null;
  /** A catch-up in the last 7 days: the firing it stood for and when it ran. */
  catchUp: { scheduledFor: IsoDateTime; ranAt: IsoDateTime } | null;
  /** The newest `skipped_missed` row in the last 7 days whose stored code is the camoufox-only one. */
  skippedMissed: { scheduledFor: IsoDateTime; code: SkipCode } | null;
  /** Two definitions using the browser provider that share a firing time. */
  clashes: { a: string; b: string; at: IsoDateTime }[];
}

/** What a finished run's priced, non-synthetic discovery prices say about age (core's effective age, spec §3). */
export interface AgeFacts {
  newest: EffectiveAge;
  oldest: EffectiveAge;
  /** Any priced observation older than its basis's stale threshold. */
  stale: boolean;
}

export interface DataFacts {
  definitionId: string;
  name: string;
  /** The latest parent run of any status once finished (not pending or running), or null. */
  latest: {
    status: ExecutionStatus;
    at: IsoDateTime;
    isCatchUp: boolean;
    skipCode: SkipCode | null;
  } | null;
  /** The latest row's discovery coverage per cell after the roll-up; null for a row without cells. */
  coverage: { buckets: Buckets; total: number } | null;
  ages: AgeFacts | null;
  /** Skipped cells that a browser window or a catch-up left, with the words of their detail. */
  leftNotes: { text: string; cells: number }[];
  /** A run that is pending or running now. */
  runningSince: IsoDateTime | null;
  /** Scheduled, and the latest row of any kind is older than the schedule's previous firing. */
  behindSchedule: boolean;
  /** The browser provider is the only discovery provider that can run this definition on a schedule. */
  browserOnlyScheduled: boolean;
}

export interface ProviderFacts {
  id: ProviderId;
  displayName: string;
  configured: boolean;
  /** The newest completed call: when, and its class (`other` is any failure that is neither auth nor quota). */
  lastCall: { at: IsoDateTime; result: 'ok' | 'auth' | 'quota' | 'other' } | null;
  usage: { used: number; cap: number | null; window: 'month' | 'lifetime' } | null;
  /** The trial's remaining lifetime credits, or null off the trial. */
  trialLeft: number | null;
}

export type RefusalRead =
  | { kind: 'none' }
  | { kind: 'unreadable' }
  | { kind: 'refusal'; reason: StartRefusalReason; at: IsoDateTime };

/** The worker's status named field by named field (nothing else of its answer is kept). */
export interface WorkerStatusFacts {
  coolingDownUntil: IsoDateTime | null;
  cooldownCause: string | null;
  formVerified: boolean;
  diffs: readonly SharedWorkerSetting[];
  appInstances: number | null;
  monthly: { pages: number; scrolls: number; readable: boolean } | null;
  consent: {
    kind: 'socs' | 'not-shown' | 'voided';
    expiresAt: IsoDateTime | null;
    boundedBy: 'cookie' | 'capture' | 'check' | null;
  } | null;
  socsCapturedAt: IsoDateTime | null;
}

export type WorkerRead =
  | { kind: 'disabled' }
  | { kind: 'ok'; status: WorkerStatusFacts }
  | { kind: 'keys-differ' }
  | { kind: 'unreadable' }
  | { kind: 'unreachable' };

export interface WorkerFacts {
  read: WorkerRead;
  refusal: RefusalRead;
  /** The app's CAMOUFOX_BROWSER_WINDOW. */
  browserWindow: 'scheduled' | 'any';
  caps: { pages: number; scrolls: number };
}

export interface EmailFacts {
  configured: boolean;
  last: { at: IsoDateTime; result: 'sent' | 'refused' | 'failed' } | null;
}

export interface PriceSourceFacts {
  /** The usable non-synthetic discovery providers that can price a scheduled search, by display name. */
  usable: string[];
}

export interface StatusFacts {
  now: IsoDateTime;
  tz: string;
  mode: StatusMode;
  version: string;
  app: AppFacts;
  database: DatabaseFacts;
  /** The newest daily backup's instant; null when there is none (and always null in container mode, where it is unseen). */
  backupNewestAt: IsoDateTime | null;
  schedule: ScheduleFacts;
  data: DataFacts[];
  priceSources: PriceSourceFacts;
  providers: ProviderFacts[];
  /** Whether a synthetic provider is registered (the synthetic gate is open). */
  synthetic: boolean;
  worker: WorkerFacts;
  email: EmailFacts;
}
