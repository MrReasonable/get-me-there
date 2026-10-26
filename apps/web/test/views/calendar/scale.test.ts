import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { buildCalendarModel } from '../../../src/views/Calendar/model.js';
import { cellAt, gridDay, priceAt, provCalendarAt, provItinerary } from '../../fixtures.wp10.js';
import { NOW } from '../../render.js';

const ten = (from: number, step: number) => Array.from({ length: 10 }, (_, i) => from + i * step);

describe('calendar model: one basis at a time, other-basis days hatched and excluded (spec §11 View B)', () => {
  const v = (date: string, pence: number) =>
    gridDay(date, { cheapestVerified: priceAt(pence, provItinerary(5), false, cellAt(date, 14)) });
  const c = (date: string, pence: number, stale = false) =>
    gridDay(date, { cheapestCalendar: priceAt(pence, provCalendarAt(5), stale, cellAt(date, 14)) });
  const verifiedDays = ten(40000, 5000).map((p, i) => v(`2027-03-${String(i + 1).padStart(2, '0')}`, p));
  const days = [...verifiedDays, c('2027-03-15', 30000, true)];

  it('colouring by verified bands only the verified days; the cheaper calendar day is hatched and does not move the scale', () => {
    const m = buildCalendarModel(days, 'verified', NOW);
    expect(m.scale.count).toBe(10);
    expect(m.bands.get(asIsoDate('2027-03-01'))).toBe(0);
    expect(m.hatchedDays).toBe(1);
    expect(m.bands.get(asIsoDate('2027-03-15'))).toBeUndefined();
    expect(m).toMatchObject({ shownPrices: 11, stalePrices: 1 });
  });
  it('colouring by calendar puts the one calendar day on a flat scale and hatches the ten verified days', () => {
    const m = buildCalendarModel(days, 'calendar', NOW);
    expect(m.scale.mode).toBe('flat-few');
    expect(m.flatDays.has(asIsoDate('2027-03-15'))).toBe(true);
    expect(m.bands.size).toBe(0);
    expect(m.hatchedDays).toBe(10);
  });
});
