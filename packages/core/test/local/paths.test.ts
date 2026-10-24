// The native install's on-disk path rules (spec §12; WP16a review S18), core's so every reader shares one rule.
import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';
import { workerDataDir } from '../../src/local/paths.js';

describe('workerDataDir', () => {
  it('joins with / under ~/.local/state (POSIX until the Windows package), and is what core exports', () => {
    expect(workerDataDir('/Users/operator')).toBe('/Users/operator/.local/state/get-me-there/camoufox');
    expect(workerDataDir('/home/op')).toBe('/home/op/.local/state/get-me-there/camoufox');
    expect(core.workerDataDir).toBe(workerDataDir);
  });
});
