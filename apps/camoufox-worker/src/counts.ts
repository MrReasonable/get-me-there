import { text } from 'node:stream/consumers';
import { type Clock, countsRewriteSchema, systemClock } from '@gmt/core';
import { loadWorkerConfig } from './config.js';
import { acquireLock, LockHeld } from './lock.js';
import { countsFact, MonthlyCounter } from './monthly.js';
import { type Entry, type EntryContext, EX_CONFIG } from './run.js';

/** EX_TEMPFAIL: another worker holds the lock; stop it first (the CLI does). */
export const EX_TEMPFAIL = 75;

/**
 * `run.ts counts --json` (W3; ca-b1-005): `gmt browser counts` rewrites the monthly counts file only through this entry,
 * so the file is written by the worker's own code, under its lock, with core's schema. stdin is one JSON object
 * `{ pages, scrolls }` (this window's figures from the ledger plus any the operator stated); the window is this
 * worker's own (its billing day, its clock). It prints `{ ok, windowStart, windowEnd, pages, scrolls }`. `--check`
 * prints the file's state, `{ counts: 'ok' | 'missing' | 'unreadable' }`, and writes nothing.
 */
export async function counts(
  ctx: EntryContext,
  d: { clock: Clock; stdin: () => Promise<string> },
): Promise<number> {
  const mode = ctx.args.join(' ');
  // why: `--check` reads the file's state alone: the start's checks name only their first refusal
  if (mode === '--check') {
    ctx.out(JSON.stringify({ counts: countsFact(ctx.dataDir) }));
    return 0;
  }
  if (mode !== '--json') {
    ctx.err('usage: run.ts counts --check | run.ts counts --json < {"pages":N,"scrolls":N}');
    return EX_CONFIG;
  }
  let billingDay: number;
  let caps: { pages: number; scrolls: number };
  try {
    const cfg = loadWorkerConfig(ctx.env);
    billingDay = cfg.billingDay;
    caps = { pages: cfg.monthlyPageCap, scrolls: cfg.monthlyScrollCap };
  } catch (e) {
    ctx.err(e instanceof Error ? e.message : String(e));
    return EX_CONFIG;
  }
  let figures: { pages: number; scrolls: number };
  try {
    const r = countsRewriteSchema.safeParse(JSON.parse(await d.stdin()));
    if (!r.success) throw new Error('not { pages, scrolls } as whole numbers');
    figures = r.data;
  } catch (e) {
    ctx.err(`the counts on stdin were refused: ${e instanceof Error ? e.message : String(e)}`);
    return EX_CONFIG;
  }
  let lock: { release(): void };
  try {
    lock = acquireLock(ctx.dataDir);
  } catch (e) {
    if (e instanceof LockHeld) {
      ctx.err('another worker holds the lock: stop it first (pnpm gmt stop --only worker)');
      return EX_TEMPFAIL;
    }
    throw e;
  }
  try {
    const monthly = new MonthlyCounter({ dir: ctx.dataDir, caps: { ...caps, billingDay }, clock: d.clock });
    const written = monthly.rewrite(figures.pages, figures.scrolls);
    ctx.out(JSON.stringify({ ok: true, ...written }));
    return 0;
  } finally {
    lock.release();
  }
}

export const entry: Entry = (ctx) => counts(ctx, { clock: systemClock, stdin: () => text(process.stdin) });
