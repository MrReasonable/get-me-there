import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@gmt/web package', () => {
  it('exports exactly the barrel’s public surface (none yet), so a new export is added here on purpose', () => {
    // why: a bare typeof check passes for any module namespace, even an empty one; the key list fails on drift.
    expect(Object.keys(pkg)).toEqual([]);
  });
  it('resolves @gmt/core from source under the test runner', () => {
    expect(asIata('lhr')).toBe('LHR');
  });
});
