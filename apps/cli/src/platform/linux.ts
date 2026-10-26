import { isAbsolute, join } from 'node:path/posix';
import { camoufoxRootDir, workerDataDir } from '@gmt/core';
import { systemdManager } from '../services/systemd.js';
import { secretFile } from './secretFile.js';
import type { Arch, Paths, Platform } from './types.js';

type Env = Readonly<Record<string, string | undefined>>;

/** Decision 74's two display groups, each a main variable and the one that goes with it. */
const DISPLAY_GROUPS = [
  ['DISPLAY', 'XAUTHORITY'],
  ['WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR'],
] as const;

/** An XDG base directory when it is set to an absolute path (the spec ignores a relative one), else the default. */
const xdg = (env: Env, name: string, fallback: string): string => {
  const v = env[name];
  return v !== undefined && v !== '' && isAbsolute(v) ? v : fallback;
};

/**
 * Linux: XDG homes honoured for config, data and state; never for the worker's two directories (spec §12, so the CLI
 * and the worker always agree); logs in the user journal; systemd `--user` units.
 */
export function linuxPlatform(arch: Arch, uid: number, home: string, env: Env): Platform {
  const paths: Paths = {
    config: join(xdg(env, 'XDG_CONFIG_HOME', join(home, '.config')), 'get-me-there'),
    data: join(xdg(env, 'XDG_DATA_HOME', join(home, '.local', 'share')), 'get-me-there'),
    state: join(xdg(env, 'XDG_STATE_HOME', join(home, '.local', 'state')), 'get-me-there'),
    workerData: workerDataDir(home),
    camoufoxRoot: camoufoxRootDir(home),
    logs: null,
    serviceDir: join(home, '.config', 'systemd', 'user'),
  };
  const display = (env.DISPLAY ?? '') !== '' || (env.WAYLAND_DISPLAY ?? '') !== '';
  const displayEnv: Record<string, string> = {};
  for (const [main, extra] of DISPLAY_GROUPS) {
    const m = env[main] ?? '';
    if (m === '') continue;
    displayEnv[main] = m;
    const x = env[extra] ?? '';
    if (x !== '') displayEnv[extra] = x;
  }
  return {
    os: 'linux',
    arch,
    uid,
    paths,
    hasDisplay: display,
    displayEnv,
    writeSecretFile: secretFile,
    serviceManager: systemdManager(),
  };
}
