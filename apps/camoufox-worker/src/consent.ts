import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type Clock, CONSENT_FIX, systemClock } from '@gmt/core';
import { type CaptureConfig, loadCaptureConfig, WorkerConfigError } from './config.js';
import {
  type ConsentDriver,
  createConsentDriver,
  type DisplayEnv,
  headedEnv,
  NoDisplay,
} from './consentDriver.js';
import {
  CONSENT_LINE_MAX_BYTES,
  decodeConsentLine,
  encodeConsentLine,
  rejectionMark,
} from './consentLine.js';
import { CONSENT_HOST, type Watched, watchConsentWindow } from './consentWatch.js';
import { CooldownStore } from './cooldown.js';
import { InstallRefused } from './install.js';
import { launchHeadedContext, prepareLaunch } from './launch.js';
import { acquireLock, LockHeld, sweepProbeProfiles } from './lock.js';
import { debugLogging, stderrLog } from './log.js';
import { MonthlyCounter } from './monthly.js';
import { Pacer } from './pacer.js';
import { claim } from './pageClaim.js';
import { RecordingRefused } from './recordArgs.js';
import { DISPLAY_NAMES, type Entry, type EntryContext, EX_CONFIG, EX_UNAVAILABLE } from './run.js';
import { type Selectors, selectorsFor } from './selectors.js';
import {
  ConsentNotCaptured,
  captureExpiry,
  notRejectionWhy,
  parseCapture,
  readConsentRecord,
  type SocsCapture,
  writeCapture,
} from './socs.js';
import { realTimers, type Timers } from './timers.js';
import { landingUrl } from './url.js';

/**
 * The `consent` command (spec §2 "Consent"; decision 74; brief WP17 Task 17.5), which `pnpm gmt consent` runs with the
 * worker service stopped. A person clicks "Reject all" in a visible Camoufox window, in a throwaway profile, and the
 * command only observes (consentWatch.ts through the ConsentDriver): it keeps the SOCS cookie set or changed after the
 * choice was submitted to the consent page, only when the value itself reads as a rejection (`rejectionMark`, as
 * research 17.0c observed it) and the submission did not carry the fields only the Accept all form sent there. It holds
 * the worker's lock and loads its one page under the pacer, the monthly count and the cool-downs, as every page does.
 *
 * - `consent`: the capture, written to `socs.json` (0600) with its capture time.
 * - `consent export`: the same capture on a desktop that has only the pinned Camoufox installed, printed as one
 *   `gmt-socs-v1.` line, the only standard output, for `consent import` on a machine with no display; nothing is
 *   written here.
 * - `consent import`: that line from standard input only (at most 4 KB), checked by its strict schema and its mark
 *   recomputed from the value; only a rejection is written, keeping its capture time.
 * - `consent check`: the stored record's mark and expiry, read only, with no page loaded.
 *
 * Nothing that refuses, fails or is interrupted (SIGINT, SIGTERM) changes a stored record: the file is written once, at
 * the end, only for a rejection (review X3). The SOCS value is never printed, except inside export's one line.
 */
export const CONSENT_PROMPT =
  'Click **Reject all** in the window, wait until Google Flights shows, then close the window. Nothing else is needed';

const NOTHING = 'nothing is written, and a record already here is kept as it was';

/** The form fields research 17.0c saw only in the Accept all submission (2026-10-25); names, never values. */
export const ACCEPT_ONLY_FIELDS: readonly string[] = ['set_aps', 'set_sc'];

export interface ConsentDeps {
  platform: string;
  /** The display groups run.ts passed to the `consent` entry (decision 74), else none. */
  display: DisplayEnv;
  clock: Clock;
  timers: Timers;
  selectors: Selectors;
  pid: number;
  isAlive?: (pid: number) => boolean;
  /** The headed window in the throwaway profile (consentDriver.ts, the command's only browser access). */
  consentDriver(profile: string): ConsentDriver;
  /** Deletes the throwaway profile (rmSync by default; a test makes it throw). */
  removeProfile?: (path: string) => void;
  /** Standard input, up to `max` bytes, or `too-long` past them (import). */
  readStdin(max: number): Promise<string | 'too-long'>;
  /** Aborted on SIGINT or SIGTERM (review X3): the window closes, the profile goes and nothing is written. */
  interrupted?: AbortSignal;
}

/** The capture's outcome: the rejection's cookie fields, or why nothing is kept (and the page kind to cool down for). */
export type Judged =
  | { kind: 'reject'; capture: SocsCapture }
  | { kind: 'refused'; message: string; cooldown: Watched['blocked'] };

/** The command a refusal tells the person to run again: the one they ran. */
export type ConsentCommand = 'pnpm gmt consent' | 'pnpm gmt consent export';

/** Pure: what a watched window comes to, in the order spec §2 states the refusals. */
export function judgeWatch(w: Watched, clock: Clock, command: ConsentCommand = 'pnpm gmt consent'): Judged {
  const refused = (message: string, cooldown: Watched['blocked'] = null): Judged => ({
    kind: 'refused',
    message: `${message}; ${NOTHING}`,
    cooldown,
  });
  if (w.ended === 'blocked' && w.blocked !== null)
    return refused(`the window stopped on ${w.blocked}`, w.blocked);
  if (w.ended === 'account-cookie')
    return refused('an account cookie appeared in the throwaway profile, which is deleted now');
  if (w.firstView === 'other')
    return refused('the first view was neither the consent page nor the landing view this tool recognises');
  const consentSeen = w.hosts.includes(CONSENT_HOST);
  if (w.firstView === 'landing' && !consentSeen && w.socs === null)
    return refused(
      'Google showed this machine’s region no consent page, so there is no choice to capture here. The browser provider cannot start without a captured rejection: capture one on a machine that is shown the consent page, with pnpm gmt consent export there piped into pnpm gmt consent import here; if no machine you use is shown it, leave the browser provider off (SearchApi and Travelpayouts still work)',
    );
  if (w.socs === null) {
    if (w.ended === 'timed-out') return refused('the consent page was left for 10 minutes without a choice');
    return refused(
      w.saves === 0
        ? 'the window was closed before a choice was made'
        : 'the window was closed before the choice’s cookie was set (wait until Google Flights shows before closing it)',
    );
  }
  if (!consentSeen) return refused('a SOCS cookie appeared but no consent page was seen');
  const mark = rejectionMark(w.socs.value);
  if (mark === 'accept')
    return refused(
      `the choice was Accept all, and only a rejection is ever kept: run ${command} again and click Reject all`,
    );
  if (mark === 'unknown')
    return refused(
      `${notRejectionWhy(mark)}; if you clicked Reject all, update this checkout (git pull, then pnpm install) and run ${command} again, and report it if it persists`,
    );
  const acceptOnly = ACCEPT_ONLY_FIELDS.filter((f) => w.saveFields.includes(f));
  if (acceptOnly.length > 0)
    return refused(
      `the choice’s submission carried ${acceptOnly.join(' and ')}, which only the Accept all form sent when this was researched; a choice made under More options has not been observed, so it is not kept: run ${command} again and click Reject all on the first page`,
    );
  try {
    return { kind: 'reject', capture: parseCapture({ ...w.socs, capturedAt: clock.now() }, clock) };
  } catch (e) {
    if (!(e instanceof ConsentNotCaptured)) throw e;
    return refused(`the cookie was refused: ${e.message}`);
  }
}

/** The expiry as the operator reads it, never the value. */
function expiryWords(c: Pick<SocsCapture, 'expires' | 'capturedAt'>): string {
  const e = captureExpiry(c);
  return `expires ${e.expiresAt} (${e.boundedBy === 'cookie' ? 'the cookie’s own expiry' : 'its capture plus 13 months'})`;
}

/** Deletes the profile, retrying once; a second failure is reported (the worker's start-up sweep removes it later). */
export function deleteProfile(path: string, rm: (p: string) => void, err: (line: string) => void): void {
  try {
    rm(path);
  } catch {
    try {
      rm(path);
    } catch (e) {
      err(
        `the throwaway profile ${path} could not be deleted (${e instanceof Error ? e.message : String(e)}); the worker’s next start removes it`,
      );
    }
  }
}

const removeTree = (p: string): void => rmSync(p, { recursive: true, force: true });

/** One first line of an error, for a page that never loaded. */
const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? '';

/** The exit code of a command stopped by SIGINT or SIGTERM (the shell's 128 + 2). */
export const EX_INTERRUPTED = 130;

class Interrupted extends Error {
  constructor() {
    super('interrupted');
    this.name = 'Interrupted';
  }
}

/** `p`, or Interrupted as soon as `signal` aborts (the watch then ends on its own, its window closed). */
function untilInterrupted<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return p;
  p.catch(() => undefined);
  if (signal.aborted) return Promise.reject(new Interrupted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Interrupted());
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** The one load, then the watch; a page that never loads (offline) or a window closed first is refused as itself. */
async function loadAndWatch(
  driver: ConsentDriver,
  url: string,
  deps: Pick<ConsentDeps, 'timers' | 'selectors' | 'clock'>,
  command: ConsentCommand,
): Promise<Judged> {
  try {
    await driver.load(url);
  } catch (e) {
    return {
      kind: 'refused',
      message: driver.closed()
        ? `the window was closed before the page loaded; ${NOTHING}`
        : `the landing page did not load (${firstLine(e)}); ${NOTHING}`,
      cooldown: null,
    };
  }
  return judgeWatch(
    await watchConsentWindow(driver, { timers: deps.timers, selectors: deps.selectors }),
    deps.clock,
    command,
  );
}

/**
 * The capture, for `consent` (`export` false) and `consent export`. Under the worker's lock; refused during a
 * cool-down, naming its end; the one page claimed through the pacer and the monthly count; the window closed and the
 * profile deleted on every path, an interruption included.
 */
export async function consentCapture(
  ctx: EntryContext,
  cfg: Pick<
    CaptureConfig,
    | 'cooldownHours'
    | 'minSpacingSeconds'
    | 'monthlyPageCap'
    | 'monthlyScrollCap'
    | 'billingDay'
    | 'pointOfSale'
  >,
  deps: ConsentDeps,
  o: { export: boolean },
): Promise<number> {
  // why: export's standard output is its one line; everything else it says goes to standard error
  const say = o.export ? ctx.err : ctx.out;
  const command: ConsentCommand = o.export ? 'pnpm gmt consent export' : 'pnpm gmt consent';
  try {
    headedEnv(deps.display, deps.platform);
  } catch (e) {
    if (!(e instanceof NoDisplay)) throw e;
    ctx.err(e.message);
    return EX_CONFIG;
  }
  let lock: { release(): void };
  try {
    lock = acquireLock(ctx.dataDir, {
      pid: deps.pid,
      ...(deps.isAlive === undefined ? {} : { isAlive: deps.isAlive }),
    });
  } catch (e) {
    ctx.err(
      e instanceof LockHeld ? `${e.message}: stop the worker first (pnpm gmt consent does)` : String(e),
    );
    return EX_CONFIG;
  }
  try {
    sweepProbeProfiles(ctx.dataDir);
    const cooldown = new CooldownStore({
      dir: ctx.dataDir,
      challengeHours: cfg.cooldownHours,
      clock: deps.clock,
    });
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
    const monthly = new MonthlyCounter({
      dir: ctx.dataDir,
      caps: { pages: cfg.monthlyPageCap, scrolls: cfg.monthlyScrollCap, billingDay: cfg.billingDay },
      clock: deps.clock,
    });
    try {
      if (deps.interrupted?.aborted === true) throw new Interrupted();
      // why: CodeRabbit (PR #18): the interruption ends the spacing wait itself, so no claim runs after the command ends
      await claim(pacer, monthly, 0, deps, { ...ctx, out: say });
    } catch (e) {
      if (deps.interrupted?.aborted === true) {
        ctx.err(`interrupted before the page loaded; ${NOTHING}`);
        return EX_INTERRUPTED;
      }
      if (!(e instanceof RecordingRefused)) throw e;
      ctx.err(e.message);
      return EX_UNAVAILABLE;
    }
    const profile = join(ctx.dataDir, `probe-consent-${Date.parse(deps.clock.now())}-${deps.pid}`);
    let judged: Judged;
    try {
      mkdirSync(profile, { recursive: true, mode: 0o700 });
      const driver = deps.consentDriver(profile);
      try {
        await driver.launchHeaded(deps.display);
        say(CONSENT_PROMPT);
        judged = await untilInterrupted(
          loadAndWatch(driver, landingUrl(cfg.pointOfSale), deps, command),
          deps.interrupted,
        );
      } finally {
        await driver.close();
        pacer.release();
      }
    } catch (e) {
      if (!(e instanceof Interrupted)) throw e;
      ctx.err(`interrupted: the window is closed and its throwaway profile deleted; ${NOTHING}`);
      return EX_INTERRUPTED;
    } finally {
      deleteProfile(profile, deps.removeProfile ?? removeTree, ctx.err);
    }
    if (judged.kind === 'refused') {
      const until = judged.cooldown === null ? null : cooldown.start(judged.cooldown).until;
      ctx.err(until === null ? judged.message : `${judged.message}; cooling down until ${until}`);
      return EX_UNAVAILABLE;
    }
    const c = judged.capture;
    if (o.export) {
      // why: CodeRabbit (PR #18): the line carries the expiry the worker would use, the earlier of the cookie's own and
      // its capture plus 13 months, so a cookie that outlives the 13 months still exports a line import accepts
      const expires = Math.min(c.expires, Math.floor(Date.parse(captureExpiry(c).expiresAt) / 1000));
      ctx.out(
        encodeConsentLine({
          socs: {
            name: 'SOCS',
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires,
            secure: c.secure,
            sameSite: c.sameSite,
          },
          capturedAt: c.capturedAt,
          mark: 'reject',
        }),
      );
      ctx.err(
        `exported the rejection captured at ${c.capturedAt} (${expiryWords(c)}): pipe the line above into pnpm gmt consent import on the other machine. It holds the cookie from a signed-out throwaway profile (only its first field is understood), its capture time and its expiry: move it by pipe, never as an argument or in a ticket`,
      );
      return 0;
    }
    try {
      const written = writeCapture(ctx.dataDir, c, deps.clock, c.capturedAt);
      ctx.out(`captured a rejection at ${written.capturedAt} (${expiryWords(written)}); written 0600`);
      return 0;
    } catch (e) {
      if (!(e instanceof ConsentNotCaptured)) throw e;
      ctx.err(e.message);
      return EX_CONFIG;
    }
  } finally {
    lock.release();
  }
}

/** `consent import`: the line from standard input only, under the worker's lock; only a rejection is written. */
export async function consentImport(
  ctx: EntryContext,
  deps: Pick<ConsentDeps, 'clock' | 'pid' | 'isAlive' | 'readStdin' | 'interrupted'>,
): Promise<number> {
  let lock: { release(): void };
  try {
    lock = acquireLock(ctx.dataDir, {
      pid: deps.pid,
      ...(deps.isAlive === undefined ? {} : { isAlive: deps.isAlive }),
    });
  } catch (e) {
    ctx.err(
      e instanceof LockHeld
        ? `${e.message}: stop the worker first (pnpm gmt consent import does)`
        : String(e),
    );
    return EX_CONFIG;
  }
  try {
    let text: string | 'too-long';
    try {
      text = await untilInterrupted(deps.readStdin(CONSENT_LINE_MAX_BYTES), deps.interrupted);
    } catch (e) {
      if (!(e instanceof Interrupted)) throw e;
      ctx.err(`interrupted before a line was read; ${NOTHING}`);
      return EX_INTERRUPTED;
    }
    if (text === 'too-long') {
      ctx.err(
        `more than ${CONSENT_LINE_MAX_BYTES} bytes on standard input: the line is one gmt-socs-v1. line; ${NOTHING}`,
      );
      return EX_CONFIG;
    }
    const line = text.trim();
    if (line === '') {
      ctx.err(`nothing on standard input: pipe in the line pnpm gmt consent export printed; ${NOTHING}`);
      return EX_CONFIG;
    }
    const decoded = decodeConsentLine(line);
    if ('error' in decoded) {
      ctx.err(`the line was refused: ${decoded.error}; ${NOTHING}`);
      return EX_CONFIG;
    }
    if (decoded.mark !== 'reject') {
      ctx.err(`the line was refused: ${notRejectionWhy(decoded.mark)}; ${NOTHING}`);
      return EX_CONFIG;
    }
    const s = decoded.socs;
    try {
      const c = writeCapture(
        ctx.dataDir,
        { value: s.value, expires: s.expires, secure: s.secure, sameSite: s.sameSite },
        deps.clock,
        decoded.capturedAt,
      );
      // why: review X2: the expiry came from the line, which export caps at the earlier of the cookie's own expiry and
      // its capture plus 13 months, so the words name the line, never the cookie alone
      ctx.out(
        `imported the rejection captured at ${c.capturedAt} (expires ${captureExpiry(c).expiresAt}, the exported line’s expiry: the earlier of the cookie’s own and its capture plus 13 months); written 0600`,
      );
      return 0;
    } catch (e) {
      if (!(e instanceof ConsentNotCaptured)) throw e;
      ctx.err(`${e.message}; ${NOTHING}`);
      return EX_CONFIG;
    }
  } finally {
    lock.release();
  }
}

/** `consent check`: the stored record, its mark and its expiry; 0 only for an in-date captured rejection. */
export function consentCheck(ctx: EntryContext, clock: Clock): number {
  const r = readConsentRecord(ctx.dataDir, clock);
  const fix = `capture one with ${CONSENT_FIX.command}`;
  if (r === null) {
    ctx.err(`consent: no record: ${fix}`);
    return EX_CONFIG;
  }
  if (r === 'invalid') {
    ctx.err(`consent: the record cannot be read (its mode, its JSON or its fields): ${fix}`);
    return EX_CONFIG;
  }
  if (r.kind === 'legacy') {
    ctx.err(
      `consent: the record is an older ${r.was} one, which this version neither writes nor uses (pages need a captured rejection): ${fix}`,
    );
    return EX_CONFIG;
  }
  const line = `consent: captured ${r.capture.capturedAt}, mark ${r.mark}, ${expiryWords(r.capture)}`;
  if (r.mark !== 'reject') {
    ctx.err(`${line}; not a rejection: ${fix}`);
    return EX_CONFIG;
  }
  if (Date.parse(r.expiresAt) <= Date.parse(clock.now())) {
    ctx.err(`${line}; expired: ${fix}`);
    return EX_CONFIG;
  }
  ctx.out(line);
  return 0;
}

/** Standard input, up to `max` bytes; `too-long` as soon as more arrives (the rest is never read). */
export async function readBounded(input: AsyncIterable<unknown>, max: number): Promise<string | 'too-long'> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of input) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c));
    total += b.length;
    if (total > max) return 'too-long';
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export const CONSENT_USAGE =
  'usage: consent [export | import | check]: consent captures here, export prints the line for another machine, import reads that line from standard input, check reports the stored record';

/** The display groups run.ts passed to this entry (decision 74's rule): only the four names, as they are. */
export function displayFrom(env: EntryContext['env']): Record<string, string> {
  const display: Record<string, string> = {};
  for (const n of DISPLAY_NAMES) {
    const v = env[n];
    if (v !== undefined) display[n] = v;
  }
  return display;
}

/** What the entry runs a capture with: the real browser, clock and timers (a test passes its own). */
export type CaptureSetup = (
  ctx: EntryContext,
  cfg: CaptureConfig,
  display: DisplayEnv,
) => ConsentDeps | { refused: string };

/** The real capture's dependencies: the pinned install (never downloaded), the headed driver, the system clock. */
export const realCaptureSetup: CaptureSetup = (ctx, cfg, display) => {
  let prepared: ReturnType<typeof prepareLaunch>;
  try {
    prepared = prepareLaunch({
      platform: process.platform,
      arch: process.arch,
      installDirSet: ctx.env.CAMOUFOX_INSTALL_DIR,
      dataDir: ctx.dataDir,
      home: cfg.home,
      path: cfg.path,
      tmp: cfg.tmp,
    });
  } catch (e) {
    if (!(e instanceof InstallRefused)) throw e;
    // why: review X4: the consent command never downloads; the one command that lays the pinned Camoufox out on any
    // machine (the app native, in Docker or absent) is gmt browser install
    return {
      refused: `${e.message}; the consent capture needs the pinned Camoufox, which pnpm gmt browser install lays out (nothing is downloaded here)`,
    };
  }
  const log = stderrLog(ctx.err, debugLogging(ctx.env));
  return {
    platform: process.platform,
    display,
    clock: systemClock,
    timers: realTimers,
    selectors: selectorsFor(prepared.osArch, prepared.install.build),
    pid: process.pid,
    consentDriver: (profile) =>
      createConsentDriver({
        platform: process.platform,
        options: prepared.options,
        profileDir: profile,
        launch: (options, p, d) => launchHeadedContext(options, p, d),
        log,
        clock: systemClock,
        timers: realTimers,
      }),
    readStdin: (max) => readBounded(process.stdin, max),
  };
};

/**
 * The command with its capture setup injected (the entry passes the real one). SIGINT and SIGTERM abort the capture or
 * the import (review X3); the handlers are removed when it ends.
 */
export async function consentEntry(
  ctx: EntryContext,
  setup: CaptureSetup = realCaptureSetup,
  signals: { on(handler: () => void): () => void } = processSignals,
): Promise<number> {
  const [sub, ...rest] = ctx.args;
  if (sub === 'import' && rest.length > 0) {
    ctx.err('consent import reads the line from standard input only; it takes no argument');
    return EX_CONFIG;
  }
  if ((sub !== undefined && !['export', 'import', 'check'].includes(sub)) || rest.length > 0) {
    ctx.err(CONSENT_USAGE);
    return EX_CONFIG;
  }
  if (sub === 'check') return consentCheck(ctx, systemClock);
  const interrupt = new AbortController();
  const off = signals.on(() => interrupt.abort());
  try {
    if (sub === 'import')
      return await consentImport(ctx, {
        clock: systemClock,
        pid: process.pid,
        readStdin: (max) => readBounded(process.stdin, max),
        interrupted: interrupt.signal,
      });
    let cfg: CaptureConfig;
    try {
      cfg = loadCaptureConfig(ctx.env);
    } catch (e) {
      if (!(e instanceof WorkerConfigError)) throw e;
      ctx.err(e.message);
      return EX_CONFIG;
    }
    const deps = setup(ctx, cfg, displayFrom(ctx.env));
    if ('refused' in deps) {
      ctx.err(deps.refused);
      return EX_CONFIG;
    }
    return await consentCapture(
      ctx,
      cfg,
      { ...deps, interrupted: interrupt.signal },
      { export: sub === 'export' },
    );
  } finally {
    off();
  }
}

/** SIGINT and SIGTERM, for as long as the command runs. */
const processSignals = {
  on(handler: () => void): () => void {
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
    return () => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
    };
  },
};

/** The command: settings from worker.env (or, for export, their defaults), the real browser, standard input. */
export const entry: Entry = (ctx) => consentEntry(ctx);
