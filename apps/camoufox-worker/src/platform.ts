/**
 * macOS only (decision 69 round 2, item 2; PIE-R2-04): `camoufox-js` reads `fontconfig/` from its install directory on
 * Linux and could reach its download branch, and this build was verified only on the operator's Mac.
 */
export const MACOS_ONLY = 'the camoufox worker supports macOS only';

/** Throws unless `platform` (process.platform) is darwin. */
export function assertMacOS(platform: string): void {
  if (platform !== 'darwin') throw new Error(`${MACOS_ONLY} (this is ${platform})`);
}
