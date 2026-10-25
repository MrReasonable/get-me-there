import { join } from 'node:path';
import {
  bundleRelPath,
  CAMOUFOX_BUILDS,
  camoufoxRootDir,
  type OsArch,
  START_REFUSAL_FILE,
  workerDataDir,
} from '@gmt/core';

/**
 * The worker's files (brief §8; decision 69 round 2, item 11). One data directory, 0700: the env file, the profile,
 * the SOCS capture, the cool-down, the pacer, the monthly counts, the refusals and the lock all live in it. Its default
 * is core's `workerDataDir` (spec §12), the one rule the worker, the CLI and the app's status check share.
 */
export function defaultDataDir(home: string): string {
  return workerDataDir(home);
}

export const workerEnvFile = (data: string): string => join(data, 'worker.env');
export const profileDir = (data: string): string => join(data, 'profile');
/** Decision 75: the start refusal the CLI and the app's status read, `{ reason, at }` only. */
export const startRefusalFile = (data: string): string => join(data, START_REFUSAL_FILE);
/** Linux: the generated fonts.conf naming the bundle's fonts by absolute path (spec §2 "Method"). */
export const fontsConfFile = (data: string): string => join(data, 'fonts.conf');

/** The install root `gmt` writes (core's `camoufoxRootDir`, the CLI's `Paths.camoufoxRoot`, XDG ignored). */
export function camoufoxRoot(home: string): string {
  return camoufoxRootDir(home);
}

/** The pinned bundle's directory for this machine: `<root>/browsers/official/<build>-<first 8 hex>`. */
export function pinnedBundleDir(home: string, osArch: OsArch): string {
  return join(camoufoxRoot(home), bundleRelPath(CAMOUFOX_BUILDS[osArch]));
}

/**
 * camoufox-js's install directory for this machine (decision 73): the root on macOS (its `Camoufox.app` link and
 * top-level `version.json`), the pinned bundle itself on Linux (where camoufox-js reads `version.json`, `camoufox-bin`,
 * `properties.json` and `fontconfig/` directly in it).
 */
export function installDirFor(osArch: OsArch, home: string): string {
  return osArch.startsWith('darwin-') ? camoufoxRoot(home) : pinnedBundleDir(home, osArch);
}
