import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { CamoufoxBuild } from '@gmt/core';

/**
 * The worker's check of the install `gmt setup` made (spec §2 "Method"; decision 73; brief WP17 Task 17.2). It only
 * verifies: it never creates, rewrites or removes anything. camoufox-js 0.11.5 resolves its browser from `INSTALL_DIR`
 * (read once, when its module is evaluated, from CAMOUFOX_INSTALL_DIR, which run.ts sets) and, when that directory is
 * missing, empty or holds a `version.json` whose release it does not accept, starts an unawaited download whose first
 * step is `rmSync(INSTALL_DIR, { recursive: true })`: reaching that branch would delete the operator's install and fetch
 * a release this app never pinned. So this check runs before any camoufox-js call and refuses (exit 78) whenever the
 * layout differs from the pinned entry, so the branch is never reached.
 *
 * macOS: the install directory is the root, holding the `Camoufox.app` symlink to the pinned bundle's app and the
 * top-level `{ version, release }` `version.json`. Linux: the install directory is the pinned bundle itself, holding
 * `version.json`, `camoufox-bin`, `properties.json` and `fontconfig/macos/fonts.conf`.
 */
export interface InstallFacts {
  installDir: string;
  bundleDir: string;
  /** `<version>-<build>`, equal to the pin. */
  build: string;
  /** The Firefox major passed as `ff_version` (from the bundle's own version.json). */
  ffMajor: number;
}

/** Why the start refuses: the layout is missing or changed, or it holds another build than the pin. */
export class InstallRefused extends Error {
  constructor(
    readonly reason: 'layout' | 'build-mismatch',
    message: string,
    /** The build the layout holds, when it could be read. */
    readonly installedBuild: string | null = null,
  ) {
    super(message);
    this.name = 'InstallRefused';
  }
}

/**
 * Whether camoufox-js 0.11.5 accepts `release` (its `Version.isSupported`: strictly between `alpha.1` and `1`, each part
 * a number or a word read by its first letter's code less 1024, padded to five parts). Pure.
 */
export function releaseAccepted(release: string): boolean {
  const parts = (r: string): number[] => {
    const p = r.split('.').map((x) => (Number.isNaN(Number(x)) ? x.charCodeAt(0) - 1024 : Number(x)));
    while (p.length < 5) p.push(0);
    return p;
  };
  const less = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      if (x !== y) return x < y;
    }
    return false;
  };
  const v = parts(release);
  return less(parts('alpha.1'), v) && less(v, parts('1'));
}

interface ReadVersion {
  version: string;
  release: string;
  build: string | undefined;
}

/**
 * A version.json's parts. `readByCamoufoxJs`: the file camoufox-js itself reads (the root's on macOS, the bundle's on
 * Linux), which must name `release` (camoufox-js 0.11.5 reads no other field; pie-b1-007); the macOS bundle's own file
 * may name it `build`.
 */
function readVersion(file: string, readByCamoufoxJs: boolean): ReadVersion {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new InstallRefused('layout', `${file} is missing or not JSON`);
  }
  if (typeof raw !== 'object' || raw === null || !('version' in raw) || typeof raw.version !== 'string')
    throw new InstallRefused('layout', `${file} has no version string`);
  if (!/^\d+\./.test(raw.version)) throw new InstallRefused('layout', `${file}: its version is not numeric`);
  const release = 'release' in raw && typeof raw.release === 'string' ? raw.release : undefined;
  const build = 'build' in raw && typeof raw.build === 'string' ? raw.build : undefined;
  const r = readByCamoufoxJs ? release : (release ?? build);
  if (r === undefined) throw new InstallRefused('layout', `${file} names no release`);
  if (!releaseAccepted(r))
    throw new InstallRefused('layout', `${file}: camoufox-js does not accept the release ${r}`);
  return { version: raw.version, release: r, build };
}

function need(dir: string, files: readonly string[]): void {
  for (const f of files)
    if (!existsSync(join(dir, f)))
      throw new InstallRefused('layout', `the Camoufox install has no ${join(dir, f)}`);
}

function notEmpty(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new InstallRefused('layout', `no Camoufox install at ${dir}: run pnpm gmt browser install`);
  }
  if (names.length === 0) throw new InstallRefused('layout', `${dir} is empty: run pnpm gmt browser install`);
}

/** The installed build against the pin: refused as `build-mismatch`, naming both. */
function pinned(v: ReadVersion, entry: Pick<CamoufoxBuild, 'build'>): string {
  const installed = `${v.version}-${v.release}`;
  if (installed !== entry.build)
    throw new InstallRefused(
      'build-mismatch',
      `the installed Camoufox is ${installed} but this worker is pinned to ${entry.build}; a new build is a re-verification`,
      installed,
    );
  return installed;
}

/** Verifies the layout for `os` at `installDir` against `entry`; throws InstallRefused, naming what differs. */
export function ensureInstallLayout(o: {
  os: 'darwin' | 'linux';
  installDir: string;
  entry: Pick<CamoufoxBuild, 'build'>;
}): InstallFacts {
  notEmpty(o.installDir);
  if (o.os === 'linux') {
    need(o.installDir, ['version.json', 'camoufox-bin', 'properties.json', 'fontconfig/macos/fonts.conf']);
    const v = readVersion(join(o.installDir, 'version.json'), true);
    const build = pinned(v, o.entry);
    return {
      installDir: o.installDir,
      bundleDir: o.installDir,
      build,
      ffMajor: Number(v.version.split('.')[0]),
    };
  }
  const top = readVersion(join(o.installDir, 'version.json'), true);
  const link = join(o.installDir, 'Camoufox.app');
  let isLink = false;
  try {
    isLink = lstatSync(link).isSymbolicLink();
  } catch {
    throw new InstallRefused('layout', `the Camoufox install has no ${link}: run pnpm gmt browser install`);
  }
  if (!isLink) throw new InstallRefused('layout', `${link} is not a symlink to a Camoufox bundle`);
  let app: string;
  try {
    app = realpathSync(link);
  } catch {
    throw new InstallRefused('layout', `${link} points at nothing: run pnpm gmt browser install`);
  }
  const bundleDir = dirname(app);
  const official = join(realpathSync(o.installDir), 'browsers', 'official');
  if (basename(app) !== 'Camoufox.app' || dirname(bundleDir) !== official)
    throw new InstallRefused('layout', `${link} does not point into ${official}`);
  need(app, ['Contents/MacOS/camoufox', 'Contents/Resources/properties.json']);
  const bundle = readVersion(join(bundleDir, 'version.json'), false);
  const build = pinned(bundle, o.entry);
  // why: camoufox-js reads the top-level file; one that disagrees with its bundle is a changed layout, never rewritten
  if (top.version !== bundle.version || top.release !== bundle.release)
    throw new InstallRefused('layout', `${join(o.installDir, 'version.json')} disagrees with its bundle`);
  return { installDir: o.installDir, bundleDir, build, ffMajor: Number(bundle.version.split('.')[0]) };
}
