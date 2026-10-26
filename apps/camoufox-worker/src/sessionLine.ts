import {
  billingMonthWindow,
  blockedPageSchema,
  type Clock,
  type IsoDateTime,
  isoDateTimeSchema,
  type MonthlyCounts,
  systemClock,
} from '@gmt/core';
import { z } from 'zod';
import { loadWorkerConfig, type WorkerConfig } from './config.js';
import { CooldownStore } from './cooldown.js';
import { acquireLock, LockHeld } from './lock.js';
import { current, MonthlyCounter, readCounts } from './monthly.js';
import { carryLastPageAt, Pacer } from './pacer.js';
import { type Entry, type EntryContext, EX_CONFIG, EX_UNAVAILABLE } from './run.js';
import { readBounded } from './stdin.js';

/**
 * `run.ts session export | seed | merge` (spec §2 "Recordings first"; brief WP17 Task 17.8). A recording session for
 * another `<os>-<arch>` entry (a Linux container on the operator's Mac, or the Mac under a throwaway HOME) has its own
 * data directory, but loads its pages from the operator's own address, as the host's worker does. So:
 *
 * - `export` prints this directory's state as one JSON line: the last page start, this billing window's start and its
 *   page and scroll counts, and the cool-down in force (null when none). It writes nothing.
 * - `seed` (in the session, before any page) reads the host's line on stdin and sets only this directory's last-page
 *   time, never earlier than the one it has, so the session's first page waits the spacing from the host's last; it
 *   refuses while the host's cool-down is active, naming its end.
 * - `merge` (on the host, after the session, before its worker starts again) reads the session's line on stdin and
 *   keeps the later last-page time, adds the session's pages and scrolls to this window's counts when the two windows
 *   start at the same instant (otherwise it adds none and says so), and carries an active cool-down whose end is later
 *   than the one in force, so a stop in the session pauses the host's worker too.
 *
 * Seed and merge take the worker's lock, so they refuse while that directory's worker or recorder runs, and refuse a
 * line that fails its strict schema; nothing is written then. Unreadable counts are refused as they stand (the counts
 * file's fail-closed rule).
 */
export const EX_TEMPFAIL = 75;
export const SESSION_LINE_MAX_BYTES = 4096;
const USAGE = 'usage: run.ts session export | seed | merge (seed and merge read one export line on stdin)';

const count = z.number().int().nonnegative();
export const sessionLineSchema = z.strictObject({
  lastPageAt: isoDateTimeSchema.nullable(),
  windowStart: isoDateTimeSchema,
  pages: count,
  scrolls: count,
  cooldown: z.strictObject({ until: isoDateTimeSchema, cause: blockedPageSchema }).nullable(),
});
export type SessionLine = z.infer<typeof sessionLineSchema>;

export interface SessionDeps {
  clock: Clock;
  /** Standard input, up to `max` bytes, or `too-long` past them. */
  stdin(max: number): Promise<string | 'too-long'>;
}

class SessionRefused extends Error {
  constructor(
    message: string,
    readonly code: number = EX_CONFIG,
  ) {
    super(message);
    this.name = 'SessionRefused';
  }
}

/** This window's counts, from the file (a new directory: zero), or refused as they stand. */
async function windowCounts(dir: string, cfg: WorkerConfig, now: IsoDateTime): Promise<MonthlyCounts> {
  const read = await readCounts(dir);
  if (typeof read === 'object' && 'refused' in read)
    throw new SessionRefused(
      `this directory's monthly counts are ${read.refused}: nothing is carried (pnpm gmt browser counts rewrites them)`,
    );
  if (read === 'absent') return { ...billingMonthWindow(now, cfg.billingDay), pages: 0, scrolls: 0 };
  return current(read, now, cfg.billingDay);
}

async function lineFrom(d: SessionDeps): Promise<SessionLine> {
  const text = await d.stdin(SESSION_LINE_MAX_BYTES);
  if (text === 'too-long')
    throw new SessionRefused(
      `the session line on stdin was refused: more than ${SESSION_LINE_MAX_BYTES} bytes`,
    );
  try {
    const r = sessionLineSchema.safeParse(JSON.parse(text));
    if (r.success) return r.data;
  } catch {
    // why: not JSON at all is refused below with the schema's own words
  }
  throw new SessionRefused(
    'the session line on stdin was refused: not one run.ts session export line (lastPageAt, windowStart, pages, scrolls, cooldown)',
  );
}

async function withLock<T>(dir: string, f: () => T | Promise<T>): Promise<T> {
  let lock: { release(): void };
  try {
    lock = acquireLock(dir);
  } catch (e) {
    if (e instanceof LockHeld)
      throw new SessionRefused(
        `${e.message}: another worker holds the lock; stop it first (pnpm gmt stop --only worker)`,
        EX_TEMPFAIL,
      );
    throw e;
  }
  try {
    return await f();
  } finally {
    lock.release();
  }
}

async function exportLine(ctx: EntryContext, cfg: WorkerConfig, d: SessionDeps): Promise<void> {
  const now = d.clock.now();
  const counts = await windowCounts(ctx.dataDir, cfg, now);
  const line: SessionLine = {
    lastPageAt: new Pacer({
      dir: ctx.dataDir,
      minSpacingSeconds: cfg.minSpacingSeconds,
      clock: d.clock,
    }).lastPageAt(),
    windowStart: counts.windowStart,
    pages: counts.pages,
    scrolls: counts.scrolls,
    cooldown: new CooldownStore({
      dir: ctx.dataDir,
      challengeHours: cfg.cooldownHours,
      clock: d.clock,
    }).active(),
  };
  ctx.out(JSON.stringify(line));
}

async function seed(ctx: EntryContext, d: SessionDeps): Promise<void> {
  const line = await lineFrom(d);
  if (line.cooldown !== null && Date.parse(line.cooldown.until) > Date.parse(d.clock.now()))
    throw new SessionRefused(
      `the host is cooling down until ${line.cooldown.until} (${line.cooldown.cause}); no session page is loaded before then`,
      EX_UNAVAILABLE,
    );
  const lastPageAt = await withLock(ctx.dataDir, () => {
    const at = line.lastPageAt;
    return at === null ? null : carryLastPageAt(ctx.dataDir, at, d.clock);
  });
  ctx.out(JSON.stringify({ ok: true, lastPageAt }));
}

async function merge(ctx: EntryContext, cfg: WorkerConfig, d: SessionDeps): Promise<void> {
  const line = await lineFrom(d);
  const now = d.clock.now();
  const result = await withLock(ctx.dataDir, async () => {
    const host = await windowCounts(ctx.dataDir, cfg, now);
    const countsAdded = host.windowStart === line.windowStart;
    const counts = countsAdded
      ? { ...host, pages: host.pages + line.pages, scrolls: host.scrolls + line.scrolls }
      : host;
    if (!countsAdded)
      ctx.err(
        `the windows differ (this directory ${host.windowStart}, the session ${line.windowStart}): the session's ${line.pages} pages and ${line.scrolls} scrolls are not added`,
      );
    else
      new MonthlyCounter({
        dir: ctx.dataDir,
        caps: { pages: cfg.monthlyPageCap, scrolls: cfg.monthlyScrollCap, billingDay: cfg.billingDay },
        clock: d.clock,
      }).write(counts);
    const pacer = new Pacer({ dir: ctx.dataDir, minSpacingSeconds: cfg.minSpacingSeconds, clock: d.clock });
    const lastPageAt =
      line.lastPageAt === null ? pacer.lastPageAt() : carryLastPageAt(ctx.dataDir, line.lastPageAt, d.clock);
    const store = new CooldownStore({ dir: ctx.dataDir, challengeHours: cfg.cooldownHours, clock: d.clock });
    const cooldown = line.cooldown === null ? store.active() : store.carry(line.cooldown);
    return { ok: true, countsAdded, lastPageAt, ...counts, cooldown };
  });
  ctx.out(JSON.stringify(result));
}

export async function sessionEntry(ctx: EntryContext, d: SessionDeps): Promise<number> {
  const sub = ctx.args.join(' ');
  if (sub !== 'export' && sub !== 'seed' && sub !== 'merge') {
    ctx.err(USAGE);
    return EX_CONFIG;
  }
  let cfg: WorkerConfig;
  try {
    cfg = loadWorkerConfig(ctx.env);
  } catch (e) {
    ctx.err(e instanceof Error ? e.message : String(e));
    return EX_CONFIG;
  }
  try {
    if (sub === 'export') await exportLine(ctx, cfg, d);
    else if (sub === 'seed') await seed(ctx, d);
    else await merge(ctx, cfg, d);
    return 0;
  } catch (e) {
    if (!(e instanceof SessionRefused)) throw e;
    ctx.err(e.message);
    return e.code;
  }
}

export const entry: Entry = (ctx) =>
  sessionEntry(ctx, { clock: systemClock, stdin: (max) => readBounded(process.stdin, max) });
