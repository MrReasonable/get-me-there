import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { clockOf, legWords, rowDay } from '../../src/lib/legWords.js';

// Ruling 20 (Trips and Search plan): one way of a trip in words.

describe('legWords', () => {
  it('says times, journey time, changes and airlines in that order', () => {
    expect(
      legWords(
        { durationMinutes: 640, stops: 1, carriers: ['Aer Lingus'] },
        { depart: '07:15', arrive: '17:55' },
      ),
    ).toBe('07:15 → 17:55 · 10h 40m · 1 change · Aer Lingus');
  });
  it('says "direct" for no stops, "2 changes" for two, and joins airlines with ", "', () => {
    expect(
      legWords(
        { durationMinutes: 415, stops: 0, carriers: ['Virgin Atlantic', 'Delta'] },
        { depart: '18:30', arrive: '06:25' },
      ),
    ).toBe('18:30 → 06:25 · 6h 55m · direct · Virgin Atlantic, Delta');
    expect(legWords({ durationMinutes: 900, stops: 2 }, { depart: '09:00', arrive: '21:00' })).toContain(
      '2 changes',
    );
  });
  it('leaves the airlines off when there are none to show (the cards) and the parts a verified leg does not state', () => {
    expect(
      legWords({ durationMinutes: 640, stops: 1, carriers: undefined }, { depart: '07:15', arrive: '17:55' }),
    ).toBe('07:15 → 17:55 · 10h 40m · 1 change');
    expect(
      legWords({ durationMinutes: null, stops: null, carriers: [] }, { depart: '07:15', arrive: '17:55' }),
    ).toBe('07:15 → 17:55');
    expect(legWords({ durationMinutes: 640, stops: null }, { depart: null, arrive: null })).toBe('10h 40m');
    expect(legWords({ durationMinutes: null, stops: null }, { depart: null, arrive: null })).toBe('');
  });
  it("takes the clock from a verified result's local date-time", () => {
    expect(clockOf('2027-03-14T18:30')).toBe('18:30');
    expect(clockOf('07:15')).toBe('07:15');
    expect(clockOf(null)).toBeNull();
    expect(clockOf('late')).toBeNull();
  });
});

describe('rowDay', () => {
  it('is the weekday, day and month', () => {
    expect(rowDay(asIsoDate('2026-11-11'))).toBe('Wed 11 Nov');
  });
});
