/**
 * Gathers the Status report's facts (spec §10 `GET /status`, brief WP18 §6) from the ports, the engine and, in native
 * mode, the worker's refusal file. Reads only: it never spends, never waits on a vendor beyond the worker's own 2 s
 * status read on this machine's loopback, and never loads a page. What it keeps is named fields, enums, counts and
 * instants; no raw text from any source reaches the facts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CellOutcome,
  cellKeyString,
  compareAges,
  coverageBuckets,
  type Execution,
  effectiveAge,
  type IsoDateTime,
  isLoopbackHost,
  isStale,
  type ProviderId,
  type SearchDefinition,
  START_REFUSAL_FILE,
  scheduledOnlyText,
  sharedInt,
  startRefusalSchema,
  withAssumedBound,
  workerDataDir,
} from '@gmt/core';
import { pendingMigrations } from '@gmt/db';
import { parseCron } from '@gmt/engine';
import { readWorkerStatus, workerFinding } from '@gmt/providers';
import { backupsDirFor } from '../bootstrap/preflight.js';
import { dbOk, dbSizeBytes } from '../routes/system.js';
import type { RouteContext } from '../routes/types.js';
import type { Ports } from '../wiring.js';
import { calendarStaleAfterHours, type RowContext } from './rows.js';
import { type ConsentCause, consentOutcome } from './status.js';
import type {
  AgeFacts,
  DataFacts,
  EmailFacts,
  PriceSourceFacts,
  ProviderFacts,
  RefusalRead,
  ScheduleFacts,
  StatusFacts,
  StatusMode,
  WorkerFacts,
  WorkerRead,
} from './statusFacts.js';
import { browserUsable, callResult, isBehindSchedule, newestBackupAt, pickRuns } from './statusPure.js';
import { planOf, providerBudget, providerScopes, usageOf } from './usage.js';

/** The worker's status read is bounded here; a slower answer is "not answering", not a hang. */
export const WORKER_STATUS_TIMEOUT_MS = 2000;
const DAY_MS = 86_400_000;
const CATCH_UP_NOTE_DAYS = 7;
/** A firing is on time within this grace (the catch-up's own 2 minutes, spec §8.2). */
const SCHEDULE_GRACE_MS = 2 * 60_000;
/** V5 (sec-b1-002): concurrent reports share one worker read in flight, and its result is reused this long. */
export const WORKER_READ_REUSE_MS = 10_000;

/** What the bootstrap passes in: the home directory (the one place the environment is read), the build, the start. */
export interface StatusEnv {
  /** `HOME` from the api bootstrap; null when it is unset (no refusal file is read). */
  home: string | null;
  version: string;
  startedAt: IsoDateTime;
  /** The migrations directory the database was migrated from. */
  migrationsDir: string;
  /** The email notifier's newest send of any kind (V7); null when email is not configured. */
  emailLast: () => EmailFacts['last'];
}

export function modeOf(ports: Pick<Ports, 'config'>): StatusMode {
  const c = ports.config;
  return c.inContainer ? 'container' : c.nodeEnv === 'development' ? 'dev' : 'native';
}

function newestBackup(databasePath: string): IsoDateTime | null {
  if (databasePath === ':memory:') return null;
  try {
    return newestBackupAt(readdirSync(join(backupsDirFor(databasePath), 'daily')));
  } catch {
    return null;
  }
}

/** The definitions an enabled schedule runs. */
const scheduledDefinitions = (defs: readonly SearchDefinition[]) =>
  defs.filter((d) => d.enabled && d.deletedAt === null && d.scheduleCron !== null);

const registered = (ports: Ports, id: ProviderId) => ports.providers.some((p) => p.id === id);

/** The discovery providers a scheduled run of the definition can use: registered, and not left out of schedules. */
function scheduledDiscovery(ports: Ports, d: SearchDefinition): ProviderId[] {
  return d.providers.discovery.filter(
    (id) => registered(ports, id) && !providerBudget(ports.config, id).excludedFromSchedule,
  );
}

function executionsOf(ports: Ports, d: SearchDefinition): Execution[] {
  return ports.repos.executions.listForDefinition(d.id, { limit: 50, includeChildren: false });
}

function scheduleFacts(
  ctx: RouteContext,
  defs: readonly SearchDefinition[],
  now: IsoDateTime,
): ScheduleFacts {
  const { ports, engine } = ctx;
  const scheduled = scheduledDefinitions(defs);
  const s = engine.status();
  const since = Date.parse(now) - CATCH_UP_NOTE_DAYS * DAY_MS;
  const recent = scheduled
    .flatMap((d) => executionsOf(ports, d))
    .filter((e) => Date.parse(e.createdAt) >= since)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const catchUp = recent.find((e) => e.isCatchUp && e.status !== 'skipped_missed');
  const skipped = recent.find(
    (e) => e.status === 'skipped_missed' && e.skipCode === 'browser-only-definition',
  );
  const jobs = engine.scheduler.jobs();
  const users = scheduled.filter(
    (d) =>
      registered(ports, 'camoufox') &&
      [...d.providers.discovery, ...d.providers.verification].includes('camoufox'),
  );
  const nextOf = (id: string) =>
    jobs.find((j) => j.kind === 'definition' && j.definitionId === id)?.nextRun ?? null;
  const clashes: ScheduleFacts['clashes'] = [];
  for (const [i, a] of users.entries())
    for (const b of users.slice(i + 1)) {
      const at = nextOf(a.id);
      if (at !== null && at === nextOf(b.id)) clashes.push({ a: a.name, b: b.name, at });
    }
  return {
    scheduledDefinitions: scheduled.length,
    jobCount: jobs.filter((j) => j.kind === 'definition').length,
    degraded: s.degraded,
    blockedSince: engine.scheduler.blockedSince(),
    lastExecutionAt: s.lastExecutionAt,
    nextRun: s.nextRun,
    catchUp:
      catchUp === undefined
        ? null
        : {
            scheduledFor: catchUp.scheduledFor,
            ranAt: catchUp.startedAt ?? catchUp.createdAt,
            status: catchUp.status,
          },
    skippedMissed:
      skipped === undefined || skipped.skipCode === null
        ? null
        : { scheduledFor: skipped.scheduledFor ?? skipped.createdAt, code: skipped.skipCode },
    clashes,
  };
}

/** The six discovery buckets over a finished run's cells after the §6.6 roll-up; null when the run holds no cells. */
function coverageOf(ports: Ports, executionId: string): DataFacts['coverage'] {
  const rollUps = ports.repos.cells.rollUps(executionId);
  if (rollUps.size === 0) return null;
  const reused = new Set(
    ports.repos.cells
      .outcomes(executionId, { stage: 'discovery' })
      .filter((o) => o.reusedFromExecutionId !== null)
      .map(cellKeyString),
  ).size;
  return coverageBuckets(
    [...rollUps.values()].map((r) => r.discovery.status),
    reused,
  );
}

function agesOf(
  ctx: RouteContext,
  d: SearchDefinition,
  executionId: string,
  now: IsoDateTime,
): AgeFacts | null {
  const { ports } = ctx;
  const rc: RowContext = { def: d, now, config: ports.config, providers: ports.providers };
  const rows = ports.repos.calendarPrices
    .heldBy(executionId)
    .filter((r) => r.provenance.sourceKind !== 'synthetic' && r.provenance.providerId !== 'fixture');
  if (rows.length === 0) return null;
  const aged = rows.map((r) => {
    const info = ports.providers.find((p) => p.id === r.provenance.providerId)?.discovery?.info;
    const p = withAssumedBound(r.provenance, info);
    return {
      age: effectiveAge(p, now),
      stale: isStale(p, now, calendarStaleAfterHours(rc, p.providerId)),
    };
  });
  const sorted = aged.map((a) => a.age).sort(compareAges);
  const [newest] = sorted;
  const oldest = sorted[sorted.length - 1];
  if (newest === undefined || oldest === undefined) return null;
  return { newest, oldest, stale: aged.some((a) => a.stale) };
}

function leftNotes(ctx: RouteContext, d: SearchDefinition, executionId: string): DataFacts['leftNotes'] {
  const leftFor = ctx.engine.browserLeftFor(d);
  const cells = new Map<CellOutcome['skipDetail'] & string, Set<string>>();
  for (const o of ctx.ports.repos.cells.outcomes(executionId, { stage: 'discovery' })) {
    if (o.status !== 'skipped' || o.skipDetail === null) continue;
    const set = cells.get(o.skipDetail) ?? new Set<string>();
    set.add(cellKeyString(o));
    cells.set(o.skipDetail, set);
  }
  return [...cells.entries()].map(([detail, set]) => ({
    text: scheduledOnlyText(detail, leftFor),
    cells: set.size,
  }));
}

const runFacts = (e: Execution): NonNullable<DataFacts['latest']> => ({
  status: e.status,
  at: e.finishedAt ?? e.startedAt ?? e.createdAt,
  isCatchUp: e.isCatchUp,
  skipCode: e.skipCode,
});

function dataFacts(ctx: RouteContext, d: SearchDefinition, now: IsoDateTime): DataFacts {
  const { ports } = ctx;
  const runs = executionsOf(ports, d);
  const { active, latest, lastRun } = pickRuns(runs);
  const cron = d.enabled ? d.scheduleCron : null;
  let previousFiringMs: number | null = null;
  if (cron !== null && active === null) {
    const parsed = parseCron(cron, d.scheduleTz);
    previousFiringMs = parsed.ok ? (parsed.previous(new Date(now))?.getTime() ?? null) : null;
  }
  const discovery = scheduledDiscovery(ports, d);
  return {
    definitionId: d.id,
    name: d.name,
    enabled: d.enabled,
    latest: latest === null ? null : runFacts(latest),
    lastRun: lastRun === null ? null : runFacts(lastRun),
    coverage: lastRun === null ? null : coverageOf(ports, lastRun.id),
    ages: lastRun === null ? null : agesOf(ctx, d, lastRun.id, now),
    leftNotes: lastRun === null ? [] : leftNotes(ctx, d, lastRun.id),
    runningSince: active === null ? null : (active.startedAt ?? active.createdAt),
    // why: no row at all is the "no prices yet" case; a row older than the previous firing means that firing left nothing
    behindSchedule: isBehindSchedule({
      newestCreatedAt: runs[0]?.createdAt ?? null,
      previousFiringMs,
      graceMs: SCHEDULE_GRACE_MS,
    }),
    browserOnlyScheduled: discovery.length === 1 && discovery[0] === 'camoufox',
  };
}

function providerFacts(ports: Ports, id: 'travelpayouts' | 'searchapi'): ProviderFacts {
  const { config } = ports;
  const configured =
    id === 'travelpayouts' ? config.providers.travelpayouts !== null : config.providers.searchapi !== null;
  if (!configured) return { id, configured, lastCall: null, usage: null, trialLeft: null };
  const call = ports.repos.ledger.lastCompleted(id);
  const [scope] = providerScopes(config, id);
  const u = scope === undefined ? null : usageOf(ports, scope);
  const window = providerBudget(config, id).window;
  return {
    id,
    configured,
    lastCall: call === null ? null : { at: call.at, result: callResult(call) },
    usage: u === null ? null : { used: u.calls, cap: u.cap, window },
    trialLeft: planOf(config, id) === 'trial' && u?.cap != null ? Math.max(0, u.cap - u.calls) : null,
  };
}

function readRefusal(home: string | null): RefusalRead {
  if (home === null) return { kind: 'none' };
  let text: string;
  try {
    text = readFileSync(join(workerDataDir(home), START_REFUSAL_FILE), 'utf8');
  } catch (e) {
    return e instanceof Error && 'code' in e && e.code === 'ENOENT'
      ? { kind: 'none' }
      : { kind: 'unreadable' };
  }
  try {
    // why: the file is refused unless it is exactly { reason, at } with a known reason; no text of it is kept
    const r = startRefusalSchema.safeParse(JSON.parse(text));
    return r.success ? { kind: 'refusal', reason: r.data.reason, at: r.data.at } : { kind: 'unreadable' };
  } catch {
    return { kind: 'unreadable' };
  }
}

async function readWorkerOnce(ports: Ports): Promise<WorkerRead> {
  const cf = ports.config.providers.camoufox;
  if (cf === null) return { kind: 'disabled' };
  const abort = new AbortController();
  // why: a timer the tests can fake, unlike AbortSignal.timeout; cleared in finally so nothing keeps the process alive
  const timer = setTimeout(() => abort.abort(), WORKER_STATUS_TIMEOUT_MS);
  try {
    const read = await readWorkerStatus({
      http: ports.http,
      key: cf.key,
      url: cf.workerUrl,
      signal: abort.signal,
      appInstance: ports.repos.meta.appInstanceId(),
    });
    if (read.kind === 'unreachable') return { kind: 'unreachable' };
    if (read.kind === 'unreadable') return { kind: 'unreadable' };
    if (read.kind === 'refused')
      return read.errorKind === 'auth' ? { kind: 'keys-differ' } : { kind: 'unreachable' };
    const st = read.status;
    return {
      kind: 'ok',
      status: {
        // why: V5 — the one judgement the engine's preflight makes, so the card says what the worker will do
        finding: workerFinding(st, {
          sharedSettings: cf.sharedSettings,
          grid:
            cf.mode === 'grid'
              ? {
                  scrollCap: cf.gridScrollCap,
                  spacingSeconds: cf.gridScrollSpacingSeconds,
                  pageTimeoutSeconds: cf.pageTimeoutSeconds,
                }
              : undefined,
        }),
        formVerified: st.flags.FORM_VERIFIED === true,
        appInstances: st.appInstances?.count ?? null,
        monthly:
          st.monthly === undefined
            ? null
            : { pages: st.monthly.pages, scrolls: st.monthly.scrolls, readable: st.monthly.readable },
        consent:
          st.consent === undefined
            ? null
            : { kind: st.consent.kind, expiresAt: st.consent.expiresAt, boundedBy: st.consent.boundedBy },
        socsCapturedAt: st.socsCapturedAt,
      },
    };
  } catch {
    // why: our own 2 s abort (or any failure to read) is "not answering"; the cause is never shown
    return { kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

const workerReads = new WeakMap<Ports, { at: number; read: Promise<WorkerRead> }>();

/** One worker read in flight at a time, reused for WORKER_READ_REUSE_MS (the app clock), however many reports ask. */
function readWorker(ports: Ports): Promise<WorkerRead> {
  const now = Date.parse(ports.clock.now());
  const cached = workerReads.get(ports);
  if (cached !== undefined && now - cached.at < WORKER_READ_REUSE_MS) return cached.read;
  const read = readWorkerOnce(ports);
  workerReads.set(ports, { at: now, read });
  return read;
}

async function workerFacts(ports: Ports, mode: StatusMode, home: string | null): Promise<WorkerFacts> {
  const cf = ports.config.providers.camoufox;
  const read = await readWorker(ports);
  return {
    read,
    // why: the refusal file lives on the host; a container cannot see it
    refusal: cf === null || mode !== 'native' ? { kind: 'none' } : readRefusal(home),
    browserWindow: ports.config.camoufoxBrowserWindow,
    caps:
      cf === null
        ? { pages: 0, scrolls: 0 }
        : {
            pages: sharedInt(cf.sharedSettings, 'CAMOUFOX_MONTHLY_PAGE_CAP'),
            scrolls: sharedInt(cf.sharedSettings, 'CAMOUFOX_MONTHLY_SCROLL_CAP'),
          },
  };
}

function priceSources(ports: Ports, worker: WorkerFacts): PriceSourceFacts {
  const usable: ProviderId[] = ports.providers
    .filter(
      (p) =>
        p.id !== 'fixture' &&
        p.discovery !== undefined &&
        !providerBudget(ports.config, p.id).excludedFromSchedule &&
        (p.id !== 'camoufox' || browserUsable(worker.read)),
    )
    .map((p) => p.id);
  return { usable };
}

/**
 * The consent check alone, as the engine's notice reads it (spec §8.3 "Consent expiry"): the worker's status and, in
 * native mode, its refusal file; none of the report's other facts. `cause` says why, so the subject names the real cause.
 */
export async function consentCheckFor(
  ports: Ports,
  home: string | null,
): Promise<{
  state: 'ok' | 'warn' | 'fail' | 'off';
  cause: ConsentCause;
  summary: string;
  fix: string | null;
}> {
  const mode = modeOf(ports);
  const { check: c, cause } = consentOutcome(
    { now: ports.clock.now(), tz: ports.config.schedulerTimezone, mode },
    await workerFacts(ports, mode, home),
  );
  return {
    state: c.state,
    cause,
    summary: c.summary,
    fix: c.fix === null ? null : c.fix.command === null ? c.fix.text : `${c.fix.text}: ${c.fix.command}`,
  };
}

/** All the facts of one report. */
export async function gatherFacts(ctx: RouteContext, env: StatusEnv): Promise<StatusFacts> {
  const { ports } = ctx;
  const now = ports.clock.now();
  const mode = modeOf(ports);
  const defs = ports.repos.definitions.list();
  let pending = 0;
  let answers = dbOk(ports);
  if (answers) {
    try {
      pending = pendingMigrations(ports.db, env.migrationsDir).length;
    } catch {
      answers = false;
    }
  }
  const worker = await workerFacts(ports, mode, env.home);
  return {
    now,
    tz: ports.config.schedulerTimezone,
    mode,
    version: env.version,
    app: {
      version: env.version,
      startedAt: env.startedAt,
      loopback: isLoopbackHost(ports.config.bindAddress),
      authOn: ports.config.auth !== null,
    },
    database: { answers, sizeBytes: dbSizeBytes(ports.config.databasePath), pendingMigrations: pending },
    backupNewestAt: mode === 'container' ? null : newestBackup(ports.config.databasePath),
    schedule: scheduleFacts(ctx, defs, now),
    data: defs.map((d) => dataFacts(ctx, d, now)),
    priceSources: priceSources(ports, worker),
    providers: [providerFacts(ports, 'travelpayouts'), providerFacts(ports, 'searchapi')],
    synthetic: registered(ports, 'fixture'),
    worker,
    email: { configured: ports.config.smtp !== null, last: env.emailLast() },
  };
}
