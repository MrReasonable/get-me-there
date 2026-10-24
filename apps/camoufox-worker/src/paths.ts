import { join } from 'node:path';
import { workerDataDir } from '@gmt/core';

/**
 * The worker's files (brief §8; decision 69 round 2, item 11). One data directory, 0700: the env file, the profile,
 * the SOCS capture, the cool-down, the pacer, the refusal and the lock all live in it. Its default is core's
 * `workerDataDir` (spec §12), the one rule the worker, the CLI and the app's status check share.
 */
export function defaultDataDir(home: string): string {
  return workerDataDir(home);
}

export const workerEnvFile = (data: string): string => join(data, 'worker.env');
export const profileDir = (data: string): string => join(data, 'profile');

/** camoufox-js's own install directory on macOS (its `INSTALL_DIR` when CAMOUFOX_INSTALL_DIR is unset). */
export function installDir(home: string): string {
  return join(home, 'Library', 'Caches', 'camoufox');
}
