import { type AlertRuleInput, asIsoDate, fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { RowRejected } from '../src/internal/validate.js';
import { AlertsRepo } from '../src/repositories/alerts.js';
import { CalendarPricesRepo } from '../src/repositories/calendarPrices.js';
import { NotificationsRepo } from '../src/repositories/notifications.js';
import { RoutePriceHistoryRepo } from '../src/repositories/routePriceHistory.js';
import { at, freshDb, sqliteCode, T0 } from './helpers/db.js';
import { calendarPrice, cell, JFK, LHR, newExecution } from './helpers/factories.js';

function setup() {
  const db = freshDb();
  const clock = fixedClock(T0);
  const { definition, execution } = newExecution(db, clock);
  const rule: AlertRuleInput = {
    definitionId: definition.id,
    type: 'absolute',
    thresholdPence: 45_000,
    pct: null,
    basis: 'verified',
    requireAllVerified: true,
    cooldownHours: 336,
    enabled: true,
  };
  return { db, clock, definition, executionId: execution.id, rule, alerts: new AlertsRepo(db, clock) };
}

describe('AlertsRepo (spec §6.8, §7 alert_rules / alert_events)', () => {
  it('creates, gets, lists and updates rules; cooldown defaults to 336 h in SQL', () => {
    const { db, definition, rule, alerts } = setup();
    const r = alerts.create(rule);
    expect(alerts.get(r.id)).toEqual({ ...rule, id: r.id });
    expect(alerts.rules(definition.id)).toEqual([{ ...rule, id: r.id }]);
    expect(alerts.update(r.id, { thresholdPence: 40_000, enabled: false })).toMatchObject({
      thresholdPence: 40_000,
      enabled: false,
    });
    db.raw
      .prepare(
        `INSERT INTO alert_rules (id, definition_id, type, pct, basis, enabled) VALUES ('r2', ?, 'dropPct', 10, 'calendar', 1)`,
      )
      .run(definition.id);
    expect(alerts.get('r2')?.cooldownHours).toBe(336);
    expect(() => alerts.update('missing', {})).toThrow(RowRejected);
  });

  it('softDelete hides the rule, refuses updates, keeps its events and is idempotent (ruling 12)', () => {
    const { clock, definition, rule, alerts } = setup();
    const r = alerts.create(rule);
    alerts.insertEvent({
      ruleId: r.id,
      identityKey: 'k',
      observationId: null,
      calendarPriceId: null,
      dedupKey: 'd',
      firedAt: T0,
      status: 'suppressed',
      reason: 'cooldown',
      payload: {},
    });
    clock.advance(60_000);
    alerts.softDelete(r.id);
    alerts.softDelete(r.id);
    expect(alerts.get(r.id)).toBeNull();
    expect(alerts.rules(definition.id)).toEqual([]);
    expect(() => alerts.update(r.id, { enabled: false })).toThrow(
      expect.objectContaining({ rule: 'missing' }),
    );
    expect(alerts.events({ ruleId: r.id, limit: 10 })).toHaveLength(1);
    expect(alerts.events({ definitionId: definition.id, limit: 10 })).toHaveLength(1);
    expect(() => alerts.softDelete('missing')).toThrow(expect.objectContaining({ rule: 'missing' }));
  });

  it('rejects requireAllVerified on a calendar rule and non-integer thresholds; SQL refuses unknown types', () => {
    const { db, definition, rule, alerts } = setup();
    expect(() => alerts.create({ ...rule, basis: 'calendar', requireAllVerified: true })).toThrow(
      /requireAllVerified/,
    );
    expect(() => alerts.create({ ...rule, thresholdPence: 450.5 })).toThrow(
      expect.objectContaining({ rule: 'integer' }),
    );
    expect(
      sqliteCode(() =>
        db.raw
          .prepare(
            `INSERT INTO alert_rules (id, definition_id, type, basis, enabled) VALUES ('r3', ?, 'whim', 'verified', 1)`,
          )
          .run(definition.id),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('priorFirings: sent events for the identities within the window, with the price that fired; payload and reason URLs stripped', () => {
    const { db, clock, definition, executionId, rule, alerts } = setup();
    const r = alerts.create({ ...rule, basis: 'calendar', requireAllVerified: null });
    const [priceId] = new CalendarPricesRepo(db, clock, { allowSynthetic: false }).insert(executionId, [
      calendarPrice(cell(), { pricePence: 41_200, priceNativeMinor: 41_200 }),
    ]);
    if (priceId === undefined) throw new Error('fixture');
    const base = {
      ruleId: r.id,
      identityKey: `${r.id}|travelpayouts|economy|LHR|JFK|2027-03-14|2027-03-28`,
      observationId: null,
      calendarPriceId: priceId,
      dedupKey: `${r.id}|x|412`,
      reason: null,
    };
    alerts.insertEvent({
      ...base,
      firedAt: at('2026-10-01T05:00:00.000Z'),
      status: 'sent',
      payload: { link: 'https://www.aviasales.com/search?marker=SECRET' },
    });
    alerts.insertEvent({
      ...base,
      firedAt: at('2026-10-10T05:00:00.000Z'),
      status: 'failed',
      reason: 'SMTP 550 https://user:pw@mail.example/x',
      payload: {},
    });
    alerts.insertEvent({
      ...base,
      identityKey: 'other',
      firedAt: at('2026-10-11T05:00:00.000Z'),
      status: 'sent',
      payload: {},
    });
    expect(alerts.priorFirings(r.id, [base.identityKey], at('2026-09-30T00:00:00.000Z'))).toEqual([
      {
        identityKey: base.identityKey,
        dedupKey: base.dedupKey,
        firedAt: '2026-10-01T05:00:00.000Z',
        pricePence: 41_200,
      },
    ]);
    expect(alerts.priorFirings(r.id, [base.identityKey], at('2026-10-02T00:00:00.000Z'))).toEqual([]);
    expect(alerts.priorFirings(r.id, [], at('2026-09-30T00:00:00.000Z'))).toEqual([]);
    const events = alerts.events({ definitionId: definition.id, limit: 10 });
    expect(events.map((e) => e.status)).toEqual(['sent', 'failed', 'sent']);
    expect(JSON.stringify(events.at(-1)?.payload)).not.toContain('SECRET');
    expect(events[1]?.reason).not.toMatch(/pw@/);
    expect(alerts.events({ ruleId: r.id, limit: 1 })).toHaveLength(1);
  });
});

describe('NotificationsRepo (spec §8.1 "deduplicated per execution and kind")', () => {
  it('records and answers wasSent per (kind, execution, definition), including execution-less notices', () => {
    const { db, clock, definition, executionId } = setup();
    const n = new NotificationsRepo(db, clock);
    expect(n.wasSent('paused_budget', executionId, definition.id)).toBe(false);
    n.record('paused_budget', executionId, definition.id, 'sent');
    expect(n.wasSent('paused_budget', executionId, definition.id)).toBe(true);
    expect(n.wasSent('interrupted', executionId, definition.id)).toBe(false);
    n.record('skipped_missed', null, definition.id, 'failed');
    expect(n.wasSent('skipped_missed', null, definition.id)).toBe(false); // a failed send is not "sent"
    n.record('skipped_missed', null, definition.id, 'sent');
    expect(n.wasSent('skipped_missed', null, definition.id)).toBe(true);
    expect(n.wasSent('skipped_missed', null, newExecution(db, clock).definition.id)).toBe(false); // another definition
  });
});

describe('RoutePriceHistoryRepo (spec §7 route_price_history)', () => {
  it("upserts by (origin, destination, cabin, provider, date), allows cabin 'unknown', and returns one cabin's series in date order", () => {
    const { db } = setup();
    const repo = new RoutePriceHistoryRepo(db, { allowSynthetic: false });
    const row = (date: string, pence: number, fetchedAt = T0, cabin: 'unknown' | 'economy' = 'unknown') => ({
      origin: LHR,
      destination: JFK,
      cabin,
      providerId: 'searchapi' as const,
      date: asIsoDate(date),
      lowestPricePence: pence,
      fetchedAt,
    });
    repo.upsert([
      row('2026-09-02', 52_000),
      row('2026-09-01', 51_000),
      row('2026-09-01', 49_000, T0, 'economy'),
    ]);
    repo.upsert([row('2026-09-02', 50_500, at('2026-10-15T05:00:00.000Z'))]);
    expect(repo.series(LHR, JFK, 'searchapi', 'unknown')).toEqual([
      {
        date: '2026-09-01',
        pricePence: 51_000,
        fetchedAt: T0,
        providerId: 'searchapi',
        sourceKind: 'scraped-search',
      },
      {
        date: '2026-09-02',
        pricePence: 50_500,
        fetchedAt: '2026-10-15T05:00:00.000Z',
        providerId: 'searchapi',
        sourceKind: 'scraped-search',
      },
    ]);
    expect(repo.series(LHR, JFK, 'searchapi', 'economy').map((p) => p.pricePence)).toEqual([49_000]);
    expect(() => repo.upsert([row('2026-09-03', 1.5)])).toThrow(RowRejected);
    expect(() => repo.upsert([{ ...row('2026-09-03', 1), providerId: 'fixture' }])).toThrow(
      expect.objectContaining({ rule: 'synthetic-gate' }),
    );
  });
});
