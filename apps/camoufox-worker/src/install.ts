import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * The launch through camoufox-js's own install layout (decision 69 round 2, item 1; spec §2 "Method"; brief §7;
 * PIE-R2-03). Without `executable_path`, camoufox-js resolves the binary and `properties.json` under
 * `INSTALL_DIR/Camoufox.app/Contents/…` and checks the top-level `INSTALL_DIR/version.json` (`{version, release}`),
 * and it starts an unawaited download when the directory is missing, empty or unsupported. On the operator's Mac that
 * layout already exists: `Camoufox.app` is a symlink to `browsers/official/<build>-<sha>/Camoufox.app`. This module
 * verifies both entries and creates any that is missing (the symlink to the pinned bundle, the top-level file written
 * from the bundle's own `version.json`), so camoufox-js never reaches its download branch. It never modifies the
 * bundle, never rewrites an entry that disagrees (it refuses instead), and refuses a set CAMOUFOX_INSTALL_DIR.
 */
export const DEFAULT_BINARY_BUILD = '152.0.4-beta.28';

export interface InstallFacts {
  installDir: string;
  bundleDir: string;
  /** `<version>-<build>`, equal to the pin. */
  build: string;
  /** The Firefox major passed as `ff_version` (from the bundle's own version.json). */
  ffMajor: number;
  /** What was created this start, if anything. */
  created: Array<'Camoufox.app' | 'version.json'>;
}

export class InstallRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallRefused';
  }
}

interface BundleVersion {
  version: string;
  build: string;
}

/** The shape check that runs before the pin (TS2-09): `version` starts with a number; `build` or `release` is a string. */
function readBundleVersion(file: string): BundleVersion {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new InstallRefused(`${file}: version.json is missing or not JSON`);
  }
  if (typeof raw !== 'object' || raw === null || !('version' in raw) || typeof raw.version !== 'string')
    throw new InstallRefused(`${file}: version.json has no version string`);
  if (!/^\d+\./.test(raw.version)) throw new InstallRefused(`${file}: version.json version is not numeric`);
  const build = 'build' in raw && typeof raw.build === 'string' ? raw.build : undefined;
  const release = 'release' in raw && typeof raw.release === 'string' ? raw.release : undefined;
  const b = build ?? release;
  if (b === undefined) throw new InstallRefused(`${file}: version.json names no build or release`);
  return { version: raw.version, build: b };
}

/**
 * The top-level `version.json` (fix round 1, prov-int M1): camoufox-js reads only its `release`, so `release` is
 * required; a `build` beside it must agree.
 */
function readTopVersion(file: string): BundleVersion {
  const v = readBundleVersion(file);
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const obj = typeof raw === 'object' && raw !== null ? raw : {};
  const release = 'release' in obj && typeof obj.release === 'string' ? obj.release : undefined;
  if (release === undefined) throw new InstallRefused(`${file}: version.json names no release`);
  const build = 'build' in obj && typeof obj.build === 'string' ? obj.build : undefined;
  if (build !== undefined && build !== release)
    throw new InstallRefused(
      `${file} disagrees with the pinned bundle (build ${build}, release ${release}); it is never rewritten silently`,
    );
  return { version: v.version, build: release };
}

/**
 * Verifies or creates the install layout for the pinned build. `env` is the worker's environment, read only for the
 * CAMOUFOX_INSTALL_DIR refusal.
 */
export function ensureInstallLayout(o: {
  installDir: string;
  pinnedBuild: string;
  installDirOverride: string | undefined;
}): InstallFacts {
  if (o.installDirOverride !== undefined && o.installDirOverride !== '')
    throw new InstallRefused(
      'CAMOUFOX_INSTALL_DIR is set; the worker launches only from camoufox-js’s default install directory',
    );
  const official = join(o.installDir, 'browsers', 'official');
  if (!existsSync(official)) throw new InstallRefused(`no Camoufox bundle under ${official}`);
  const bundles = readdirSync(official)
    .map((id) => join(official, id))
    .filter((dir) => existsSync(join(dir, 'version.json')));
  if (bundles.length === 0) throw new InstallRefused(`no Camoufox bundle under ${official}`);
  // why: every bundle's shape is checked before any pin comparison, so a malformed file is named as such (TS2-09).
  const read = bundles.map((dir) => ({ dir, v: readBundleVersion(join(dir, 'version.json')) }));
  const matching = read.filter(({ v }) => `${v.version}-${v.build}` === o.pinnedBuild);
  const only = matching[0];
  if (matching.length !== 1 || only === undefined) {
    const seen = read.map(({ v }) => `${v.version}-${v.build}`).join(', ');
    throw new InstallRefused(
      `CAMOUFOX_BINARY_BUILD is ${o.pinnedBuild} but the installed bundles are ${seen}; an upgrade is a re-verification`,
    );
  }
  const { dir: bundleDir, v } = only;
  const bundleApp = join(bundleDir, 'Camoufox.app');
  for (const f of ['Contents/MacOS/camoufox', 'Contents/Resources/properties.json'])
    if (!existsSync(join(bundleApp, f))) throw new InstallRefused(`the bundle has no ${f}`);

  const created: InstallFacts['created'] = [];
  const appLink = join(o.installDir, 'Camoufox.app');
  let linkStat: ReturnType<typeof lstatSync> | undefined;
  try {
    linkStat = lstatSync(appLink);
  } catch {
    linkStat = undefined;
  }
  if (linkStat === undefined) {
    symlinkSync(bundleApp, appLink);
    created.push('Camoufox.app');
  } else if (!linkStat.isSymbolicLink() || realpathSync(appLink) !== realpathSync(bundleApp)) {
    throw new InstallRefused(
      `${appLink} is not a symlink to the pinned bundle; it is never rewritten silently`,
    );
  }

  const topVersion = join(o.installDir, 'version.json');
  if (!existsSync(topVersion)) {
    writeFileSync(topVersion, JSON.stringify({ version: v.version, release: v.build }));
    created.push('version.json');
  } else {
    const top = readTopVersion(topVersion);
    if (top.version !== v.version || top.build !== v.build)
      throw new InstallRefused(
        `${topVersion} disagrees with the pinned bundle; it is never rewritten silently`,
      );
  }
  return {
    installDir: o.installDir,
    bundleDir,
    build: o.pinnedBuild,
    ffMajor: Number(v.version.split('.')[0]),
    created,
  };
}
