// Spec §8.2 plan preset and §11 form defaults.
import type { FlightProvider, ProviderId } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultDefinitionInput, newSearchSourcesFor } from '../src/defaults.js';
import { loadConfigFromEnv } from '../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH, SENTINEL_SA, SENTINEL_TP } from './helpers/env.js';

const config = (env: Record<string, string>) =>
  loadConfigFromEnv(
    cleanEnv({
      NODE_ENV: 'production',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      APP_BASIC_AUTH_USER: 'operator',
      APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
      ...env,
    }),
  );
const stub = (id: ProviderId): FlightProvider => ({
  id,
  displayName: id,
  suppliedFields: [],
  cabins: ['economy'],
  healthcheck: async () => ({ ok: true, detail: '' }),
});

describe('defaultDefinitionInput (spec §8.2 plan preset, §11 form defaults)', () => {
  it('£0: Travelpayouts discovery only, no verification, the core refresh default', () => {
    const d = defaultDefinitionInput(config({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP }), [stub('travelpayouts')]);
    expect(d.providers).toEqual({
      discovery: ['travelpayouts'],
      verification: [],
      discoveryRefreshHours: { travelpayouts: 168 },
    });
  });
  it('trial SearchApi plus Travelpayouts: still no verification provider', () => {
    const c = config({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP, SEARCHAPI_KEY: SENTINEL_SA });
    expect(
      defaultDefinitionInput(c, [stub('travelpayouts'), stub('searchapi')]).providers.verification,
    ).toEqual([]);
  });
  it('40usd with no stored lists: SearchApi is ticked nowhere (the operator ticks it per search); policy maxCells 10 / expandTop 2', () => {
    const c = config({
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
    });
    const d = defaultDefinitionInput(c, [stub('travelpayouts'), stub('searchapi')]);
    expect(d.providers.discovery).toEqual(['travelpayouts']);
    expect(d.providers.verification).toEqual([]);
    expect(d.verification).toEqual({
      maxCells: 10,
      topN: 10,
      alwaysInclude: [],
      expandTop: 2,
      bookingLinks: true,
    });
    expect(d.budget).toEqual({ maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 });
  });
  it('no providers: empty stages; no airports; disabled; no schedule, its zone SCHEDULER_TIMEZONE; form defaults', () => {
    const d = defaultDefinitionInput(config({ SCHEDULER_TIMEZONE: 'Europe/London' }), []);
    expect(d.providers.discovery).toEqual([]);
    expect([d.origins, d.destinations, d.enabled]).toEqual([[], [], false]);
    // why: spec rev 55 §8.2: a new search has no schedule until Repeat weekly; the zone is kept for when it gets one
    expect([d.scheduleCron, d.scheduleTz]).toEqual([null, 'Europe/London']);
    expect(d.window).toEqual({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 });
    expect([d.minNights, d.maxNights, d.cabin]).toEqual([10, 21, 'economy']);
    // why: spec rev 55 §8.2: no default arrival window; the 25-hour journey limit stays
    expect(d.constraints).toEqual({ maxJourneyMinutes: 1500 });
    expect(d).not.toHaveProperty('confirmedCostPence');
    expect(d).not.toHaveProperty('confirmedCalls');
  });

  it('rev 55 §8.2: names every configured free source, the browser worker with its key; never one CAMOUFOX_ENABLED leaves out', () => {
    const on = config({
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      CAMOUFOX_ENABLED: 'true',
      CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
      CAMOUFOX_WORKER_KEY: 'test-worker-key-0123456789abcdef0123456789abcdef',
    });
    const d = defaultDefinitionInput(on, [stub('travelpayouts'), stub('camoufox')]);
    expect(d.providers).toEqual({
      discovery: ['travelpayouts', 'camoufox'],
      verification: [],
      discoveryRefreshHours: { travelpayouts: 168, camoufox: 168 },
    });
    expect([d.scheduleCron, d.enabled]).toEqual([null, false]);
    expect(d.constraints).not.toHaveProperty('arrivalWindowLocal');
    // why: wiring registers no camoufox provider while CAMOUFOX_ENABLED is false, so the preset cannot name it
    expect(
      defaultDefinitionInput(config({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP }), [stub('travelpayouts')]).providers
        .discovery,
    ).toEqual(['travelpayouts']);
  });
});

// Settings plan ruling 7 and controller ruling R2: the one place that decides the sources a new search starts with.
describe('new-search sources (NEW_SEARCH_DISCOVERY, NEW_SEARCH_VERIFICATION) and the refresh days', () => {
  const PAID = {
    TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
    SEARCHAPI_KEY: SENTINEL_SA,
    SEARCHAPI_PLAN: '40usd',
  };
  const ALL = [stub('travelpayouts'), stub('searchapi'), stub('camoufox')];

  it("unset: today's draft, every configured free source and SearchApi on neither list, on trial and on 40usd", () => {
    for (const plan of ['trial', '40usd']) {
      const c = config({ ...PAID, SEARCHAPI_PLAN: plan });
      expect(newSearchSourcesFor(c, ALL)).toEqual({
        discovery: ['travelpayouts', 'camoufox'],
        verification: [],
      });
      expect(defaultDefinitionInput(c, ALL).providers.discovery).toEqual(['travelpayouts', 'camoufox']);
    }
  });
  it('unset with the test source beside a real one: a new search starts on the real ones; alone, on the test source', () => {
    const c = config({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP, NODE_ENV: 'development' });
    expect(newSearchSourcesFor(c, [stub('travelpayouts'), stub('fixture')])).toEqual({
      discovery: ['travelpayouts'],
      verification: ['fixture'],
    });
    expect(newSearchSourcesFor(c, [stub('fixture')])).toEqual({
      discovery: ['fixture'],
      verification: ['fixture'],
    });
  });
  it("lists: exactly those sources, in the list's order, minus any that is not configured", () => {
    const c = config({
      ...PAID,
      NEW_SEARCH_DISCOVERY: 'searchapi,travelpayouts,camoufox',
      NEW_SEARCH_VERIFICATION: 'searchapi',
    });
    expect(newSearchSourcesFor(c, [stub('travelpayouts'), stub('searchapi')])).toEqual({
      discovery: ['searchapi', 'travelpayouts'],
      verification: ['searchapi'],
    });
  });
  it('`none` gives nothing for that role and leaves the other role alone', () => {
    const c = config({ ...PAID, NEW_SEARCH_DISCOVERY: 'none', NEW_SEARCH_VERIFICATION: 'searchapi' });
    const d = defaultDefinitionInput(c, ALL);
    expect(d.providers.discovery).toEqual([]);
    expect(d.providers.verification).toEqual(['searchapi']);
    expect(d.providers.discoveryRefreshHours).toEqual({});
  });
  it('a stored list can tick SearchApi on a trial plan: the operator asked for it', () => {
    const c = config({ ...PAID, SEARCHAPI_PLAN: 'trial', NEW_SEARCH_VERIFICATION: 'searchapi' });
    expect(newSearchSourcesFor(c, ALL).verification).toEqual(['searchapi']);
  });
  it('DISCOVERY_REFRESH_DAYS=3 gives every ticked calendar source 72 hours; unset 168', () => {
    const c = config({ TRAVELPAYOUTS_TOKEN: SENTINEL_TP, DISCOVERY_REFRESH_DAYS: '3' });
    expect(defaultDefinitionInput(c, [stub('travelpayouts')]).providers.discoveryRefreshHours).toEqual({
      travelpayouts: 72,
    });
  });
});
