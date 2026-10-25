import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  billingMonthWindow,
  type Clock,
  type IsoDateTime,
  MONTHLY_FILE,
  type MonthlyCounts,
  monthlyCountsSchema,
} from '@gmt/core';
import { writePrivateFile } from './privateFile.js';

export type { MonthlyCounts };
/**
 * The worker's own monthly caps, for every caller together (spec §2 "Caps across callers"; decision 82; brief WP17
 * Task 17.3). The counts of the ledger's billing month (`billingMonthWindow`, 00:00 UTC on CAMOUFOX_BILLING_DAY, core's
 * one rule the ledger's window query is tested to agree with) live in `<data>/monthly.json` (0600, core's
 * `monthlyCountsSchema`, beside the pacer's file). Under the worker's lock and before anything loads, a page is
 * admitted only while the page cap has room, and its scroll allowance is clamped to what the scroll cap leaves (0
 * still reads the first block); the page and its allowance are written before the load and settle to the scrolls made
 * afterwards, so a crash over-counts and never under-counts. Counts start at zero only once the window they belong to
 * has ended (W3): a changed billing day or a clock step back carries them, never resets them. The file fails closed:
 * missing beside an existing pacer file (an earlier worker's data), unreadable, invalid, or wider than 0600, every page
 * is refused (`counts-unreadable`, never a cap reached) and the file is left exactly as it is; `gmt browser counts`
 * rewrites it from the ledger. Only a new install (neither file there) starts the window at zero.
 */
export { MONTHLY_FILE };

const PACER_FILE = 'pacer.json';

export interface MonthlyCaps {
  pages: number;
  scrolls: number;
  billingDay: number;
}
/** Why the counts file refused: missing beside an earlier worker's pacer file, or there but unreadable. */
export type CountsProblem = 'missing' | 'unreadable';
export type Admission =
  | { kind: 'ok'; scrollAllowance: number; reserved: MonthlyCounts }
  | { kind: 'monthly-cap'; cap: number; used: number; windowEnd: IsoDateTime }
  | { kind: 'counts-unreadable'; problem: CountsProblem };

/**
 * Pure: the counts now's window starts from. Stored counts whose window ended at or before now's window started are a
 * new window at zero; any other stored window (a billing day changed part way, or a clock stepped back) carries its
 * counts into now's window, which ends no earlier than the stored one: over-counting is the safe direction.
 */
export function current(c: MonthlyCounts, now: IsoDateTime, billingDay: number): MonthlyCounts {
  const w = billingMonthWindow(now, billingDay);
  if (c.windowStart === w.windowStart && c.windowEnd === w.windowEnd) return c;
  if (Date.parse(c.windowEnd) <= Date.parse(w.windowStart)) return { ...w, pages: 0, scrolls: 0 };
  const end = Date.parse(c.windowEnd) > Date.parse(w.windowEnd) ? c.windowEnd : w.windowEnd;
  return { windowStart: w.windowStart, windowEnd: end, pages: c.pages, scrolls: c.scrolls };
}

/** Pure: a page is refused only on the page cap; its scroll allowance is what the scroll cap leaves, at most the request. */
export function admit(
  c: MonthlyCounts,
  caps: MonthlyCaps,
  now: IsoDateTime,
  scrollRequest: number,
): Admission {
  const cur = current(c, now, caps.billingDay);
  if (cur.pages >= caps.pages)
    return { kind: 'monthly-cap', cap: caps.pages, used: cur.pages, windowEnd: cur.windowEnd };
  const scrollAllowance = Math.max(0, Math.min(scrollRequest, caps.scrolls - cur.scrolls));
  return {
    kind: 'ok',
    scrollAllowance,
    reserved: { ...cur, pages: cur.pages + 1, scrolls: cur.scrolls + scrollAllowance },
  };
}

/** Pure: the reservation less the allowance the page did not use (`scrollsMade` read within 0 and the allowance). */
export function settle(reserved: MonthlyCounts, allowance: number, scrollsMade: number): MonthlyCounts {
  const made = Math.max(0, Math.min(allowance, scrollsMade));
  return { ...reserved, scrolls: reserved.scrolls - (allowance - made) };
}

/** The counts file's contents, or what refuses it; never throws. */
function readSync(dir: string): MonthlyCounts | 'absent' | { refused: CountsProblem } {
  const file = join(dir, MONTHLY_FILE);
  if (!existsSync(file)) return existsSync(join(dir, PACER_FILE)) ? { refused: 'missing' } : 'absent';
  let raw: unknown;
  try {
    // why: anything beyond the owner's read and write is a widened mode, and the file is refused as it stands
    if ((statSync(file).mode & 0o777 & ~0o600) !== 0) return { refused: 'unreadable' };
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { refused: 'unreadable' };
  }
  const r = monthlyCountsSchema.safeParse(raw);
  return r.success ? r.data : { refused: 'unreadable' };
}

/**
 * Reads the file: 'absent' only when no pacer file exists either; a missing file beside a pacer file is refused as
 * missing, and invalid JSON, a schema failure, a mode wider than 0600 or a read error as unreadable; the file is left
 * as it is.
 */
export async function readCounts(
  dir: string,
): Promise<MonthlyCounts | 'absent' | { refused: CountsProblem }> {
  return readSync(dir);
}

/** The counts problem the start checks read: none, or why the file refused. */
export function countsFact(dir: string): 'ok' | CountsProblem {
  const read = readSync(dir);
  return typeof read === 'object' && 'refused' in read ? read.refused : 'ok';
}

/** The window's counts as `/v1/status` reports them; `readable` false when the file refused. */
export interface MonthlyStatus {
  windowStart: IsoDateTime;
  windowEnd: IsoDateTime;
  pages: number;
  scrolls: number;
  readable: boolean;
}

/**
 * The counter over one data directory. Its check and its reservation are synchronous, so two callers in this process
 * can never both take the last page (each reads what the other wrote); the worker's lock keeps other processes out.
 */
export class MonthlyCounter {
  private readonly file: string;
  /**
   * Whether this counter found a new install (neither file): the pacer's file this process then writes before the
   * first reservation does not make the counts "missing" (a check after the pacer's claim reads them as new).
   */
  private fresh = false;
  constructor(private readonly o: { dir: string; caps: MonthlyCaps; clock: Clock }) {
    this.file = join(o.dir, MONTHLY_FILE);
  }

  private read(): MonthlyCounts | 'absent' | { refused: CountsProblem } {
    const r = readSync(this.o.dir);
    if (r === 'absent') this.fresh = true;
    return this.fresh && typeof r === 'object' && 'refused' in r && r.refused === 'missing' ? 'absent' : r;
  }

  /** Admits a page asking for `scrollRequest` scrolls, or says why not (the counts file left unchanged). */
  check(scrollRequest: number): Admission {
    const read = this.read();
    if (typeof read === 'object' && 'refused' in read)
      return { kind: 'counts-unreadable', problem: read.refused };
    const now = this.o.clock.now();
    const counts =
      read === 'absent' ? { ...billingMonthWindow(now, this.o.caps.billingDay), pages: 0, scrolls: 0 } : read;
    return admit(counts, this.o.caps, now, scrollRequest);
  }

  /** Writes counts through the worker's one private-file write. */
  write(c: MonthlyCounts): void {
    writePrivateFile(this.file, JSON.stringify(monthlyCountsSchema.parse(c)));
  }

  /** `check` then, when admitted, the reservation written before anything loads. */
  async admit(scrollRequest: number): Promise<Admission> {
    const a = this.check(scrollRequest);
    if (a.kind === 'ok') this.write(a.reserved);
    return a;
  }

  /** After the page: the counts settle to the scrolls it made (only while the reservation is still the file's window). */
  settle(reserved: MonthlyCounts, allowance: number, scrollsMade: number): void {
    const read = this.read();
    if (read === 'absent' || 'refused' in read || read.windowStart !== reserved.windowStart) return;
    this.write(settle(read, allowance, scrollsMade));
  }

  /** `gmt browser counts`: this window's figures from the ledger replace the file (the caller holds the lock). */
  rewrite(pages: number, scrolls: number): MonthlyCounts {
    const c = { ...billingMonthWindow(this.o.clock.now(), this.o.caps.billingDay), pages, scrolls };
    this.write(c);
    return c;
  }

  status(): MonthlyStatus {
    const now = this.o.clock.now();
    const read = this.read();
    const cur =
      read === 'absent' || 'refused' in read
        ? { ...billingMonthWindow(now, this.o.caps.billingDay), pages: 0, scrolls: 0 }
        : current(read, now, this.o.caps.billingDay);
    return {
      windowStart: cur.windowStart,
      windowEnd: cur.windowEnd,
      pages: cur.pages,
      scrolls: cur.scrolls,
      readable: read === 'absent' || !('refused' in read),
    };
  }

  get caps(): MonthlyCaps {
    return this.o.caps;
  }
}

/**
 * Decision 82: the app instances that called the worker in the current billing window (each app sends its database's
 * own random id as APP_INSTANCE_HEADER). A second one is reported in `/v1/status`, never refused. Each id is kept only
 * as its SHA-256, in `<data>/app-instances.json` (0600); an unreadable file starts the window's list afresh.
 */
export const INSTANCES_FILE = 'app-instances.json';
const INSTANCE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export class AppInstances {
  private readonly file: string;
  constructor(private readonly o: { dir: string; billingDay: number; clock: Clock }) {
    this.file = join(o.dir, INSTANCES_FILE);
  }

  private current(): { windowStart: IsoDateTime; ids: string[] } {
    const { windowStart } = billingMonthWindow(this.o.clock.now(), this.o.billingDay);
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'windowStart' in raw &&
        raw.windowStart === windowStart &&
        'ids' in raw &&
        Array.isArray(raw.ids) &&
        raw.ids.every((x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x))
      )
        return { windowStart, ids: raw.ids.filter((x): x is string => typeof x === 'string') };
    } catch {
      // why: no file yet, or one this worker cannot read: the window's list starts afresh (a report, never a refusal)
    }
    return { windowStart, ids: [] };
  }

  /** Records a well-formed instance id for the current window; anything else is ignored. */
  seen(id: string): void {
    if (!INSTANCE_ID.test(id)) return;
    const digest = createHash('sha256').update(id).digest('hex');
    const c = this.current();
    if (c.ids.includes(digest)) return;
    writePrivateFile(this.file, JSON.stringify({ windowStart: c.windowStart, ids: [...c.ids, digest] }));
  }

  status(): { windowStart: IsoDateTime; count: number } {
    const c = this.current();
    return { windowStart: c.windowStart, count: c.ids.length };
  }
}
