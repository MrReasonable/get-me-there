import { type AlertEvent, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { AlertsRepo } from '../src/repositories/alerts.js';
import { CalendarPricesRepo } from '../src/repositories/calendarPrices.js';
import { ItinerariesRepo } from '../src/repositories/itineraries.js';
import { NotificationsRepo } from '../src/repositories/notifications.js';
import { at, freshDb, T0 } from './helpers/db.js';
import { calendarPrice, cell, itinerary, newExecution, observationWrite } from './helpers/factories.js';

// Decision 56: alert events are queued before the send and notified after; an earlier pass's events are found by a
// query on (rule, execution); a "new" listing never suppresses; operator messages are de-duplicated per day.
function setup() {
  const db = freshDb();
  const clock = fixedClock(T0);
  const first = newExecution(db, clock, { status: 'completed' });
  const second = newExecution(db, clock, { definition: first.definition });
  const alerts = new AlertsRepo(db, clock);
  const rule = alerts.create({
    definitionId: first.definition.id,
    type: 'absolute',
    thresholdPence: 45_000,
    pct: null,
    basis: 'calendar',
    requireAllVerified: null,
    cooldownHours: 336,
    enabled: true,
  });
  const prices = new CalendarPricesRepo(db, clock, { allowSynthetic: false });
  const [p1] = prices.insert(first.execution.id, [calendarPrice(cell())]);
  const [p2] = prices.insert(second.execution.id, [calendarPrice(cell())]);
  const itineraries = new ItinerariesRepo(db, clock, { allowSynthetic: false });
  const it = itinerary();
  itineraries.upsertItinerary(it);
  const { observationId } = itineraries.recordObservation(
    { itineraryHash: it.hash, providerId: 'searchapi', seller: 'British Airways', cabin: 'economy' },
    { ...observationWrite(), executionId: second.execution.id },
  );
  if (p1 === undefined || p2 === undefined) throw new Error('fixture');
  const event = (over: Partial<Omit<AlertEvent, 'id'>>): Omit<AlertEvent, 'id'> => ({
    ruleId: rule.id,
    identityKey: 'k',
    observationId: null,
    calendarPriceId: null,
    dedupKey: 'k|412',
    firedAt: T0,
    status: 'queued',
    reason: 'r',
    payload: { isNew: false },
    ...over,
  });
  return { db, clock, alerts, rule, first, second, p1, p2, observationId, event };
}

describe('AlertsRepo event lifecycle (decision 56)', () => {
  it('eventsForExecution returns the rule events whose price row the execution wrote, calendar and observation alike', () => {
    const { alerts, rule, first, second, p1, p2, observationId, event } = setup();
    const a = alerts.insertEvent(event({ calendarPriceId: p1 }));
    const b = alerts.insertEvent(event({ calendarPriceId: p2 }));
    const c = alerts.insertEvent(event({ observationId, status: 'suppressed' }));
    alerts.insertEvent(event({}));
    expect(alerts.eventsForExecution(rule.id, second.execution.id).map((e) => e.id)).toEqual([b, c]);
    expect(alerts.eventsForExecution(rule.id, first.execution.id).map((e) => e.id)).toEqual([a]);
    expect(alerts.eventsForExecution('other-rule', second.execution.id)).toEqual([]);
  });

  it('updateEvents moves statuses in one transaction, keeps or replaces the reason, strips URLs and refuses a missing id', () => {
    const { alerts, rule, second, p2, observationId, event } = setup();
    const a = alerts.insertEvent(event({ calendarPriceId: p2 }));
    const b = alerts.insertEvent(event({ observationId }));
    alerts.updateEvents([a, b], { status: 'notified' });
    expect(alerts.eventsForExecution(rule.id, second.execution.id).map((e) => [e.status, e.reason])).toEqual([
      ['notified', 'r'],
      ['notified', 'r'],
    ]);
    alerts.updateEvents([a], {
      status: 'queued',
      reason: 'not delivered: https://user:pw@mail.example/x?k=1',
    });
    alerts.updateEvents([b], { status: 'suppressed', reason: null });
    const [ea, eb] = alerts.eventsForExecution(rule.id, second.execution.id);
    expect(ea?.status).toBe('queued');
    expect(ea?.reason).not.toMatch(/pw@|k=1/);
    expect(eb).toMatchObject({ status: 'suppressed', reason: null });
    expect(() => alerts.updateEvents([a, 999_999], { status: 'notified' })).toThrow(
      expect.objectContaining({ rule: 'missing' }),
    );
    // the transaction rolled back: `a` is still queued
    expect(alerts.eventsForExecution(rule.id, second.execution.id)[0]?.status).toBe('queued');
  });

  it('a successful retry rewrites the reason, the fire time and the digest id; other payload fields stay (decision 59)', () => {
    const { alerts, rule, second, p2, event } = setup();
    const a = alerts.insertEvent(
      event({
        calendarPriceId: p2,
        reason: 'r; not delivered: refused',
        payload: { digestId: 'd1', isNew: false },
      }),
    );
    alerts.updateEvents([a], {
      status: 'notified',
      reason: 'r',
      firedAt: at('2026-10-14T13:00:00.000Z'),
      digestId: 'd2',
    });
    expect(alerts.eventsForExecution(rule.id, second.execution.id)[0]).toMatchObject({
      status: 'notified',
      reason: 'r',
      firedAt: '2026-10-14T13:00:00.000Z',
      payload: { digestId: 'd2', isNew: false },
    });
    expect(() => alerts.updateEvents([a], { status: 'notified', firedAt: at('not a time') })).toThrow();
  });

  it('priorFirings counts notified firings only: never a queued event or a "new" listing', () => {
    const { alerts, rule, p1, p2, event } = setup();
    alerts.insertEvent(event({ calendarPriceId: p1, status: 'queued' }));
    alerts.insertEvent(event({ calendarPriceId: p1, status: 'notified', payload: { isNew: true } }));
    expect(alerts.priorFirings(rule.id, ['k'], at('2026-10-01T00:00:00.000Z'))).toEqual([]);
    alerts.insertEvent(event({ calendarPriceId: p2, status: 'notified' }));
    alerts.insertEvent(event({ calendarPriceId: p2, status: 'notified', payload: {} }));
    expect(alerts.priorFirings(rule.id, ['k'], at('2026-10-01T00:00:00.000Z'))).toHaveLength(2);
  });
});

describe('NotificationsRepo.lastSent (decision 56: operator messages once per kind per definition per day)', () => {
  it('the newest sent instant of the kind for the definition, any execution; failed sends and other kinds ignored', () => {
    const { db, clock, first, second } = setup();
    const n = new NotificationsRepo(db, clock);
    expect(n.lastSent('paused_budget', first.definition.id)).toBeNull();
    n.record('paused_budget', first.execution.id, first.definition.id, 'sent');
    clock.advance(3_600_000);
    n.record('paused_budget', second.execution.id, first.definition.id, 'failed');
    n.record('paused_error', second.execution.id, first.definition.id, 'sent');
    expect(n.lastSent('paused_budget', first.definition.id)).toBe(T0);
    clock.advance(3_600_000);
    n.record('paused_budget', null, first.definition.id, 'sent');
    expect(n.lastSent('paused_budget', first.definition.id)).toBe(clock.now());
  });
});
