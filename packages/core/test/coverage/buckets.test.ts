import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { selectedNotReached, sixBuckets } from '../../src/coverage/buckets.js';
import { generateCells } from '../../src/space/generate.js';
import type { Cell } from '../../src/types/definition.js';
import type { CellOutcomeStatus } from '../../src/types/execution.js';
import { key, outcome, space } from '../helpers/space.js';

const cells = generateCells(
  space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 7, max: 8 }),
); // 6 cells
const STATUSES = ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run'] as const;
const zip = <A, B>(as: readonly A[], bs: readonly B[]): Array<[A, B]> =>
  as.flatMap((x, i) => {
    const y = bs[i];
    return y === undefined ? [] : [[x, y]];
  });

describe('sixBuckets (spec §3: six buckets; reference oracle for WP3)', () => {
  it('counts one execution × stage × provider into the six buckets and reused beside them', () => {
    const outs = zip(cells, STATUSES).map(([c, s], i) =>
      outcome(c, s, { reusedFromExecutionId: i < 2 ? 'exec-0' : null }),
    );
    expect(sixBuckets(outs)).toEqual({
      priced: 1,
      empty: 1,
      no_data: 1,
      error: 1,
      skipped: 1,
      not_run: 1,
      reused: 2,
    });
  });

  it('is all zeros for no outcomes (spec §6.6 row 0, not_applicable; callers must not render it as coverage)', () => {
    expect(sixBuckets([])).toEqual({
      priced: 0,
      empty: 0,
      no_data: 0,
      error: 0,
      skipped: 0,
      not_run: 0,
      reused: 0,
    });
  });

  it('property: each bucket equals an independently computed count of that status', () => {
    const status = fc.constantFrom<CellOutcomeStatus>(...STATUSES);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(status, fc.boolean()), { minLength: cells.length, maxLength: cells.length }),
        (spec) => {
          const outs = zip<Cell, [CellOutcomeStatus, boolean]>(cells, spec).map(([c, [s, reused]]) =>
            outcome(c, s, { reusedFromExecutionId: reused ? 'exec-0' : null }),
          );
          const b = sixBuckets(outs);
          for (const s of STATUSES) expect(b[s]).toBe(spec.filter(([x]) => x === s).length);
          expect(b.reused).toBe(spec.filter(([, r]) => r).length);
        },
      ),
    );
  });

  it('refuses mixed executions, stages, providers and repeated cells (the counts would be wrong)', () => {
    const [a, b] = cells;
    if (a === undefined || b === undefined) throw new Error('fixture');
    const mixed = /one execution, one stage and one provider/;
    expect(() => sixBuckets([outcome(a, 'priced'), outcome(b, 'priced', { executionId: 'exec-2' })])).toThrow(
      mixed,
    );
    expect(() => sixBuckets([outcome(a, 'priced'), outcome(b, 'priced', { stage: 'verification' })])).toThrow(
      mixed,
    );
    expect(() =>
      sixBuckets([outcome(a, 'priced'), outcome(b, 'priced', { providerId: 'searchapi' })]),
    ).toThrow(mixed);
    expect(() => sixBuckets([outcome(a, 'priced'), outcome(a, 'empty')])).toThrow(/appears twice/);
  });
});

describe('selectedNotReached (spec §6.6: selected ∧ (not_run ∨ skipped:budget))', () => {
  const v = { stage: 'verification', providerId: 'searchapi' } as const;
  const [c0, c1, c2, c3, c4, c5] = cells.map((c) =>
    key(c.origin, c.destination, c.departureDate, c.returnDate),
  );
  if (!c0 || !c1 || !c2 || !c3 || !c4 || !c5) throw new Error('fixture');

  it('lists selected cells left not_run or skipped for budget, in selection order, in spec notation', () => {
    const outs = [
      outcome(c0, 'priced', { ...v, minPence: 41_200 }),
      outcome(c1, 'not_run', v),
      outcome(c2, 'skipped', { ...v, reason: 'budget' }),
      outcome(c3, 'skipped', { ...v, reason: 'provider_disabled' }),
      outcome(c4, 'error', { ...v, reason: 'upstream' }),
      outcome(c5, 'empty', v),
    ];
    expect(selectedNotReached([c2, c0, c1, c3, c4, c5], outs)).toEqual([
      { cell: c2, reason: 'skipped:budget' },
      { cell: c1, reason: 'not_run' },
    ]);
  });

  it('a cell priced by one verification provider was reached even if another is skipped:budget', () => {
    const outs = [
      outcome(c0, 'priced', { ...v, minPence: 500 }),
      outcome(c0, 'skipped', { ...v, providerId: 'fixture', reason: 'budget' }),
    ];
    expect(selectedNotReached([c0], outs)).toEqual([]);
  });

  it('a cabin-not-offered row never hides a budget skip', () => {
    const outs = [
      outcome(c0, 'no_data', { ...v, providerId: 'fixture', reason: 'cabin-not-offered' }),
      outcome(c0, 'skipped', { ...v, reason: 'budget' }),
    ];
    expect(selectedNotReached([c0], outs)).toEqual([{ cell: c0, reason: 'skipped:budget' }]);
  });

  it('ignores discovery rows', () => {
    const outs = [outcome(c0, 'not_run'), outcome(c0, 'priced', { ...v, minPence: 500 })];
    expect(selectedNotReached([c0], outs)).toEqual([]);
  });

  it('throws when a selected cell has no verification rows while other cells have them', () => {
    expect(() => selectedNotReached([c0, c1], [outcome(c0, 'not_run', v), outcome(c1, 'not_run')])).toThrow(
      /selected cell LHR\|JFK\|2027-03-01\|2027-03-09 has no verification outcome rows/,
    );
  });

  it('is empty when nothing was selected', () => {
    expect(selectedNotReached([], [outcome(c0, 'not_run', v)])).toEqual([]);
  });
});
