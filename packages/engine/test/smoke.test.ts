import { asIata } from '@gmt/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as pkg from '../src/index.js';

describe('@gmt/engine package', () => {
  it('exports a module', () => {
    expect(typeof pkg).toBe('object');
  });
  it('resolves @gmt/core from source under the test runner', () => {
    expect(asIata('lhr')).toBe('LHR');
  });
  it('exports StartOptions, the one start-options type of every start signature (decision 48)', () => {
    // why: a compile-time check (tests are type-checked); WP8 imports this type rather than restating the shape
    expectTypeOf<pkg.StartOptions>().toEqualTypeOf<Parameters<pkg.Engine['start']>[1]>();
  });
  it('exports SOFT_CONFIRM_CALL_SHARE, the call share above which a run needs confirming (decision 53)', () => {
    // why: WP8 imports the engine's value rather than keeping a copy that could drift
    expect(pkg.SOFT_CONFIRM_CALL_SHARE).toBe(0.2);
  });
  it('exports the confirmation rule and the cap-scope mapping the api calls (decision 58)', () => {
    // why: WP8 fills needsConfirmation with the engine's own rule instead of a copy that could drift
    expect(pkg.capKindOf('month')).toBe('provider-month');
    expect(pkg.capKindOf('lifetime')).toBe('provider-lifetime');
    expect(pkg.lineKey('verification', 'searchapi')).toBe('verification:searchapi');
    expectTypeOf(pkg.confirmationNeeded).toBeFunction();
  });
});
