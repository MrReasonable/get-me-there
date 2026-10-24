import { isAbsolute, join } from 'node:path';
import { workerDataDir } from '@gmt/core';
import { systemdManager } from '../services/systemd.js';
import { secretFile } from './secretFile.js';
import type { Arch, Paths, Platform } from './types.js';

type Env = Readonly<Record<string, string | undefined>>;

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
    camoufoxRoot: join(home, '.local', 'share', 'get-me-there', 'camoufox'),
    logs: null,
    serviceDir: join(home, '.config', 'systemd', 'user'),
  };
  const display = (env.DISPLAY ?? '') !== '' || (env.WAYLAND_DISPLAY ?? '') !== '';
  return {
    os: 'linux',
    arch,
    uid,
    paths,
    hasDisplay: display,
    writeSecretFile: secretFile,
    serviceManager: systemdManager(uid, paths),
  };
}
