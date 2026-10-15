import { describe, expect, it } from 'vitest';
import { assertRequestAllowed, loadParamsAllowlist } from '../../src/params/allowlist.js';
import {
  FIXED_PARAMS,
  FORBIDDEN_PARAM_NAMES,
  PRICES_FOR_DATES_PATH,
  TRAVELPAYOUTS_PARAMS,
} from '../../src/travelpayouts/params.js';
import { buildRequestUrl } from '../../src/travelpayouts/provider.js';
import { planMonthTiles, tileParams } from '../../src/travelpayouts/tiles.js';
import { airports, query } from './harness.js';
import { paramsFilePath } from './recorded.js';

describe('TRAVELPAYOUTS_PARAMS (plan decision 6: a code constant equal to the recorded file)', () => {
  it('equals fixtures/recorded/travelpayouts/params-<date>.json, contentSha256 included', () => {
    expect(TRAVELPAYOUTS_PARAMS).toEqual(loadParamsAllowlist(paramsFilePath()));
  });

  it('carries the hard-coded fixed values and no forbidden name (spec §5.2)', () => {
    const rules = TRAVELPAYOUTS_PARAMS.endpoints[PRICES_FOR_DATES_PATH];
    if (rules === undefined) throw new Error('no prices_for_dates rules');
    for (const [name, value] of Object.entries(FIXED_PARAMS)) expect(rules.values[name]).toEqual([value]);
    for (const name of FORBIDDEN_PARAM_NAMES) expect(rules.names).not.toContain(name);
  });

  it('accepts every page URL the adapter builds, metro and airport origins alike', () => {
    const [plan] = planMonthTiles(query());
    if (plan === undefined) throw new Error('no tile');
    for (const q of [query(), query({ definitionOrigins: [] })]) {
      for (const page of [1, 2]) {
        expect(() =>
          assertRequestAllowed(
            TRAVELPAYOUTS_PARAMS,
            PRICES_FOR_DATES_PATH,
            buildRequestUrl(tileParams(plan, q, airports), page),
          ),
        ).not.toThrow();
      }
    }
  });
});
