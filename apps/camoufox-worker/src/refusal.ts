import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type Clock, type IsoDateTime, isoDateTimeSchema } from '@gmt/core';
import { writePrivateFile } from './privateFile.js';

/**
 * The persisted signed-in refusal (spec §2 "the worker refuses to serve until the operator clears a persisted flag after
 * wiping the profile"; devops-011). Set when a page shows a signed-in account control or the profile holds an account
 * cookie; it survives restarts and is cleared only by `clear-signed-in`, which wipes the profile first. An unreadable
 * record stands as a refusal (fail closed).
 */
const FILE = 'signed-in-refusal.json';

export interface RefusalRecord {
  reason: string;
  since: IsoDateTime;
}

export class Refusal {
  private readonly path: string;
  constructor(private readonly o: { dir: string; clock: Clock }) {
    this.path = join(o.dir, FILE);
  }

  active(): RefusalRecord | null {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return null;
      throw e;
    }
    try {
      const raw: unknown = JSON.parse(text);
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'reason' in raw &&
        'since' in raw &&
        typeof raw.reason === 'string'
      ) {
        const since = isoDateTimeSchema.safeParse(raw.since);
        if (since.success) return { reason: raw.reason, since: since.data };
      }
    } catch {
      // why: fall through: a record nobody can read still refuses.
    }
    return { reason: 'unreadable refusal record', since: this.o.clock.now() };
  }

  set(reason: string): RefusalRecord {
    const rec = { reason, since: this.o.clock.now() };
    writePrivateFile(this.path, JSON.stringify(rec));
    return rec;
  }

  clear(): void {
    rmSync(this.path, { force: true });
  }
}
