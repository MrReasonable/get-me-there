import { describe, expect, it } from 'vitest';
import * as fixture from '../src/fixture/index.js';
import * as providers from '../src/index.js';
import * as testing from '../src/testing/index.js';

const surface = (m: object): Record<string, unknown> => ({ ...m });

describe('@gmt/providers public surface (plan "http-kit" contract, arch-008)', () => {
  it('the main barrel exports the contract and the named-consumer extras, and nothing test-only', () => {
    const main = surface(providers);
    for (const name of [
      'createHttpKit',
      'createRecorder',
      'defaultRecordedRoot',
      'contentHash',
      'scrubSecrets',
      'stripUrl',
      'canonicalCacheKey',
      'fixtureProvider',
      'loadParamsAllowlist',
      'assertRequestAllowed',
      'canonicalJson',
      'fixtureHttpLimits',
      'RecorderRefusedError',
      'ParamsNotAllowedError',
      'travelpayoutsProvider', // WP6: apps/api providersFor
      'travelpayoutsHttpLimits', // WP6: apps/api httpLimitsFor
      'withContentHash',
      'assertRecordedRoot',
      'secretForms',
    ]) {
      expect(typeof main[name], name).toBe('function');
    }
    expect(main.CREDENTIAL_HEADERS).toBeInstanceOf(Set);
    // WP6: the recorded-allowlist constant, for apps/api providersFor
    expect(main.TRAVELPAYOUTS_PARAMS).toMatchObject({ provider: 'travelpayouts' });
    for (const name of [
      'fixtureRouter',
      'fixtureHandlers',
      'replayHandlers',
      'createFixtureServer',
      'loadRecordedFixture',
      'classifyResponse',
      // WP6: the shared adapter helpers stay package-internal (WP5 imports them from ../shared/*.js)
      'majorToMinor',
      'parseError',
      'parseVendor',
      'NoteCounter',
      // WP6: adapter constants stay internal too
      'TRAVELPAYOUTS_INFO',
      'TRAVELPAYOUTS_HOST',
      'PRICES_FOR_DATES_PATH',
    ]) {
      expect(name in main, name).toBe(false);
    }
  });
  it('./testing exports fixtureHandlers, replayHandlers, loadRecorded, withContentHash and the network guards', () => {
    const t = surface(testing);
    for (const name of [
      'fixtureHandlers',
      'replayHandlers',
      'loadRecorded',
      'withContentHash',
      'installNetworkGuards',
      'hangUntilAborted',
      'respondAfter',
      'takeStrays',
      'verifyRecordedTree',
      'verifyRecordedFile',
      'verifyFixturesTree',
    ])
      expect(typeof t[name], name).toBe('function');
    expect(typeof t.guardedServer, 'guardedServer').toBe('object');
  });
  it('./fixture exports the gated router and the scenario-control contract', () => {
    const f = surface(fixture);
    for (const name of ['fixtureRouter', 'scenarioRequest', 'releaseRequest', 'defaultFixtureRoot'])
      expect(typeof f[name], name).toBe('function');
    expect(f.FIXTURE_TILE_DAYS).toBe(7);
    // why: every export names its consumer (arch-r2-010); the control paths stay behind scenarioRequest/releaseRequest.
    expect(Object.keys(f).sort()).toEqual([
      'FIXTURE_TILE_DAYS',
      'defaultFixtureRoot',
      'fixtureRouter',
      'releaseRequest',
      'scenarioRequest',
    ]);
  });
});
