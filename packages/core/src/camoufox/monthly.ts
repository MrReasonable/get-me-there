import { z } from 'zod';
import { isoDateTimeSchema } from '../types/ids.js';

/**
 * The worker's monthly counts file (decision 82; W3): `<workerData>/monthly.json`, 0600. The worker reads and writes it
 * under its lock; `gmt browser counts` rewrites it only through the worker's own `counts` entry, which takes the lock and
 * this schema, so the CLI never hand-builds the file. `windowEnd` is the end of the window the counts belong to, so a
 * changed billing day or a clock step back carries them until then instead of starting at zero.
 */
export const MONTHLY_FILE = 'monthly.json';

const count = z.number().int().nonnegative();
export const monthlyCountsSchema = z.strictObject({
  windowStart: isoDateTimeSchema,
  windowEnd: isoDateTimeSchema,
  pages: count,
  scrolls: count,
});
export type MonthlyCounts = z.infer<typeof monthlyCountsSchema>;

/** What `gmt browser counts` sends the worker's `counts` entry on stdin: this window's figures. */
export const countsRewriteSchema = z.strictObject({
  pages: count.max(9_999_999),
  scrolls: count.max(9_999_999),
});
export type CountsRewrite = z.infer<typeof countsRewriteSchema>;
