import { join } from 'node:path';

/**
 * The worker's files (brief §8; decision 69 round 2, item 11). One data directory, 0700: the env file, the profile,
 * the SOCS capture, the cool-down, the pacer, the refusal and the lock all live in it.
 */
export function defaultDataDir(home: string): string {
  return join(home, '.local', 'state', 'get-me-there', 'camoufox');
}

export const workerEnvFile = (data: string): string => join(data, 'worker.env');
export const profileDir = (data: string): string => join(data, 'profile');

/** camoufox-js's own install directory on macOS (its `INSTALL_DIR` when CAMOUFOX_INSTALL_DIR is unset). */
export function installDir(home: string): string {
  return join(home, 'Library', 'Caches', 'camoufox');
}
