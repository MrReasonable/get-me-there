import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  cellAt,
  cells,
  fixture,
  hoursBefore,
  LGW,
  NOW,
  payloadOf,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedReused,
  seedRule,
  seedVerificationCoverage,
} from './fixtures.js';

describe('one digest per rule per execution (spec §6.8, §9 item 4)', () => {
  it('50 qualifying calendar cells under one absolute rule → one digest, top 10 + 40 more, 50 notified events sharing a digest id', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const rule = seedRule(f, def, { type: 'absolute', thresholdPence: 50000, basis: 'calendar' });
    seedCalendar(
      f,
      ex,
      cells(50).map((cell, i) => ({ cell, pricePence: 40000 + i * 100 })),
    );
    // why: LGW cells keep the verification caveat's cells distinct from the 50 LHR calendar cells.
    seedVerificationCoverage(f, ex, cells(10, LGW), 3);

    const result = await runAlerts(f.deps, ex);

    expect(result).toEqual({ digests: 1, events: 50 });
    expect(f.notifier.sent).toHaveLength(1);
    const [sent] = f.notifier.digests();
    expect(sent?.digest).toMatchObject({
      ruleId: rule.id,
      executionId: ex,
      definitionId: def.id,
      basis: 'calendar',
      restCount: 40,
    });
    expect(sent?.digest.items.map((i) => i.pricePence)).toEqual([
      40000, 40100, 40200, 40300, 40400, 40500, 40600, 40700, 40800, 40900,
    ]);
    expect(sent?.digest.coverageCaveat).toEqual({ itinerarySearched: 3, selected: 10, expandTop: 2 });
    expect(sent?.subject).toBe(
      '[get-me-there] £400 LHR→JFK 1 Nov–15 Nov (14n) · Google date grid via SearchApi · fetched just now · provider age unknown (≤24h before that) · constraints not checked',
    );
    expect(sent?.body).toContain('and 40 more');
    expect(sent?.body).toContain('Coverage: itinerary-searched 3 of 10 cells, 2 outbounds each');

    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 1000 });
    expect(events).toHaveLength(50);
    expect(new Set(events.map((e) => e.status))).toEqual(new Set(['notified']));
    expect(new Set(events.map((e) => payloadOf(e).digestId)).size).toBe(1);
    expect(
      events.every(
        (e) => payloadOf(e).executionId === ex && e.calendarPriceId !== null && e.observationId === null,
      ),
    ).toBe(true);
  });

  it('only calendar prices fetched by this execution count: reused copies, other executions and other cabins are excluded', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const earlier = seedExecution(f, def);
    const list = cells(3);
    const [a, b, c] = [cellAt(list, 0), cellAt(list, 1), cellAt(list, 2)];
    seedCalendar(f, earlier, [{ cell: b, pricePence: 30000, fetchedAt: hoursBefore(NOW, 24) }]);
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 50000, basis: 'calendar' });
    seedReused(f, def, ex, b, hoursBefore(NOW, 48));
    seedCalendar(f, ex, [
      { cell: a, pricePence: 45000 },
      { cell: c, pricePence: 46000, cabin: 'business' },
    ]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[0]?.digest.items.map((i) => i.cell.departureDate)).toEqual([a.departureDate]);
  });

  it('a definition without a verification provider says so; a disabled rule sends nothing', async () => {
    const f = fixture();
    const def = seedDefinition(f, {
      providers: {
        discovery: ['travelpayouts'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168 },
      },
      verification: { maxCells: 0, topN: 0, alwaysInclude: [], expandTop: 2, bookingLinks: false },
    });
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 45000 });
    seedRule(f, def, { thresholdPence: 99999, enabled: false });
    seedCalendar(
      f,
      ex,
      cells(3).map((cell, i) => ({ cell, pricePence: i === 0 ? 40000 : 47000, providerId: 'travelpayouts' })),
    );
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[0]?.digest.coverageCaveat).toBeNull();
    expect(f.notifier.digests()[0]?.body).toContain(
      'Coverage: itinerary-searched 0 cells (no verification provider configured)',
    );
  });

  it('no qualifying price, no rule, or a deleted definition → nothing sent, nothing recorded', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedCalendar(
      f,
      ex,
      cells(2).map((cell) => ({ cell, pricePence: 60000 })),
    );
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    seedRule(f, def, { thresholdPence: 50000 });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    f.repos.definitions.softDelete(def.id);
    seedCalendar(f, ex, [{ cell: cellAt(cells(3), 2), pricePence: 100 }]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.notifier.sent).toHaveLength(0);
  });
});
