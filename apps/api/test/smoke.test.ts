import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@gmt/api package', () => {
  it('exports a module', () => {
    expect(typeof pkg).toBe('object');
  });
  it('resolves @gmt/core from source under the test runner', () => {
    expect(asIata('lhr')).toBe('LHR');
  });
});
