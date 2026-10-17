// Spec §6.5, §6.9, §8.1 `/results`: basis, dedup, ranking, cap, staleness (decision 44), notSeenInLatest, children,
// excluded rows (review focus 4), truncation (decisions 36, 47).
import { apiContract, type Constraints, TRUNCATED_NOTE } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { API_TEXT } from '../../src/text.js';
import { expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at, cell, seeder } from '../helpers/seed.js';

const RESULTS = apiContract.resultsResponseSchema;
const C1 = cell('LHR', 'JFK', '2026-11-02', '2026-11-12');
const C2 = cell('LHR', 'JFK', '2026-11-03', '2026-11-13');
const C3 = cell('LHR', 'JFK', '2026-11-04', '2026-11-14');
const HOUR = 3_600_000;

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

/**
 * Three itinerary-searched rows in one parent execution, one per class under { maxStops: 1, checkedBagRequired: true }:
 * hV £600 verified, hP £400 partially-verified (baggage not supplied), hF £300 failed (two stops).
 */
async function world(constraints: Constraints = { maxStops: 1, checkedBagRequired: true }) {
  const x = await createHarness();
  h = x;
  const s = seeder(x.ports);
  const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints }));
  s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
  s.cells('E1', [C1, C2, C3], { selected: [C1, C2, C3].map((c) => ({ cell: c, reason: 'top_n' as const })) });
  s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-1) }]);
  s.verified('E1', C2, [{ hash: 'hP', pricePence: 40_000, fetchedAt: at(-1), baggage: null }]);
  s.verified('E1', C3, [{ hash: 'hF', pricePence: 30_000, fetchedAt: at(-1), stopsOut: 2 }]);
  return { x, def, s };
}

async function results(x: Harness, defId: string, query = '') {
  return expectContract(
    await x.request(`/api/definitions/${defId}/results${query}`),
    'GET',
    '/api/definitions/:id/results',
    RESULTS,
  );
}

describe('GET /definitions/:id/results, verified basis', () => {
  it('returns every class, ranked by class then price, each row with provenance', async () => {
    const { x, def, s } = await world();
    const r = await results(x, def.id);
    expect(r.basis).toBe('verified');
    expect(r.basisReason).toBe(API_TEXT.basisItinerarySearch);
    expect(r.rows.map((row) => row.itineraryHash)).toEqual(['hV', 'hP', 'hF']);
    expect(r.rows.map((row) => row.verdictClass)).toEqual(['verified', 'partially-verified', 'failed']);
    expect(r.rows[1]?.unverified).toContain('checkedBagRequired');
    expect([r.total, r.truncated, r.excludedByCurrentSpace, r.verificationProviderConfigured]).toEqual([
      3,
      false,
      0,
      true,
    ]);
    expect(r.cheapest?.itineraryHash).toBe('hV'); // the headline row: best class first, then price
    expect(r.rows.map((row) => row.executionId)).toEqual([s.id('E1'), s.id('E1'), s.id('E1')]);
    expect(r.rows[0]?.observationId).not.toBeNull();
    for (const row of r.rows) {
      expect(row.provenance.fetchedAt).toBe(at(-1));
      expect([row.stale, row.ageHours, row.truncated]).toEqual([false, 1, false]);
    }
  });

  it('recomputes verdicts at read time after a constraint edit', async () => {
    const { x, def } = await world();
    const put = await x.request(`/api/definitions/${def.id}`, {
      method: 'PUT',
      json: { constraints: { maxStops: 1, checkedBagRequired: true, maxPricePence: 50_000 } },
    });
    expect(put.status).toBe(200);
    const r = await results(x, def.id);
    expect(r.rows.map((row) => [row.itineraryHash, row.verdictClass])).toEqual([
      ['hP', 'partially-verified'],
      ['hF', 'failed'],
      ['hV', 'failed'],
    ]);
  });

  it('returns stale rows labelled, never hidden (STALE_AFTER_HOURS 192 against the fetch age)', async () => {
    const { x, def } = await world();
    x.clock.advance(200 * HOUR); // 201 h > 192
    const r = await results(x, def.id);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((row) => row.stale && row.ageHours === 201)).toBe(true);
  });

  it('an unknown vendor age is aged by fetchedAt alone and is not stale for that reason (decision 44, spec rev 23)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1, C2], { selected: [C1, C2].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.verified('E1', C1, [{ hash: 'hU', pricePence: 50_000, fetchedAt: at(-1), maxAgeHours: 'unknown' }]);
    s.verified('E1', C2, [{ hash: 'hK', pricePence: 51_000, fetchedAt: at(-1), maxAgeHours: 48 }]);
    x.clock.advance(150 * HOUR); // fetch age 151 h: under 192 alone, over it with a known 48 h
    const rows = (await results(x, def.id)).rows;
    expect(rows.find((r) => r.itineraryHash === 'hU')).toMatchObject({ stale: false, ageHours: 151 });
    expect(rows.find((r) => r.itineraryHash === 'hU')?.provenance.maxAgeHours).toBe('unknown'); // the label's source
    expect(rows.find((r) => r.itineraryHash === 'hK')).toMatchObject({ stale: true, ageHours: 199 });
    x.clock.advance(50 * HOUR); // fetch age 201 h: stale by fetch age, whatever the vendor's age
    expect((await results(x, def.id)).rows.find((r) => r.itineraryHash === 'hU')?.stale).toBe(true);
  });

  it('dedups per itinerary: the best offer (same class, cheaper) is the row, the others are in otherOffers with their class', async () => {
    const { x, def, s } = await world();
    s.verified('E1', C1, [{ hash: 'hV', seller: 'OTA', pricePence: 58_000, fetchedAt: at(-1) }]);
    const r = await results(x, def.id);
    const hv = r.rows.filter((row) => row.itineraryHash === 'hV');
    expect(hv).toHaveLength(1);
    expect(hv[0]?.pricePence).toBe(58_000);
    expect(hv[0]?.otherOffers.map((o) => [o.seller, o.pricePence, o.verdictClass])).toEqual([
      ['BA', 60_000, 'verified'],
    ]);
    expect(hv[0]?.otherOffers[0]?.provenance.providerId).toBe('fixture');
  });

  it('caps at limit with truncated and total; refuses a limit above 1000', async () => {
    const { x, def } = await world();
    const r = await results(x, def.id, '?limit=2');
    expect([r.rows.length, r.total, r.truncated]).toEqual([2, 3, true]);
    expect((await x.request(`/api/definitions/${def.id}/results?limit=1001`)).status).toBe(400);
  });

  it('includes children; marks rows not seen in the newer search and ranks them after seen rows', async () => {
    const { x, def, s } = await world();
    s.execution('E2', { def, status: 'completed', startedAt: at(-0.5), finishedAt: at(-0.5), child: C1 });
    s.cells('E2', [C1], { discovery: [], selected: [{ cell: C1, reason: 'always_include' }] });
    s.verified('E2', C1, [{ hash: 'hC', pricePence: 65_000, fetchedAt: at(-0.5) }]);
    const r = await results(x, def.id);
    const order = r.rows.map((row) => row.itineraryHash);
    expect(order.indexOf('hC')).toBeLessThan(order.indexOf('hV')); // why: hC is dearer but seen in the latest search
    expect(r.rows.find((row) => row.itineraryHash === 'hC')?.notSeenInLatest).toBeNull();
    expect(r.rows.find((row) => row.itineraryHash === 'hV')?.notSeenInLatest).toEqual({ ageHours: 0 });
    expect(r.rows.find((row) => row.itineraryHash === 'hP')?.notSeenInLatest).toBeNull();
    expect(r.coverage.onDemand).toBe(1);
    expect(r.executions.map((e) => e.id)).toEqual([s.id('E2'), s.id('E1')]); // newest first
  });

  it('every execution summary carries the run snapshot expandTop (decision 42)', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const s = seeder(x.ports);
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    x.ports.repos.definitions.update(def.id, { verification: { ...def.verification, expandTop: 3 } });
    const r = await expectContract(
      await x.request(`/api/definitions/${def.id}/results`),
      'GET',
      '/api/definitions/:id/results',
      apiContract.resultsResponseSchema,
    );
    expect(r.executions.map((e) => e.expandTop)).toEqual([2]);
  });
  it('scopes to one execution with executionId; 404 for a foreign one', async () => {
    const { x, def, s } = await world();
    expect((await results(x, def.id, `?executionId=${s.id('E1')}`)).total).toBe(3);
    expect((await x.request(`/api/definitions/${def.id}/results?executionId=nope`)).status).toBe(404);
    const other = x.ports.repos.definitions.create(exampleDefinitionInput({ name: 'other' }));
    s.execution('EO', { def: other, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    expect((await x.request(`/api/definitions/${def.id}/results?executionId=${s.id('EO')}`)).status).toBe(
      404,
    );
  });

  it('an older run picked with executionId still shows its own price after a newer run priced the cell again (review prov-003)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-29) });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('Enew', [C1]);
    s.tile('Enew', C1, { status: 'priced', pricePence: 47_000, fetchedAt: at(-1) });
    const scoped = await results(x, def.id, `?basis=calendar&executionId=${s.id('Eold')}`);
    expect(scoped.rows.map((r) => [r.pricePence, r.executionId])).toEqual([[45_000, s.id('Eold')]]);
    expect(scoped.executions.map((e) => e.id)).toEqual([s.id('Eold')]);
    const latest = await results(x, def.id, '?basis=calendar');
    expect(latest.rows.map((r) => r.pricePence)).toEqual([47_000]);
  });

  it('scoped to an older run, an offer the newest search also returned is not marked not-seen (review prov I1)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E1', C1, [{ hash: 'hV', pricePence: 60_000, fetchedAt: at(-29) }]);
    s.execution('E2', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E2', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E2', C1, [
      { hash: 'hV', pricePence: 61_000, fetchedAt: at(-1) },
      { hash: 'hN', pricePence: 70_000, fetchedAt: at(-1) },
    ]);
    const old = await results(x, def.id, `?executionId=${s.id('E1')}`);
    expect(old.rows.map((r) => [r.itineraryHash, r.notSeenInLatest])).toEqual([['hV', null]]);
    // The control: an offer the newest search did not return is still marked, scoped or not.
    s.execution('E3', { def, status: 'completed', startedAt: at(-0.5), finishedAt: at(-0.5) });
    s.cells('E3', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
    s.verified('E3', C1, [{ hash: 'hN', pricePence: 69_000, fetchedAt: at(-0.5) }]);
    const again = await results(x, def.id, `?executionId=${s.id('E1')}`);
    expect(again.rows.map((r) => [r.itineraryHash, r.notSeenInLatest])).toEqual([['hV', { ageHours: 0 }]]);
  });

  it('an unconfirmed fare ranks after a confirmed one of its class and is never the headline while one exists (review prov I2)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({ constraints: { maxStops: 1, checkedBagRequired: true } }),
    );
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1, C2, C3], {
      selected: [C1, C2, C3].map((c) => ({ cell: c, reason: 'top_n' as const })),
    });
    s.verified('E1', C1, [
      { hash: 'hU', pricePence: 38_000, fetchedAt: at(-1), baggage: null, confirmed: false },
    ]);
    s.verified('E1', C2, [{ hash: 'hP', pricePence: 40_000, fetchedAt: at(-1), baggage: null }]);
    // One itinerary with an unconfirmed cheaper offer and a confirmed dearer one: the confirmed offer is the row.
    s.verified('E1', C3, [
      { hash: 'hD', seller: 'OTA', pricePence: 37_000, fetchedAt: at(-1), baggage: null, confirmed: false },
      { hash: 'hD', seller: 'BA', pricePence: 41_000, fetchedAt: at(-1), baggage: null },
    ]);
    const r = await results(x, def.id);
    expect(r.rows.map((row) => [row.itineraryHash, row.seller, row.pricePence])).toEqual([
      ['hP', 'BA', 40_000],
      ['hD', 'BA', 41_000],
      ['hU', 'BA', 38_000],
    ]);
    expect(r.rows[1]?.otherOffers.map((o) => [o.seller, o.pricePence])).toEqual([['OTA', 37_000]]);
    expect(r.cheapest?.itineraryHash).toBe('hP');
  });

  it('the headline is an unconfirmed fare only when no confirmed offer exists, and keeps its mark (review prov I2)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput({ constraints: { maxStops: 0 } }));
    s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E1', [C1, C2], { selected: [C1, C2].map((c) => ({ cell: c, reason: 'top_n' as const })) });
    s.verified('E1', C1, [{ hash: 'hU', pricePence: 38_000, fetchedAt: at(-1), confirmed: false }]);
    expect((await results(x, def.id)).cheapest?.verdicts.priceConfirmed).toBe('unverified');
    // A confirmed offer of a lower class still heads the headline (the ruling: never unconfirmed while one exists).
    s.verified('E1', C2, [{ hash: 'hF', pricePence: 50_000, fetchedAt: at(-1), stopsOut: 1 }]);
    const r = await results(x, def.id);
    expect(r.rows.map((row) => [row.itineraryHash, row.verdictClass])).toEqual([
      ['hU', 'partially-verified'],
      ['hF', 'failed'],
    ]);
    expect(r.cheapest?.itineraryHash).toBe('hF');
  });

  it.each([
    ['a javascript: URL', { kind: 'get', url: 'javascript:alert(1)', host: 'x' }],
    ['plain http', { kind: 'get', url: 'http://www.google.com/travel/flights', host: 'www.google.com' }],
    ['userinfo', { kind: 'get', url: 'https://user:pw@www.google.com/travel', host: 'www.google.com' }],
    [
      'a suffix look-alike',
      { kind: 'get', url: 'https://www.google.com.evil.example/', host: 'www.google.com.evil.example' },
    ],
    ['a port', { kind: 'get', url: 'https://www.google.com:8443/travel', host: 'www.google.com' }],
    [
      "another provider's host",
      { kind: 'get', url: 'https://www.google.com/travel/flights', host: 'www.google.com' },
    ],
    [
      'a post off the allowlist',
      { kind: 'post', url: 'https://evil.example/book', postData: 'a=1', host: 'evil.example' },
    ],
  ] as const)(
    'a stored booking with %s is dropped on the way out (decision 54, reviews SEC-9, SEC-R2-3)',
    async (_label, booking) => {
      const x = await createHarness();
      h = x;
      const s = seeder(x.ports);
      const def = x.ports.repos.definitions.create(exampleDefinitionInput());
      s.execution('E1', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
      s.cells('E1', [C1], { selected: [{ cell: C1, reason: 'top_n' }] });
      s.verified('E1', C1, [{ hash: 'hJ', pricePence: 50_000, fetchedAt: at(-1), booking }]);
      const r = await results(x, def.id);
      expect(r.rows.map((row) => [row.itineraryHash, row.booking, row.searchLink])).toEqual([
        ['hJ', { kind: 'none' }, null],
      ]);
    },
  );
});

describe('GET /definitions/:id/results, calendar basis (spec §6.9)', () => {
  it('is the default with no verification provider, with the reason, unchecked rows, not-applied list and no search link for synthetic rows', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(
      exampleDefinitionInput({
        providers: { discovery: ['fixture'], verification: [], discoveryRefreshHours: { fixture: 168 } },
        constraints: { maxJourneyMinutes: 1500 },
      }),
    );
    const s = seeder(x.ports);
    s.execution('E3', { def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    s.cells('E3', [C1]);
    s.tile('E3', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-3) });
    const r = await results(x, def.id);
    expect(r.basis).toBe('calendar');
    expect(r.basisReason).toBe(API_TEXT.basisNoVerificationProvider);
    expect(r.verificationProviderConfigured).toBe(false);
    const row = r.rows[0];
    expect(row?.verdictClass).toBe('unchecked');
    expect(row?.notApplied).toEqual(['maxJourneyMinutes']);
    expect(row?.booking).toEqual({ kind: 'none' });
    expect(row?.searchLink).toBeNull(); // why: synthetic (fixture) rows have no search link (plan decision 15)
    expect(row?.outbound).toBeNull();
    expect([row?.calendarPriceId === null, row?.observationId, row?.seller, row?.layovers]).toEqual([
      false,
      null,
      null,
      [],
    ]);
    expect([row?.stale, row?.ageHours, row?.truncated]).toEqual([false, 3 + 24, false]);
  });

  it('marks a price from a truncated tile with truncated, from the outcome last_error (decisions 36, 47)', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const s = seeder(x.ports);
    s.execution('E3', { def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    s.cells('E3', [C1, C2]);
    s.tile('E3', C1, {
      status: 'priced',
      pricePence: 45_000,
      fetchedAt: at(-3),
      lastError: `${TRUNCATED_NOTE} (3 pages)`,
    });
    s.tile('E3', C2, { status: 'priced', pricePence: 46_000, fetchedAt: at(-3), tileIndex: 1 });
    const rows = (await results(x, def.id, '?basis=calendar')).rows;
    expect(rows.map((r) => [r.pricePence, r.truncated])).toEqual([
      [45_000, true],
      [46_000, false],
    ]);
  });

  it('a calendar price is stale only past the refresh plus the provider age (spec §8.1)', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const s = seeder(x.ports);
    s.execution('E3', { def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    s.cells('E3', [C1]);
    s.tile('E3', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-1), maxAgeHours: 24 });
    x.clock.advance(150 * HOUR);
    expect((await results(x, def.id, '?basis=calendar')).rows[0]?.stale).toBe(true); // 151 + 24 > 168 + 0 declared
  });

  it('is the default when a verification provider exists but nothing was itinerary-searched', async () => {
    const x = await createHarness();
    h = x;
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const s = seeder(x.ports);
    s.execution('E3', { def, status: 'completed', startedAt: at(-4), finishedAt: at(-3) });
    s.cells('E3', [C1]);
    s.tile('E3', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-3) });
    expect((await results(x, def.id)).basisReason).toBe(API_TEXT.basisNoObservations);
  });

  it('a calendar price a later search found empty is marked superseded and ranked after current prices (decision 54)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1, C2]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-29) });
    s.tile('Eold', C2, { status: 'priced', pricePence: 50_000, fetchedAt: at(-29), tileIndex: 1 });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-3), finishedAt: at(-2) });
    s.cells('Enew', [C1, C2]);
    s.tile('Enew', C1, { status: 'empty', fetchedAt: at(-2) });
    s.tile('Enew', C2, { status: 'priced', pricePence: 52_000, fetchedAt: at(-2), tileIndex: 1 });
    const r = await results(x, def.id, '?basis=calendar');
    expect(r.rows.map((row) => [row.pricePence, row.superseded])).toEqual([
      [52_000, false],
      [30_000, true],
    ]);
  });

  it('superseded compares with the latest run that searched the cell: a newer run that skipped it does not clear the mark (decision 58)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('E1', { def, status: 'completed', startedAt: at(-50), finishedAt: at(-49) });
    s.cells('E1', [C1]);
    s.tile('E1', C1, { status: 'priced', pricePence: 30_000, fetchedAt: at(-49) });
    s.execution('E2', { def, status: 'completed', startedAt: at(-20), finishedAt: at(-19) });
    s.cells('E2', [C1, C2]);
    s.tile('E2', C1, { status: 'empty', fetchedAt: at(-19) });
    s.tile('E2', C2, { status: 'priced', pricePence: 31_000, fetchedAt: at(-19), tileIndex: 1 });
    s.execution('E3', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('E3', [C1, C2]); // not_run: E3 searched neither cell
    const r = await results(x, def.id, '?basis=calendar');
    // C1: E2's "no fares" still marks E1's price; C2: E2's price is the latest search's own, never superseded
    expect(r.rows.map((row) => [row.pricePence, row.superseded])).toEqual([
      [31_000, false],
      [30_000, true],
    ]);
  });

  it('a run picked with executionId shows the prices it reused, as its coverage counts them (decision 58)', async () => {
    const x = await createHarness();
    h = x;
    const s = seeder(x.ports);
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    s.execution('Eold', { def, status: 'completed', startedAt: at(-30), finishedAt: at(-29) });
    s.cells('Eold', [C1]);
    s.tile('Eold', C1, { status: 'priced', pricePence: 41_000, fetchedAt: at(-29) });
    s.execution('Enew', { def, status: 'completed', startedAt: at(-2), finishedAt: at(-1) });
    s.cells('Enew', [C1, C2]);
    s.reuse('Enew', 'Eold', [C1], at(-100));
    s.tile('Enew', C2, { status: 'priced', pricePence: 52_000, fetchedAt: at(-1), tileIndex: 1 });
    const r = await results(x, def.id, `?basis=calendar&executionId=${s.id('Enew')}`);
    expect(r.rows.map((row) => [row.pricePence, row.provenance.fetchedAt]).sort()).toEqual([
      [41_000, at(-29)],
      [52_000, at(-1)],
    ]);
  });

  it('can be requested explicitly, and ignores reused copies', async () => {
    const { x, def, s } = await world();
    s.tile('E1', C1, { status: 'priced', pricePence: 45_000, fetchedAt: at(-3) });
    s.execution('E4', { def, status: 'completed', startedAt: at(-0.2), finishedAt: at(-0.1) });
    s.cells('E4', [C1]);
    s.reuse('E4', 'E1', [C1], at(-100));
    const r = await results(x, def.id, '?basis=calendar');
    expect(r.basisReason).toBe(API_TEXT.basisRequestedCalendar);
    expect(r.rows).toHaveLength(1);
    expect([r.rows[0]?.executionId, r.rows[0]?.provenance.fetchedAt]).toEqual([s.id('E1'), at(-3)]);
  });
});

describe('review focus 4: the definition is edited after the rows were written', () => {
  it('reports the excluded count and says "0 of 3 rows are inside…" rather than "no results"', async () => {
    const { x, def, s } = await world();
    for (const [i, [c, p]] of (
      [
        [C1, 45_000],
        [C2, 46_000],
        [C3, 47_000],
      ] as const
    ).entries())
      s.tile('E1', c, { status: 'priced', pricePence: p, fetchedAt: at(-1), tileIndex: i });
    expect(
      (await x.request(`/api/definitions/${def.id}`, { method: 'PUT', json: { minNights: 11 } })).status,
    ).toBe(200);
    for (const q of ['?basis=calendar', '?basis=verified', '']) {
      const r = await results(x, def.id, q);
      expect(r.rows).toEqual([]);
      expect([r.total, r.excludedByCurrentSpace]).toEqual([0, 3]);
      expect(r.basisReason).toContain(API_TEXT.insideSpace(0, 3));
    }
  });
});
