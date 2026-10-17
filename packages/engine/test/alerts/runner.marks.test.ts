import { asIsoDate, TRUNCATED_NOTE } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { runAlerts } from '../../src/alerts/runner.js';
import {
  ALL_FIELDS,
  cellAt,
  cells,
  fixture,
  hoursBefore,
  JFK,
  LGW,
  LHR,
  NOW,
  payloadOf,
  searchedEmpty,
  seedCalendar,
  seedDefinition,
  seedExecution,
  seedObservation,
  seedRule,
  seedTile,
  seedVerificationCoverage,
} from './fixtures.js';

const HOUR = 3_600_000;
const notesOf = (body: string) => body.split('\n').filter((l) => l.startsWith('   Notes:'));

describe('staleness by effective age through core isStale (spec §3, §8.1; decisions 54, 55, 56)', () => {
  it('calendar basis at the threshold and one hour over, for an observed age and for fetch age plus the declared age (review TS-4)', async () => {
    const f = fixture({ env: { CALENDAR_STALE_AFTER_HOURS: '100' } });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(5);
    seedCalendar(f, ex, [
      // observed age: 100 h is not over 100 h; 101 h is
      {
        cell: cellAt(list, 0),
        pricePence: 40000,
        providerId: 'travelpayouts',
        providerObservedAt: hoursBefore(NOW, 100),
      },
      {
        cell: cellAt(list, 1),
        pricePence: 40100,
        providerId: 'travelpayouts',
        providerObservedAt: hoursBefore(NOW, 101),
      },
      // fetch age plus the declared 48 h: 52 + 48 = 100 not stale, 53 + 48 = 101 stale
      {
        cell: cellAt(list, 2),
        pricePence: 40200,
        providerId: 'travelpayouts',
        fetchedAt: hoursBefore(NOW, 52),
      },
      {
        cell: cellAt(list, 3),
        pricePence: 40300,
        providerId: 'travelpayouts',
        fetchedAt: hoursBefore(NOW, 53),
      },
      // the observed age wins over fetch plus declared: observed 90 h (fresh) although 60 + 48 = 108 would be stale
      {
        cell: cellAt(list, 4),
        pricePence: 40400,
        providerId: 'travelpayouts',
        fetchedAt: hoursBefore(NOW, 60),
        providerObservedAt: hoursBefore(NOW, 90),
      },
    ]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    const payloads = f.repos.alerts.events({ definitionId: def.id, limit: 10 }).map(payloadOf);
    expect(new Set(payloads.map((p) => p.staleThresholdHours))).toEqual(new Set([100]));
    const lines = (f.notifier.digests()[0]?.body ?? '').split('\n');
    const staleItems = lines.filter((l) => /^\d+\. /.test(l) || l === '   Notes: stale: older than 100h');
    expect(staleItems).toEqual([
      '1. £400 LHR→JFK 1 Nov–15 Nov (14n)',
      '2. £401 LHR→JFK 2 Nov–16 Nov (14n)',
      '   Notes: stale: older than 100h',
      '3. £402 LHR→JFK 3 Nov–17 Nov (14n)',
      '4. £403 LHR→JFK 4 Nov–18 Nov (14n)',
      '   Notes: stale: older than 100h',
      '5. £404 LHR→JFK 5 Nov–19 Nov (14n)',
    ]);
  });

  it('the calendar threshold defaults to the refresh plus the declared age', async () => {
    const f = fixture();
    const def = seedDefinition(f); // travelpayouts refresh 168 h; no provider registered here, so declared age 0
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 40000, providerId: 'travelpayouts' }]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    const [event] = f.repos.alerts.events({ definitionId: def.id, limit: 1 });
    expect(event === undefined ? null : payloadOf(event).staleThresholdHours).toBe(168);
  });

  it('itinerary-search basis: STALE_AFTER_HOURS for a known age, and for an unknown vendor age by its fetch age alone (review TS-15, PA-8)', async () => {
    const f = fixture({ env: { STALE_AFTER_HOURS: '192' } });
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const day = (d: number) => asIsoDate(`2026-11-0${d}`);
    // a known (bounded, 0) age at 192 h and 193 h; an unknown vendor age at 192 h and 193 h
    seedObservation(f, ex, {
      departureDate: day(1),
      flight: 101,
      pricePence: 41000,
      maxAgeHours: 0,
      fetchedAt: hoursBefore(NOW, 192),
    });
    seedObservation(f, ex, {
      departureDate: day(2),
      flight: 103,
      pricePence: 41100,
      maxAgeHours: 0,
      fetchedAt: hoursBefore(NOW, 193),
    });
    seedObservation(f, ex, {
      departureDate: day(3),
      flight: 105,
      pricePence: 41200,
      fetchedAt: hoursBefore(NOW, 192),
    });
    seedObservation(f, ex, {
      departureDate: day(4),
      flight: 107,
      pricePence: 41300,
      fetchedAt: hoursBefore(NOW, 193),
    });
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(notesOf(body)).toEqual(['   Notes: stale: older than 192h', '   Notes: stale: older than 192h']);
    expect(body).toContain(
      "   Provenance: Google Flights via SearchApi · fetched 8d ago · vendor's cache age unknown",
    );
    const staleByPrice = body
      .split('\n\n')
      .filter((block) => block.includes('stale: older than 192h'))
      .map((block) => block.split('\n')[0]);
    expect(staleByPrice).toEqual([
      '2. £411 LHR→JFK 2 Nov–16 Nov (14n)',
      '4. £413 LHR→JFK 4 Nov–18 Nov (14n)',
    ]);
  });
});

describe('truncated tiles, newer searches, unconfirmed fares and budget stops (decisions 25, 30, 54; review PA-2, PA-10)', () => {
  it('a price from a tile the page cap cut short reads "cheapest of the rows read" in the email and the payload', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(2);
    seedTile(f, ex, [{ cell: cellAt(list, 0), pricePence: 40000 }], `${TRUNCATED_NOTE}: page cap reached`);
    seedCalendar(f, ex, [{ cell: cellAt(list, 1), pricePence: 40100 }]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex);
    expect(notesOf(f.notifier.digests()[0]?.body ?? '')).toEqual([`   Notes: ${TRUNCATED_NOTE}`]);
    const payloads = f.repos.alerts.events({ definitionId: def.id, limit: 10 }).map(payloadOf);
    expect(payloads.filter((p) => p.truncated).map((p) => p.route)).toEqual(['LHR→JFK 1 Nov–15 Nov (14n)']);
  });

  it("a fare a newer itinerary search of its cell did not see is marked with that search's instant; one it saw is not", async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-02'), pricePence: 42000 });
    const seen = seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-03'),
      pricePence: 43000,
      flight: 177,
    });
    f.clock.advance(HOUR);
    const searchedAt = f.clock.now();
    // a single-cell verification (a child) searched 2 Nov after the run's own search and found no fares
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
    // another child searched 3 Nov and saw the same offer again
    const nov3 = {
      origin: LHR,
      destination: JFK,
      departureDate: asIsoDate('2026-11-03'),
      returnDate: asIsoDate('2026-11-17'),
      nights: 14,
    };
    const child3 = seedExecution(f, def, nov3);
    seedObservation(f, child3, { departureDate: asIsoDate('2026-11-03'), pricePence: 43000, flight: 177 });
    f.repos.cells.seed(child3, [nov3], []);
    f.repos.cells.seedVerification(child3, [{ cell: nov3, reason: 'always_include' }], [nov3], ['searchapi']);
    searchedEmpty(f, child3, nov3);
    f.clock.advance(2 * HOUR);
    const rule = seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(notesOf(body)).toEqual(['   Notes: not seen in latest search (2h ago)']);
    const byObservation = new Map(
      f.repos.alerts.events({ ruleId: rule.id, limit: 10 }).map((e) => [e.observationId, payloadOf(e)]),
    );
    expect(byObservation.get(seen.observationId)?.notSeenInLatest).toBeNull();
    expect([...byObservation.values()].map((p) => p.notSeenInLatest).filter((m) => m !== null)).toEqual([
      { at: searchedAt },
    ]);
  });

  it('the digest counts the fares whose price the final step did not confirm, leaving out ones that fail a constraint anyway', async () => {
    const f = fixture();
    const def = seedDefinition(f, { constraints: { maxJourneyMinutes: 1500 } });
    const ex = seedExecution(f, def);
    const unconfirmed = ALL_FIELDS.filter((x) => x !== 'price');
    seedObservation(f, ex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 20000,
      seller: 'An agency',
      suppliedFields: unconfirmed,
    });
    seedObservation(f, ex, { departureDate: asIsoDate('2026-11-03'), pricePence: 44000, flight: 177 });
    seedRule(f, def, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    await runAlerts(f.deps, ex);
    expect(f.notifier.digests()[0]?.body).toContain(
      'Unconfirmed: 1 fare in this run had no price confirmed by the final step; they are never alerted.',
    );
    const strict = fixture();
    const sdef = seedDefinition(strict, { constraints: { maxJourneyMinutes: 60 } }); // every fare fails this
    const sex = seedExecution(strict, sdef);
    seedObservation(strict, sex, {
      departureDate: asIsoDate('2026-11-02'),
      pricePence: 20000,
      suppliedFields: unconfirmed,
    });
    seedRule(strict, sdef, { basis: 'verified', thresholdPence: 45000, requireAllVerified: false });
    expect(await runAlerts(strict.deps, sex)).toEqual({ digests: 0, events: 0 });
  });

  it('a run a budget cap stopped says how many cell searches did not run', async () => {
    const f = fixture();
    const def = seedDefinition(f);
    const ex = seedExecution(f, def);
    const list = cells(4);
    seedCalendar(f, ex, [{ cell: cellAt(list, 0), pricePence: 40000 }]);
    seedVerificationCoverage(f, ex, cells(1, LGW), 1); // the itinerary search ran (one cell)
    f.repos.cells.seed(ex, [cellAt(list, 1), cellAt(list, 2), cellAt(list, 3)], ['travelpayouts']);
    f.repos.cells.setOutcome(ex, cellAt(list, 3), 'discovery', 'travelpayouts', {
      status: 'skipped',
      reason: 'budget',
    });
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex, { stop: 'budget' });
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(
      'Not searched: a budget cap left 3 cell searches of this run undone; the prices above come from the cells that were searched.',
    );
    expect(body).toContain('Coverage: itinerary-searched 1 of 1 cells, 2 outbounds each');
  });

  it('a cap that stopped the run during discovery: the itinerary search is "not run" and the count a lower bound (review PA-2)', async () => {
    const f = fixture();
    const def = seedDefinition(f); // verification by SearchApi is configured
    const ex = seedExecution(f, def);
    const list = cells(3);
    seedCalendar(f, ex, [{ cell: cellAt(list, 0), pricePence: 40000 }]);
    f.repos.cells.seed(ex, [cellAt(list, 1), cellAt(list, 2)], ['travelpayouts']);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex, { stop: 'budget' });
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain(
      'Not searched: a budget cap left at least 2 cell searches of this run undone; the prices above come from the cells that were searched.',
    );
    expect(body).toContain(
      'Coverage: itinerary search not run (a budget cap stopped the run during discovery)',
    );
  });

  it('a completed pass whose itinerary search never ran (no verification provider registered) names no budget cap (review PA2-1)', async () => {
    const f = fixture();
    const def = seedDefinition(f); // the snapshot names SearchApi for verification; nothing seeded verification outcomes
    const ex = seedExecution(f, def);
    seedCalendar(f, ex, [{ cell: cellAt(cells(1), 0), pricePence: 40000 }]);
    seedRule(f, def, { thresholdPence: 45000, basis: 'calendar' });
    await runAlerts(f.deps, ex); // a completed pass
    const body = f.notifier.digests()[0]?.body ?? '';
    expect(body).toContain('Coverage: itinerary search not run\n');
    expect(body).not.toContain('budget cap');
    expect(body).not.toContain('Not searched');
  });
});
