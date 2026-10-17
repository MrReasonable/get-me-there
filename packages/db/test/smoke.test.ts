import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@gmt/db package', () => {
  it('exports openDatabase', () => {
    expect(pkg.openDatabase).toBeTypeOf('function');
  });
  it('resolves @gmt/core from source under the test runner', () => {
    expect(asIata('lhr')).toBe('LHR');
  });
});
