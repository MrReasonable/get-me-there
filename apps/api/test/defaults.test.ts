// Spec §8.2 plan preset and §11 form defaults.
import type { FlightProvider, ProviderId } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultDefinitionInput } from '../src/defaults.js';
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
  it('40usd: both providers discover, SearchApi verifies, maxCells 10 / expandTop 2', () => {
    const c = config({
      TRAVELPAYOUTS_TOKEN: SENTINEL_TP,
      SEARCHAPI_KEY: SENTINEL_SA,
      SEARCHAPI_PLAN: '40usd',
    });
    const d = defaultDefinitionInput(c, [stub('travelpayouts'), stub('searchapi')]);
    expect(d.providers.discovery).toEqual(['travelpayouts', 'searchapi']);
    expect(d.providers.verification).toEqual(['searchapi']);
    expect(d.verification).toEqual({
      maxCells: 10,
      topN: 10,
      alwaysInclude: [],
      expandTop: 2,
      bookingLinks: true,
    });
    expect(d.budget).toEqual({ maxCalls: 2000, maxFreeCalls: 2000, maxCostMicroGbp: 0 });
  });
  it('no providers: empty stages; no airports; disabled; weekly schedule in SCHEDULER_TIMEZONE; form defaults', () => {
    const d = defaultDefinitionInput(config({ SCHEDULER_TIMEZONE: 'Europe/London' }), []);
    expect(d.providers.discovery).toEqual([]);
    expect([d.origins, d.destinations, d.enabled]).toEqual([[], [], false]);
    expect([d.scheduleCron, d.scheduleTz]).toEqual(['0 5 * * 1', 'Europe/London']);
    expect(d.window).toEqual({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 });
    expect([d.minNights, d.maxNights, d.cabin]).toEqual([10, 21, 'economy']);
    expect(d.constraints).toEqual({
      maxJourneyMinutes: 1500,
      arrivalWindowLocal: { from: '06:00', to: '23:00' },
    });
    expect(d).not.toHaveProperty('confirmedCostPence');
    expect(d).not.toHaveProperty('confirmedCalls');
  });
});
