import { describe, expect, it } from 'vitest';
import { span } from '../../src/alerts/dedup.js';
import { evaluateAlertRules } from '../../src/alerts/evaluate.js';
import type { AlertCandidate, AlertRule, PriorFiring } from '../../src/types/alerts.js';
import { CTX, calendar, cell, hoursAgo, hoursBefore, prior, rule, verified } from '../helpers/alerts.js';

const run = (r: AlertRule[], c: AlertCandidate[], p: PriorFiring[] = [], ctx = CTX) =>
  evaluateAlertRules(r, c, p, ctx);
const priceOfFiring = (c: AlertCandidate) =>
  c.basis === 'verified' ? c.observation.pricePence : c.pricePence;

describe('evaluateAlertRules, verified basis (spec §6.8)', () => {
  it('identity is ruleId|itineraryHash; an absolute rule fires at or below the threshold', () => {
    const [f] = run([rule()], [verified({ observation: { pricePence: 45_000 } })]);
    expect(f).toMatchObject({
      identityKey: 'r1|h1',
      dedupKey: 'r1|h1|450',
      isNew: false,
      suppressed: null,
      reason: '£450 is at or below the £450 threshold',
    });
    expect(f?.rule.id).toBe('r1');
    expect(run([rule()], [verified({ observation: { pricePence: 45_001 } })])).toEqual([]);
  });

  it('partially-verified candidates count only when requireAllVerified is false', () => {
    const partial = verified({ verdictClass: 'partially-verified', unverified: ['cabin'] });
    expect(run([rule({ requireAllVerified: true })], [partial])).toEqual([]);
    expect(run([rule({ requireAllVerified: false })], [partial])).toHaveLength(1);
  });

  it('failed candidates, other executions, other cabins and synthetic rows never fire', () => {
    expect(
      run(
        [rule({ requireAllVerified: false })],
        [
          verified({ verdictClass: 'failed' }),
          verified({ observation: { executionId: 'ex-1' } }),
          verified({ observation: { provenance: { cabin: 'business' } } }),
          verified({ observation: { provenance: { providerId: 'fixture', sourceKind: 'synthetic' } } }),
        ],
      ),
    ).toEqual([]);
  });

  it('one firing per identity: the cheapest offer of the itinerary', () => {
    const out = run(
      [rule()],
      [
        verified({ observation: { offerId: 2, pricePence: 43_000 } }),
        verified({ observation: { offerId: 1, pricePence: 41_200 } }),
        verified({ hash: 'h2', observation: { pricePence: 44_000 } }),
      ],
    );
    expect(out.map((f) => [f.identityKey, priceOfFiring(f.candidate)])).toEqual([
      ['r1|h1', 41_200],
      ['r1|h2', 44_000],
    ]);
  });

  it('the identity settles on its cheapest offer before judging: a dearer offer with a drop does not fire (review prov-006)', () => {
    const cheapNoHistory = verified({ observation: { offerId: 1, pricePence: 40_000 } });
    const dearWithDrop = verified({
      observation: { offerId: 2, pricePence: 42_000 },
      previous: { pricePence: 50_000, fetchedAt: hoursAgo(30) },
    });
    expect(run([rule({ type: 'dropAbs', thresholdPence: 1_000 })], [dearWithDrop, cheapNoHistory])).toEqual(
      [],
    );
  });

  it('drops compare with the previous observation and state its price and age (dropAbs and dropPct; review pft-003)', () => {
    const c = verified({
      observation: { pricePence: 40_500 },
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(205) },
    });
    expect(run([rule({ type: 'dropAbs', thresholdPence: 4_500 })], [c])[0]?.reason).toBe(
      'down £45 (10%) from £450 fetched 8d (200h) earlier',
    );
    expect(run([rule({ type: 'dropAbs', thresholdPence: 4_501 })], [c])).toEqual([]);
    expect(run([rule({ type: 'dropPct', thresholdPence: null, pct: 10 })], [c])).toHaveLength(1);
    const short = verified({
      observation: { pricePence: 40_501 },
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(6) },
    });
    expect(run([rule({ type: 'dropPct', thresholdPence: null, pct: 10 })], [short])).toEqual([]);
  });

  it('verified drops have no window: a previous observation 400h older still compares (ruling 9)', () => {
    const c = verified({
      observation: { pricePence: 40_000 },
      previous: { pricePence: 45_000, fetchedAt: hoursAgo(405) },
    });
    expect(run([rule({ type: 'dropAbs', thresholdPence: 1_000 })], [c])[0]).toMatchObject({
      isNew: false,
      reason: 'down £50 (11%) from £450 fetched 2w (400h) earlier',
    });
  });

  it('no previous observation, or a price that did not fall, never fires a drop', () => {
    expect(run([rule({ type: 'dropAbs', thresholdPence: 1 })], [verified()])).toEqual([]);
    const same = verified({ previous: { pricePence: 41_200, fetchedAt: hoursAgo(6) } });
    expect(run([rule({ type: 'dropPct', thresholdPence: null, pct: 0 })], [same])).toEqual([]);
  });

  it('cooldown: a suppressed firing is returned with its reason; without prior, suppressed is null', () => {
    expect(run([rule()], [verified()], [prior()])[0]?.suppressed).toEqual({
      reason: 'same price band alerted 24h ago; cooldown 2w (336h)',
    });
    expect(run([rule()], [verified()], [])[0]?.suppressed).toBeNull();
  });

  it('disabled rules are skipped; a rule missing its threshold is a caller bug', () => {
    expect(run([rule({ enabled: false })], [verified()])).toEqual([]);
    expect(() => run([rule({ thresholdPence: null })], [verified()])).toThrow(RangeError);
    const dropping = verified({ previous: { pricePence: 50_000, fetchedAt: hoursAgo(6) } });
    expect(() => run([rule({ type: 'dropPct', pct: null })], [dropping])).toThrow(RangeError);
  });
});

describe('evaluateAlertRules, calendar basis (spec §6.8)', () => {
  const cal = rule({ basis: 'calendar', requireAllVerified: null });
  const drop = rule({ basis: 'calendar', type: 'dropAbs', thresholdPence: 1_000, requireAllVerified: null });

  it('identity is ruleId|providerId|cabin|cellKey; providers and cells are separate identities', () => {
    const out = run(
      [cal],
      [
        calendar(),
        calendar({ provenance: { providerId: 'searchapi', sourceKind: 'scraped-aggregate' } }),
        calendar({ cell: cell(15) }),
      ],
    );
    expect(out.map((f) => f.identityKey)).toEqual([
      'r1|travelpayouts|economy|LHR|JFK|2027-03-14|2027-03-28',
      'r1|searchapi|economy|LHR|JFK|2027-03-14|2027-03-28',
      'r1|travelpayouts|economy|LHR|JFK|2027-03-15|2027-03-29',
    ]);
  });

  it('reused rows (fetched by another execution), other-cabin and synthetic rows are refused (review prov-005)', () => {
    expect(
      run(
        [cal],
        [
          calendar({ fetchedByExecutionId: 'ex-1' }),
          calendar({ provenance: { cabin: 'business' } }),
          calendar({ provenance: { providerId: 'fixture', sourceKind: 'synthetic' } }),
        ],
      ),
    ).toEqual([]);
  });

  // Sparse-cache drop rule (ruling 17): the window is 2 × discoveryRefreshHours. maxAgeHours 168 on the
  // row shows the provider's age bound does not enter the comparison.
  it.each([
    [84, 167, false],
    [84, 168, false],
    [84, 169, true],
    [undefined, 335, false], // default refresh 168 → window 336 h
    [undefined, 336, false],
    [undefined, 337, true],
  ] as const)('refresh %s, previous fetched %i h earlier → isNew %s', (refresh, gap, isNew) => {
    const fetchedAt = hoursAgo(2);
    const c = calendar({
      pricePence: 38_000,
      provenance: { fetchedAt, maxAgeHours: 168 },
      previous: { pricePence: 45_000, fetchedAt: hoursBefore(fetchedAt, gap) },
    });
    const ctx = refresh === undefined ? CTX : { ...CTX, discoveryRefreshHours: { travelpayouts: refresh } };
    const [f] = run([drop], [c], [], ctx);
    const window = 2 * (refresh ?? 168);
    expect(f?.isNew).toBe(isNew);
    expect(f?.reason).toBe(
      isNew
        ? `last price £450 was fetched ${span(gap)} earlier, outside the ${span(window)} comparison window; not compared`
        : `down £70 (15%) from £450 fetched ${span(gap)} earlier`,
    );
  });

  // The window is judged in whole minutes (fix round 1): 336 h 30 min is outside 336 h even though it
  // floors to 336 h; 335 h 59 min is inside.
  it.each([
    [335.99, false],
    [336, false],
    [336.02, true],
    [336.5, true],
  ] as const)('default window, previous fetched %f h earlier → isNew %s', (gap, isNew) => {
    const fetchedAt = hoursAgo(2);
    const c = calendar({
      pricePence: 38_000,
      provenance: { fetchedAt, maxAgeHours: 168 },
      previous: { pricePence: 45_000, fetchedAt: hoursBefore(fetchedAt, gap) },
    });
    expect(run([drop], [c])[0]?.isNew).toBe(isNew);
  });

  it('absent-then-present is "first price seen for this cell", never a drop; absolute rules still apply; new is never suppressed', () => {
    const c = calendar({ pricePence: 38_000, previous: null });
    expect(
      run([rule({ basis: 'calendar', type: 'dropPct', thresholdPence: null, pct: 5 })], [c])[0],
    ).toMatchObject({
      isNew: true,
      reason: 'first price seen for this cell',
    });
    expect(run([cal], [c])[0]).toMatchObject({
      isNew: false,
      reason: '£380 is at or below the £450 threshold',
    });
    const id = 'r1|travelpayouts|economy|LHR|JFK|2027-03-14|2027-03-28';
    expect(
      run([drop], [c], [prior({ identityKey: id, dedupKey: `${id}|380`, pricePence: 30_000 })])[0],
    ).toMatchObject({ isNew: true, suppressed: null });
  });

  it('review focus 2: a previous price stamped in the future is compared as 0 h old, without throwing', () => {
    const c = calendar({ pricePence: 38_000, previous: { pricePence: 45_000, fetchedAt: hoursAgo(-5) } });
    expect(run([drop], [c])[0]).toMatchObject({
      isNew: false,
      reason: 'down £70 (15%) from £450 fetched under 1h earlier',
    });
  });

  it('basis must match: a calendar candidate is not seen by a verified rule and vice versa', () => {
    expect(run([rule()], [calendar()])).toEqual([]);
    expect(run([cal], [verified()])).toEqual([]);
  });
});
