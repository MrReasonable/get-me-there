import { chmodSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type BlockedPage,
  blockedPageSchema,
  type Clock,
  type IsoDateTime,
  isoDateTimeOfEpochMs,
  isoDateTimeSchema,
} from '@gmt/core';

/**
 * The cool-down store (spec §2 "Navigation and the stops"; decision 69 "Cool-downs by cause"): a stop pauses every
 * page load for CAMOUFOX_COOLDOWN_HOURS (default 48, at least 24) after a bot check, a sign-in wall, a signed-in
 * control, a consent page or an off-allowlist navigation, and for a fixed 1 hour after an unrecognised page. Persisted
 * in `<data>/cooldown.json` (written atomically, 0600), so it survives a restart; an unreadable record fails closed to
 * a fresh bot-length cool-down with cause `unrecognised`; any read error other than "no file" is thrown, never read as
 * "no cool-down".
 */
export const UNRECOGNISED_HOURS = 1;
const HOUR_MS = 3_600_000;
const FILE = 'cooldown.json';

export interface CooldownRecord {
  until: IsoDateTime;
  cause: BlockedPage;
}

function isMissing(e: unknown): boolean {
  return e instanceof Error && 'code' in e && e.code === 'ENOENT';
}

function parseRecord(text: string): CooldownRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || !('until' in raw) || !('cause' in raw)) return null;
  const until = isoDateTimeSchema.safeParse(raw.until);
  const cause = blockedPageSchema.safeParse(raw.cause);
  return until.success && cause.success ? { until: until.data, cause: cause.data } : null;
}

export class CooldownStore {
  private readonly path: string;
  private readonly botHours: number;
  private readonly clock: Clock;

  constructor(o: { dir: string; botHours: number; clock: Clock }) {
    if (!Number.isInteger(o.botHours) || o.botHours < 24)
      throw new Error('CAMOUFOX_COOLDOWN_HOURS must be a whole number of at least 24');
    this.path = join(o.dir, FILE);
    this.botHours = o.botHours;
    this.clock = o.clock;
  }

  /** The hours a stop of this kind pauses for. */
  hoursFor(cause: BlockedPage): number {
    return cause === 'unrecognised' ? UNRECOGNISED_HOURS : this.botHours;
  }

  private read(): CooldownRecord | null {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
    const rec = parseRecord(text);
    if (rec !== null) return rec;
    // why: fail closed: a record nobody can read is a cool-down, not its absence.
    return this.write({ until: this.endFrom('captcha'), cause: 'unrecognised' });
  }

  private endFrom(cause: BlockedPage): IsoDateTime {
    return isoDateTimeOfEpochMs(Date.parse(this.clock.now()) + this.hoursFor(cause) * HOUR_MS);
  }

  private write(rec: CooldownRecord): CooldownRecord {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
    return rec;
  }

  /** The active cool-down, or null once its end has passed. */
  active(): CooldownRecord | null {
    const rec = this.read();
    if (rec === null || Date.parse(rec.until) <= Date.parse(this.clock.now())) return null;
    return rec;
  }

  /**
   * Starts a cool-down for `cause` and returns the end in force. A later, shorter cool-down never shortens a longer
   * one; equal ends keep the record already there, so the earlier cause stands (TS2-06).
   */
  start(cause: BlockedPage): CooldownRecord {
    const current = this.active();
    const end = this.endFrom(cause);
    if (current !== null && Date.parse(current.until) >= Date.parse(end)) return current;
    return this.write({ until: end, cause });
  }
}
