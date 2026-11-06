import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { billingMonthWindow, type Clock, type IsoDateTime } from '@gmt/core';
import { writePrivateFile } from './privateFile.js';

/**
 * Decision 82: the app instances that called the worker in the current calendar month (from 00:00 UTC on the 1st; each
 * app sends its database's own random id as APP_INSTANCE_HEADER). A second one is reported in `/v1/status`, never
 * refused. Each id is kept only as its SHA-256, in `<data>/app-instances.json` (0600); an unreadable file starts the
 * month's list afresh.
 */
export const INSTANCES_FILE = 'app-instances.json';
const INSTANCE_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** The month's first day: the window is the calendar month. */
const FIRST_DAY = 1;

export class AppInstances {
  private readonly file: string;
  constructor(private readonly o: { dir: string; clock: Clock }) {
    this.file = join(o.dir, INSTANCES_FILE);
  }

  private current(): { windowStart: IsoDateTime; ids: string[] } {
    const { windowStart } = billingMonthWindow(this.o.clock.now(), FIRST_DAY);
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
      // why: no file yet, or one this worker cannot read: the month's list starts afresh (a report, never a refusal)
    }
    return { windowStart, ids: [] };
  }

  /** Records a well-formed instance id for the current month; anything else is ignored. */
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
