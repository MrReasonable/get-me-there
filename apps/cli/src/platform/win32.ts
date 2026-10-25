import { win32 } from 'node:path';
import { camoufoxRootDir, workerDataDir } from '@gmt/core';
import type { Arch, Paths, Platform, ServiceManager } from './types.js';

/** Decision 78: Windows setup is a later work package; until then every command that would install refuses so. */
export const WIN32_REFUSAL = 'Windows setup is not built yet; run the app with Docker (docs/setup.md)';

const refuse = (): never => {
  throw new Error(WIN32_REFUSAL);
};
const refusing: ServiceManager = {
  render: refuse,
  facts: refuse,
  install: refuse,
  start: refuse,
  stop: refuse,
  restart: refuse,
  remove: refuse,
};

/** A Windows platform that can say where things would live and refuses every service action. */
export function win32Platform(arch: Arch, home: string): Platform {
  const j = win32.join;
  const paths: Paths = {
    config: j(home, '.config', 'get-me-there'),
    data: j(home, '.local', 'share', 'get-me-there'),
    state: j(home, '.local', 'state', 'get-me-there'),
    workerData: workerDataDir(home),
    camoufoxRoot: camoufoxRootDir(home),
    logs: null,
    serviceDir: j(home, '.config', 'get-me-there', 'services'),
  };
  return {
    os: 'win32',
    arch,
    uid: -1,
    paths,
    hasDisplay: true,
    displayEnv: {},
    writeSecretFile: refuse,
    serviceManager: refusing,
  };
}
