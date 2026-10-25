import { join } from 'node:path/posix';
import type { Deps } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import { freeBytesAt, osArchOf, planCamoufoxUpdate } from './install.js';
import { planLayout } from './layout.js';
import { libraryProblem } from './libs.js';
import { manifestArgv, parseManifest } from './manifest.js';

/**
 * `gmt update`'s Camoufox step (spec §13: after the build, before the restart; decision 73). Nothing is read or done
 * where no Camoufox is installed. Otherwise the new code's own pin is read (`printManifest.ts`), and a changed pin is
 * installed only when its flags are set, its layout switched now and the previous bundles removed after the health wait
 * (`after`); a pin without flags installs nothing and keeps the old bundle, saying so.
 */
export type BrowserStep = { ok: true; after: Action[] } | { ok: false; message: string };

export async function camoufoxUpdateStep(deps: Deps): Promise<BrowserStep> {
  const os = deps.platform.os;
  const osArch = osArchOf(deps.platform);
  if (os === 'win32' || osArch === null) return { ok: true, after: [] };
  const root = deps.platform.paths.camoufoxRoot;
  if ((deps.files.list(join(root, 'browsers', 'official')) ?? []).length === 0)
    return { ok: true, after: [] };
  const read = await deps.run(manifestArgv(deps.execPath, deps.checkout, osArch), {
    cwd: join(deps.checkout, 'apps', 'cli'),
    timeoutMs: 120_000,
    env: deps.childEnv,
  });
  const manifest = read.code === 0 ? parseManifest(read.stdout) : null;
  if (manifest === null) return { ok: false, message: 'the new code’s Camoufox pin could not be read' };
  const random = deps.randomBytes(4).toString('hex');
  const step = planCamoufoxUpdate({
    os,
    osArch,
    root,
    entry: manifest.entry,
    formVerified: manifest.flags.FORM_VERIFIED,
    files: deps.files,
    freeBytes: await freeBytesAt(deps.run, deps.files, root),
    random,
    layout: (bundle) => planLayout({ os, root, bundle, entry: manifest.entry, files: deps.files, random }),
  });
  if (step.kind === 'none') return { ok: true, after: [] };
  if (step.kind === 'refused') return { ok: false, message: step.message };
  if (step.kind === 'stays-off') {
    deps.io.out(`${step.note}\n`);
    return { ok: true, after: [] };
  }
  if (step.kind === 'install') deps.io.out(`${step.note}\n`);
  const command = 'update: the browser install';
  const r = await apply({ command, actions: step.actions, notes: [] }, deps.executor);
  if (r.failed !== null) return { ok: false, message: describeResult(command, r) };
  if (step.kind === 'current') return { ok: true, after: [] };
  if (os === 'linux') {
    // why: the app runs without the browser provider; the worker refuses to start until the libraries are there
    const libs = await libraryProblem(deps.run, deps.files, step.bundle);
    if (libs !== null) deps.io.err(`${libs}\n`);
  }
  return { ok: true, after: step.after };
}
