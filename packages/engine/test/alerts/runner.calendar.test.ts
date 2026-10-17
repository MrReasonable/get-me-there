import { cellKeyString, type FlightProvider } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  cellAt,
  cells,
  fixture,
  hoursBefore,
  NOW,
  payloadOf,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedRule,
} from './fixtures.js';

// why: discoveryRefreshHours 84 puts the spec §6.8 window (2 × refresh) at 168 h, the boundary spec §6.8 tests at 167/168/169 h.
function scenario() {
  const f = fixture();
  const def = seedDefinition(f, {
    providers: {
      discovery: ['searchapi'],
      verification: ['searchapi'],
      discoveryRefreshHours: { searchapi: 84 },
    },
  });
  const earlier = seedExecution(f, def);
  const list = cells(3);
  const [c167, c168, c169] = [cellAt(list, 0), cellAt(list, 1), cellAt(list, 2)];
  seedCalendar(f, earlier, [
    { cell: c167, pricePence: 50000, fetchedAt: hoursBefore(NOW, 167), maxAgeHours: 168 },
    { cell: c168, pricePence: 50000, fetchedAt: hoursBefore(NOW, 168), maxAgeHours: 168 },
    { cell: c169, pricePence: 50000, fetchedAt: hoursBefore(NOW, 169), maxAgeHours: 168 },
  ]);
  const ex = seedExecution(f, def);
  seedCalendar(
    f,
    ex,
    [c167, c168, c169].map((cell) => ({ cell, pricePence: 40000, maxAgeHours: 168 })),
  );
  return { f, def, ex, c167, c168, c169 };
}

describe('calendar basis (spec §6.8)', () => {
  it('drops compare only with a previous price fetched within 2 × discoveryRefreshHours (167 h, 168 h in; 169 h out)', async () => {
    const { f, def, ex, c167, c168, c169 } = scenario();
    const rule = seedRule(f, def, { type: 'dropAbs', thresholdPence: 5000, basis: 'calendar' });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 3 });
    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    const drops = events.filter((e) => !payloadOf(e).isNew);
    expect(drops.map((e) => e.identityKey).sort()).toEqual(
      [c167, c168].map((c) => `${rule.id}|searchapi|economy|${cellKeyString(c)}`).sort(),
    );
    expect(
      drops.every((e) => payloadOf(e).previous?.pricePence === 50000 && (e.reason ?? '').includes('£500')),
    ).toBe(true);
    // absent-then-present (outside the window) is listed as new, never a drop; the body shows its previous price and
    // the fetch gap (spec §6.8; review PA-9), and the listing is recorded as a notified "new" event (PA-5)
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(
      'New since the last check (no earlier price within the comparison window; not a drop):',
    );
    expect(body).toContain(
      '- £400 LHR→JFK 3 Nov–17 Nov (14n) · Google date grid via SearchApi · fetched just now · provider age unknown (≤7d before that) · previous £500, fetched 7d before this price',
    );
    const listed = events.filter((e) => payloadOf(e).isNew);
    expect(listed.map((e) => [e.identityKey, e.status])).toEqual([
      [`${rule.id}|searchapi|economy|${cellKeyString(c169)}`, 'notified'],
    ]);
    expect(listed[0] === undefined ? null : payloadOf(listed[0])).toMatchObject({
      reason: { kind: 'new', gapHours: 169 },
      previous: { pricePence: 50000 },
    });
  });

  it('a calendar price whose bound its provider assumes reads "assumed" in the email and payload (N4, pie-007)', async () => {
    const { f, def, ex } = scenario();
    // why: SearchApi's date grid states no cache age; its capability marks the app's 24 h bound as assumed
    const assumed: FlightProvider = {
      id: 'searchapi',
      displayName: 'SearchApi (assumed-bound stand-in)',
      suppliedFields: ['price'],
      cabins: ['economy'],
      discovery: {
        info: {
          sourceKind: 'scraped-aggregate',
          provenanceNote: 'stand-in',
          maxAgeHours: 168,
          maxAgeAssumed: true,
        },
        plan: () => [],
        fetchTile: () => Promise.reject(new Error('no HTTP in this test')),
      },
      healthcheck: async () => ({ ok: true, detail: 'not probed' }),
    };
    f.deps.providers.push(assumed);
    const rule = seedRule(f, def, { type: 'absolute', thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('provider age assumed ≤7d (undocumented) before that');
    expect(body).not.toContain('provider age unknown (≤7d');
    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(events.every((e) => payloadOf(e).provenance.maxAgeAssumed === true)).toBe(true);
  });

  it('absolute rules still apply to an absent-then-present cell', async () => {
    const { f, def, ex, c169 } = scenario();
    const rule = seedRule(f, def, { type: 'absolute', thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(
      f.repos.alerts
        .events({ ruleId: rule.id, limit: 100 })
        .some((e) => e.identityKey.endsWith(cellKeyString(c169))),
    ).toBe(true);
  });

  it('a cell first seen by this execution under a drop rule is listed as new; with no drop at all nothing is sent', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 40000 }]);
    seedRule(f, def, { type: 'dropPct', thresholdPence: null, pct: 5, basis: 'calendar' });
    // why: plan decision 10 — "new" listings alone are not a digest
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.notifier.sent).toHaveLength(0);
  });

  it('identity separates providers for the same cell', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const cell = cellAt(cells(1), 0);
    seedCalendar(f, ex, [
      { cell, pricePence: 40000, providerId: 'searchapi' },
      { cell, pricePence: 39000, providerId: 'travelpayouts' },
    ]);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(
      f.repos.alerts
        .events({ ruleId: rule.id, limit: 100 })
        .map((e) => e.identityKey)
        .sort(),
    ).toEqual(
      [
        `${rule.id}|searchapi|economy|${cellKeyString(cell)}`,
        `${rule.id}|travelpayouts|economy|${cellKeyString(cell)}`,
      ].sort(),
    );
  });
});
