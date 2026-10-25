import { rmSync } from 'node:fs';
import { type IsoDateTime, type StartRefusal, type StartRefusalReason, startRefusalSchema } from '@gmt/core';
import { startRefusalFile } from './paths.js';
import { writePrivateFile } from './privateFile.js';

/**
 * The worker's refusal file (decision 75; brief WP17 Task 17.2): before every exit 78 the worker writes
 * `<workerData>/start-refusal.json` (0600, `{ reason, at }` only: no message, no path, no secret), and a successful
 * start removes it. Its own module, so run.ts can write a `config` refusal without loading the start checks.
 */
export function writeStartRefusal(
  dataDir: string,
  reason: StartRefusalReason,
  at: IsoDateTime,
): StartRefusal {
  const r = startRefusalSchema.parse({ reason, at });
  writePrivateFile(startRefusalFile(dataDir), JSON.stringify(r));
  return r;
}

export function clearStartRefusal(dataDir: string): void {
  rmSync(startRefusalFile(dataDir), { force: true });
}
