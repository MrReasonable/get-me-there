import { describe, expect, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@gmt/core package', () => {
  it('exports the api contract routes', () => {
    expect(pkg.apiContract.ROUTES.length).toBeGreaterThan(0);
  });
});
