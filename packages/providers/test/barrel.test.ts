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
    ]) {
      expect(typeof main[name], name).toBe('function');
    }
    expect(main.CREDENTIAL_HEADERS).toBeInstanceOf(Set);
    for (const name of [
      'withContentHash',
      'fixtureRouter',
      'fixtureHandlers',
      'replayHandlers',
      'createFixtureServer',
      'loadRecordedFixture',
      'classifyResponse',
    ]) {
      expect(name in main, name).toBe(false);
    }
  });
  it('./testing exports fixtureHandlers, replayHandlers, loadRecorded and withContentHash', () => {
    const t = surface(testing);
    for (const name of ['fixtureHandlers', 'replayHandlers', 'loadRecorded', 'withContentHash'])
      expect(typeof t[name], name).toBe('function');
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
