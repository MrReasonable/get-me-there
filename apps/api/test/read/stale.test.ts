// Spec revision 55 §8.1 "Staleness per price": every reader judges a price by core's one per-price rule
// (`stalenessOf`): the search's refresh for the price's provider plus the price's OWN stored age, never the registered
// provider's declared age; CALENDAR_STALE_AFTER_HOURS wins outright. Every age below is a fetch age.
import {
  apiContract,
  asIsoDate,
  asIsoDateTime,
  type DatePair,
  type IsoDateTime,
  type Provenance,
  stalenessOf,
} from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { staleness, staleThresholds } from '../../src/read/rows.js';
import { datesOf, pairOf, resultsOf } from '../helpers/dates.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness, T0 } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const HOUR = 3_600_000;
const ago = (hours: number): IsoDateTime =>
  asIsoDateTime(new Date(Date.parse(T0) - hours * HOUR).toISOString());
const prov = (over: Partial<Provenance>): Provenance => ({
  providerId: 'camoufox',
  sourceKind: 'scraped-self',
  fetchedAt: ago(1),
  maxAgeHours: 0,
  fx: { converted: false },
  pointOfSale: 'GB',
  cabin: 'economy',
  ...over,
});
const t = (refreshHours: number, overrideHours: number | null = null) => ({
  refreshHours,
  overrideHours,
  staleAfterHours: 192,
});

describe('core stalenessOf as every reader calls it (revision 55 §8.1)', () => {
  it('a browser list-mode row (stored age 0) fetched 1 h ago under refresh 168 is not stale', () => {
    expect(stalenessOf({ provenance: prov({}), basis: 'calendar' }, t(168), T0).stale).toBe(false);
  });

  it('stored age 24 under refresh 1: not stale fetched 1 h ago (25 against 25, strictly greater), stale at 2 h (the old declared-age rule gave 1)', () => {
    const row = (h: number) => ({
      provenance: prov({ maxAgeHours: 24, fetchedAt: ago(h) }),
      basis: 'calendar' as const,
    });
    expect(stalenessOf(row(1), t(1), T0).stale).toBe(false);
    expect(stalenessOf(row(2), t(1), T0).stale).toBe(true);
  });

  it('168 h under refresh 168 is not stale, 169 h is, whichever run fetched it', () => {
    expect(
      stalenessOf({ provenance: prov({ fetchedAt: ago(168) }), basis: 'calendar' }, t(168), T0).stale,
    ).toBe(false);
    expect(
      stalenessOf({ provenance: prov({ fetchedAt: ago(169) }), basis: 'calendar' }, t(168), T0).stale,
    ).toBe(true);
  });

  it('a vendor-dated price keeps its own age: fetched 1 h ago, observed 20 days ago, is stale (prov-001)', () => {
    const p = prov({
      providerId: 'travelpayouts',
      sourceKind: 'authorised-cached',
      maxAgeHours: 48,
      providerObservedAt: ago(20 * 24),
    });
    expect(stalenessOf({ provenance: p, basis: 'calendar' }, t(168), T0).stale).toBe(true);
  });

  it('the verified basis reads STALE_AFTER_HOURS alone; the override wins outright with its own mark', () => {
    const p = prov({ fetchedAt: ago(191), maxAgeHours: 'unknown' });
    expect(stalenessOf({ provenance: p, basis: 'verified' }, t(1), T0).stale).toBe(false);
    const o = stalenessOf({ provenance: prov({ fetchedAt: ago(3) }), basis: 'calendar' }, t(168, 2), T0);
    expect([o.stale, o.markText]).toEqual([true, 'older than your stale setting']);
  });
});

describe('the api readers go through it (one case each over the same row)', () => {
  /** One fixture row stored with age 24, fetched 1 h ago, under a refresh of 1 h; the fixture declares no age of 24. */
  async function world(env: Record<string, string> = {}) {
    h = await createHarness({ env });
    const x = h;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-02') },
        minNights: 10,
        maxNights: 10,
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 1 } },
      }),
    );
    const c = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
    const s = seeder(x.ports);
    s.execution('E', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E', [c]);
    s.tile('E', c, { status: 'priced', pricePence: 41_000, fetchedAt: at(-1), maxAgeHours: 24 });
    return { x, def };
  }
  const figureOf = (pairs: DatePair) => pairs.figure?.price.stale;

  it('rows.ts, the date-pairs figure, /results and route history: not stale at 1 h, stale at 2 h', async () => {
    const { x, def } = await world();
    const route = async () =>
      apiContract.routeHistoryResponseSchema
        .parse(await (await x.request('/api/routes/LHR/JFK/history')).json())
        .calendarSeries.flatMap((s) => s.points.map((p) => p.stale));
    const read = async () => [
      figureOf(pairOf(await datesOf(x, def.id), '2026-11-02', '2026-11-12')),
      (await resultsOf(x, def.id, '?basis=calendar')).rows[0]?.stale,
      ...(await route()),
    ];
    expect(await read()).toEqual([false, false, false]);
    const row = x.ports.repos.calendarPrices.heldBy(
      x.ports.repos.executions.listForDefinition(def.id, { limit: 1, includeChildren: false })[0]?.id ?? '',
    )[0];
    if (row === undefined) throw new Error('no row');
    expect(
      staleness(row.provenance, 'calendar', { def, config: x.ports.config, now: x.clock.now() }).stale,
    ).toBe(false);
    expect(staleThresholds({ def, config: x.ports.config }, 'fixture')).toEqual({
      refreshHours: 1,
      overrideHours: null,
      staleAfterHours: x.ports.config.staleAfterHours,
    });
    x.clock.advance(HOUR);
    expect(await read()).toEqual([true, true, true]);
  });

  it('CALENDAR_STALE_AFTER_HOURS wins outright: the same row is stale at 3 h under an override of 2', async () => {
    const { x, def } = await world({ CALENDAR_STALE_AFTER_HOURS: '2' });
    x.clock.advance(2 * HOUR);
    expect((await resultsOf(x, def.id, '?basis=calendar')).rows[0]?.stale).toBe(true);
    const d = await datesOf(x, def.id);
    expect(d).not.toHaveProperty('calendarStaleAfterHours');
  });
});
