import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import { LogNotifier } from '../../src/notifiers/log.js';
import {
  ALL_FIELDS,
  cellAt,
  cells,
  type Fixture,
  fixture,
  JFK,
  LHR,
  payloadOf,
  RecordingNotifier,
  searchedEmpty,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
} from './fixtures.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** One calendar cell priced by a new execution of the definition at `pricePence`; returns its run result. */
async function runAt(f: Fixture, def: Parameters<typeof seedExecution>[1], pricePence: number) {
  const ex = seedExecution(f, def);
  seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence }]);
  return runAlerts(f.deps, ex);
}

describe('cooldown across executions (spec §6.8, §9 item 4)', () => {
  it('calendar basis: the same price band is suppressed with a reason until cooldownHours have passed, exactly (review TS-1)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar', cooldownHours: 336 });
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(335 * HOUR);
    expect(await runAt(f, def, 41250)).toEqual({ digests: 0, events: 1 }); // same £412 band, 335 h later
    const suppressed = f.repos.alerts
      .events({ ruleId: rule.id, limit: 100 })
      .filter((e) => e.status === 'suppressed');
    expect(suppressed.map((e) => e.reason)).toEqual([
      'same price band alerted 13d (335h) ago; cooldown 2w (336h)',
    ]);
    // why: core's window is "fired less than cooldownHours ago", so at exactly 336 h the earlier firing no longer counts
    f.clock.advance(HOUR);
    expect(await runAt(f, def, 41250)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(HOUR);
    expect(await runAt(f, def, 41250)).toEqual({ digests: 0, events: 1 }); // 1 h after that firing: suppressed again
  });

  it('the cooldown is judged to the hour, not the database window: 335 h 30 min is inside, 336 h 30 min is out (review ts-3)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar', cooldownHours: 336 });
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(335 * HOUR + 30 * 60_000);
    expect(await runAt(f, def, 41250)).toEqual({ digests: 0, events: 1 });
    f.clock.advance(HOUR);
    expect(await runAt(f, def, 41250)).toEqual({ digests: 1, events: 1 });
  });

  it('inside the cooldown a repeat needs max(£10, 5%) below the last fired price: the 5% side at ±1p (review TS-2)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 }); // step max(£10, ⌈5% of £412⌉ = £20.60)
    f.clock.advance(DAY);
    expect(await runAt(f, def, 43000)).toEqual({ digests: 0, events: 1 }); // dearer
    f.clock.advance(DAY);
    expect(await runAt(f, def, 39141)).toEqual({ digests: 0, events: 1 }); // £20.59 below
    f.clock.advance(DAY);
    expect(await runAt(f, def, 39140)).toEqual({ digests: 1, events: 1 }); // £20.60 below
  });

  it('a fractional 5% rounds the step up to a whole penny: last fired £412.10, 5% = 2060.5p, step 2061p (review ts-2)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    expect(await runAt(f, def, 41210)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(DAY);
    expect(await runAt(f, def, 39150)).toEqual({ digests: 0, events: 1 }); // 2060p below: one penny short
    f.clock.advance(DAY);
    expect(await runAt(f, def, 39149)).toEqual({ digests: 1, events: 1 }); // 2061p below
  });

  it('under £200 the £10 floor applies (5% would be less): £9.99 below is suppressed, £10.00 below fires (review TS-2)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 20000, basis: 'calendar' });
    expect(await runAt(f, def, 15000)).toEqual({ digests: 1, events: 1 }); // 5% = £7.50 < £10
    f.clock.advance(DAY);
    expect(await runAt(f, def, 14001)).toEqual({ digests: 0, events: 1 });
    f.clock.advance(DAY);
    expect(await runAt(f, def, 14000)).toEqual({ digests: 1, events: 1 });
  });

  it('itinerary-search basis: the same itinerary and band in the next execution is suppressed', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    const first = seedExecution(f, def);
    seedObservation(f, first, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    expect(await runAlerts(f.deps, first)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(7 * DAY);
    const second = seedExecution(f, def);
    seedObservation(f, second, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    expect(await runAlerts(f.deps, second)).toEqual({ digests: 0, events: 1 });
  });

  it('one identity is judged on its cheapest eligible offer whatever its class; class order is the results ranking, not alerts (review TS-3)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    // a class-verified offer at £440 and a cheaper partially-verified one (baggage not supplied) at £430, same itinerary
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 44000,
      seller: 'British Airways',
    });
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 43000,
      seller: 'An agency',
      suppliedFields: ALL_FIELDS.filter((x) => x !== 'baggage'),
    });
    const any = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    const strict = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: true });
    await runAlerts(f.deps, ex);
    const firedAt = (ruleId: string) =>
      f.repos.alerts
        .events({ ruleId, limit: 10 })
        .map((e) => [payloadOf(e).pricePence, payloadOf(e).verdictClass]);
    expect(firedAt(any.id)).toEqual([[43000, 'partially-verified']]);
    expect(firedAt(strict.id)).toEqual([[44000, 'verified']]);
  });
});

describe('event lifecycle: queued before the send, notified after (spec §8.1; decision 56)', () => {
  it('events exist as queued while the notifier is sending, and are notified once it accepted', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const seen: string[][] = [];
    f.notifier.onSend = () =>
      seen.push(f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => e.status));
    await runAt(f, def, 41200);
    expect(seen).toEqual([['queued']]);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => e.status)).toEqual(['notified']);
  });

  it('a failed send stays queued saying why and whether it is retried; the resumed pass resends it on the same row, rewritten (decision 59)', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 41200 }]);
    // a pass that stopped on a budget cap: the resumed pass will send it
    expect(await runAlerts(f.deps, ex, { stop: 'budget' })).toEqual({ digests: 1, events: 1 });
    const [queued] = f.repos.alerts.events({ ruleId: rule.id, limit: 10 });
    expect(queued).toMatchObject({
      status: 'queued',
      reason:
        '£412 is at or below the £450 threshold; not delivered: email: connection refused; sent again when this run resumes',
    });
    const failedDigest = queued === undefined ? null : payloadOf(queued).digestId;
    // the resumed pass of the same execution retries it
    f.notifier.respondWith({ ok: true });
    f.clock.advance(HOUR);
    const resent = f.clock.now();
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests().map((d) => d.digest.items.map((i) => i.pricePence))).toEqual([
      [41200],
      [41200],
    ]);
    const [notified] = f.repos.alerts.events({ ruleId: rule.id, limit: 10 });
    expect(notified).toMatchObject({
      id: queued?.id,
      status: 'notified',
      reason: '£412 is at or below the £450 threshold',
      firedAt: resent,
    });
    expect(notified === undefined ? null : payloadOf(notified).digestId).not.toBe(failedDigest);
    // and a third pass has nothing left to send
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
  });

  it('a queued (never delivered) firing does not suppress the next execution', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAt(f, def, 41200);
    f.notifier.respondWith({ ok: true });
    f.clock.advance(DAY);
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
  });
});

describe('a later pass of the same execution never repeats a firing or a listing (decisions 25, 55, 56)', () => {
  it('the second pass sends only prices the first pass did not record; with none, it sends and records nothing', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar', cooldownHours: 1 });
    const list = cells(3);
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(list, 0), pricePence: 41200 }]);
    // first pass: paused at a budget cap (the engine runs the alerts step on paused_budget)
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    // why: a cooldown shorter than the pause shows the guard is the earlier pass's event, not the cooldown
    f.clock.advance(2 * HOUR);
    seedCalendar(f, ex, [{ cell: cellAt(list, 1), pricePence: 42000 }]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[1]?.digest.items.map((i) => i.pricePence)).toEqual([42000]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 })).toHaveLength(2);
  });

  it('a suppressed row an earlier pass recorded is not judged or inserted again by a later pass (review ts-1)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
    f.clock.advance(HOUR);
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 41250 }]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 1 }); // suppressed by the cooldown
    f.clock.advance(HOUR);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).map((e) => e.status)).toEqual([
      'suppressed',
      'notified',
    ]);
  });

  it('a "new" cell listed by the first pass is not listed again by the second (review PA-5)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    seedRule(f, def, { type: 'dropAbs', thresholdPence: 1000, basis: 'calendar' });
    const list = cells(3);
    const earlier = seedExecution(f, def);
    seedCalendar(f, earlier, [
      { cell: cellAt(list, 0), pricePence: 50000 },
      { cell: cellAt(list, 2), pricePence: 50000 },
    ]);
    f.clock.advance(HOUR);
    const ex = seedExecution(f, def);
    // first pass: a drop on cell 0 and a first sighting on cell 1
    seedCalendar(f, ex, [
      { cell: cellAt(list, 0), pricePence: 40000 },
      { cell: cellAt(list, 1), pricePence: 41000 },
    ]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 2 });
    expect(f.notifier.digests()[0]?.digest.newItems.map((i) => i.pricePence)).toEqual([41000]);
    // second pass: a drop on cell 2 sends a digest; cell 1, already listed, is not listed again
    f.clock.advance(HOUR);
    seedCalendar(f, ex, [{ cell: cellAt(list, 2), pricePence: 42000 }]);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(f.notifier.digests()[1]?.digest.items.map((i) => i.pricePence)).toEqual([42000]);
    expect(f.notifier.digests()[1]?.digest.newItems).toEqual([]);
  });

  it('a failure on a completed pass says it is not retried unless the run is resumed', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAt(f, def, 41200);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 1 })[0]?.reason).toBe(
      '£412 is at or below the £450 threshold; not delivered: email: connection refused; not retried unless this run is resumed',
    );
  });
});

describe('a queued event no later pass will send, and the payload of a delivered retry (review prov-1, prov-2)', () => {
  it('a queued row whose trip a cheaper offer of the same pass replaced stops promising a resend', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    const ex = seedExecution(f, def);
    const departureDate = asIsoDate('2026-11-02');
    seedObservation(f, ex, { departureDate, pricePence: 42000, seller: 'British Airways' });
    await runAlerts(f.deps, ex, { stop: 'budget' });
    f.notifier.respondWith({ ok: true });
    f.clock.advance(HOUR);
    // the resumed pass found the same itinerary cheaper from another seller
    seedObservation(f, ex, { departureDate, pricePence: 41000, seller: 'An agency' });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 2 });
    expect(
      f.repos.alerts
        .events({ ruleId: rule.id, limit: 10 })
        .map((e) => [payloadOf(e).pricePence, e.status, e.reason]),
    ).toEqual([
      [41000, 'notified', '£410 is at or below the £450 threshold'],
      [
        42000,
        'suppressed',
        '£420 is at or below the £450 threshold; superseded by a cheaper price of the same trip in a later pass; not retried',
      ],
    ]);
  });

  it('a retried row records the marks of the send that delivered it, not those of the failed send', async () => {
    const f = fixture({
      notifier: new RecordingNotifier('email', { ok: false, detail: 'connection refused' }),
    });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex, { stop: 'budget' });
    const [queued] = f.repos.alerts.events({ ruleId: rule.id, limit: 10 });
    expect(queued === undefined ? null : payloadOf(queued).notSeenInLatest).toBeNull();
    // a single-cell search after the first pass found no fares for the cell
    f.clock.advance(HOUR);
    const searchedAt = f.clock.now();
    const nov2 = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-11-02'),
      returnDate: asIsoDate('2026-11-16'),
      nights: 14,
    };
    const child = seedExecution(f, def, nov2);
    f.repos.cells.seed(child, [nov2], []);
    f.repos.cells.seedVerification(child, [{ cell: nov2, reason: 'always_include' }], [nov2], ['searchapi']);
    searchedEmpty(f, child, nov2);
    f.notifier.respondWith({ ok: true });
    f.clock.advance(HOUR);
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [notified] = f.repos.alerts.events({ ruleId: rule.id, limit: 10 });
    expect(notified?.status).toBe('notified');
    expect(notified === undefined ? null : payloadOf(notified).notSeenInLatest).toEqual({ at: searchedAt });
  });
});

describe('a notifier failure detail reaches the event reason scrubbed (review sec-1)', () => {
  it('a thrown message holding the SMTP password or a URL query is stored without them', async () => {
    const pass = 'test-smtp-pass-0123456789abcdef';
    const f = fixture({
      env: {
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: '465',
        SMTP_USER: 'alerts',
        SMTP_PASS: pass,
        ALERT_EMAIL_TO: 'operator@example.com',
        ALERT_EMAIL_FROM: 'get-me-there@example.com',
      },
    });
    f.deps.notifiers.splice(0, f.deps.notifiers.length, {
      id: 'broken',
      send: async () =>
        Promise.reject(new Error(`login failed with ${pass} at https://h.example/p?token=${pass}`)),
    });
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAt(f, def, 41200);
    const reason = f.repos.alerts.events({ ruleId: rule.id, limit: 1 })[0]?.reason ?? '';
    expect(reason).toContain('not delivered: broken: login failed');
    expect(reason).not.toContain(pass);
    expect(reason).not.toContain('token=');
  });
});

describe('with no SMTP configured the digest only reaches the log (decision 59; review PA2-3)', () => {
  it('its firings are suppressed, "email not configured", and never start a cooldown', async () => {
    const f = fixture();
    f.deps.notifiers.splice(0, f.deps.notifiers.length, new LogNotifier(f.log));
    const def = seedDefinition(f);
    const rule = seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
    expect(f.log.lines.some((l) => l.fields.kind === 'alert_digest')).toBe(true);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => [e.status, e.reason])).toEqual([
      ['suppressed', '£412 is at or below the £450 threshold; email not configured'],
    ]);
    // the same band a day later is not held back by a cooldown the operator never received
    f.clock.advance(DAY);
    expect(await runAt(f, def, 41200)).toEqual({ digests: 1, events: 1 });
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => e.reason)).toEqual([
      '£412 is at or below the £450 threshold; email not configured',
      '£412 is at or below the £450 threshold; email not configured',
    ]);
  });
});
