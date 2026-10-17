// Spec §6.8, §10 alert rule storage and events (WP11 evaluates and delivers).
import { apiContract } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { errorOf, expectContract } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { at } from '../helpers/seed.js';

const RULE = apiContract.alertRuleSchema;
let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});
async function harness(): Promise<Harness> {
  h = await createHarness();
  return h;
}

const rule = (definitionId: string) => ({
  definitionId,
  type: 'absolute',
  thresholdPence: 50_000,
  pct: null,
  basis: 'verified',
  requireAllVerified: true,
  cooldownHours: 336,
  enabled: true,
});

describe('alert rules (spec §6.8, §10; storage only, WP11 evaluates)', () => {
  it('create, list, update, delete', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const created = await x.request('/api/alerts', { json: rule(def.id) });
    expect(created.status).toBe(201);
    const r = await expectContract(created, 'POST', '/api/alerts', RULE);
    const listed = await expectContract(
      await x.request(`/api/alerts?definitionId=${def.id}`),
      'GET',
      '/api/alerts',
      RULE.array(),
    );
    expect(listed).toHaveLength(1);
    const put = await x.request(`/api/alerts/${r.id}`, { method: 'PUT', json: { thresholdPence: 40_000 } });
    expect((await expectContract(put, 'PUT', '/api/alerts/:id', RULE)).thresholdPence).toBe(40_000);
    expect((await x.request(`/api/alerts/${r.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await x.request(`/api/alerts?definitionId=${def.id}`)).json()).toEqual([]);
    const gone = await x.request(`/api/alerts/${r.id}`, { method: 'DELETE' });
    expect(gone.status).toBe(404);
    expect((await errorOf(gone)).code).toBe('alert_not_found');
  });

  it('requireAllVerified is rejected on calendar basis, on create and through a partial update', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    expect((await x.request('/api/alerts', { json: { ...rule(def.id), basis: 'calendar' } })).status).toBe(
      400,
    );
    const r = await expectContract(
      await x.request('/api/alerts', { json: rule(def.id) }),
      'POST',
      '/api/alerts',
      RULE,
    );
    const res = await x.request(`/api/alerts/${r.id}`, { method: 'PUT', json: { basis: 'calendar' } });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('invalid_alert_rule');
  });

  it('a rule for an unknown definition is refused', async () => {
    const x = await harness();
    const res = await x.request('/api/alerts', { json: rule('nope') });
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('definition_not_found');
  });

  it('lists events by rule and by definition; events are kept after a soft delete', async () => {
    const x = await harness();
    const def = x.ports.repos.definitions.create(exampleDefinitionInput());
    const r = await expectContract(
      await x.request('/api/alerts', { json: rule(def.id) }),
      'POST',
      '/api/alerts',
      RULE,
    );
    x.ports.repos.alerts.insertEvent({
      ruleId: r.id,
      identityKey: `${r.id}|hV`,
      observationId: null,
      calendarPriceId: null,
      dedupKey: `${r.id}|hV|500`,
      firedAt: at(-1),
      // why: 'suppressed' is a status before and after WP11's migration 0002 (sent → notified, failed → queued), and the
      // payload has WP11's alertEventPayloadSchema shape, so this test holds on either side of WP11 (decision 56)
      status: 'suppressed',
      reason: 'below £500',
      payload: {
        digestId: null,
        executionId: 'ex-1',
        pricePence: 41_200,
        provenance: {
          providerId: 'fixture',
          sourceKind: 'synthetic',
          fetchedAt: at(-1),
          maxAgeHours: 'unknown',
          fx: { converted: false },
          pointOfSale: 'unknown',
          cabin: 'economy',
        },
        previous: null,
        isNew: false,
        route: 'LHR→JFK 2 Nov–12 Nov (10n)',
        verdictClass: 'verified',
        unverified: [],
        reason: { kind: 'threshold', gapHours: null },
        staleThresholdHours: 192,
        truncated: false,
        notSeenInLatest: null,
      },
    });
    const EVENTS = apiContract.alertEventSchema.array();
    const events = await expectContract(
      await x.request(`/api/alerts/events?ruleId=${r.id}`),
      'GET',
      '/api/alerts/events',
      EVENTS,
    );
    expect(events.map((e) => [e.status, e.reason])).toEqual([['suppressed', 'below £500']]);
    expect((await x.request(`/api/alerts/${r.id}`, { method: 'DELETE' })).status).toBe(200);
    const after = (q: string) =>
      x
        .request(`/api/alerts/events?${q}`)
        .then((res) => expectContract(res, 'GET', '/api/alerts/events', EVENTS));
    expect(await after(`ruleId=${r.id}`)).toHaveLength(1);
    expect(await after(`definitionId=${def.id}`)).toHaveLength(1);
    expect(await after('definitionId=other')).toHaveLength(0);
  });
});
