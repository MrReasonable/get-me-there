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
 * `gmt update`'s Camoufox step (spec §13: after the build, before the restart; decision 73). The new code's own pin is
 * read (`apps/cli/src/printManifest.ts`). Where no Camoufox is installed nothing is done, and update only says when the
 * provider is now offered on this machine. Otherwise a changed pin is
 * installed only when its flags are set, its layout switched now and the previous bundles removed after the health wait
 * (`after`); a pin without flags installs nothing and keeps the old bundle, saying so.
 */
/** Update's note when the new code offers the browser provider on this machine (pinned by a test). */
export const availableNote = (osArch: string): string =>
  `The browser provider is now available on ${osArch}: turn it on with pnpm gmt setup --reconfigure browser`;

export type BrowserStep = { ok: true; after: Action[] } | { ok: false; message: string };

export async function camoufoxUpdateStep(deps: Deps): Promise<BrowserStep> {
  const os = deps.platform.os;
  const osArch = osArchOf(deps.platform);
  if (os === 'win32' || osArch === null) return { ok: true, after: [] };
  const root = deps.platform.paths.camoufoxRoot;
  const installed = (deps.files.list(join(root, 'browsers', 'official')) ?? []).length > 0;
  const read = await deps.run(manifestArgv(deps.execPath, deps.checkout, osArch), {
    cwd: join(deps.checkout, 'apps', 'cli'),
    timeoutMs: 120_000,
    env: deps.childEnv,
  });
  const manifest = read.code === 0 ? parseManifest(read.stdout) : null;
  if (!installed) {
    // why: decision 75: once recordings set this machine's flags, update says the provider is now offered here
    if (manifest?.flags.FORM_VERIFIED === true) deps.io.out(`${availableNote(osArch)}\n`);
    return { ok: true, after: [] };
  }
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
