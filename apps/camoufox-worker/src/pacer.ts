import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Clock, type IsoDateTime, isoDateTimeSchema } from '@gmt/core';
import { writePrivateFile } from './privateFile.js';
import { type Deadline, DeadlineExceeded, type Timers } from './timers.js';

/**
 * The start-to-start pacer (spec §2 "at least CAMOUFOX_MIN_SPACING_SECONDS from the start of one page load to the start
 * of the next"; decision 69 ruling 7; PIE-R2-07). At most `capacity` pages at once (CAMOUFOX_PAGES_AT_ONCE for the
 * worker, 1 for every other caller); a claim passes at least `spacing − 2 s` after the last start, whichever page made
 * it (a fixed tolerance for arrival jitter, never randomised; with spacing 0 only the capacity refuses); the last start
 * is persisted in `<data>/pacer.json` so a restart keeps the spacing, and the recorder shares it. An unreadable record
 * fails closed: the last page is treated as now.
 */
export const TOLERANCE_MS = 2000;
const FILE = 'pacer.json';

export type Claim = { ok: true } | { ok: false; retryAfterSeconds: number };

export class Pacer {
  private readonly path: string;
  /**
   * The spacing in ms (CAMOUFOX_MIN_SPACING_SECONDS), read-only (WP21 Task 21.0, preflight P6): a page that may load
   * further documents budgets one spacing for each from it.
   */
  readonly spacingMs: number;
  private readonly clock: Clock;
  private readonly capacity: number;
  /** Pages holding a claim now. */
  private claimed = 0;

  constructor(o: { dir: string; minSpacingSeconds: number; clock: Clock; capacity?: number }) {
    if (!Number.isInteger(o.minSpacingSeconds) || o.minSpacingSeconds < 0 || o.minSpacingSeconds > 600)
      throw new Error('CAMOUFOX_MIN_SPACING_SECONDS must be a whole number from 0 to 600');
    const capacity = o.capacity ?? 1;
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error('the pacer’s capacity must be a whole number of at least 1');
    this.path = join(o.dir, FILE);
    this.spacingMs = o.minSpacingSeconds * 1000;
    this.clock = o.clock;
    this.capacity = capacity;
  }

  /** The last page start, or null when none was recorded; an unreadable record reads as now (fail closed). */
  lastPageAt(): IsoDateTime | null {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
      throw e;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return this.clock.now();
    }
    const at =
      typeof raw === 'object' && raw !== null && 'lastPageAt' in raw
        ? isoDateTimeSchema.safeParse(raw.lastPageAt)
        : null;
    return at?.success === true ? at.data : this.clock.now();
  }

  /** Claims the next page start, or says how long to wait (whole seconds, at least 1). */
  claim(): Claim {
    const now = Date.parse(this.clock.now());
    if (this.isBusy()) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(this.spacingMs / 1000)) };
    const last = this.lastPageAt();
    // why: spacing 0 (operator, 2026-10-25) is no pause at all: a claim passes while the capacity allows, and the
    // record below is still written so the last-page time stays right
    if (last !== null && this.spacingMs > 0) {
      const wait = Date.parse(last) + this.spacingMs - TOLERANCE_MS - now;
      if (wait > 0) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
    }
    writePrivateFile(this.path, JSON.stringify({ lastPageAt: this.clock.now() }));
    // why: claimed only once the record is written, so a failed write never wedges the pacer (CodeRabbit, fix round 1)
    this.claimed += 1;
    return { ok: true };
  }

  /**
   * WP21 Task 21.0 (spec §2: the spacing runs from the start of one document load to the start of the next): for the
   * page in flight, before it loads a further document (the list page again, or a selection that may load one). Waits
   * until `spacing − TOLERANCE_MS` after the last recorded start, under `d`, then records the new start; with spacing
   * 0 it records and returns at once. A wait that would reach `d`'s end throws DeadlineExceeded at once and records
   * nothing, so the caller ends that step as the spacing's, with the page's own deadline untouched.
   */
  async reclaim(d: Deadline, timers: Timers): Promise<void> {
    // why: CodeRabbit on PR #49: another page may start while this one waits, so the last start is read again after
    // every wait until no wait is left
    for (;;) {
      const last = this.lastPageAt();
      if (last === null || this.spacingMs === 0) break;
      const wait = Date.parse(last) + this.spacingMs - TOLERANCE_MS - Date.parse(this.clock.now());
      if (wait <= 0) break;
      // why: a wait the step's budget cannot cover would only idle the open page; it ends the step now instead (a wait of
      // exactly what is left would end with the deadline, so it is refused too)
      if (wait >= d.remaining()) throw new DeadlineExceeded('the spacing outlasts the step budget');
      await d.race(timers.sleep(wait, d.signal));
    }
    writePrivateFile(this.path, JSON.stringify({ lastPageAt: this.clock.now() }));
  }

  /** Ends one page in flight; the spacing still runs from the last start. */
  release(): void {
    this.claimed = Math.max(0, this.claimed - 1);
  }

  /** True while `capacity` pages hold a claim, so the next claim is refused whatever the spacing. */
  isBusy(): boolean {
    return this.claimed >= this.capacity;
  }
}

/**
 * WP17 Task 17.8 (`run.ts session seed` and `merge`): carries a last page start from another data directory into this
 * one's record, keeping the later of the two, so a carried time never shortens the spacing. An unreadable record reads
 * as now, as the pacer reads it (fail closed). Returns the time now recorded.
 */
export function carryLastPageAt(dir: string, at: IsoDateTime, clock: Clock): IsoDateTime {
  // why: the pacer's own reading of its file (spacing 0: only the reader is used, and every spacing reads alike)
  const current = new Pacer({ dir, minSpacingSeconds: 0, clock }).lastPageAt();
  if (current !== null && Date.parse(current) >= Date.parse(at)) return current;
  writePrivateFile(join(dir, FILE), JSON.stringify({ lastPageAt: at }));
  return at;
}
