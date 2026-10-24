import { join } from 'node:path/posix';
import { z } from 'zod';
import type { Deps } from '../deps.js';
import type { Action } from '../plan/action.js';

/**
 * The record setup keeps beside its state (spec §13; U4): what the settings file does not hold. `linger` is the answer
 * to row 7 (uninstall offers to undo it); `installed` turns true only once a setup has finished, so a failed first
 * setup or import is still judged as a fresh machine (one app per ledger); `import` names an import in progress, so a
 * plain re-run cannot skip it; `moved` says the old database is already marked moved (an import or --ignore-docker got
 * that far), so a re-run finishes the install instead of refusing over the marked volume.
 */
const recordSchema = z.object({
  linger: z.enum(['skip', 'enable']).catch('skip'),
  installed: z.boolean().catch(false),
  import: z.enum(['docker', 'db']).nullable().catch(null),
  moved: z.boolean().catch(false),
});
export type SetupRecord = z.infer<typeof recordSchema>;
const FRESH: SetupRecord = { linger: 'skip', installed: false, import: null, moved: false };

export const setupRecordPath = (deps: Deps): string => join(deps.platform.paths.state, 'setup.json');

export function readSetupRecord(deps: Deps): SetupRecord {
  const text = deps.files.read(setupRecordPath(deps));
  if (text === null) return FRESH;
  try {
    const r = recordSchema.safeParse({ ...FRESH, ...JSON.parse(text) });
    return r.success ? r.data : FRESH;
  } catch {
    // why: a record that is not JSON was not written by setup; the machine is read as fresh, never as installed
    return FRESH;
  }
}

/** The write that records `r`, or null when the file already says so. */
export function recordAction(deps: Deps, r: SetupRecord): Action | null {
  const contents = `${JSON.stringify(r)}\n`;
  return deps.files.read(setupRecordPath(deps)) === contents
    ? null
    : { kind: 'writeFile', path: setupRecordPath(deps), contents, mode: 0o644, secret: false };
}
