import { describe, expect, it } from 'vitest';
import { dedupKey, identityKey, isSuppressed } from '../../src/alerts/dedup.js';
import type { PriorFiring } from '../../src/types/alerts.js';
import { calendar, cell, hoursAgo, NOW, prior, rule, verified } from '../helpers/alerts.js';

const at = (pricePence: number) => ({
  identityKey: 'r1|h1',
  dedupKey: dedupKey('r1|h1', pricePence),
  candidate: verified({ observation: { pricePence } }),
});

describe('identityKey (plan contract formats, spec §6.8)', () => {
  it('verified is ruleId|itineraryHash; calendar is ruleId|providerId|cabin|cellKeyString', () => {
    expect(identityKey(rule(), verified())).toBe('r1|h1');
    expect(identityKey(rule({ basis: 'calendar' }), calendar({ cell: cell(15) }))).toBe(
      'r1|travelpayouts|economy|LHR|JFK|2027-03-15|2027-03-29',
    );
  });
});

describe('dedupKey (spec §6.8)', () => {
  it('is identity + floor(pricePence / 100)', () => {
    expect(dedupKey('r1|h1', 41_200)).toBe('r1|h1|412');
    expect(dedupKey('r1|h1', 41_299)).toBe('r1|h1|412');
    expect(dedupKey('r1|h1', 41_300)).toBe('r1|h1|413');
    expect(dedupKey('r1|h1', 99)).toBe('r1|h1|0');
  });
});

describe('isSuppressed (spec §6.8 cooldown, default 336 h; ruling 8 repeat step)', () => {
  it('same dedup key within the cooldown is suppressed, with a reason; at the cooldown it is not', () => {
    expect(isSuppressed(at(41_200), [prior({ firedAt: hoursAgo(335) })], 336, NOW)).toEqual({
      suppressed: true,
      reason: 'same price band alerted 335h ago (cooldown 336h)',
    });
    expect(isSuppressed(at(41_200), [prior({ firedAt: hoursAgo(336) })], 336, NOW)).toEqual({
      suppressed: false,
      reason: null,
    });
  });

  it('within the cooldown, a repeat needs a fall of at least max(£10, 5%) below the last fired price', () => {
    // last fired £412: 5% is £20.60, so the floor is £391.40
    const last = [prior({ pricePence: 41_200 })];
    expect(isSuppressed(at(39_140), last, 336, NOW)).toEqual({ suppressed: false, reason: null });
    expect(isSuppressed(at(39_141), last, 336, NOW)).toEqual({
      suppressed: true,
      reason: 'alerted at £412 24h ago; within the 336h cooldown a new alert needs £391.40 or less',
    });
    // last fired £150: 5% is £7.50, so the £10 minimum applies and the floor is £140
    const cheap = [prior({ pricePence: 15_000, dedupKey: 'r1|h1|150' })];
    expect(isSuppressed(at(14_000), cheap, 336, NOW).suppressed).toBe(false);
    expect(isSuppressed(at(14_001), cheap, 336, NOW).suppressed).toBe(true);
    // equal or higher than the last fired price stays suppressed
    expect(isSuppressed(at(41_500), last, 336, NOW).suppressed).toBe(true);
  });

  it('the step is measured from the most recent firing of the identity', () => {
    const older = prior({ pricePence: 50_000, dedupKey: 'r1|h1|500', firedAt: hoursAgo(100) });
    const newer = prior({ pricePence: 41_200, firedAt: hoursAgo(10) });
    expect(isSuppressed(at(45_000), [older, newer], 336, NOW).suppressed).toBe(true);
    expect(isSuppressed(at(45_000), [newer, older], 336, NOW).suppressed).toBe(true);
  });

  it('three successive £1 drops inside the cooldown send once', () => {
    const sent: PriorFiring[] = [];
    let sends = 0;
    for (const [i, price] of [41_200, 41_100, 41_000, 40_900].entries()) {
      const f = at(price);
      if (!isSuppressed(f, sent, 336, hoursAgo(24 - i)).suppressed) {
        sends += 1;
        sent.push({
          identityKey: f.identityKey,
          dedupKey: f.dedupKey,
          pricePence: price,
          firedAt: hoursAgo(24 - i),
        });
      }
    }
    expect(sends).toBe(1);
  });

  it('a prior firing outside the cooldown no longer suppresses, whatever its price (review test-008)', () => {
    expect(
      isSuppressed(at(41_200), [prior({ dedupKey: 'other', firedAt: hoursAgo(336) })], 336, NOW).suppressed,
    ).toBe(false);
    expect(
      isSuppressed(at(41_200), [prior({ dedupKey: 'other', firedAt: hoursAgo(337) })], 336, NOW).suppressed,
    ).toBe(false);
  });

  it('other identities do not count; calendar candidates are priced from the candidate itself', () => {
    expect(
      isSuppressed(at(41_200), [prior({ identityKey: 'r1|h9', dedupKey: 'r1|h9|412' })], 336, NOW).suppressed,
    ).toBe(false);
    const c = { identityKey: 'k', dedupKey: 'k|300', candidate: calendar({ pricePence: 30_000 }) };
    expect(
      isSuppressed(c, [prior({ identityKey: 'k', dedupKey: 'x', pricePence: 30_000 })], 336, NOW).suppressed,
    ).toBe(true);
  });

  it('review focus 2: a firing stamped in the future reads as 0 h old (inside the cooldown) without throwing', () => {
    expect(isSuppressed(at(41_200), [prior({ firedAt: hoursAgo(-3) })], 336, NOW)).toEqual({
      suppressed: true,
      reason: 'same price band alerted 0h ago (cooldown 336h)',
    });
  });
});
