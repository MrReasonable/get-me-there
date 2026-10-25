import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import {
  CAMOUFOX_JS_VERSION,
  type Clock,
  GRID_STEP_DAYS,
  type Logger,
  type StartRefusalReason,
  startChecks,
  systemClock,
  type Versions,
  type WorkerStatus,
} from '@gmt/core';
import { checkAccountCookies } from './accountCookies.js';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { CooldownStore } from './cooldown.js';
import type { ContextLike } from './driver.js';
import { type LaunchOptions, launchContext, prepareLaunch } from './launch.js';
import { acquireLock, LockHeld, sweepProbeProfiles } from './lock.js';
import { debugLogging, stderrLog } from './log.js';
import { AppInstances, MonthlyCounter } from './monthly.js';
import { GRAMMAR_VERSION } from './names.js';
import { Pacer } from './pacer.js';
import { profileDir } from './paths.js';
import { Refusal } from './refusal.js';
import { type Entry, type EntryContext, EX_CONFIG, EX_SOFTWARE } from './run.js';
import { flagsOf, type Selectors, selectorsFor } from './selectors.js';
import { BIND_HOST, createWorkerServer, portOf } from './server.js';
import { PageSession } from './session.js';
import { consentStatusOf } from './socs.js';
import {
  clearStartRefusal,
  type GatheredStart,
  gatherStart,
  refusalWords,
  writeStartRefusal,
} from './startRefusal.js';
import { bounded, realTimers, type Timers } from './timers.js';

/** The status route's bound on a cold relaunch plus its cookie read: under the app's 10 s status timeout. */
const STATUS_CHECK_MS = 8000;

/**
 * The worker process (spec §2, §13; brief Task 14.5; decisions 69 and 75). The settings first, then the start facts
 * judged by core's `startChecks` in its order (the lock, this machine's flags for its pinned build, the install layout
 * and its build, the consent record), each refusal exiting 78 after writing `start-refusal.json`; then the launch and
 * the account-cookie check (a signed-in profile refuses the same way). A successful start removes the refusal file. The
 * flags are the running entry's (`selectorsFor(osArch, build)`). A standing signed-in refusal starts the server
 * answering `cooling-down` only, without launching. SIGTERM stops accepting, lets the page in flight answer, closes
 * the browser, releases the lock and exits 0; a cool-down store failure answers its page, then exits 70.
 */
export interface MainDeps {
  platform: string;
  arch: string;
  clock: Clock;
  timers: Timers;
  log: Logger;
  /** Tests only: the flags to run with; production runs on `selectorsFor(osArch, installed build)` (decision 75). */
  selectors?: Selectors;
  prepare: typeof prepareLaunch;
  launch: (options: LaunchOptions, profile: string) => Promise<ContextLike>;
  /** Registers the shutdown signal (process.once('SIGTERM') and SIGINT in production). */
  onShutdown: (handler: () => void) => void;
  /** The port to bind; the configured one in production, 0 in tests. */
  port?: number;
  pid: number;
}

export interface RunningWorker {
  port: number;
  /** Resolves with the exit code once the worker has stopped. */
  done: Promise<number>;
}

class StartRefused extends Error {}

export async function startWorker(ctx: EntryContext, deps: MainDeps): Promise<RunningWorker | number> {
  // why: W1 (dev-b1-003): every exit 78 leaves the refusal file, so status and start explain it and boot a refused
  // agent out; a refusal of the worker's own settings or files is `config`, its words on stderr (start prints them)
  const refuse = (check: string, e: unknown): number => {
    ctx.err(`camoufox worker refused to start: ${check}: ${e instanceof Error ? e.message : String(e)}`);
    try {
      writeStartRefusal(ctx.dataDir, 'config', deps.clock.now());
    } catch (w) {
      ctx.err(`the refusal file could not be written: ${w instanceof Error ? w.message : String(w)}`);
    }
    return EX_CONFIG;
  };
  let cfg: WorkerConfig;
  try {
    cfg = loadWorkerConfig(ctx.env);
  } catch (e) {
    return refuse('settings', e);
  }
  let lock: { release(): void } | null = null;
  try {
    lock = acquireLock(ctx.dataDir, { pid: deps.pid });
    sweepProbeProfiles(ctx.dataDir);
  } catch (e) {
    if (!(e instanceof LockHeld)) return refuse('lock', e);
  }
  // why: decision 75: the start's facts, judged by core's startChecks (the CLI and the app's status read the same)
  // why: filled by the inspection below, which TS cannot follow into the callback
  const prepared: { value: ReturnType<typeof prepareLaunch> | null } = { value: null };
  let gathered: GatheredStart;
  try {
    gathered = gatherStart({
      platform: deps.platform,
      arch: deps.arch,
      dataDir: ctx.dataDir,
      locked: lock === null,
      clock: deps.clock,
      inspect: () => {
        prepared.value = deps.prepare({
          platform: deps.platform,
          arch: deps.arch,
          installDirSet: ctx.env.CAMOUFOX_INSTALL_DIR,
          dataDir: ctx.dataDir,
          home: cfg.home,
          path: cfg.path,
          tmp: cfg.tmp,
        });
        return prepared.value.install;
      },
    });
  } catch (e) {
    lock?.release();
    return refuse('install layout and pins', e);
  }
  const reason = startChecks(gathered.facts);
  const refused = (r: StartRefusalReason, words: string): number => {
    lock?.release();
    try {
      writeStartRefusal(ctx.dataDir, r, deps.clock.now());
    } catch (e) {
      ctx.err(`the refusal file could not be written: ${e instanceof Error ? e.message : String(e)}`);
    }
    ctx.err(`camoufox worker refused to start: ${r}: ${words}`);
    return EX_CONFIG;
  };
  if (reason !== null) return refused(reason, refusalWords(reason, gathered));
  const held = lock;
  const ready = prepared.value;
  const record = gathered.consent;
  const osArch = gathered.osArch;
  // why: startChecks refuses a never-shown record as itself (consent-not-shown), so only a capture reaches here
  if (
    held === null ||
    ready === null ||
    osArch === null ||
    record === null ||
    record === 'invalid' ||
    record.kind !== 'socs'
  )
    return refuse('start checks', new Error('the start facts are incomplete'));
  const socs = record.capture;
  const selectors = deps.selectors ?? selectorsFor(osArch, ready.install.build);
  const fail = (check: string, e: unknown): number => {
    held.release();
    return refuse(check, e);
  };
  const cooldown = new CooldownStore({
    dir: ctx.dataDir,
    challengeHours: cfg.cooldownHours,
    clock: deps.clock,
  });
  const refusal = new Refusal({ dir: ctx.dataDir, clock: deps.clock });
  const pacer = new Pacer({ dir: ctx.dataDir, minSpacingSeconds: cfg.minSpacingSeconds, clock: deps.clock });
  // why: decision 82: the month's caps for every caller, over the ledger's billing window
  const monthly = new MonthlyCounter({
    dir: ctx.dataDir,
    caps: { pages: cfg.monthlyPageCap, scrolls: cfg.monthlyScrollCap, billingDay: cfg.billingDay },
    clock: deps.clock,
  });
  const instances = new AppInstances({ dir: ctx.dataDir, billingDay: cfg.billingDay, clock: deps.clock });
  const profile = profileDir(ctx.dataDir);
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  const versions: Versions = {
    selectors: selectors.version,
    grammar: GRAMMAR_VERSION,
    camoufoxJs: CAMOUFOX_JS_VERSION,
    binary: ready.install.build,
  };
  const session = new PageSession({
    launch: () => deps.launch(ready.options, profile),
    profileDir: profile,
    socs,
    cooldown,
    pacer,
    monthly,
    refusal,
    clock: deps.clock,
    timers: deps.timers,
    selectors,
    pageTimeoutMs: cfg.pageTimeoutSeconds * 1000,
    log: deps.log,
    versions,
    grid: {
      mode: cfg.mode,
      spacingMs: cfg.gridScrollSpacingSeconds * 1000,
      scrollCap: cfg.gridScrollCap,
      stepDays: GRID_STEP_DAYS,
    },
  });
  let standingRefusal: boolean;
  try {
    standingRefusal = refusal.active() !== null;
    if (!standingRefusal) {
      const context = await session.currentContext();
      const account = await checkAccountCookies(context, deps.clock);
      if (account.found) {
        await session.discard(false);
        throw new StartRefused(
          `the profile holds Google account cookies (${account.names.join(', ')}); run clear-signed-in`,
        );
      }
    }
  } catch (e) {
    if (!(e instanceof StartRefused)) return fail('launch', e);
    return refused('signed-in', e.message);
  }
  // why: decision 75: a successful start clears the refusal the CLI and the status read
  clearStartRefusal(ctx.dataDir);

  let exitCode = 0;
  let stopping: Promise<number> | null = null;
  let resolveDone: (code: number) => void = () => undefined;
  const done = new Promise<number>((r) => {
    resolveDone = r;
  });
  const status = async (): Promise<WorkerStatus> => {
    const active = cooldown.active();
    let account: WorkerStatus['accountCookie'];
    if (standingRefusal || refusal.active() !== null)
      account = { found: false, names: [], checkedAt: deps.clock.now() };
    else {
      // why: fix round 1 (prov-int M7): after a wipe the context relaunches cold; status bounds that launch and its
      // cookie read under the app's 10 s status timeout and answers 500 past it, never a stale or guessed answer
      const checked = await bounded(
        async () => checkAccountCookies(await session.currentContext(), deps.clock),
        STATUS_CHECK_MS,
        deps.timers,
      );
      if (checked.overran) throw new Error('the browser did not answer the account-cookie check in time');
      account = checked.value;
    }
    const counts = monthly.status();
    return {
      // why: W3: a counts file that cannot be read refuses every page, so the app's preflight skips the provider
      ok: active === null && refusal.active() === null && !account.found && counts.readable,
      coolingDownUntil: active?.until ?? null,
      cooldownCause: active?.cause ?? null,
      signedInRefusal: refusal.active() !== null,
      lastPageAt: pacer.lastPageAt(),
      busySince: session.busy(),
      versions,
      // why: decision 75: the running entry's flags, for the build it runs
      flags: flagsOf(selectors),
      accountCookie: account,
      socsCapturedAt: socs.capturedAt,
      socsStable: selectors.SOCS_STABLE,
      cooldownHours: cfg.cooldownHours,
      pageTimeoutSeconds: cfg.pageTimeoutSeconds,
      // why: spec §2 rev 34: the measured step the planner uses, only while this worker serves grid pages
      gridStepDays: selectors.GRID_VERIFIED && cfg.mode === 'grid' ? { ...GRID_STEP_DAYS } : null,
      // why: fix round 1 (CA 9): the app's preflight refuses grid mode when its settings differ from these
      gridScrollCap: cfg.mode === 'grid' ? cfg.gridScrollCap : null,
      gridScrollSpacingSeconds: cfg.mode === 'grid' ? cfg.gridScrollSpacingSeconds : null,
      // why: spec §12 — the effective record the app's preflight compares with its own, by name
      sharedSettings: cfg.sharedSettings,
      osArch,
      build: ready.install.build,
      consent: consentStatusOf(record),
      monthly: counts,
      appInstances: instances.status(),
    };
  };
  let server: Server;
  let inFlight: Promise<unknown> = Promise.resolve();
  const stop = (code: number): Promise<number> => {
    stopping ??= (async () => {
      exitCode = code;
      await new Promise<void>((r) => server.close(() => r()));
      await inFlight.catch(() => undefined);
      await session.discard(false);
      held.release();
      resolveDone(exitCode);
      return exitCode;
    })();
    return stopping;
  };
  server = createWorkerServer({
    key: cfg.key,
    log: deps.log,
    now: () => deps.timers.now(),
    page: (req) => {
      const p = session.page(req);
      inFlight = p;
      return p;
    },
    status,
    seen: (id) => {
      try {
        instances.seen(id);
      } catch (e) {
        deps.log.warn({ error: e instanceof Error ? e.name : 'unknown' }, 'app instance not recorded');
      }
    },
    onFatal: () => {
      void stop(EX_SOFTWARE);
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.port ?? cfg.port, BIND_HOST, () => resolve());
  }).catch(async (e: unknown) => {
    await session.discard(false);
    held.release();
    throw e;
  });
  deps.onShutdown(() => {
    void stop(0);
  });
  ctx.out(
    `camoufox worker listening on ${BIND_HOST}:${portOf(server)}${standingRefusal ? ' (signed-in refusal stands: cooling-down only)' : ''}`,
  );
  return { port: portOf(server), done };
}

/** The command. */
export const entry: Entry = async (ctx) => {
  const w = await startWorker(ctx, {
    platform: process.platform,
    arch: process.arch,
    clock: systemClock,
    timers: realTimers,
    log: stderrLog(ctx.err, debugLogging(ctx.env)),
    prepare: prepareLaunch,
    launch: launchContext,
    onShutdown: (h) => {
      process.once('SIGTERM', h);
      process.once('SIGINT', h);
    },
    pid: process.pid,
  });
  return typeof w === 'number' ? w : w.done;
};
