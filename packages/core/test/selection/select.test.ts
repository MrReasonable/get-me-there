import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { selectCandidates } from '../../src/selection/select.js';
import { generateCells } from '../../src/space/generate.js';
import { type Cell, cellKeyString, type VerificationPolicy } from '../../src/types/definition.js';
import type { RollUp } from '../../src/types/execution.js';
import { key, space } from '../helpers/space.js';

// 3 departure days × 2 nights = 6 cells, generation order:
// 0: 03-01+7  1: 03-01+8  2: 03-02+7  3: 03-02+8  4: 03-03+7  5: 03-03+8
const cells = generateCells(
  space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 7, max: 8 }),
);
const at = (i: number): Cell => {
  const c = cells[i];
  if (c === undefined) throw new Error(`fixture has no cell ${i}`);
  return c;
};
const k = (i: number) => key(at(i).origin, at(i).destination, at(i).departureDate, at(i).returnDate);

/** Discovery roll-ups from a list of [cell index, price]; unlisted cells have no priced roll-up. */
function priced(
  entries: Array<[number, number]>,
  others: Partial<Record<number, RollUp>> = {},
): Map<string, RollUp> {
  const m = new Map<string, RollUp>();
  for (const [i, p] of entries) m.set(cellKeyString(at(i)), { status: 'priced', reason: null, minPence: p });
  for (const [i, r] of Object.entries(others)) if (r) m.set(cellKeyString(at(Number(i))), r);
  return m;
}
// expandTop and bookingLinks belong to stage 2's search, not to selection; fixed values here.
const policy = (p: Partial<VerificationPolicy>): VerificationPolicy => ({
  maxCells: 10,
  topN: 10,
  alwaysInclude: [],
  expandTop: 2,
  bookingLinks: true,
  ...p,
});
const picks = (r: ReturnType<typeof selectCandidates>, space_: Cell[] = cells) =>
  r.map((s) => [space_.findIndex((c) => cellKeyString(c) === cellKeyString(s.cell)), s.reason]);

const PRICES: Array<[number, number]> = [
  [0, 600],
  [1, 400],
  [2, 500],
  [3, 400],
  [4, 900],
  [5, 300],
];

describe('selectCandidates (spec §6.7)', () => {
  it('step 2–3: ranks priced cells by minPence, ties in generation order, stops after topN', () => {
    expect(picks(selectCandidates(policy({ topN: 4 }), cells, priced(PRICES), true))).toEqual([
      [5, 'top_n'],
      [1, 'top_n'],
      [3, 'top_n'],
      [2, 'top_n'], // 400 tie: index 1 before 3
    ]);
  });

  it('pins the generation-order tie-break: five equal-price cells keep ascending index, not reversed or shuffled', () => {
    // 7 departure days × 1 night; prices 5,3,3,3,3,3,1 are non-monotone, so only a correct (price, index)
    // comparator yields 6, 1, 2, 3.
    const seven = generateCells(
      space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-07', min: 7, max: 7 }),
    );
    const prices = [5, 3, 3, 3, 3, 3, 1];
    const discovery = new Map<string, RollUp>();
    seven.forEach((c, i) => {
      discovery.set(cellKeyString(c), { status: 'priced', reason: null, minPence: prices[i] ?? 0 });
    });
    const r = selectCandidates(policy({ topN: 4 }), seven, discovery, true);
    expect(r.map((x) => seven.findIndex((c) => cellKeyString(c) === cellKeyString(x.cell)))).toEqual([
      6, 1, 2, 3,
    ]);
  });

  it('only priced roll-ups are ranked: empty, no_data, error, not_run and absent cells are not selected', () => {
    const others = {
      1: { status: 'empty', reason: null, minPence: null },
      2: { status: 'no_data', reason: null, minPence: null },
      3: { status: 'error', reason: null, minPence: null },
      4: { status: 'not_run', reason: null, minPence: null },
    } satisfies Partial<Record<number, RollUp>>;
    expect(picks(selectCandidates(policy({}), cells, priced([[0, 600]], others), true))).toEqual([
      [0, 'top_n'],
    ]);
  });

  it('step 1: alwaysInclude first, deduplicated, counted toward maxCells, skipped in the walk', () => {
    const r = selectCandidates(
      policy({ maxCells: 3, alwaysInclude: [k(4), k(5), k(4)] }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [4, 'always_include'],
      [5, 'always_include'],
      [1, 'top_n'],
    ]);
  });

  it('step 3: maxCells stops additions before topN is reached', () => {
    expect(picks(selectCandidates(policy({ maxCells: 2, topN: 5 }), cells, priced(PRICES), true))).toEqual([
      [5, 'top_n'],
      [1, 'top_n'],
    ]);
  });

  it('step 3: perDepartureDateBest caps each date and counts alwaysInclude toward it', () => {
    // 03-03 already has cell 4 from alwaysInclude, so cell 5 (cheapest, also 03-03) is skipped;
    // 1 (400, 03-01) and 3 (400, 03-02) are taken; 2 (500, 03-02) finds 03-02 full.
    const r = selectCandidates(
      policy({ perDepartureDateBest: 1, alwaysInclude: [k(4)] }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [4, 'always_include'],
      [1, 'top_n'],
      [3, 'top_n'],
    ]);
  });

  it('step 4: with a ceiling, keeps walking after topN adding only cells ≤ ceiling until maxCells', () => {
    const r = selectCandidates(
      policy({ topN: 1, maxCells: 4, priceCeilingPence: 500 }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [5, 'top_n'],
      [1, 'ceiling'],
      [3, 'ceiling'],
      [2, 'ceiling'],
    ]);
  });

  it('step 4: the ceiling excludes dearer cells, honours perDepartureDateBest, and is inclusive', () => {
    const r = selectCandidates(
      policy({ topN: 1, priceCeilingPence: 400, perDepartureDateBest: 1 }),
      cells,
      priced(PRICES),
      true,
    );
    // 5 (300) top_n; 1 (400, 03-01) ceiling; 3 (400, 03-02) ceiling; 2 (500) over the ceiling.
    expect(picks(r)).toEqual([
      [5, 'top_n'],
      [1, 'ceiling'],
      [3, 'ceiling'],
    ]);
  });

  it('step 4: cells dearer than the ceiling are never added, however much room is left', () => {
    const r = selectCandidates(
      policy({ topN: 1, maxCells: 6, priceCeilingPence: 450 }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [5, 'top_n'],
      [1, 'ceiling'],
      [3, 'ceiling'],
    ]); // 2 (500), 0 (600), 4 (900) excluded
  });

  it('step 4: an alwaysInclude member under the ceiling is not added twice', () => {
    const r = selectCandidates(
      policy({ topN: 1, maxCells: 6, priceCeilingPence: 450, alwaysInclude: [k(1)] }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [1, 'always_include'],
      [5, 'top_n'],
      [3, 'ceiling'],
    ]);
  });

  it('step 3: perDepartureDateBest 2 allows exactly two cells per date', () => {
    const r = selectCandidates(
      policy({ perDepartureDateBest: 2 }),
      cells,
      priced([
        [0, 100],
        [1, 200],
        [2, 300],
        [3, 400],
      ]),
      true,
    );
    expect(picks(r).map(([i]) => i)).toEqual([0, 1, 2, 3]);
    const same = selectCandidates(
      policy({ perDepartureDateBest: 2, alwaysInclude: [k(0)] }),
      cells,
      priced([
        [1, 200],
        [2, 300],
      ]),
      true,
    );
    expect(picks(same).map(([i]) => i)).toEqual([0, 1, 2]);
  });

  it('step 4: without a ceiling, stops after step 3 even with room left', () => {
    expect(picks(selectCandidates(policy({ topN: 1, maxCells: 6 }), cells, priced(PRICES), true))).toEqual([
      [5, 'top_n'],
    ]);
  });

  it('topN 0 with a ceiling selects by ceiling only', () => {
    const r = selectCandidates(
      policy({ topN: 0, maxCells: 2, priceCeilingPence: 450 }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [5, 'ceiling'],
      [1, 'ceiling'],
    ]);
  });

  it('sparse discovery is not topped up by stride: no priced cells means alwaysInclude only', () => {
    expect(picks(selectCandidates(policy({ alwaysInclude: [k(2)] }), cells, new Map(), true))).toEqual([
      [2, 'always_include'],
    ]);
  });

  it('drops alwaysInclude members outside the resolved space (slid out of a relative window)', () => {
    const gone = key('LHR', 'JFK', '2027-02-28', '2027-03-07');
    expect(
      picks(selectCandidates(policy({ maxCells: 1, alwaysInclude: [gone] }), cells, priced(PRICES), true)),
    ).toEqual([[5, 'top_n']]);
  });

  it('throws on a priced discovery roll-up without minPence (broken invariant)', () => {
    const bad = new Map<string, RollUp>([
      [cellKeyString(at(0)), { status: 'priced', reason: null, minPence: null }],
    ]);
    expect(() => selectCandidates(policy({}), cells, bad, true)).toThrow(/without minPence/);
  });

  describe('step 5: even stride when the execution has no discovery provider', () => {
    it('k = floor(total / m), start at 0, at most m cells', () => {
      // m = 3, k = floor(6 / 3) = 2 → indexes 0, 2, 4
      expect(picks(selectCandidates(policy({ maxCells: 3 }), cells, new Map(), false))).toEqual([
        [0, 'stride'],
        [2, 'stride'],
        [4, 'stride'],
      ]);
    });

    it('strides over the cells not already chosen', () => {
      // m = 4 − 1 = 3; remaining = [1, 2, 3, 4, 5]; k = floor(5 / 3) = 1 → 1, 2, 3.
      const r = selectCandidates(policy({ maxCells: 4, alwaysInclude: [k(0)] }), cells, new Map(), false);
      expect(picks(r)).toEqual([
        [0, 'always_include'],
        [1, 'stride'],
        [2, 'stride'],
        [3, 'stride'],
      ]);
    });

    it('never loses a slot to alwaysInclude members the stride would land on (cells 0 and 3)', () => {
      // m = 5 − 2 = 3; remaining = [1, 2, 4, 5]; k = floor(4 / 3) = 1 → 1, 2, 4: three picks, not two.
      const r = selectCandidates(
        policy({ maxCells: 5, alwaysInclude: [k(0), k(3)] }),
        cells,
        new Map(),
        false,
      );
      expect(picks(r)).toEqual([
        [0, 'always_include'],
        [3, 'always_include'],
        [1, 'stride'],
        [2, 'stride'],
        [4, 'stride'],
      ]);
    });

    it('total < m: k = max(1, 0) = 1 and every cell is taken once', () => {
      expect(
        picks(selectCandidates(policy({ maxCells: 10 }), cells, new Map(), false)).map(([i]) => i),
      ).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('m = 0: alwaysInclude fills maxCells and the stride adds nothing', () => {
      expect(
        picks(selectCandidates(policy({ maxCells: 1, alwaysInclude: [k(3)] }), cells, new Map(), false)),
      ).toEqual([[3, 'always_include']]);
    });

    it('ignores discovery roll-ups entirely', () => {
      expect(picks(selectCandidates(policy({ maxCells: 1 }), cells, priced(PRICES), false))).toEqual([
        [0, 'stride'],
      ]);
    });

    it('takes every remaining cell when m exceeds them: maxCells 6 with alwaysInclude [5] takes 0–4', () => {
      const r = selectCandidates(policy({ maxCells: 6, alwaysInclude: [k(5)] }), cells, new Map(), false);
      expect(picks(r).map(([i]) => i)).toEqual([5, 0, 1, 2, 3, 4]);
    });
  });

  it('alwaysInclude of exactly maxCells with discovery adds no top_n or ceiling cells', () => {
    const r = selectCandidates(
      policy({ maxCells: 2, topN: 2, priceCeilingPence: 10_000, alwaysInclude: [k(4), k(0)] }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [4, 'always_include'],
      [0, 'always_include'],
    ]);
  });

  it('a ceiling that admits every cell still stops at maxCells', () => {
    const r = selectCandidates(
      policy({ maxCells: 3, topN: 1, priceCeilingPence: 10_000 }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [5, 'top_n'],
      [1, 'ceiling'],
      [3, 'ceiling'],
    ]);
  });

  it('returns fresh CellKey objects: no nights key, no aliasing of the policy', () => {
    const p = policy({ maxCells: 2, topN: 1, alwaysInclude: [k(4)] });
    const r = selectCandidates(p, cells, priced(PRICES), true);
    expect(r).toEqual([
      { cell: k(4), reason: 'always_include' },
      { cell: k(5), reason: 'top_n' },
    ]);
    expect(r[0]?.cell).not.toBe(p.alwaysInclude[0]);
    expect(Object.keys(r[1]?.cell ?? {})).toEqual(['origin', 'destination', 'departureDate', 'returnDate']);
  });

  describe('spend bound (spec §6.7: maxCells is the upper bound the estimate uses)', () => {
    it.each([
      [{ maxCells: -1 }, /maxCells must be a non-negative integer/],
      [{ maxCells: 2.5 }, /maxCells must be a non-negative integer/],
      [{ topN: -1 }, /topN must be a non-negative integer/],
      [{ topN: 0.5 }, /topN must be a non-negative integer/],
      [{ perDepartureDateBest: 1.5 }, /perDepartureDateBest must be a non-negative integer/],
      [{ perDepartureDateBest: -1 }, /perDepartureDateBest must be a non-negative integer/],
    ])('throws RangeError for %j', (patch, message) => {
      expect(() => selectCandidates(policy(patch), cells, priced(PRICES), true)).toThrow(RangeError);
      expect(() => selectCandidates(policy(patch), cells, priced(PRICES), true)).toThrow(message);
    });

    it('throws when distinct in-space alwaysInclude cells exceed maxCells (duplicates and out-of-space members do not count)', () => {
      const gone = key('LHR', 'JFK', '2027-02-28', '2027-03-07');
      expect(() =>
        selectCandidates(policy({ maxCells: 1, alwaysInclude: [k(3), k(4), k(3)] }), cells, new Map(), false),
      ).toThrow(/alwaysInclude has 2 distinct cells in the space; maxCells is 1/);
      expect(
        picks(
          selectCandidates(
            policy({ maxCells: 1, alwaysInclude: [k(3), k(3), gone] }),
            cells,
            new Map(),
            false,
          ),
        ),
      ).toEqual([[3, 'always_include']]);
    });

    it('property: never more than maxCells, no duplicates, all in space, alwaysInclude kept, per-date cap held', () => {
      // A 2 × 1 × 4 × 2 = 16-cell space keeps the generator small but lets dates collide.
      const big = generateCells(
        space({ o: ['LHR', 'LGW'], d: ['JFK'], from: '2027-03-01', to: '2027-03-04', min: 7, max: 8 }),
      );
      const keys = big.map(cellKeyString);
      const arbPolicy = fc.integer({ min: 0, max: 8 }).chain((maxCells) =>
        fc.record({
          maxCells: fc.constant(maxCells),
          topN: fc.integer({ min: 0, max: maxCells }),
          priceCeilingPence: fc.option(fc.integer({ min: 0, max: 1_200 }), { nil: undefined }),
          perDepartureDateBest: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
          alwaysIdx: fc.array(fc.integer({ min: 0, max: big.length - 1 }), { maxLength: maxCells * 2 }),
        }),
      );
      const arbDiscovery = fc.array(fc.option(fc.integer({ min: 0, max: 1_000 }), { nil: null }), {
        minLength: big.length,
        maxLength: big.length,
      });
      fc.assert(
        fc.property(arbPolicy, arbDiscovery, fc.boolean(), (p, prices, hasDiscovery) => {
          // Keep the distinct alwaysInclude count within maxCells, as validation guarantees.
          const distinct = [...new Set(p.alwaysIdx)].slice(0, p.maxCells);
          const alwaysInclude = p.alwaysIdx
            .filter((i) => distinct.includes(i))
            .flatMap((i) => {
              const c = big[i];
              return c === undefined ? [] : [key(c.origin, c.destination, c.departureDate, c.returnDate)];
            });
          const pol: VerificationPolicy = {
            maxCells: p.maxCells,
            topN: p.topN,
            alwaysInclude,
            expandTop: 2,
            bookingLinks: true,
            ...(p.priceCeilingPence === undefined ? {} : { priceCeilingPence: p.priceCeilingPence }),
            ...(p.perDepartureDateBest === undefined ? {} : { perDepartureDateBest: p.perDepartureDateBest }),
          };
          const discovery = new Map<string, RollUp>();
          big.forEach((c, i) => {
            const price = prices[i];
            if (price !== null && price !== undefined) {
              discovery.set(cellKeyString(c), { status: 'priced', reason: null, minPence: price });
            }
          });
          const r = selectCandidates(pol, big, discovery, hasDiscovery);
          const got = r.map((x) => cellKeyString(x.cell));
          expect(r.length).toBeLessThanOrEqual(p.maxCells);
          expect(new Set(got).size).toBe(got.length);
          for (const g of got) expect(keys).toContain(g);
          for (const a of alwaysInclude) expect(got).toContain(cellKeyString(a));
          if (hasDiscovery && pol.perDepartureDateBest !== undefined) {
            const perDate = new Map<string, number>();
            for (const x of r)
              perDate.set(x.cell.departureDate, (perDate.get(x.cell.departureDate) ?? 0) + 1);
            for (const x of r) {
              if (x.reason === 'always_include') continue;
              expect(perDate.get(x.cell.departureDate)).toBeLessThanOrEqual(
                Math.max(
                  pol.perDepartureDateBest,
                  r.filter(
                    (y) => y.reason === 'always_include' && y.cell.departureDate === x.cell.departureDate,
                  ).length,
                ),
              );
            }
          }
          if (!hasDiscovery) {
            const strides = r.filter((x) => x.reason === 'stride').length;
            expect(strides).toBe(Math.min(p.maxCells - distinct.length, big.length - distinct.length));
          }
        }),
        { numRuns: 500 },
      );
    });
  });

  it('property: matches an independent reference (sort by price then index, caps, ceiling) without alwaysInclude', () => {
    const big = generateCells(
      space({ o: ['LHR', 'LGW'], d: ['JFK'], from: '2027-03-01', to: '2027-03-04', min: 7, max: 8 }),
    );
    const arbCase = fc.record({
      maxCells: fc.integer({ min: 0, max: 8 }),
      topN: fc.integer({ min: 0, max: 8 }),
      ceiling: fc.option(fc.integer({ min: 0, max: 1_000 }), { nil: undefined }),
      perDate: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
      // Few distinct prices so ties are common.
      prices: fc.array(
        fc.option(
          fc.integer({ min: 0, max: 4 }).map((n) => n * 250),
          { nil: null },
        ),
        {
          minLength: big.length,
          maxLength: big.length,
        },
      ),
    });
    fc.assert(
      fc.property(arbCase, (c) => {
        const topN = Math.min(c.topN, c.maxCells);
        const pol = policy({
          maxCells: c.maxCells,
          topN,
          ...(c.ceiling === undefined ? {} : { priceCeilingPence: c.ceiling }),
          ...(c.perDate === undefined ? {} : { perDepartureDateBest: c.perDate }),
        });
        const discovery = new Map<string, RollUp>();
        const entries: Array<{ i: number; p: number }> = [];
        big.forEach((cell, i) => {
          const p = c.prices[i];
          if (p === null || p === undefined) return;
          discovery.set(cellKeyString(cell), { status: 'priced', reason: null, minPence: p });
          entries.push({ i, p });
        });
        // Reference: order the priced cells, then walk once with two phases.
        const order = [...entries].sort((x, y) => (x.p === y.p ? x.i - y.i : x.p - y.p));
        const expected: Array<[number, string]> = [];
        const perDate = new Map<string, number>();
        let tops = 0;
        for (const e of order) {
          const cell = big[e.i];
          if (cell === undefined) throw new Error('fixture index');
          const room =
            expected.length < c.maxCells &&
            (c.perDate === undefined || (perDate.get(cell.departureDate) ?? 0) < c.perDate);
          let why: string | null = null;
          if (tops < topN) {
            if (room) why = 'top_n';
          } else if (c.ceiling !== undefined && e.p <= c.ceiling && room) why = 'ceiling';
          if (why === null) continue;
          if (why === 'top_n') tops += 1;
          perDate.set(cell.departureDate, (perDate.get(cell.departureDate) ?? 0) + 1);
          expected.push([e.i, why]);
        }
        expect(picks(selectCandidates(pol, big, discovery, true), big)).toEqual(expected);
      }),
      { numRuns: 500 },
    );
  });

  it('is deterministic: the same inputs give the same output', () => {
    const p = policy({ topN: 2, priceCeilingPence: 600, perDepartureDateBest: 1, alwaysInclude: [k(4)] });
    expect(selectCandidates(p, cells, priced(PRICES), true)).toEqual(
      selectCandidates(p, cells, priced(PRICES), true),
    );
  });
});
