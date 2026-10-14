import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@gmt/api package', () => {
  it('exports a module', () => {
    expect(typeof pkg).toBe('object');
  });
});
