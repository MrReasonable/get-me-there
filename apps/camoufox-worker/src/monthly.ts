import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { billingMonthWindow, type Clock, type IsoDateTime, isoDateTimeSchema } from '@gmt/core';

/**
 * The worker's own monthly caps, for every caller together (spec §2 "Caps across callers"; decision 82; brief WP17
 * Task 17.3). The counts of the ledger's billing month (`billingMonthWindow`, 00:00 UTC on CAMOUFOX_BILLING_DAY, core's
 * one rule the ledger's window query is tested to agree with) live in `<data>/monthly.json` (0600, beside the pacer's
 * file). Under the worker's lock and before anything loads, a page is admitted only while the page cap has room, and
 * its scroll allowance is clamped to what the scroll cap leaves (0 still reads the first block); the page and its
 * allowance are written before the load and settle to the scrolls made afterwards, so a crash over-counts and never
 * under-counts. The file fails closed: missing beside an existing pacer file, unreadable, invalid, or wider than 0600,
 * every page is refused (`monthly-cap`) and the file is left exactly as it is, never rewritten with zeros. Only a new
 * install (neither file there) starts the window at zero.
 */
export const MONTHLY_FILE = 'monthly.json';
const PACER_FILE = 'pacer.json';

export interface MonthlyCounts {
  windowStart: IsoDateTime;
  pages: number;
  scrolls: number;
}
export interface MonthlyCaps {
  pages: number;
  scrolls: number;
  billingDay: number;
}
export type Admission =
  | { kind: 'ok'; scrollAllowance: number; reserved: MonthlyCounts }
  | { kind: 'monthly-cap' };

/**
 * Pure: counts from another window are a new window at zero. A page is refused only on the page cap; its scroll
 * allowance is what the scroll cap leaves, at most `scrollRequest`.
 */
export function admit(
  c: MonthlyCounts,
  caps: MonthlyCaps,
  now: IsoDateTime,
  scrollRequest: number,
): Admission {
  const { windowStart } = billingMonthWindow(now, caps.billingDay);
  const cur = c.windowStart === windowStart ? c : { windowStart, pages: 0, scrolls: 0 };
  if (cur.pages >= caps.pages) return { kind: 'monthly-cap' };
  const scrollAllowance = Math.max(0, Math.min(scrollRequest, caps.scrolls - cur.scrolls));
  return {
    kind: 'ok',
    scrollAllowance,
    reserved: { windowStart, pages: cur.pages + 1, scrolls: cur.scrolls + scrollAllowance },
  };
}

/** Pure: the reservation less the allowance the page did not use (`scrollsMade` read within 0 and the allowance). */
export function settle(reserved: MonthlyCounts, allowance: number, scrollsMade: number): MonthlyCounts {
  const made = Math.max(0, Math.min(allowance, scrollsMade));
  return { ...reserved, scrolls: reserved.scrolls - (allowance - made) };
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The counts file's text, or what refuses it; never throws. */
function readSync(dir: string): MonthlyCounts | 'absent' | 'refused' {
  const file = join(dir, MONTHLY_FILE);
  if (!existsSync(file)) return existsSync(join(dir, PACER_FILE)) ? 'refused' : 'absent';
  let raw: unknown;
  try {
    // why: anything beyond the owner's read and write is a widened mode, and the file is refused as it stands
    if ((statSync(file).mode & 0o777 & ~0o600) !== 0) return 'refused';
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return 'refused';
  }
  if (typeof raw !== 'object' || raw === null) return 'refused';
  const keys = Object.keys(raw).sort().join(',');
  const start = isoDateTimeSchema.safeParse('windowStart' in raw ? raw.windowStart : undefined);
  const pages = 'pages' in raw ? raw.pages : undefined;
  const scrolls = 'scrolls' in raw ? raw.scrolls : undefined;
  if (keys !== 'pages,scrolls,windowStart' || !start.success || !isCount(pages) || !isCount(scrolls))
    return 'refused';
  return { windowStart: start.data, pages, scrolls };
}

/**
 * Reads the file: 'absent' only when no pacer file exists either; a missing file beside a pacer file, invalid JSON, a
 * schema failure, a mode wider than 0600 or a read error is 'refused', and the file is left as it is.
 */
export async function readCounts(dir: string): Promise<MonthlyCounts | 'absent' | 'refused'> {
  return readSync(dir);
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
  constructor(private readonly o: { dir: string; caps: MonthlyCaps; clock: Clock }) {
    this.file = join(o.dir, MONTHLY_FILE);
  }

  /** Admits a page asking for `scrollRequest` scrolls, or says it is refused (the counts file left unchanged). */
  check(scrollRequest: number): Admission {
    const read = readSync(this.o.dir);
    if (read === 'refused') return { kind: 'monthly-cap' };
    const now = this.o.clock.now();
    const counts =
      read === 'absent'
        ? { windowStart: billingMonthWindow(now, this.o.caps.billingDay).windowStart, pages: 0, scrolls: 0 }
        : read;
    return admit(counts, this.o.caps, now, scrollRequest);
  }

  /** Writes counts (a temporary file, 0600, then a rename). */
  write(c: MonthlyCounts): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(c), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  /** `check` then, when admitted, the reservation written before anything loads. */
  async admit(scrollRequest: number): Promise<Admission> {
    const a = this.check(scrollRequest);
    if (a.kind === 'ok') this.write(a.reserved);
    return a;
  }

  /** After the page: the counts settle to the scrolls it made (only while the reservation is still the file's window). */
  settle(reserved: MonthlyCounts, allowance: number, scrollsMade: number): void {
    const read = readSync(this.o.dir);
    if (read === 'refused' || read === 'absent' || read.windowStart !== reserved.windowStart) return;
    this.write(settle(read, allowance, scrollsMade));
  }

  status(): MonthlyStatus {
    const now = this.o.clock.now();
    const w = billingMonthWindow(now, this.o.caps.billingDay);
    const read = readSync(this.o.dir);
    const current = typeof read === 'object' && read.windowStart === w.windowStart ? read : null;
    return {
      windowStart: w.windowStart,
      windowEnd: w.windowEnd,
      pages: current?.pages ?? 0,
      scrolls: current?.scrolls ?? 0,
      readable: read !== 'refused',
    };
  }

  /** The current window's end, for a refused page's answer. */
  windowEnd(): IsoDateTime {
    return billingMonthWindow(this.o.clock.now(), this.o.caps.billingDay).windowEnd;
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
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ windowStart: c.windowStart, ids: [...c.ids, digest] }), {
      mode: 0o600,
    });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.file);
  }

  status(): { windowStart: IsoDateTime; count: number } {
    const c = this.current();
    return { windowStart: c.windowStart, count: c.ids.length };
  }
}
