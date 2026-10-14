import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { RowRejected } from '../src/internal/validate.js';
import { FxRepo } from '../src/repositories/fx.js';
import { freshDb } from './helpers/db.js';

const d = asIsoDate;
const row = { date: d('2026-10-12'), currency: 'USD', rateNano: 750_000_000, source: 'frankfurter' };

describe('FxRepo (spec §5.6, §6.3, §7 fx_rates)', () => {
  it('stores integer nano rates with their source and answers the newest rate within maxAgeDays', () => {
    const repo = new FxRepo(freshDb());
    repo.upsert([
      { ...row, date: d('2026-10-09'), rateNano: 760_000_000 },
      row,
      { ...row, currency: 'JPY', rateNano: 5_100_000 },
    ]);
    expect(repo.rateNano(d('2026-10-12'), 'USD')).toBe(750_000_000);
    expect(repo.rateNano(d('2026-10-13'), 'USD')).toBeNull();
    expect(repo.latest('USD', 3, d('2026-10-14'))).toEqual({
      rateNano: 750_000_000,
      date: '2026-10-12',
      source: 'frankfurter',
    });
    expect(repo.latest('USD', 3, d('2026-10-15'))?.date).toBe('2026-10-12'); // 15 − 3 = 12: in
    expect(repo.latest('USD', 3, d('2026-10-16'))).toBeNull(); // 16 − 3 = 13: too old
    expect(repo.latest('CNY', 3, d('2026-10-14'))).toBeNull();
  });

  it('upsert replaces the rate and source for the same date and currency', () => {
    const repo = new FxRepo(freshDb());
    repo.upsert([{ ...row, source: 'a' }]);
    repo.upsert([{ ...row, rateNano: 751_000_000, source: 'b' }]);
    expect(repo.latest('USD', 3, d('2026-10-12'))).toEqual({
      rateNano: 751_000_000,
      date: '2026-10-12',
      source: 'b',
    });
  });

  it('rejects non-integer rates, lower-case currencies, GBP itself and an empty source, writing nothing', () => {
    const repo = new FxRepo(freshDb());
    expect(() => repo.upsert([row, { ...row, currency: 'EUR', rateNano: 0.75 }])).toThrow(RowRejected);
    expect(() => repo.upsert([{ ...row, currency: 'usd' }])).toThrow(/currency/);
    expect(() => repo.upsert([{ ...row, currency: 'GBP' }])).toThrow(/GBP/);
    expect(() => repo.upsert([{ ...row, source: '' }])).toThrow(/source/);
    expect(repo.rateNano(d('2026-10-12'), 'USD')).toBeNull();
  });
});
