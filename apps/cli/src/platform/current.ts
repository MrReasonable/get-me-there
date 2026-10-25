import { win32 } from 'node:path';
import { isAbsolute } from 'node:path/posix';
import { darwinPlatform } from './darwin.js';
import { linuxPlatform } from './linux.js';
import type { Arch, Platform } from './types.js';
import { win32Platform } from './win32.js';

/** What `main.ts` reads from the process to choose a platform (tests pass their own). */
export interface PlatformInput {
  platform: string;
  arch: string;
  uid: number;
  env: Readonly<Record<string, string | undefined>>;
}

const isArch = (a: string): a is Arch => a === 'arm64' || a === 'x64';

/** The platform this process runs on; throws, naming the value, for an OS, arch or home it has no rules for. */
export function currentPlatform(input: PlatformInput): Platform {
  if (!isArch(input.arch))
    throw new Error(`gmt has no rules for the ${input.arch} architecture (arm64 or x64)`);
  if (input.platform === 'win32') {
    const home = input.env.USERPROFILE ?? input.env.HOME ?? '';
    if (!win32.isAbsolute(home)) throw new Error('HOME (or USERPROFILE) must be an absolute path');
    return win32Platform(input.arch, home);
  }
  const home = input.env.HOME ?? '';
  if (!isAbsolute(home)) throw new Error('HOME must be set to an absolute path');
  if (input.platform === 'darwin') return darwinPlatform(input.arch, input.uid, home);
  if (input.platform === 'linux') return linuxPlatform(input.arch, input.uid, home, input.env);
  throw new Error(
    `gmt has no rules for ${input.platform} (macOS and Linux; Windows runs the app with Docker)`,
  );
}
