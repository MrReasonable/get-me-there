import { describe, expect, it } from 'vitest';
import { executionSummarySchema, priceCellSchema, resultRowSchema } from '../../src/api-contract/index.js';
import { effectiveAge, formatAgeFull, formatAgo, formatFetchedAgo } from '../../src/labels/age.js';
import { filterRows } from '../../src/results/filter.js';
import { asIsoDate, asIsoDateTime } from '../../src/types/ids.js';
import { calendarRow, row } from '../helpers/rows.js';

// The core additions the WP9 brief makes (plan decision 36): the truncated flag on prices, the
// departure-date range filter, and the relative-age phrases the web shows.

describe('truncated flag on every price (decisions 30 and 36)', () => {
  it('a price cell and a result row carry it, and neither parses without it', () => {
    const r = calendarRow({ truncated: true });
    expect(r.truncated).toBe(true);
    const { truncated: _row, ...unflaggedRow } = r;
    expect(resultRowSchema.safeParse(unflaggedRow).success).toBe(false);
    const cell = {
      pricePence: r.pricePence,
      provenance: r.provenance,
      stale: false,
      ageHours: 2,
      truncated: true,
    };
    expect(priceCellSchema.parse(cell).truncated).toBe(true);
    const { truncated: _cell, ...unflaggedCell } = cell;
    expect(priceCellSchema.safeParse(unflaggedCell).success).toBe(false);
  });
});

describe('departure-date range filter (spec §6.5 filters, decision 36)', () => {
  const on = (d: string) => row({ itineraryHash: d, cell: { departureDate: d } });
  const rows = [on('2027-02-28'), on('2027-03-01'), on('2027-03-31'), on('2027-04-01')];
  const names = (rs: ReturnType<typeof row>[]) => rs.map((r) => r.itineraryHash);

  it('keeps rows departing inside the range, both ends inclusive', () => {
    const march = { from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-31') };
    expect(names(filterRows(rows, { departure: march }))).toEqual(['2027-03-01', '2027-03-31']);
  });

  it('composes with the other filters (AND), and an absent range keeps every row', () => {
    const priced = [
      row({ itineraryHash: 'in-cheap', pricePence: 100, cell: { departureDate: '2027-03-10' } }),
      row({ itineraryHash: 'in-dear', pricePence: 900, cell: { departureDate: '2027-03-11' } }),
      row({ itineraryHash: 'out-cheap', pricePence: 100, cell: { departureDate: '2027-04-10' } }),
    ];
    const march = { from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-31') };
    expect(names(filterRows(priced, { departure: march, maxPricePence: 500 }))).toEqual(['in-cheap']);
    expect(filterRows(rows, {})).toHaveLength(4);
  });
});

describe('the execution summary carries the run own expandTop (decision 42)', () => {
  it('requires a positive integer', () => {
    const s = {
      id: 'e',
      status: 'completed',
      isChild: false,
      startedAt: null,
      finishedAt: null,
      ageHours: 2,
      expandTop: 2,
    };
    expect(executionSummarySchema.parse(s).expandTop).toBe(2);
    const { expandTop: _drop, ...bare } = s;
    expect(executionSummarySchema.safeParse(bare).success).toBe(false);
    expect(executionSummarySchema.safeParse({ ...s, expandTop: 0 }).success).toBe(false);
  });
});

describe('relative-age phrases shared by web and email (spec §3)', () => {
  it('formatAgo says "just now" under an hour and "<duration> ago" after', () => {
    expect([0, 5, 72, 400].map(formatAgo)).toEqual(['just now', '5h ago', '3d ago', '2w ago']);
  });

  it('formatFetchedAgo is the fetch age alone, the leading part of the full form', () => {
    const now = asIsoDateTime('2026-10-14T15:00:00.000Z');
    const a = effectiveAge({ fetchedAt: asIsoDateTime('2026-10-14T13:00:00.000Z'), maxAgeHours: 48 }, now);
    expect(formatFetchedAgo(a)).toBe('fetched 2h ago');
    expect(formatAgeFull(a).startsWith(formatFetchedAgo(a))).toBe(true);
  });
});
