import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { defaultColourBasis, resolveDayDisplay } from '../../../src/views/Calendar/display.js';
import {
  cellAt,
  disc,
  gridDay,
  priceAt,
  provCalendarAt,
  provItinerary,
  provItineraryKnownAge,
  slice,
} from '../../fixtures.wp10.js';
import { NOW } from '../../render.js';

const c14 = cellAt('2027-03-14', 14);

describe('day precedence (spec §11 View B, §8.1)', () => {
  it('a fresh class-verified price wins even over a cheaper calendar price, which the day then names', () => {
    const v = priceAt(52000, provItinerary(5), false, c14);
    const c = priceAt(41200, provCalendarAt(2), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({
      kind: 'price',
      basis: 'verified',
      price: v,
      stale: false,
      why: 'fresh-verified',
      cheaperCached: c,
    });
  });
  it('a dearer calendar price is not named as cached', () => {
    const v = priceAt(41200, provItinerary(5), false, c14);
    const c = priceAt(52000, provCalendarAt(2), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({
      cheaperCached: null,
    });
  });
  it('a stale SearchApi verified price (age unknown, spec rev 15) loses to any known-age calendar price', () => {
    const v = priceAt(52000, provItinerary(200), true, c14);
    const c = priceAt(41200, provCalendarAt(190), true, c14); // known worst case 238h
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toEqual({
      kind: 'price',
      basis: 'calendar',
      price: c,
      stale: true,
      why: 'calendar-fresher',
      cheaperCached: null,
    });
  });
  it('two unknown ages tie, and ties go to verified', () => {
    const v = priceAt(52000, provItinerary(300), true, c14);
    const c = priceAt(41200, provCalendarAt(1, 'unknown'), false, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({
      basis: 'verified',
      why: 'stale-verified-fresher',
      cheaperCached: c,
    });
  });
  it('equal known ages go to verified (a known-age itinerary provider; none exists today)', () => {
    const v = priceAt(52000, provItineraryKnownAge(58, 0), true, c14); // 58h
    const c = priceAt(41200, provCalendarAt(10), false, c14); // 10 + 48 = 58h
    expect(resolveDayDisplay(slice({ cheapestVerified: v, cheapestCalendar: c }), NOW)).toMatchObject({
      basis: 'verified',
    });
  });
  it('a stale calendar price still renders, labelled stale', () => {
    const c = priceAt(41200, provCalendarAt(400), true, c14);
    expect(resolveDayDisplay(slice({ cheapestCalendar: c }), NOW)).toMatchObject({
      basis: 'calendar',
      stale: true,
      why: 'calendar-only',
    });
  });
  it('a stale verified price with no calendar price renders, labelled stale', () => {
    const v = priceAt(52000, provItinerary(300), true, c14);
    expect(resolveDayDisplay(slice({ cheapestVerified: v }), NOW)).toMatchObject({
      basis: 'verified',
      stale: true,
      why: 'stale-verified-only',
    });
  });
  it('a partially-verified price never becomes the day price', () => {
    const pv = { ...priceAt(30000, provItinerary(1), false, c14), count: 3 };
    expect(
      resolveDayDisplay(
        slice({ cheapestPartiallyVerified: pv, discovery: [disc('searchapi', { priced: 1 })] }),
        NOW,
      ).kind,
    ).toBe('glyphs');
  });
});

describe('days without a price (spec §11 View B, plan decision 38)', () => {
  it('one counted glyph per non-zero unpriced status of the best-covered source, in a fixed order, skipped included', () => {
    const s = slice({
      discovery: [
        disc('travelpayouts', { no_data: 3, not_run: 2, skipped: 1, error: 1 }),
        disc('searchapi', { error: 1, empty: 1 }),
      ],
    });
    // why: ui-r2-003 — one source's counts, never a union of two providers' states.
    expect(resolveDayDisplay(s, NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [
        { status: 'no_data', count: 3 },
        { status: 'error', count: 1 },
        { status: 'skipped', count: 1 },
        { status: 'not_run', count: 2 },
      ],
      reason: 'counts',
    });
  });
  it('"1 no fares, 47 not searched" and "47 no fares, 1 not searched" are different days (ui-r2-003)', () => {
    const a = resolveDayDisplay(
      slice({ discovery: [disc('travelpayouts', { empty: 1, not_run: 47 })] }),
      NOW,
    );
    const b = resolveDayDisplay(
      slice({ discovery: [disc('travelpayouts', { empty: 47, not_run: 1 })] }),
      NOW,
    );
    expect(a).not.toEqual(b);
    expect(a).toEqual({
      kind: 'glyphs',
      glyphs: [
        { status: 'empty', count: 1 },
        { status: 'not_run', count: 47 },
      ],
      reason: 'counts',
    });
  });
  it('a day whose cells are all skipped shows the skipped glyph, never a blank', () => {
    expect(resolveDayDisplay(slice({ discovery: [disc('travelpayouts', { skipped: 12 })] }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [{ status: 'skipped', count: 12 }],
      reason: 'counts',
    });
  });
  it('a configured definition whose day no run has reached is not searched, not "no provider" (po-wp10-001)', () => {
    expect(resolveDayDisplay(slice({ discovery: [] }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [{ status: 'not_run', count: null }],
      reason: 'no-run',
    });
    expect(resolveDayDisplay(slice({ discovery: [], discoveryProviders: [] }), NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [],
      reason: 'no-provider',
    });
  });
  it('a filtered day is counted by the api for its destination, so its glyphs are its own (decision 53)', () => {
    const s = slice({
      destination: asIata('JFK'),
      discovery: [disc('travelpayouts', { empty: 2, not_run: 22 })],
    });
    expect(resolveDayDisplay(s, NOW)).toEqual({
      kind: 'glyphs',
      glyphs: [
        { status: 'empty', count: 2 },
        { status: 'not_run', count: 22 },
      ],
      reason: 'counts',
    });
  });
});

describe('default colour basis (plan decision 38)', () => {
  const v = (d: string) =>
    gridDay(d, { cheapestVerified: priceAt(50000, provItinerary(5), false, cellAt(d, 14)) });
  const c = (d: string) =>
    gridDay(d, { cheapestCalendar: priceAt(40000, provCalendarAt(5), false, cellAt(d, 14)) });
  it('is the calendar basis with one verified day among many priced days', () => {
    expect(defaultColourBasis([v('2027-03-01'), c('2027-03-02'), c('2027-03-03')], true, NOW)).toBe(
      'calendar',
    );
  });
  it('is the calendar basis on an even split, and verified only with a strict majority', () => {
    expect(defaultColourBasis([v('2027-03-01'), c('2027-03-02')], true, NOW)).toBe('calendar');
    expect(defaultColourBasis([v('2027-03-01'), v('2027-03-02'), c('2027-03-03')], true, NOW)).toBe(
      'verified',
    );
  });
  it('is the calendar basis without a verification provider, and with no priced day', () => {
    expect(defaultColourBasis([v('2027-03-01')], false, NOW)).toBe('calendar');
    expect(defaultColourBasis([gridDay('2027-03-01')], true, NOW)).toBe('calendar');
  });
});
