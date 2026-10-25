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
  SkipCode,
  StartRefusalReason,
} from '@gmt/core';
import type { WorkerFinding } from '@gmt/providers';

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

/** A catch-up in the last 7 days: the firing it stood for (null when the row names none), when it ran, how it stands. */
export interface CatchUpFacts {
  scheduledFor: IsoDateTime | null;
  ranAt: IsoDateTime;
  status: ExecutionStatus;
}

export interface ScheduleFacts {
  /** Enabled, undeleted definitions with a schedule. */
  scheduledDefinitions: number;
  jobCount: number;
  degraded: boolean;
  blockedSince: IsoDateTime | null;
  lastExecutionAt: IsoDateTime | null;
  nextRun: IsoDateTime | null;
  catchUp: CatchUpFacts | null;
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

export interface RunFacts {
  status: ExecutionStatus;
  at: IsoDateTime;
  isCatchUp: boolean;
  skipCode: SkipCode | null;
}

export interface DataFacts {
  definitionId: string;
  /** The definition's name: the card's label, never part of its summary. */
  name: string;
  /** A disabled definition is shown as off, so a parked search never nags the bar. */
  enabled: boolean;
  /** The newest parent row that is not pending or running, whatever its status (a skipped firing included), or null. */
  latest: RunFacts | null;
  /** The newest such row that actually ran (not a skipped firing): the coverage and ages below are its. */
  lastRun: RunFacts | null;
  coverage: { buckets: Buckets; total: number } | null;
  ages: AgeFacts | null;
  /** Skipped cells that a browser window or a catch-up left, with the words of their detail. */
  leftNotes: { text: string; cells: number }[];
  /** A run that is pending or running now. */
  runningSince: IsoDateTime | null;
  /** Scheduled, and the newest row of any kind is older than the schedule's previous firing. */
  behindSchedule: boolean;
  /** The browser provider is the only discovery provider that can run this definition on a schedule. */
  browserOnlyScheduled: boolean;
}

export interface ProviderFacts {
  id: ProviderId;
  configured: boolean;
  /** The newest completed call: when, and the adapters' own class of how it ended (`other` is any other failure). */
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
  /** What the worker will do with the next page request, judged by the one rule the preflight uses (V5). */
  finding: WorkerFinding | null;
  formVerified: boolean;
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
  /** The newest send of any kind since the app started (V7). */
  last: { at: IsoDateTime; kind: string; result: 'sent' | 'refused' | 'failed' } | null;
}

export interface PriceSourceFacts {
  /** The usable non-synthetic discovery providers that can price a scheduled search. */
  usable: ProviderId[];
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
