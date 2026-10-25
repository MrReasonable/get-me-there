import { join } from 'node:path/posix';
import { camoufoxRootDir, workerDataDir } from '@gmt/core';
import { launchdManager } from '../services/launchd.js';
import { secretFile } from './secretFile.js';
import type { Arch, Paths, Platform } from './types.js';

/** macOS: the shared home layout (XDG never read), logs under ~/Library/Logs, launchd agents. */
export function darwinPlatform(arch: Arch, uid: number, home: string): Platform {
  const paths: Paths = {
    config: join(home, '.config', 'get-me-there'),
    data: join(home, '.local', 'share', 'get-me-there'),
    state: join(home, '.local', 'state', 'get-me-there'),
    workerData: workerDataDir(home),
    camoufoxRoot: camoufoxRootDir(home),
    logs: join(home, 'Library', 'Logs', 'get-me-there'),
    serviceDir: join(home, 'Library', 'LaunchAgents'),
  };
  return {
    os: 'darwin',
    arch,
    uid,
    paths,
    hasDisplay: true,
    displayEnv: {},
    writeSecretFile: secretFile,
    serviceManager: launchdManager(uid, paths),
  };
}
