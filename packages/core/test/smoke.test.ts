import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@gmt/core package', () => {
  it('exports a module', () => {
    expect(typeof pkg).toBe('object');
  });
});
