import { CAMOUFOX_BUILDS, type CamoufoxBuild, type OsArch } from '@gmt/core';
import type { Deps } from '../deps.js';
import type { Action } from '../plan/action.js';
import { apply } from '../plan/apply.js';
import { describeResult } from '../plan/describe.js';
import { freeBytesAt, megabytes, osArchOf, otherBundles, planInstall, staleEntries } from './install.js';
import { planLayout } from './layout.js';
import { libraryProblem, unzipProblem } from './libs.js';

/**
 * The one Camoufox install sequence (W1, W9; ca-b1-009): `gmt browser install`, `gmt setup`'s browser step, `gmt
 * setup --reconfigure browser` and `gmt update` all run it, and CI's camoufox-install job runs `gmt browser install`,
 * so what CI proves is what an operator runs. In order: this machine's pin, `unzip`, a sweep of what an earlier attempt
 * left under the root, the free space, the download (skipped when the pinned archive is already whole there; the unpack
 * re-hashes it), the unpack, version.json and the rename into place, then the layout camoufox-js reads and, on Linux,
 * Firefox's libraries. It prints one line before the download and one before the unpack (sizes), and one when done.
 */
export type InstallOutcome =
  | { kind: 'ok'; osArch: OsArch; entry: CamoufoxBuild; bundle: string; changed: boolean }
  /** Nothing was changed past the sweep; `message` says what to do. */
  | { kind: 'refused'; message: string }
  /** Linux: the bundle is in place, but Firefox's libraries are missing on this machine; `message` names them. */
  | { kind: 'libraries'; osArch: OsArch; entry: CamoufoxBuild; bundle: string; message: string }
  /** An action failed part way; `message` is the plan's own report. */
  | { kind: 'failed'; message: string };

export interface InstallOptions {
  /** The plan's name in reports (`browser install`, `setup: install Camoufox`, `update: the browser install`). */
  command: string;
  /** The pin to install: this code's own for this machine unless given (update passes the new code's). */
  entry?: CamoufoxBuild;
  /** Keep the verified download (CI's cache). */
  keepArchive?: boolean;
  /**
   * Also switch the layout camoufox-js reads and check Linux's libraries (false: the bundle is put in place only, for
   * an early download while the worker still runs on the old one).
   */
  layout?: boolean;
}

/** Splits an install's actions where its long steps start, so a line can be printed before each. */
function phases(
  actions: readonly Action[],
): Array<{ before: 'download' | 'unpack' | null; actions: Action[] }> {
  const out: Array<{ before: 'download' | 'unpack' | null; actions: Action[] }> = [
    { before: null, actions: [] },
  ];
  for (const a of actions) {
    if (a.kind === 'download' || a.kind === 'unpack') out.push({ before: a.kind, actions: [] });
    out.at(-1)?.actions.push(a);
  }
  return out.filter((p) => p.actions.length > 0);
}

export async function installCamoufox(deps: Deps, o: InstallOptions): Promise<InstallOutcome> {
  const os = deps.platform.os;
  const osArch = osArchOf(deps.platform);
  if (os === 'win32' || osArch === null)
    return {
      kind: 'refused',
      message: `no Camoufox build is pinned for ${deps.platform.os}-${deps.platform.arch}; the browser provider runs on macOS and Linux`,
    };
  const entry = o.entry ?? CAMOUFOX_BUILDS[osArch];
  const unzip = await unzipProblem(deps.run, os);
  if (unzip !== null) return { kind: 'refused', message: unzip };
  const root = deps.platform.paths.camoufoxRoot;
  const random = deps.randomBytes(4).toString('hex');
  const install = planInstall({
    root,
    entry,
    files: deps.files,
    freeBytes: await freeBytesAt(deps.run, deps.files, root),
    random,
    keepArchive: o.keepArchive === true,
  });
  if (install.kind === 'refused') return install;
  const layout =
    o.layout === false
      ? { kind: 'ok' as const, actions: [] }
      : planLayout({ os, root, bundle: install.bundle, entry, files: deps.files, random });
  if (layout.kind === 'refused') return layout;
  // why: W6: an installed pin still sweeps what an interrupted attempt left (gigabytes, never found otherwise)
  const sweep: Action[] =
    install.kind === 'installed'
      ? staleEntries(deps.files, root, entry).map((path) => ({ kind: 'remove', path, recursive: true }))
      : [];
  const actions = [...sweep, ...(install.kind === 'install' ? install.actions : []), ...layout.actions];
  for (const p of phases(actions)) {
    // why: W6 (po-b1-005): the download and the unpack take minutes; each is announced with its size first
    if (p.before === 'download')
      deps.io.out(
        `Downloading Camoufox ${entry.build} for ${osArch} (${megabytes(entry.bytes)}) from github.com; this can take several minutes\n`,
      );
    if (p.before === 'unpack')
      deps.io.out(`Checking and unpacking it (about ${megabytes(entry.unpackedBytes)} on disk)\n`);
    const r = await apply({ command: o.command, actions: p.actions, notes: [] }, deps.executor);
    if (r.failed !== null) return { kind: 'failed', message: describeResult(o.command, r) };
  }
  if (install.kind === 'install') deps.io.out(`Camoufox ${entry.build} is installed in ${install.bundle}\n`);
  if (os === 'linux' && o.layout !== false) {
    const libs = await libraryProblem(deps.run, deps.files, install.bundle, deps.childEnv);
    if (libs !== null) return { kind: 'libraries', osArch, entry, bundle: install.bundle, message: libs };
  }
  return { kind: 'ok', osArch, entry, bundle: install.bundle, changed: actions.length > 0 };
}

/** The removal of every bundle but `keep` (W6: any later successful install reclaims what an earlier pin left). */
export function oldBundleRemovals(deps: Deps, keep: string): Action[] {
  return otherBundles(deps.files, deps.platform.paths.camoufoxRoot, keep).map((path) => ({
    kind: 'remove',
    path,
    recursive: true,
  }));
}
