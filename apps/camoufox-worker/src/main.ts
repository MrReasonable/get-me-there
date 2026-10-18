import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import {
  CAMOUFOX_JS_VERSION,
  type Clock,
  GRID_STEP_DAYS,
  type Logger,
  systemClock,
  type Versions,
  type WorkerStatus,
} from '@gmt/core';
import { checkAccountCookies } from './accountCookies.js';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { CooldownStore } from './cooldown.js';
import type { ContextLike } from './driver.js';
import { type LaunchOptions, launchContext, prepareLaunch } from './launch.js';
import { acquireLock, sweepProbeProfiles } from './lock.js';
import { debugLogging, stderrLog } from './log.js';
import { GRAMMAR_VERSION } from './names.js';
import { Pacer } from './pacer.js';
import { installDir, profileDir } from './paths.js';
import { Refusal } from './refusal.js';
import { type Entry, type EntryContext, EX_CONFIG, EX_SOFTWARE } from './run.js';
import { flagsOf, SELECTORS, type Selectors } from './selectors.js';
import { BIND_HOST, createWorkerServer, portOf } from './server.js';
import { PageSession } from './session.js';
import { loadSocs } from './socs.js';
import { bounded, realTimers, type Timers } from './timers.js';

/** The status route's bound on a cold relaunch plus its cookie read: under the app's 10 s status timeout. */
const STATUS_CHECK_MS = 8000;

/**
 * The worker process (spec §2, §13; brief Task 14.5; decision 69). Start checks, in order, each exiting 78 naming the
 * check: macOS, the settings, the install layout and the pins, the data-directory lock (and the probe sweep), the
 * launch, the account-cookie check, the SOCS capture, and FORM_VERIFIED (the search-form check is mandatory, so the
 * server refuses to start until Task 14.2's recording verifies it). A standing signed-in refusal starts the server
 * answering `cooling-down` only, without launching. SIGTERM stops accepting, lets the page in flight answer, closes
 * the browser, releases the lock and exits 0; a cool-down store failure answers its page, then exits 70.
 */
export interface MainDeps {
  platform: string;
  clock: Clock;
  timers: Timers;
  log: Logger;
  selectors: Selectors;
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
  const refuse = (check: string, e: unknown): number => {
    ctx.err(`camoufox worker refused to start: ${check}: ${e instanceof Error ? e.message : String(e)}`);
    return EX_CONFIG;
  };
  let cfg: WorkerConfig;
  let prepared: ReturnType<typeof prepareLaunch>;
  try {
    if (deps.platform !== 'darwin') throw new StartRefused('the camoufox worker supports macOS only');
  } catch (e) {
    return refuse('platform', e);
  }
  try {
    cfg = loadWorkerConfig(ctx.env);
  } catch (e) {
    return refuse('settings', e);
  }
  try {
    prepared = deps.prepare({
      platform: deps.platform,
      installDir: installDir(cfg.home),
      pinnedBuild: cfg.binaryBuild,
      installDirOverride: ctx.env.CAMOUFOX_INSTALL_DIR,
      home: cfg.home,
      path: cfg.path,
      tmp: cfg.tmp,
    });
  } catch (e) {
    return refuse('install layout and pins', e);
  }
  let lock: { release(): void };
  try {
    lock = acquireLock(ctx.dataDir, { pid: deps.pid });
    sweepProbeProfiles(ctx.dataDir);
  } catch (e) {
    return refuse('lock', e);
  }
  const fail = (check: string, e: unknown): number => {
    lock.release();
    return refuse(check, e);
  };
  const cooldown = new CooldownStore({
    dir: ctx.dataDir,
    challengeHours: cfg.cooldownHours,
    clock: deps.clock,
  });
  const refusal = new Refusal({ dir: ctx.dataDir, clock: deps.clock });
  const pacer = new Pacer({ dir: ctx.dataDir, minSpacingSeconds: cfg.minSpacingSeconds, clock: deps.clock });
  let socs: ReturnType<typeof loadSocs>;
  try {
    socs = loadSocs(ctx.dataDir, deps.clock);
  } catch (e) {
    return fail('SOCS capture', e);
  }
  if (!deps.selectors.FORM_VERIFIED)
    return fail(
      'FORM_VERIFIED',
      new Error('the search-form check is unverified until Task 14.2’s recording (decision 69)'),
    );
  const profile = profileDir(ctx.dataDir);
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  const versions: Versions = {
    selectors: deps.selectors.version,
    grammar: GRAMMAR_VERSION,
    camoufoxJs: CAMOUFOX_JS_VERSION,
    binary: prepared.install.build,
  };
  const session = new PageSession({
    launch: () => deps.launch(prepared.options, profile),
    profileDir: profile,
    socs,
    cooldown,
    pacer,
    refusal,
    clock: deps.clock,
    timers: deps.timers,
    selectors: deps.selectors,
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
    return fail(e instanceof StartRefused ? 'account cookies' : 'launch', e);
  }

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
    return {
      ok: active === null && refusal.active() === null && !account.found,
      coolingDownUntil: active?.until ?? null,
      cooldownCause: active?.cause ?? null,
      signedInRefusal: refusal.active() !== null,
      lastPageAt: pacer.lastPageAt(),
      busySince: session.busy(),
      versions,
      flags: flagsOf(deps.selectors),
      accountCookie: account,
      socsCapturedAt: socs.capturedAt,
      socsStable: deps.selectors.SOCS_STABLE,
      cooldownHours: cfg.cooldownHours,
      pageTimeoutSeconds: cfg.pageTimeoutSeconds,
      // why: spec §2 rev 34: the measured step the planner uses, only while this worker serves grid pages
      gridStepDays: deps.selectors.GRID_VERIFIED && cfg.mode === 'grid' ? { ...GRID_STEP_DAYS } : null,
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
      lock.release();
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
    onFatal: () => {
      void stop(EX_SOFTWARE);
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.port ?? cfg.port, BIND_HOST, () => resolve());
  }).catch(async (e: unknown) => {
    await session.discard(false);
    lock.release();
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
    clock: systemClock,
    timers: realTimers,
    log: stderrLog(ctx.err, debugLogging(ctx.env)),
    selectors: SELECTORS,
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
