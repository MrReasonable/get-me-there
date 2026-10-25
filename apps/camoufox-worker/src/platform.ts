export { osArchOf } from '@gmt/core';

/**
 * Where the worker runs (spec §2 rev 36; decision 75): macOS or Linux, each `<os>-<arch>` on its own pinned build and
 * flags. Windows is a later work package (decision 78), so the worker refuses to start there.
 */
export const SUPPORTED_ONLY = 'the camoufox worker runs on macOS and Linux only';

/** Throws unless `platform` (process.platform) is darwin or linux; narrows it for the install rules. */
export function assertSupportedPlatform(platform: string): asserts platform is 'darwin' | 'linux' {
  if (platform !== 'darwin' && platform !== 'linux')
    throw new Error(`${SUPPORTED_ONLY} (this is ${platform})`);
}
