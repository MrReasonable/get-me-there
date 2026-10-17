import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { isSynthetic } from '../../src/alerts/pools.js';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  cells,
  fixture,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
} from './fixtures.js';

describe('synthetic rows are refused by the runner (spec §5.5, §6.8, §9 item 4)', () => {
  it('fixture calendar rows and fixture observations never become firings, events or digests', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedRule(f, def, { thresholdPence: 99999, basis: 'calendar' });
    seedRule(f, def, { thresholdPence: 99999, basis: 'verified', requireAllVerified: false });
    seedCalendar(
      f,
      ex,
      cells(5).map((cell) => ({ cell, pricePence: 100, providerId: 'fixture' })),
    );
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 100, synthetic: true });

    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.notifier.sent).toHaveLength(0);
    expect(f.repos.alerts.events({ definitionId: def.id, limit: 100 })).toHaveLength(0);
    const refusals = f.log.lines.filter(
      (l) => l.level === 'warn' && l.msg === 'alerts: synthetic rows refused',
    );
    expect(refusals.map((l) => l.fields.refused).sort()).toEqual([1, 5]);
  });

  it('the check refuses both halves of the invariant; the database cannot store a mismatch, so the predicate is tested directly (review ts-4)', () => {
    expect(isSynthetic({ providerId: 'fixture', sourceKind: 'scraped-aggregate' })).toBe(true);
    expect(isSynthetic({ providerId: 'searchapi', sourceKind: 'synthetic' })).toBe(true);
    expect(isSynthetic({ providerId: 'fixture', sourceKind: 'synthetic' })).toBe(true);
    expect(isSynthetic({ providerId: 'searchapi', sourceKind: 'scraped-aggregate' })).toBe(false);
  });

  it('runAlerts never rejects: a missing execution is logged and reports nothing', async () => {
    const f = fixture();
    expect(await runAlerts(f.deps, 'no-such-execution')).toEqual({ digests: 0, events: 0 });
    expect(
      f.log.lines.some(
        (l) => l.level === 'error' && l.msg === 'alerts: step failed; execution still completes',
      ),
    ).toBe(true);
  });

  it('a notifier that throws is a failed delivery, and one broken rule does not stop the others', async () => {
    const f = fixture();
    f.deps.notifiers.push({ id: 'broken', send: async () => Promise.reject(new Error('socket closed')) });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedCalendar(
      f,
      ex,
      cells(1).map((cell) => ({ cell, pricePence: 40000 })),
    );
    const good = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const broken = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    // why: a rule core cannot judge (absolute with no threshold) stands in for any rule that throws
    f.db.raw.prepare('UPDATE alert_rules SET threshold_pence = NULL WHERE id = ?').run(broken.id);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [event] = f.repos.alerts.events({ ruleId: good.id, limit: 10 });
    expect(event?.status).toBe('queued');
    expect(event?.reason).toContain('not delivered: broken: socket closed');
    expect(
      f.log.lines.some((l) => l.level === 'error' && l.msg === 'alerts: rule failed; other rules continue'),
    ).toBe(true);
  });
});
