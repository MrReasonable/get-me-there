import { describe, expect, it } from 'vitest';
import { assertSupportedPlatform, osArchOf } from '../src/platform.js';

describe('platform (spec §2 rev 36: macOS or Linux; Windows is a later package)', () => {
  it.each(['darwin', 'linux'])('%s passes', (p) => {
    expect(() => assertSupportedPlatform(p)).not.toThrow();
  });
  it.each(['win32', 'freebsd'])('%s refuses', (p) => {
    expect(() => assertSupportedPlatform(p)).toThrow(
      `the camoufox worker runs on macOS and Linux only (this is ${p})`,
    );
  });
  it('names the four pinned entries and nothing else', () => {
    expect([
      osArchOf('darwin', 'arm64'),
      osArchOf('darwin', 'x64'),
      osArchOf('linux', 'arm64'),
      osArchOf('linux', 'x64'),
      osArchOf('linux', 'ia32'),
      osArchOf('win32', 'x64'),
    ]).toEqual(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', null, null]);
  });
});
