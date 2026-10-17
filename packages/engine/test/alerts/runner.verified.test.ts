import { asIsoDate, CONSTRAINT_LABELS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  ALL_FIELDS,
  fixture,
  hoursBefore,
  NOW,
  payloadOf,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
} from './fixtures.js';

const WITHOUT_BAGGAGE = ALL_FIELDS.filter((x) => x !== 'baggage'); // checkedBagRequired → unverified
const UNCONFIRMED = ALL_FIELDS.filter((x) => x !== 'price'); // decisions 27, 37: the final step did not confirm the price

function scenario() {
  const f = fixture();
  const def = seedDefinition(f);
  const earlier = seedExecution(f, def);
  // A was seen at £500 a week ago; C was written by the earlier execution only, so it is never a candidate of the next one
  seedObservation(f, earlier, {
    departureDate: asIsoDate('2026-11-02'),
    pricePence: 50000,
    flight: 117,
    fetchedAt: hoursBefore(NOW, 168),
  });
  seedObservation(f, earlier, {
    departureDate: asIsoDate('2026-11-04'),
    pricePence: 30000,
    flight: 115,
    fetchedAt: hoursBefore(NOW, 168),
  });
  const ex = seedExecution(f, def);
  // A: £420 now, every constraint passes → class verified
  const a = seedObservation(f, ex, {
    departureDate: asIsoDate('2026-11-02'),
    pricePence: 42000,
    flight: 117,
  });
  // B: first seen now at £410, baggage not supplied → partially-verified
  const b = seedObservation(f, ex, {
    departureDate: asIsoDate('2026-11-03'),
    pricePence: 41000,
    flight: 177,
    suppliedFields: WITHOUT_BAGGAGE,
  });
  return { f, def, ex, a, b };
}

describe('itinerary-search basis (spec §6.8)', () => {
  it('candidates are observations written by the current execution; identity is (ruleId, itineraryHash)', async () => {
    const { f, def, ex, a, b } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 2 });
    const events = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(events.map((e) => e.identityKey).sort()).toEqual(
      [`${rule.id}|${a.itineraryHash}`, `${rule.id}|${b.itineraryHash}`].sort(),
    );
    expect(events.every((e) => e.observationId !== null && e.calendarPriceId === null)).toBe(true);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(`unverified: ${CONSTRAINT_LABELS.checkedBagRequired}`);
    expect(body).toContain('Outbound: BA 117 LHR 08:25 → JFK 11:20 (2 Nov)');
  });

  it('requireAllVerified admits class verified only', async () => {
    const { f, def, ex, a } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: true });
    await runAlerts(f.deps, ex);
    expect(f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).map((e) => e.identityKey)).toEqual([
      `${rule.id}|${a.itineraryHash}`,
    ]);
  });

  it('a drop compares the offer with its previous observation; a first sighting cannot drop', async () => {
    const { f, def, ex, b } = scenario();
    const rule = seedRule(f, def, {
      basis: 'verified',
      type: 'dropPct',
      thresholdPence: null,
      pct: 10,
      requireAllVerified: false,
    });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [event] = f.repos.alerts.events({ ruleId: rule.id, limit: 100 });
    expect(event === undefined ? null : payloadOf(event)).toMatchObject({
      pricePence: 42000,
      previous: { pricePence: 50000 },
      reason: { kind: 'drop', gapHours: 168 },
      isNew: false,
    });
    expect(event?.reason).toBe('down £80 (16%) from £500 fetched 7d (168h) earlier');
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('Previous: £500, fetched 7d before this price');
    // why: only calendar cells have a "new" section (spec §6.8); an offer seen for the first time is not listed
    expect(body).not.toContain('New since the last check');
    expect(
      f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).some((e) => e.observationId === b.observationId),
    ).toBe(false);
  });

  it('the cheapest eligible offer per itinerary represents it once (core settles identities, rev 11)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 44000,
      seller: 'British Airways',
    });
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 43000,
      seller: 'An agency',
    });
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(
      f.repos.alerts.events({ ruleId: rule.id, limit: 100 }).map((e) => payloadOf(e).pricePence),
    ).toEqual([43000]);
  });

  it('an unconfirmed price never fires, however cheap (decisions 27, 37, 45)', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const cheap = seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 20000,
      seller: 'An agency',
      suppliedFields: UNCONFIRMED,
    });
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-03'), pricePence: 44000, flight: 177 });
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    expect(
      f.repos.alerts
        .events({ ruleId: rule.id, limit: 100 })
        .some((e) => e.observationId === cheap.observationId),
    ).toBe(false);
    expect(f.notifier.digests()[0]?.digest.items.map((i) => i.pricePence)).toEqual([44000]);
    // an execution with only unconfirmed prices sends nothing
    const next = seedExecution(f, def);
    seedObservation(f, next, {
      departureDate: asIsoDate('2026-11-05'),
      pricePence: 20000,
      flight: 119,
      suppliedFields: UNCONFIRMED,
    });
    expect(await runAlerts(f.deps, next)).toEqual({ digests: 0, events: 0 });
  });
});

describe('the drop baseline and the event payload (decisions 37, 45, 56; review PA-1, PA-3)', () => {
  it('a drop is measured against the newest earlier confirmed price: an unconfirmed one in between is walked past', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const older = seedExecution(f, def);
    seedObservation(f, older, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 45000,
      fetchedAt: hoursBefore(NOW, 336),
    });
    const earlier = seedExecution(f, def);
    seedObservation(f, earlier, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 50000,
      fetchedAt: hoursBefore(NOW, 168),
      suppliedFields: UNCONFIRMED,
    });
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    // £80 below the unconfirmed £500 would fire; only £30 below the confirmed £450 does not
    seedRule(f, def, { basis: 'verified', type: 'dropAbs', thresholdPence: 5000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
    const rule = seedRule(f, def, {
      basis: 'verified',
      type: 'dropAbs',
      thresholdPence: 2000,
      requireAllVerified: false,
    });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 1, events: 1 });
    const [event] = f.repos.alerts.events({ ruleId: rule.id, limit: 10 });
    expect(event?.reason).toBe('down £30 (6%) from £450 fetched 2w (336h) earlier');
    expect(event === undefined ? null : payloadOf(event).previous?.pricePence).toBe(45000);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('Previous: £450, fetched 2w before this price');
    expect(body).not.toContain('£500');
    expect(JSON.stringify(event?.payload)).not.toContain('50000');
  });

  it('only an unconfirmed earlier price: the offer has no previous price, so a drop rule cannot fire', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const earlier = seedExecution(f, def);
    seedObservation(f, earlier, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 50000,
      fetchedAt: hoursBefore(NOW, 168),
      suppliedFields: UNCONFIRMED,
    });
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    seedRule(f, def, { basis: 'verified', type: 'dropAbs', thresholdPence: 1000, requireAllVerified: false });
    expect(await runAlerts(f.deps, ex)).toEqual({ digests: 0, events: 0 });
  });

  it("the payload carries the verdict class, every unverified constraint, the previous price's provenance and the reason parts", async () => {
    const { f, def, ex, a, b } = scenario();
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    const byObservation = new Map(
      f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => [e.observationId, payloadOf(e)]),
    );
    expect(byObservation.get(a.observationId)).toMatchObject({
      verdictClass: 'verified',
      unverified: [],
      pricePence: 42000,
      previous: {
        pricePence: 50000,
        provenance: { fetchedAt: hoursBefore(NOW, 168), sourceKind: 'scraped-search' },
      },
      reason: { kind: 'threshold', gapHours: 168 },
      route: 'LHR→JFK 2 Nov–16 Nov (14n)',
    });
    expect(byObservation.get(b.observationId)).toMatchObject({
      verdictClass: 'partially-verified',
      unverified: ['checkedBagRequired'],
      previous: null,
      reason: { kind: 'threshold', gapHours: null },
    });
  });
});
