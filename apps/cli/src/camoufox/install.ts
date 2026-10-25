import { join } from 'node:path/posix';
import { bundleDirName, type CamoufoxBuild, type OsArch, versionOf } from '@gmt/core';
import type { Files } from '../exec/files.js';
import type { Runner } from '../exec/runner.js';
import type { Action } from '../plan/action.js';
import type { Arch, Os } from '../platform/types.js';

/**
 * The verified Camoufox install (spec §2 "Method"; decision 73; brief WP17 §0 and Task 17.1). The CLI alone writes the
 * install root `~/.local/share/get-me-there/camoufox`: it checks the free space against the archive plus its unpacked
 * size, downloads the pinned asset (systemExecutor's `download`: https on the release hosts only, hashed while it
 * streams, the partial file removed on any mismatch), re-hashes and lists it before unpacking (`unpack`: no absolute,
 * `..` or escaping entry) into a 0700 `.tmp-<random>/` beside the target, writes the bundle's `version.json` (neither
 * archive carries one) and renames it into `browsers/official/<build>-<first 8 hex>/` in one step. A bundle already
 * there with the pinned digest plans nothing; any other is reported and never overwritten. Pure over `Files`.
 */

const OS_ARCH: Readonly<Record<'darwin' | 'linux', Readonly<Record<Arch, OsArch>>>> = {
  darwin: { arm64: 'darwin-arm64', x64: 'darwin-x64' },
  linux: { arm64: 'linux-arm64', x64: 'linux-x64' },
};

/** This machine's `CAMOUFOX_BUILDS` key, or null where no build is pinned (Windows, decision 78). */
export function osArchOf(p: { os: Os; arch: Arch }): OsArch | null {
  return p.os === 'win32' ? null : OS_ARCH[p.os][p.arch];
}

/** Where the bundle for `entry` lives under the install root. */
export const bundlePath = (root: string, entry: Pick<CamoufoxBuild, 'build' | 'sha256'>): string =>
  join(root, 'browsers', 'official', bundleDirName(entry));

/** The bundle's own `version.json` (`{ version, build, release, sha256 }`; `build` is the release, as camoufox-js names it). */
export function bundleVersionText(entry: Pick<CamoufoxBuild, 'build' | 'sha256'>): string {
  const { version, release } = versionOf(entry);
  return `${JSON.stringify({ version, build: release, release, sha256: entry.sha256 })}\n`;
}

/** The digest an installed bundle's `version.json` names, or null when it names none (or cannot be read). */
export function installedDigest(files: Files, bundle: string): string | null {
  let text: string | null;
  try {
    text = files.read(join(bundle, 'version.json'));
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    const raw: unknown = JSON.parse(text);
    return typeof raw === 'object' && raw !== null && 'sha256' in raw && typeof raw.sha256 === 'string'
      ? raw.sha256
      : null;
  } catch {
    return null;
  }
}

/** Whole megabytes, as the refusals name sizes. */
export const megabytes = (bytes: number): string =>
  `${Math.round(bytes / 1_000_000).toLocaleString('en-GB')} MB`;

export type InstallPlan =
  | { kind: 'installed'; bundle: string }
  | { kind: 'install'; bundle: string; actions: Action[] }
  | { kind: 'refused'; message: string };

export interface InstallInput {
  root: string;
  entry: CamoufoxBuild;
  files: Files;
  /** The bytes free on the install root's file system, or null when they could not be read. */
  freeBytes: number | null;
  /** Hex for the temporary directory's name (the plan is pure; the caller draws it). */
  random: string;
}

/** The install's actions for `entry`, nothing when its bundle is in place, or a refusal naming why. */
export function planInstall(i: InstallInput): InstallPlan {
  const bundle = bundlePath(i.root, i.entry);
  if (i.files.isDir(bundle) || i.files.isSymlink(bundle)) {
    if (installedDigest(i.files, bundle) === i.entry.sha256 && !i.files.isSymlink(bundle))
      return { kind: 'installed', bundle };
    return {
      kind: 'refused',
      message: `${bundle} is there but is not the pinned Camoufox ${i.entry.build} (its version.json does not name the digest ${i.entry.sha256}); it is never overwritten: move it aside, then run setup again`,
    };
  }
  const need = i.entry.bytes + i.entry.unpackedBytes;
  if (i.freeBytes === null)
    return {
      kind: 'refused',
      message: `could not read the free space under ${i.root}; Camoufox needs ${megabytes(need)} (the ${megabytes(i.entry.bytes)} download and about ${megabytes(i.entry.unpackedBytes)} unpacked)`,
    };
  if (i.freeBytes < need)
    return {
      kind: 'refused',
      message: `Camoufox needs ${megabytes(need)} free under ${i.root} (the ${megabytes(i.entry.bytes)} download and about ${megabytes(i.entry.unpackedBytes)} unpacked); ${megabytes(i.freeBytes)} is free`,
    };
  const official = join(i.root, 'browsers', 'official');
  const archive = join(i.root, `.download-${bundleDirName(i.entry)}.zip`);
  const tmp = join(i.root, `.tmp-${i.random}`);
  const dirs: Action[] = [i.root, join(i.root, 'browsers'), official]
    .filter((d) => !i.files.isDir(d) || i.files.mode(d) !== 0o700)
    .map((path) => ({ kind: 'mkdir', path, mode: 0o700 }));
  return {
    kind: 'install',
    bundle,
    actions: [
      ...dirs,
      { kind: 'download', url: i.entry.url, to: archive, sha256: i.entry.sha256, bytes: i.entry.bytes },
      { kind: 'unpack', archive, sha256: i.entry.sha256, to: tmp },
      {
        kind: 'writeFile',
        path: join(tmp, 'version.json'),
        contents: bundleVersionText(i.entry),
        mode: 0o644,
        secret: false,
      },
      { kind: 'rename', from: tmp, to: bundle },
      { kind: 'remove', path: archive, recursive: false },
    ],
  };
}

/** The bundles under the root other than `keep` (an update removes them once the app is healthy). */
export function otherBundles(files: Files, root: string, keep: string): string[] {
  const official = join(root, 'browsers', 'official');
  return (files.list(official) ?? []).map((n) => join(official, n)).filter((p) => p !== keep);
}

/** The nearest directory at or above `path` that exists (df needs one). */
function existingAncestor(files: Files, path: string): string {
  let p = path;
  while (p !== '/' && !files.isDir(p)) p = join(p, '..');
  return p;
}

/**
 * The bytes free on the file system holding `path` (`df -Pk`, POSIX output on macOS and Linux), or null when df fails
 * or prints what this cannot read.
 */
export async function freeBytesAt(run: Runner, files: Files, path: string): Promise<number | null> {
  const dir = existingAncestor(files, path);
  const r = await run(['df', '-Pk', dir], { cwd: '/', timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  const last = r.stdout.trim().split('\n').at(-1) ?? '';
  const available = last.split(/\s+/)[3];
  return available !== undefined && /^\d+$/.test(available) ? Number(available) * 1024 : null;
}

/** What `gmt update` does about Camoufox after its build (spec §13; decision 73). */
export type UpdateStep =
  | { kind: 'none' }
  | { kind: 'current'; actions: Action[] }
  | { kind: 'install'; bundle: string; actions: Action[]; after: Action[]; note: string }
  | { kind: 'stays-off'; note: string }
  | { kind: 'refused'; message: string };

/** The words update prints when the new pin has no recordings for this machine yet (pinned by a test). */
export const staysOffNote = (osArch: OsArch, build: string): string =>
  `the browser provider stays off on ${osArch} until recordings for ${build} land; the installed Camoufox is kept`;
/** The words update prints when it installs a new pin (pinned by a test). */
export const installingNote = (osArch: OsArch, build: string): string =>
  `installing Camoufox ${build} for ${osArch}; the previous bundle is removed once the app is healthy`;

/**
 * Pure: nothing when no Camoufox is installed here (the provider was never set up); the layout's repairs when the pin
 * is installed; a new pin installed (with no keep option) only when its flags are set, the previous bundles removed
 * after the health wait (`after`); otherwise nothing installed and the old bundle kept.
 */
export function planCamoufoxUpdate(i: {
  os: 'darwin' | 'linux';
  osArch: OsArch;
  root: string;
  entry: CamoufoxBuild;
  formVerified: boolean;
  files: Files;
  freeBytes: number | null;
  random: string;
  layout: (bundle: string) => { kind: 'ok'; actions: Action[] } | { kind: 'refused'; message: string };
}): UpdateStep {
  const official = join(i.root, 'browsers', 'official');
  if ((i.files.list(official) ?? []).length === 0) return { kind: 'none' };
  const bundle = bundlePath(i.root, i.entry);
  // why: an installed pin is checked whatever its flags; a new one is installed only once its recordings set them
  const install = i.files.isDir(bundle) || i.formVerified ? planInstall(i) : null;
  if (install === null) return { kind: 'stays-off', note: staysOffNote(i.osArch, i.entry.build) };
  if (install.kind === 'refused') return install;
  const layout = i.layout(bundle);
  if (layout.kind === 'refused') return layout;
  if (install.kind === 'installed') return { kind: 'current', actions: layout.actions };
  return {
    kind: 'install',
    bundle,
    actions: [...install.actions, ...layout.actions],
    after: otherBundles(i.files, i.root, bundle).map((path) => ({ kind: 'remove', path, recursive: true })),
    note: installingNote(i.osArch, i.entry.build),
  };
}
