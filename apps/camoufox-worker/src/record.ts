import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type BlockedPage,
  type Clock,
  type Iata,
  type IsoDate,
  iataSchema,
  isoDateSchema,
  type Logger,
  systemClock,
} from '@gmt/core';
import { checkAccountCookies } from './accountCookies.js';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { CooldownStore } from './cooldown.js';
import {
  type ContextLike,
  createDriver,
  type Driver,
  type PageLike,
  type ProbePage,
  pollUntilSettled,
  probePage,
  type Settled,
} from './driver.js';
import { installGuard, installProbeGuard, onAllowlist } from './guard.js';
import {
  CAMOUFOX_JS_VERSION,
  type LaunchOptions,
  launchContext,
  launchOptionsForMeta,
  prepareLaunch,
} from './launch.js';
import { acquireLock, LockHeld, sweepProbeProfiles } from './lock.js';
import { Pacer } from './pacer.js';
import { installDir, profileDir } from './paths.js';
import { type Entry, type EntryContext, EX_CONFIG, EX_SOFTWARE, EX_UNAVAILABLE } from './run.js';
import { SELECTORS, SELECTORS_VERSION, type Selectors } from './selectors.js';
import { loadSocs, type ReadBack, readBack, type SocsCapture, socsCookie } from './socs.js';
import { DeadlineExceeded, realTimers, type Timers } from './timers.js';
import { pageUrl, probeUrl } from './url.js';

/**
 * The recorder (spec §2 "Recordings first"; brief Task 14.2; decision 69 round 2, item 4; PIE-R2-01, PIE-R2-12,
 * SEC-R2-003, SEC-015, TS-05, TS2-10, TS2-12). It loads Google pages in the worker's own browser, under every rule the
 * server applies (the lock, the shared pacer, the allowlist guard, SOCS set before and read back after every page, the
 * cool-down on any block), and writes what the locators read to `fixtures/recorded/<kind>/<date>/<n>.{facts,meta}.json`
 * (gitignored, local-only: decision 61). It never stores printed ARIA text, a cookie value, the worker key, an account
 * name or an e-mail address. The consent probe is the one navigation exception, and it lives only here.
 */
export const KINDS = [
  'results',
  'cheapest',
  'view-more',
  'socs-stability',
  'consent-probe',
  'no-flights',
] as const;
export type RecordingKind = (typeof KINDS)[number];
export const RECORDED_BY = 'camoufox-worker record';
export const MAX_PAGES = 3;
/** The stability check's spacing between its three pages (rule 2). */
export const STABILITY_PAGES = 3;
export const DEFAULT_ROOT = fileURLToPath(new URL('../fixtures/recorded/', import.meta.url));

export class RecordingRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingRefused';
  }
}

export interface RecordArgs {
  kind: RecordingKind;
  request: { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate } | null;
  pages: number;
}

/** Parses the recorder's flags; throws RecordingRefused naming what is wrong. */
export function parseRecordArgs(args: readonly string[]): RecordArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (['--origin', '--destination', '--depart', '--return', '--pages'].includes(a)) {
      const v = args[i + 1];
      if (v === undefined) throw new RecordingRefused(`${a} needs a value`);
      values.set(a, v);
      i++;
    } else if (
      ['--cheapest', '--view-more', '--stability', '--consent-probe', '--no-flights', '--grid'].includes(a)
    )
      flags.add(a);
    else throw new RecordingRefused(`unknown argument ${a}`);
  }
  // why: decision 69: grid mode is not built in WP14, so nothing (the recorder included) loads the grid.
  if (flags.has('--grid'))
    throw new RecordingRefused('--grid: grid mode is not built in this work package (decision 69)');
  if (flags.size > 1)
    throw new RecordingRefused(
      'pass at most one of --cheapest, --view-more, --stability, --consent-probe, --no-flights',
    );
  const kind: RecordingKind = flags.has('--cheapest')
    ? 'cheapest'
    : flags.has('--view-more')
      ? 'view-more'
      : flags.has('--stability')
        ? 'socs-stability'
        : flags.has('--consent-probe')
          ? 'consent-probe'
          : flags.has('--no-flights')
            ? 'no-flights'
            : 'results';
  const pagesRaw = values.get('--pages') ?? (kind === 'socs-stability' ? String(STABILITY_PAGES) : '1');
  const pages = Number(pagesRaw);
  if (!/^\d+$/.test(pagesRaw) || pages < 1 || pages > MAX_PAGES)
    throw new RecordingRefused(`--pages must be 1 to ${MAX_PAGES}`);
  if (kind === 'consent-probe') return { kind, request: null, pages: 1 };
  const origin = iataSchema.safeParse(values.get('--origin') ?? '');
  const destination = iataSchema.safeParse(values.get('--destination') ?? '');
  const departureDate = isoDateSchema.safeParse(values.get('--depart') ?? '');
  const returnDate = isoDateSchema.safeParse(values.get('--return') ?? '');
  if (!origin.success || !destination.success)
    throw new RecordingRefused('--origin and --destination must be IATA codes');
  if (!departureDate.success || !returnDate.success || returnDate.data <= departureDate.data)
    throw new RecordingRefused('--depart and --return must be dates, the return after the departure');
  return {
    kind,
    request: {
      origin: origin.data,
      destination: destination.data,
      departureDate: departureDate.data,
      returnDate: returnDate.data,
    },
    pages,
  };
}

export interface RecordDeps {
  clock: Clock;
  timers: Timers;
  log: Logger;
  /** Launches the worker's browser into `profile` (the persistent one, or a throwaway probe profile). */
  launch(profile: string): Promise<ContextLike>;
  launchOptions: Omit<LaunchOptions, 'env'>;
  binary: string;
  root: string;
  pollMs: number;
  selectors: Selectors;
  pid: number;
  isAlive?: (pid: number) => boolean;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
/** Rule 6: nothing is written when the recording holds the key, the SOCS value, an account name or an e-mail address. */
export function assertClean(text: string, secrets: readonly string[]): void {
  for (const s of secrets)
    if (s !== '' && text.includes(s))
      throw new RecordingRefused('the recording holds a secret; nothing written');
  if (text.includes('Google Account:'))
    throw new RecordingRefused('the recording holds an account name; nothing written');
  if (EMAIL.test(text)) throw new RecordingRefused('the recording holds an e-mail address; nothing written');
}

function nextIndex(dir: string): number {
  if (!existsSync(dir)) return 1;
  const used = readdirSync(dir)
    .map((f) => /^(\d+)\.meta\.json$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}

interface PageRecording {
  facts: unknown;
  meta: Record<string, unknown>;
}

/** Writes one recording pair after the fail-closed scan; returns the facts path. */
export function writeRecording(
  root: string,
  kind: RecordingKind,
  day: string,
  rec: PageRecording,
  secrets: readonly string[],
): string {
  const factsText = `${JSON.stringify(rec.facts, null, 2)}\n`;
  const contentSha256 = createHash('sha256').update(factsText).digest('hex');
  const metaText = `${JSON.stringify({ ...rec.meta, contentSha256 }, null, 2)}\n`;
  assertClean(factsText + metaText, secrets);
  const dir = join(root, kind, day);
  mkdirSync(dir, { recursive: true });
  const n = nextIndex(dir);
  writeFileSync(join(dir, `${n}.facts.json`), factsText);
  writeFileSync(join(dir, `${n}.meta.json`), metaText);
  return join(dir, `${n}.facts.json`);
}

interface LoadedPage {
  settled: Settled | null;
  /** The blocked kind the page or its guard stopped on. */
  blocked: BlockedPage | null;
  landing: string;
  hops: string[];
  stepMs: Record<string, number>;
  driverOrProbe: Driver | ProbePage;
  page: PageLike;
}

export async function record(ctx: EntryContext, cfg: WorkerConfig, deps: RecordDeps): Promise<number> {
  let args: RecordArgs;
  try {
    args = parseRecordArgs(ctx.args);
  } catch (e) {
    ctx.err(e instanceof Error ? e.message : String(e));
    return EX_CONFIG;
  }
  let lock: { release(): void };
  try {
    lock = acquireLock(ctx.dataDir, {
      pid: deps.pid,
      ...(deps.isAlive === undefined ? {} : { isAlive: deps.isAlive }),
    });
  } catch (e) {
    ctx.err(e instanceof LockHeld ? `${e.message}: stop the worker before recording` : String(e));
    return EX_CONFIG;
  }
  try {
    sweepProbeProfiles(ctx.dataDir);
    const cooldown = new CooldownStore({ dir: ctx.dataDir, botHours: cfg.cooldownHours, clock: deps.clock });
    const active = cooldown.active();
    if (active !== null) {
      ctx.err(`cooling down until ${active.until} (${active.cause}); no page is loaded before then`);
      return EX_UNAVAILABLE;
    }
    const pacer = new Pacer({
      dir: ctx.dataDir,
      minSpacingSeconds: cfg.minSpacingSeconds,
      clock: deps.clock,
    });
    const day = deps.clock.now().slice(0, 10);
    if (args.kind === 'consent-probe') return await consentProbe(ctx, cfg, deps, { pacer, cooldown, day });
    let capture: SocsCapture;
    try {
      capture = loadSocs(ctx.dataDir, deps.clock);
    } catch (e) {
      ctx.err(e instanceof Error ? e.message : String(e));
      return EX_CONFIG;
    }
    const secrets = [cfg.key.reveal(), capture.value];
    const context = await deps.launch(profileDir(ctx.dataDir));
    const readBacks: ReadBack[] = [];
    try {
      for (let i = 0; i < args.pages; i++) {
        const req = args.request;
        if (req === null) throw new RecordingRefused('no request');
        await claim(pacer, deps, ctx);
        let loaded: LoadedPage | null = null;
        let back: ReadBack = 'missing';
        try {
          // why: TS2-10: the only cookie the recorder sets is socsCookie(capture).
          await context.addCookies([socsCookie(capture)]);
          const account = await checkAccountCookies(context, deps.clock);
          if (account.found) {
            const until = cooldown.start('signed-in').until;
            ctx.err(
              `the profile holds Google account cookies (${account.names.join(', ')}); cooling down until ${until}`,
            );
            return EX_UNAVAILABLE;
          }
          loaded = await loadPage(context, deps, cfg, pageUrl({ ...req, gl: cfg.pointOfSale }), false);
        } finally {
          back = readBack(await context.cookies(), capture);
          readBacks.push(back);
          pacer.release();
        }
        const blocked = loaded.blocked ?? (back === 'same' ? null : 'consent-unhandled');
        // why: rule 1: a recording counts only when it landed on the allowlist with every hop on it.
        const offList = [loaded.landing, ...loaded.hops].some((u) => !onAllowlist(u, deps.selectors));
        if (blocked !== null || (offList && args.kind !== 'no-flights')) {
          const kind: BlockedPage = blocked ?? 'off-allowlist';
          const until = cooldown.start(kind).until;
          if (kind === 'consent-unhandled')
            writeRecording(
              deps.root,
              args.kind,
              day,
              {
                facts: {
                  failure: kind,
                  landing: stripQuery(loaded.landing),
                  hops: loaded.hops.map(stripQuery),
                  socsReadBack: back,
                },
                meta: meta(deps, args.kind, back, loaded.stepMs, { failure: kind }),
              },
              secrets,
            );
          ctx.err(`stopped: ${kind}; cooling down until ${until}; the work stops for an operator ruling`);
          return EX_UNAVAILABLE;
        }
        const facts = await readRecording(loaded, deps, args.kind);
        if (args.kind === 'no-flights' && !facts.noFlights) {
          writeUnrecorded(deps.root, day, facts, secrets);
          ctx.out(
            'no recognisable "no flights" line appeared; wrote no-flights/unrecorded.meta.json, NO_FLIGHTS_VERIFIED stays false',
          );
          continue;
        }
        const path = writeRecording(
          deps.root,
          args.kind,
          day,
          {
            facts: { ...facts.data, socsReadBack: back },
            meta: meta(deps, args.kind, back, loaded.stepMs, {}),
          },
          secrets,
        );
        ctx.out(`recorded ${path}`);
      }
    } finally {
      await context.close().catch(() => undefined);
    }
    if (args.kind === 'socs-stability' && !readBacks.every((b) => b === 'same')) {
      ctx.err(
        `SOCS read-backs ${readBacks.join(', ')}: SOCS_STABLE stays false; an operator ruling is needed`,
      );
      return EX_UNAVAILABLE;
    }
    return 0;
  } catch (e) {
    ctx.err(e instanceof Error ? e.message : String(e));
    return e instanceof RecordingRefused ? EX_CONFIG : EX_SOFTWARE;
  } finally {
    lock.release();
  }
}

/** The shared pacer: waits out the spacing once (fake timers in tests), then claims or refuses. */
async function claim(pacer: Pacer, deps: RecordDeps, ctx: EntryContext): Promise<void> {
  const first = pacer.claim();
  if (first.ok) return;
  ctx.out(`waiting ${first.retryAfterSeconds} s for the spacing`);
  await deps.timers.sleep(first.retryAfterSeconds * 1000);
  const second = pacer.claim();
  if (!second.ok) throw new RecordingRefused(`the spacing still refuses (${second.retryAfterSeconds} s)`);
}

function stripQuery(u: string): string {
  try {
    const x = new URL(u);
    return `${x.origin}${x.pathname}`;
  } catch {
    return 'unparsable';
  }
}

async function loadPage(
  context: ContextLike,
  deps: RecordDeps,
  cfg: WorkerConfig,
  url: string,
  probe: boolean,
): Promise<LoadedPage> {
  const page = await context.newPage();
  const guard = probe
    ? await installProbeGuard(context, page, deps.log, deps.selectors)
    : await installGuard(context, page, deps.log, deps.selectors);
  const driver = createDriver(page, guard, deps.selectors);
  const driverOrProbe: Driver | ProbePage = probe ? probePage(driver) : driver;
  const d = deps.timers.deadline(cfg.pageTimeoutSeconds * 1000);
  d.onExpire(() => {
    void page.close().catch(() => undefined);
  });
  const stepMs: Record<string, number> = {};
  const t0 = deps.timers.now();
  let settled: Settled | null = null;
  let blocked: BlockedPage | null = null;
  try {
    try {
      await driverOrProbe.goto(url, d);
    } catch (e) {
      if (guard.refused === null) throw e;
      blocked = guard.refused;
    }
    stepMs.goto = deps.timers.now() - t0;
    if (blocked === null) {
      // why: the probe expects the consent page; the recorder reads with the no-flights hypothesis on so it can see it.
      const S = { ...deps.selectors, NO_FLIGHTS_VERIFIED: true };
      settled = await pollUntilSettled(driverOrProbe, d, deps.timers, deps.pollMs, S);
      if (settled.kind.kind === 'blocked' && !(probe && settled.kind.page === 'consent-unhandled'))
        blocked = settled.kind.page;
    }
    stepMs.settle = deps.timers.now() - t0;
  } catch (e) {
    if (!(e instanceof DeadlineExceeded)) throw e;
    throw new RecordingRefused(
      `the page did not settle within CAMOUFOX_PAGE_TIMEOUT_SECONDS (${cfg.pageTimeoutSeconds})`,
    );
  }
  return { settled, blocked, landing: page.url(), hops: [...guard.hops], stepMs, driverOrProbe, page };
}

async function readRecording(
  loaded: LoadedPage,
  deps: RecordDeps,
  kind: RecordingKind,
): Promise<{ data: Record<string, unknown>; noFlights: boolean }> {
  const cfgMs = 30_000;
  const d = deps.timers.deadline(cfgMs);
  const facts = loaded.settled?.facts ?? null;
  const clicked: string[] = [];
  let after = facts;
  // why: rule 5: only --cheapest and --view-more click these controls before their flags are set.
  if ((kind === 'cheapest' || kind === 'view-more') && 'click' in loaded.driverOrProbe) {
    const driver = loaded.driverOrProbe;
    if (kind === 'cheapest') {
      const tab = facts?.page.cheapestTabs[0]?.name ?? '';
      if (tab !== '') {
        await driver.click('tab', tab, d);
        clicked.push(`tab:${tab.replace(/\d[\d,]*/g, '<n>')}`);
      }
    } else {
      await driver.click('button', deps.selectors.results.viewMoreButton, d);
      clicked.push(`button:${deps.selectors.results.viewMoreButton}`);
    }
    after = (await pollUntilSettled(driver, d, deps.timers, deps.pollMs, deps.selectors)).facts;
  }
  const data = {
    kind,
    landing: loaded.landing,
    hops: loaded.hops,
    page: after?.page ?? null,
    settle: after?.settle ?? null,
    clicked,
    names: await loaded.driverOrProbe.resultNames(d),
    list: await loaded.driverOrProbe.listFacts(d),
    form: await loaded.driverOrProbe.formFacts(d),
    headings: await loaded.driverOrProbe.headingNames(d),
  };
  d.clear();
  await loaded.page.close().catch(() => undefined);
  return { data, noFlights: after?.page.text.noFlights === true };
}

function meta(
  deps: RecordDeps,
  kind: RecordingKind,
  back: ReadBack,
  stepMs: Record<string, number>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    recordedAt: deps.clock.now(),
    recordedBy: RECORDED_BY,
    kind,
    socsReadBack: back,
    launchOptions: deps.launchOptions,
    versions: { selectors: SELECTORS_VERSION, camoufoxJs: CAMOUFOX_JS_VERSION, binary: deps.binary },
    stepMs,
    ...extra,
  };
}

function writeUnrecorded(
  root: string,
  day: string,
  facts: { data: Record<string, unknown> },
  secrets: readonly string[],
): void {
  const text = `${JSON.stringify({ recordedAt: day, recordedBy: RECORDED_BY, appeared: facts.data }, null, 2)}\n`;
  assertClean(text, secrets);
  mkdirSync(join(root, 'no-flights'), { recursive: true });
  writeFileSync(join(root, 'no-flights', 'unrecorded.meta.json'), text);
}

/**
 * Rule 3: the consent probe. A throwaway profile `<data>/probe-<time>-<pid>` (deleted in a `finally`, a thrown error
 * included), no SOCS, the probe guard, a page typed without `click`. It records the consent page's facts and starts no
 * cool-down for that expected page; any other blocked kind cools down as usual.
 */
async function consentProbe(
  ctx: EntryContext,
  cfg: WorkerConfig,
  deps: RecordDeps,
  s: { pacer: Pacer; cooldown: CooldownStore; day: string },
): Promise<number> {
  const profile = join(ctx.dataDir, `probe-${Date.parse(deps.clock.now())}-${deps.pid}`);
  mkdirSync(profile, { recursive: true, mode: 0o700 });
  try {
    await claim(s.pacer, deps, ctx);
    let loaded: LoadedPage;
    const context = await deps.launch(profile);
    try {
      loaded = await loadPage(context, deps, cfg, probeUrl(cfg.pointOfSale), true);
      if (loaded.blocked !== null) {
        const until = s.cooldown.start(loaded.blocked).until;
        ctx.err(`the probe stopped on ${loaded.blocked}; cooling down until ${until}`);
        return EX_UNAVAILABLE;
      }
      const facts = await readRecording(loaded, deps, 'consent-probe');
      const path = writeRecording(
        deps.root,
        'consent-probe',
        s.day,
        {
          facts: facts.data,
          meta: meta(deps, 'consent-probe', 'missing', loaded.stepMs, { profile: 'throwaway' }),
        },
        [cfg.key.reveal()],
      );
      ctx.out(`recorded ${path}`);
      return 0;
    } finally {
      s.pacer.release();
      await context.close().catch(() => undefined);
    }
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

/** A Logger for the command line: warnings and errors as JSON lines on stderr (host names only, never a URL). */
export function stderrLog(err: (line: string) => void): Logger {
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (o, msg) => err(JSON.stringify({ level: 'warn', msg, ...o })),
    error: (o, msg) => err(JSON.stringify({ level: 'error', msg, ...o })),
    child: () => log,
  };
  return log;
}

/** The real dependencies: the system clock, real timers, and the browser launched with the prepared options. */
export function realRecordDeps(
  prepared: ReturnType<typeof prepareLaunch>,
  err: (line: string) => void,
): RecordDeps {
  return {
    clock: systemClock,
    timers: realTimers,
    log: stderrLog(err),
    launch: (profile) => launchContext(prepared.options, profile),
    launchOptions: launchOptionsForMeta(prepared.options),
    binary: prepared.install.build,
    root: DEFAULT_ROOT,
    pollMs: 2000,
    selectors: SELECTORS,
    pid: process.pid,
  };
}

/** The command: settings from worker.env, the real browser and clock. */
export const entry: Entry = async (ctx) => {
  const cfg = loadWorkerConfig(ctx.env);
  const prepared = prepareLaunch({
    platform: process.platform,
    installDir: installDir(cfg.home),
    pinnedBuild: cfg.binaryBuild,
    installDirOverride: ctx.env.CAMOUFOX_INSTALL_DIR,
    home: cfg.home,
    path: cfg.path,
    tmp: cfg.tmp,
  });
  return record(ctx, cfg, realRecordDeps(prepared, ctx.err));
};
