// The real http-kit (WP4) over the package's fakes (test/fakes.ts), with SearchApi's own limits.
import { PLAN_PRESETS, type ProviderContext } from '@gmt/core';
import type { ProviderHttpLimits } from '../../../src/http/types.js';
import { assertRequestAllowed } from '../../../src/params/allowlist.js';
import { searchApiHttpLimits } from '../../../src/searchapi/errors.js';
import { SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_PARAMS } from '../../../src/searchapi/params.js';
import { type FakeBudget, type LedgerEvent, makeKit, SENTINELS } from '../../fakes.js';

/** The sentinel key: asserted never to reach any sink but the Authorization header (spec §5.3). */
export const KEY = SENTINELS.searchapi;

/** SearchApi limits as wired, with generous rates so bottleneck never queues a chain; classification unchanged. */
export function saLimits(over: Partial<ProviderHttpLimits> = {}): ProviderHttpLimits {
  return {
    ...searchApiHttpLimits(PLAN_PRESETS['40usd'], { maxWaitSeconds: 3900, requestTimeoutSeconds: 60 }),
    ratePerMinute: 600,
    ratePerHour: 36_000,
    concurrency: 4,
    ...over,
  };
}

const logs: LedgerEvent[][] = [];

/** makeKit with only the searchapi limits and syntheticAllowed false, as production wiring builds it. */
export function saKit(o: { budget?: FakeBudget; limits?: Partial<ProviderHttpLimits> } = {}) {
  const k = makeKit({
    limits: { searchapi: saLimits(o.limits) },
    syntheticAllowed: false,
    ...(o.budget === undefined ? {} : { budget: o.budget }),
  });
  logs.push(k.events);
  return k;
}

/** Upstream request URLs msw saw, from makeKit's fetch events. */
export function sentUrls(events: readonly LedgerEvent[]): URL[] {
  return events.flatMap((e) => (e.type === 'fetch' ? [new URL(e.url)] : []));
}

/**
 * Spec §5.2 / §9 item 2: every request any kit sent since the last call has names and values in the dated
 * allowlist. Each test file calls it in afterEach.
 */
export function assertEverySentAllowed(): void {
  for (const url of logs.splice(0).flatMap(sentUrls))
    assertRequestAllowed(SEARCHAPI_PARAMS, SEARCHAPI_ENDPOINT_PATH, url);
}

export function ctx(signal: AbortSignal = new AbortController().signal): ProviderContext {
  return { executionId: 'exec-test', signal, recordFixtures: false };
}
