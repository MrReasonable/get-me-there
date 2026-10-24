import { workerDataDir } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultDataDir, installDir, profileDir, workerEnvFile } from '../src/paths.js';

describe('paths (brief §8)', () => {
  it('places every file under the one data directory and camoufox-js’s install directory under Library/Caches', () => {
    const data = defaultDataDir('/Users/op');
    expect(data).toBe('/Users/op/.local/state/get-me-there/camoufox');
    expect(workerEnvFile(data)).toBe(`${data}/worker.env`);
    expect(profileDir(data)).toBe(`${data}/profile`);
    expect(installDir('/Users/op')).toBe('/Users/op/Library/Caches/camoufox');
  });
  it('the default data directory is core’s workerDataDir, the one rule the CLI and the status check share', () => {
    for (const home of ['/Users/op', '/home/op', '/var/lib/someone'])
      expect(defaultDataDir(home)).toBe(workerDataDir(home));
  });
});
