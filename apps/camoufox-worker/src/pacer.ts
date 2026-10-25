import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Clock, type IsoDateTime, isoDateTimeSchema } from '@gmt/core';
import { writePrivateFile } from './privateFile.js';

/**
 * The start-to-start pacer (spec §2 "at least CAMOUFOX_MIN_SPACING_SECONDS from the start of one page load to the start
 * of the next"; decision 69 ruling 7; PIE-R2-07). One page at a time; a claim passes at least `spacing − 2 s` after the
 * last start (a fixed tolerance for arrival jitter, never randomised; with spacing 0 a claim always passes); the last start is persisted in
 * `<data>/pacer.json` so a restart keeps the spacing, and the recorder shares it. An unreadable record fails closed: the
 * last page is treated as now.
 */
export const TOLERANCE_MS = 2000;
const FILE = 'pacer.json';

export type Claim = { ok: true } | { ok: false; retryAfterSeconds: number };

export class Pacer {
  private readonly path: string;
  private readonly spacingMs: number;
  private readonly clock: Clock;
  private busy = false;

  constructor(o: { dir: string; minSpacingSeconds: number; clock: Clock }) {
    if (!Number.isInteger(o.minSpacingSeconds) || o.minSpacingSeconds < 0 || o.minSpacingSeconds > 600)
      throw new Error('CAMOUFOX_MIN_SPACING_SECONDS must be a whole number from 0 to 600');
    this.path = join(o.dir, FILE);
    this.spacingMs = o.minSpacingSeconds * 1000;
    this.clock = o.clock;
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
    if (this.busy) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(this.spacingMs / 1000)) };
    const last = this.lastPageAt();
    // why: spacing 0 (operator, 2026-10-25) is no pause at all: a claim passes, still one page at a time, and the
    // record below is still written so the last-page time stays right
    if (last !== null && this.spacingMs > 0) {
      const wait = Date.parse(last) + this.spacingMs - TOLERANCE_MS - now;
      if (wait > 0) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) };
    }
    writePrivateFile(this.path, JSON.stringify({ lastPageAt: this.clock.now() }));
    // why: busy only once the record is written, so a failed write never wedges the pacer (CodeRabbit, fix round 1)
    this.busy = true;
    return { ok: true };
  }

  /** Ends the page in flight; the spacing still runs from its start. */
  release(): void {
    this.busy = false;
  }

  isBusy(): boolean {
    return this.busy;
  }
}
