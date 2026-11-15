import { beforeEach, describe, expect, it } from 'vitest';
import { monthlyCapsMissed } from '../../src/budget/monthlyFit.js';
import * as core from '../../src/index.js';

beforeEach(() => {
  expect.hasAssertions();
});

const row = (scope: string, fits: boolean) => ({ scope, estimated: 0, cap: 10, fits });

describe('monthlyCapsMissed (decision 25, ruling 5; design 2026-11-08 Ruling 14): the provider-month caps a schedule would miss', () => {
  it('names each named provider’s month scope that does not fit, in the fit’s order', () => {
    const perScope = [
      row('provider-month:travelpayouts', false),
      row('execution-calls', false),
      row('provider-month:searchapi', false),
      row('provider-month:camoufox', true),
    ];
    expect(monthlyCapsMissed(perScope, ['searchapi', 'travelpayouts', 'camoufox'])).toEqual([
      'provider-month:travelpayouts',
      'provider-month:searchapi',
    ]);
  });

  it('a scope that fits, another kind of scope, or a provider not named is not a miss', () => {
    expect(
      monthlyCapsMissed(
        [
          row('provider-month:searchapi', true),
          row('global-month', false),
          row('provider-lifetime:searchapi', false),
          row('execution-cost', false),
          row('provider-month:travelpayouts', false),
        ],
        ['searchapi'],
      ),
    ).toEqual([]);
    expect(monthlyCapsMissed([], ['searchapi'])).toEqual([]);
    expect(monthlyCapsMissed([row('provider-month:searchapi', false)], [])).toEqual([]);
  });

  it('is on the barrel', () => {
    expect(core.monthlyCapsMissed).toBe(monthlyCapsMissed);
  });
});
