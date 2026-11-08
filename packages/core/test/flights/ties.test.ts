import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ShownFlights } from '../../src/flights/choose.js';
import { orderWithinTie, tieGroups } from '../../src/flights/ties.js';
import type { ListedFlight } from '../../src/flights/types.js';

// Spec revision 55 §11 "Ties": runs of rows at one price (and of one current or superseded kind), and the order inside
// one run by the first shown flight. Synthetic flights only.

interface Row {
  id: number;
  pricePence: number;
  current: boolean;
}
const row = (id: number, pounds: number, current = true): Row => ({ id, pricePence: pounds * 100, current });
const keyOf = (r: Row) => ({ pricePence: r.pricePence, current: r.current });

function flight(durationMinutes: number, stops: number, departsLocal: string): ListedFlight {
  return {
    departsLocal,
    arrivesLocal: '18:05',
    arrivesDayOffset: 0,
    durationMinutes,
    stops,
    carriers: ['QQ Air'],
    operatedBy: null,
    amountMinor: 8600,
  };
}
const shownOf = (...flights: ListedFlight[]): ShownFlights<ListedFlight> => ({
  shown: flights,
  overLimit: false,
  moreRead: 0,
  moreOutside: 0,
});

describe('tieGroups (spec rev 55 §11 Ties)', () => {
  // Design 2026-11-08 §5.2: a trip with flights read and a calendar price at one price are not one tie group
  it('splits a run at a change of tier when the key names one, and ignores tier when it names none', () => {
    const ranked = [row(1, 86), row(2, 86), row(3, 86), row(4, 86)];
    const tierOf = (r: Row) => (r.id <= 2 ? 0 : 2);
    expect(
      tieGroups(ranked, (r) => ({ ...keyOf(r), tier: tierOf(r) })).map((g) => g.map((r) => r.id)),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(tieGroups(ranked, keyOf).map((g) => g.length)).toEqual([4]);
  });

  it('groups contiguous runs of equal price and equal current flag, in rank order', () => {
    const ranked = [row(1, 86), row(2, 86), row(3, 86, false), row(4, 92), row(5, 92)];
    const groups = tieGroups(ranked, keyOf);
    expect(groups.map((g) => g.length)).toEqual([2, 1, 2]);
    expect(groups.flat().map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });
  it('the same price apart is two groups; an empty list has none', () => {
    expect(tieGroups([row(1, 86), row(2, 92), row(3, 86)], keyOf).map((g) => g.length)).toEqual([1, 1, 1]);
    expect(tieGroups([], keyOf)).toEqual([]);
  });
  it('property: the groups, flattened, are the input in order, and each group is one key', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ p: fc.integer({ min: 1, max: 3 }), c: fc.boolean() }), { maxLength: 30 }),
        (xs) => {
          const rows = xs.map((x, i) => row(i, x.p, x.c));
          const groups = tieGroups(rows, keyOf);
          expect(groups.flat()).toEqual(rows);
          for (const g of groups) {
            expect(g.length).toBeGreaterThan(0);
            for (const r of g) expect(keyOf(r)).toEqual(keyOf(g[0] ?? r));
          }
          for (let i = 1; i < groups.length; i += 1)
            expect(keyOf(groups[i]?.[0] ?? rows[0] ?? row(0, 1))).not.toEqual(
              keyOf(groups[i - 1]?.at(-1) ?? rows[0] ?? row(0, 1)),
            );
        },
      ),
    );
  });
});

describe('orderWithinTie (spec rev 55 §11 Ties)', () => {
  it('orders by the first shown flight: shortest, then fewer changes', () => {
    const lists = new Map<number, ShownFlights<ListedFlight>>([
      [1, shownOf(flight(700, 0, '09:00'))],
      [2, shownOf(flight(600, 1, '09:00'))],
      [3, shownOf(flight(600, 0, '09:00'))],
    ]);
    const out = orderWithinTie([row(1, 86), row(2, 86), row(3, 86)], (r) => lists.get(r.id) ?? null);
    expect(out.map((r) => r.id)).toEqual([3, 2, 1]);
  });
  it('a tie decided only by the departure time goes to the earlier one', () => {
    const lists = new Map<number, ShownFlights<ListedFlight>>([
      [1, shownOf(flight(600, 0, '11:30'))],
      [2, shownOf(flight(600, 0, '07:15'))],
    ]);
    const out = orderWithinTie([row(1, 86), row(2, 86)], (r) => lists.get(r.id) ?? null);
    expect(out.map((r) => r.id)).toEqual([2, 1]);
  });
  it('the departure decides in either input order; equal first flights keep the board order', () => {
    const lists = new Map<number, ShownFlights<ListedFlight>>([
      [1, shownOf(flight(600, 0, '07:15'))],
      [2, shownOf(flight(600, 0, '11:30'))],
      [3, shownOf(flight(600, 0, '07:15'))],
      [4, shownOf(flight(600, 0, '11:30'))],
    ]);
    const out = orderWithinTie(
      [row(2, 86), row(1, 86), row(4, 86), row(3, 86)],
      (r) => lists.get(r.id) ?? null,
    );
    expect(out.map((r) => r.id)).toEqual([1, 3, 2, 4]);
  });
  it('members with no list or no flight shown keep their input order, after those with flights', () => {
    // why: the web passes null for a failed, empty or missing list and for a pair whose only list is another
    // airport pair's (listOtherPair); an empty shown set is no flights shown
    const lists = new Map<number, ShownFlights<ListedFlight> | null>([
      [1, null],
      [2, shownOf()],
      [3, shownOf(flight(800, 0, '09:00'))],
      [4, null],
      [5, shownOf(flight(500, 2, '09:00'))],
    ]);
    const out = orderWithinTie(
      [row(1, 86), row(2, 86), row(3, 86), row(4, 86), row(5, 86)],
      (r) => lists.get(r.id) ?? null,
    );
    expect(out.map((r) => r.id)).toEqual([5, 3, 1, 2, 4]);
  });
  it('property: stable, a permutation of the group, flights first', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.option(
            fc.record({
              d: fc.integer({ min: 500, max: 503 }),
              s: fc.integer({ min: 0, max: 1 }),
              t: fc.constantFrom('07:00', '09:00'),
            }),
            { nil: null },
          ),
          { maxLength: 20 },
        ),
        (xs) => {
          const rows = xs.map((_x, i) => row(i, 86));
          const shown = (r: Row) => {
            const x = xs[r.id];
            return x === null || x === undefined ? null : shownOf(flight(x.d, x.s, x.t));
          };
          const out = orderWithinTie(rows, shown);
          expect([...out].sort((a, b) => a.id - b.id)).toEqual(rows);
          const withFlights = out.filter((r) => shown(r) !== null);
          expect(out.slice(0, withFlights.length)).toEqual(withFlights);
          // stable: equal keys keep input order, and members without flights keep input order
          const key = (r: Row) => {
            const f = shown(r)?.shown[0];
            return f === undefined ? '' : `${f.durationMinutes}|${f.stops}|${f.departsLocal}`;
          };
          for (let i = 1; i < out.length; i += 1) {
            const a = out[i - 1];
            const b = out[i];
            if (a !== undefined && b !== undefined && key(a) === key(b)) expect(a.id).toBeLessThan(b.id);
          }
        },
      ),
    );
  });
});
