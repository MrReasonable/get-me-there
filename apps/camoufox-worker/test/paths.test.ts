import { workerDataDir } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  camoufoxRoot,
  defaultDataDir,
  fontsConfFile,
  installDirFor,
  pinnedBundleDir,
  profileDir,
  startRefusalFile,
  workerEnvFile,
} from '../src/paths.js';

describe('paths (brief §8; decision 73)', () => {
  it('places every file under the one data directory', () => {
    const data = defaultDataDir('/Users/op');
    expect(data).toBe('/Users/op/.local/state/get-me-there/camoufox');
    expect(workerEnvFile(data)).toBe(`${data}/worker.env`);
    expect(profileDir(data)).toBe(`${data}/profile`);
    expect(startRefusalFile(data)).toBe(`${data}/start-refusal.json`);
    expect(fontsConfFile(data)).toBe(`${data}/fonts.conf`);
  });
  it('camoufox-js’s install directory: the root on macOS, the pinned bundle on Linux', () => {
    expect(camoufoxRoot('/Users/op')).toBe('/Users/op/.local/share/get-me-there/camoufox');
    expect(installDirFor('darwin-arm64', '/Users/op')).toBe('/Users/op/.local/share/get-me-there/camoufox');
    expect(installDirFor('darwin-x64', '/Users/op')).toBe('/Users/op/.local/share/get-me-there/camoufox');
    expect(installDirFor('linux-arm64', '/home/op')).toBe(
      '/home/op/.local/share/get-me-there/camoufox/browsers/official/152.0.4-beta.28-3a105a2f',
    );
    expect(installDirFor('linux-x64', '/home/op')).toBe(
      '/home/op/.local/share/get-me-there/camoufox/browsers/official/152.0.4-beta.28-924f3109',
    );
    expect(pinnedBundleDir('/Users/op', 'darwin-arm64')).toBe(
      '/Users/op/.local/share/get-me-there/camoufox/browsers/official/152.0.4-beta.28-8b7680a6',
    );
  });
  it('the default data directory is core’s workerDataDir, the one rule the CLI and the status check share', () => {
    for (const home of ['/Users/op', '/home/op', '/var/lib/someone'])
      expect(defaultDataDir(home)).toBe(workerDataDir(home));
  });
});
