import { join } from 'node:path/posix';
import {
  bundleDirName,
  bundleRelPath,
  type CamoufoxBuild,
  osArchOf as coreOsArch,
  type OsArch,
  versionOf,
} from '@gmt/core';
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

/** This machine's `CAMOUFOX_BUILDS` key (core's rule), or null where no build is pinned (Windows, decision 78). */
export const osArchOf = (p: { os: Os; arch: Arch }): OsArch | null => coreOsArch(p.os, p.arch);

/** Where the bundle for `entry` lives under the install root (core's `bundleRelPath`). */
export const bundlePath = (root: string, entry: Pick<CamoufoxBuild, 'build' | 'sha256'>): string =>
  join(root, bundleRelPath(entry));

/** The directory every pinned bundle lives in under the install root. */
export const officialDir = (root: string): string => join(root, 'browsers', 'official');

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
  /** Keep the verified download beside the install (`gmt browser install --keep-archive`, for CI's cache). */
  keepArchive?: boolean;
}

/** The archive a pin downloads to, under the install root (removed once unpacked, unless kept). */
export const archivePath = (root: string, entry: Pick<CamoufoxBuild, 'build' | 'sha256'>): string =>
  join(root, `.download-${bundleDirName(entry)}.zip`);

/**
 * What an install, update or setup left behind under the root when it stopped part way (W6; dev-b1-005, sec-b1-001):
 * the unpack's `.tmp-*` directories and the executor's own temporary names beside them, the layout's temporary link,
 * a partial download, and archives of other pins. The current pin's whole archive is kept: the unpack re-hashes it, so a
 * retry (or CI's cache) need not download it again.
 */
const STALE = /^\.{1,2}(?:tmp-|Camoufox\.app\.tmp-|version\.json\.tmp-|download-)/;
export function staleEntries(
  files: Files,
  root: string,
  entry: Pick<CamoufoxBuild, 'build' | 'sha256'>,
): string[] {
  const keep = archivePath(root, entry);
  return (files.list(root) ?? [])
    .filter((n) => STALE.test(n))
    .map((n) => join(root, n))
    .filter((p) => p !== keep);
}

/** The install's actions for `entry`, nothing when its bundle is in place, or a refusal naming why. */
export function planInstall(i: InstallInput): InstallPlan {
  const bundle = bundlePath(i.root, i.entry);
  if (i.files.isDir(bundle) || i.files.isSymlink(bundle)) {
    if (installedDigest(i.files, bundle) === i.entry.sha256 && !i.files.isSymlink(bundle))
      return { kind: 'installed', bundle };
    return {
      kind: 'refused',
      message: `${bundle} is there but is not the pinned Camoufox ${i.entry.build} (its version.json does not name the digest ${i.entry.sha256}); it is never overwritten: move it aside, then run pnpm gmt browser install`,
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
  const official = officialDir(i.root);
  const archive = archivePath(i.root, i.entry);
  const tmp = join(i.root, `.tmp-${i.random}`);
  const dirs: Action[] = [i.root, join(i.root, 'browsers'), official]
    .filter((d) => !i.files.isDir(d) || i.files.mode(d) !== 0o700)
    .map((path) => ({ kind: 'mkdir', path, mode: 0o700 }));
  // why: W6: an archive of the pinned size from an earlier attempt (or CI's cache) is not fetched again; the unpack
  // re-hashes it and removes it on a mismatch
  const downloaded = i.files.size(archive) === i.entry.bytes;
  return {
    kind: 'install',
    bundle,
    actions: [
      ...staleEntries(i.files, i.root, i.entry).map(
        (path): Action => ({ kind: 'remove', path, recursive: true }),
      ),
      ...dirs,
      ...(downloaded
        ? []
        : [
            {
              kind: 'download' as const,
              url: i.entry.url,
              to: archive,
              sha256: i.entry.sha256,
              bytes: i.entry.bytes,
            },
          ]),
      { kind: 'unpack', archive, sha256: i.entry.sha256, to: tmp },
      {
        kind: 'writeFile',
        path: join(tmp, 'version.json'),
        contents: bundleVersionText(i.entry),
        mode: 0o644,
        secret: false,
      },
      { kind: 'rename', from: tmp, to: bundle },
      ...(i.keepArchive === true ? [] : [{ kind: 'remove' as const, path: archive, recursive: false }]),
    ],
  };
}

/** The bundles under the root other than `keep` (removed by any later successful install, update or setup; W6). */
export function otherBundles(files: Files, root: string, keep: string): string[] {
  const official = officialDir(root);
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

/** The words update prints when the new pin has no recordings for this machine yet (pinned by a test). */
export const staysOffNote = (osArch: OsArch, build: string): string =>
  `the browser provider stays off on ${osArch} until recordings for ${build} land; the installed Camoufox is kept`;
