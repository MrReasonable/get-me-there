import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeWithinProvider, rollUp } from '../../src/coverage/rollUp.js';
import type { CellOutcome, CellOutcomeStatus, RollUp, SkipReason } from '../../src/types/execution.js';
import { asIsoDateTime } from '../../src/types/ids.js';
import { key, outcome } from '../helpers/space.js';

// One cell; providers differ per row in real data, but rollUp reads only status, reason, minPence.
const K = key('LHR', 'JFK', '2027-03-01', '2027-03-08');
type O = CellOutcome;
const o = (status: CellOutcomeStatus, extra: Partial<Pick<O, 'reason' | 'minPence'>> = {}): O =>
  outcome(K, status, extra);
const priced = (p: number, reason: string | null = null) => o('priced', { minPence: p, reason });
const skipped = (reason: SkipReason) => o('skipped', { reason });
const notOffered = () => o('no_data', { reason: 'cabin-not-offered' });

/**
 * Independent oracle: spec §6.6's table transcribed row by row, including row 4's full condition
 * ("any empty and every other ∈ {empty, no_data, skipped}"), plus the 2026-10-14 rulings on
 * cabin-not-offered and on roll-up reasons, written without reference to the implementation.
 */
function oracle(all: readonly O[]): RollUp {
  if (all.length === 0) return { status: null, reason: null, minPence: null }; // row 0
  const isNotOffered = (x: O) => x.status === 'no_data' && x.reason === 'cabin-not-offered';
  if (all.every(isNotOffered)) return { status: 'no_data', reason: 'cabin-not-offered', minPence: null };
  const xs = all.filter((x) => !isNotOffered(x));
  const any = (s: CellOutcomeStatus) => xs.some((x) => x.status === s);
  if (any('priced')) {
    const ps = xs.flatMap((x) => (x.status === 'priced' && x.minPence !== null ? [x.minPence] : []));
    const partial = xs.some((x) => x.status === 'priced' && x.reason === 'partial-expansion');
    return { status: 'priced', reason: partial ? 'partial-expansion' : null, minPence: Math.min(...ps) }; // row 1
  }
  if (any('not_run')) return { status: 'not_run', reason: null, minPence: null }; // row 2
  if (any('error')) {
    const rs = xs.filter((x) => x.status === 'error').map((x) => x.reason);
    const agree = rs.every((r) => r === rs[0]);
    return { status: 'error', reason: agree ? (rs[0] ?? null) : 'mixed', minPence: null }; // row 3
  }
  if (any('empty') && xs.every((x) => ['empty', 'no_data', 'skipped'].includes(x.status))) {
    return { status: 'empty', reason: null, minPence: null }; // row 4
  }
  if (any('no_data')) return { status: 'no_data', reason: null, minPence: null }; // row 5
  // row 6: all skipped
  const rs = xs.map((x) => x.reason);
  const reason = rs.includes('budget')
    ? 'budget'
    : rs.includes('provider_disabled')
      ? 'provider_disabled'
      : rs.includes('departed')
        ? 'departed'
        : 'not_selected';
  return { status: 'skipped', reason, minPence: null };
}

const VARIANTS: O[] = [
  o('not_run'),
  priced(41_200),
  priced(39_900, 'partial-expansion'),
  o('empty'),
  o('no_data'),
  notOffered(),
  o('error', { reason: 'upstream' }),
  o('error', { reason: 'parse' }),
  skipped('budget'),
  skipped('provider_disabled'),
  skipped('departed'),
  skipped('not_selected'),
];

describe('rollUp precedence (spec §6.6)', () => {
  it.each([
    ['row 0: no rows', [], { status: null, reason: null, minPence: null }],
    [
      'row 1: any priced wins over not_run and error',
      [o('not_run'), o('error'), priced(500)],
      { status: 'priced', reason: null, minPence: 500 },
    ],
    [
      'row 1: minPence is the minimum priced',
      [priced(700), priced(450), o('empty')],
      { status: 'priced', reason: null, minPence: 450 },
    ],
    [
      'row 2: not_run beats error',
      [o('error'), o('not_run')],
      { status: 'not_run', reason: null, minPence: null },
    ],
    [
      'row 3: error beats empty',
      [o('empty'), o('error', { reason: 'upstream' })],
      { status: 'error', reason: 'upstream', minPence: null },
    ],
    [
      'row 4: empty with no_data and skipped',
      [o('no_data'), o('empty'), skipped('budget')],
      { status: 'empty', reason: null, minPence: null },
    ],
    [
      'row 5: no_data with skipped',
      [skipped('budget'), o('no_data')],
      { status: 'no_data', reason: null, minPence: null },
    ],
    [
      'row 6: budget first',
      [skipped('not_selected'), skipped('departed'), skipped('budget')],
      { status: 'skipped', reason: 'budget', minPence: null },
    ],
    [
      'row 6: provider_disabled over departed',
      [skipped('departed'), skipped('provider_disabled')],
      { status: 'skipped', reason: 'provider_disabled', minPence: null },
    ],
    [
      'row 6: departed over not_selected',
      [skipped('not_selected'), skipped('departed')],
      { status: 'skipped', reason: 'departed', minPence: null },
    ],
    [
      'row 6: not_selected alone',
      [skipped('not_selected')],
      { status: 'skipped', reason: 'not_selected', minPence: null },
    ],
  ] satisfies Array<[string, O[], RollUp]>)('%s', (_name, xs, expected) => {
    expect(rollUp(xs)).toEqual(expected);
  });

  describe('cabin-not-offered (ruling 2026-10-14)', () => {
    it.each([
      [
        'ignored beside a budget skip: [no_data:cabin-not-offered, skipped:budget] → skipped:budget',
        [notOffered(), skipped('budget')],
        { status: 'skipped', reason: 'budget', minPence: null },
      ],
      [
        'ignored beside not_run',
        [notOffered(), o('not_run')],
        { status: 'not_run', reason: null, minPence: null },
      ],
      [
        'ignored beside a real no_data, which keeps a null reason',
        [notOffered(), o('no_data')],
        { status: 'no_data', reason: null, minPence: null },
      ],
      [
        'every outcome not offered → no_data:cabin-not-offered',
        [notOffered(), notOffered()],
        { status: 'no_data', reason: 'cabin-not-offered', minPence: null },
      ],
    ] satisfies Array<[string, O[], RollUp]>)('%s', (_name, xs, expected) => {
      expect(rollUp(xs)).toEqual(expected);
    });
  });

  describe('roll-up reason (ruling 2026-10-14)', () => {
    it('priced carries partial-expansion when any priced input has it', () => {
      expect(rollUp([priced(500), priced(600, 'partial-expansion')]).reason).toBe('partial-expansion');
      expect(rollUp([priced(500, 'offers-dropped:2')]).reason).toBeNull();
    });
    it('error carries the reason when every error input agrees, else mixed', () => {
      expect(rollUp([o('error', { reason: 'parse' }), o('error', { reason: 'parse' })]).reason).toBe('parse');
      expect(rollUp([o('error', { reason: 'parse' }), o('error', { reason: 'upstream' })]).reason).toBe(
        'mixed',
      );
      expect(rollUp([o('error'), o('error')]).reason).toBeNull();
    });
    it('not_run, empty and an asked no_data carry null', () => {
      expect(rollUp([o('not_run')]).reason).toBeNull();
      expect(rollUp([o('empty')]).reason).toBeNull();
      expect(rollUp([o('no_data')]).reason).toBeNull();
    });
  });

  it('matches the independent oracle on every sequence of up to three outcomes (1,885 cases)', () => {
    let cases = 0;
    const walk = (prefix: O[]) => {
      expect(rollUp(prefix), JSON.stringify(prefix.map((x) => [x.status, x.reason]))).toEqual(oracle(prefix));
      cases += 1;
      if (prefix.length < 3) for (const v of VARIANTS) walk([...prefix, v]);
    };
    walk([]);
    expect(cases).toBe(1 + 12 + 144 + 1728);
  });

  const arbOutcome: fc.Arbitrary<O> = fc.oneof(
    fc.constantFrom<CellOutcomeStatus>('not_run', 'empty', 'no_data').map((s) => o(s)),
    fc.constant(null).map(notOffered),
    fc.constantFrom('upstream', 'parse', 'network').map((reason) => o('error', { reason })),
    fc
      .tuple(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.constantFrom(null, 'partial-expansion', 'offers-dropped:1'),
      )
      .map(([p, r]) => priced(p, r)),
    fc.constantFrom<SkipReason>('budget', 'provider_disabled', 'departed', 'not_selected').map(skipped),
  );

  it('property: agrees with the oracle, ignores order, and only ever reports a status it was given', () => {
    fc.assert(
      fc.property(fc.array(arbOutcome, { maxLength: 8 }), (xs) => {
        const r = rollUp(xs);
        expect(r).toEqual(oracle(xs));
        expect(rollUp([...xs].reverse())).toEqual(r);
        if (r.status === null) expect(xs).toHaveLength(0);
        else expect(xs.map((x) => x.status)).toContain(r.status);
      }),
      { numRuns: 1000 },
    );
  });

  it('property: adding a priced outcome always yields priced', () => {
    fc.assert(
      fc.property(fc.array(arbOutcome, { maxLength: 8 }), fc.integer({ min: 0, max: 1_000_000 }), (xs, p) => {
        expect(rollUp([...xs, priced(p)]).status).toBe('priced');
      }),
    );
  });

  it('throws on a priced outcome without minPence and on an unknown skip reason', () => {
    expect(() => rollUp([o('priced')])).toThrow(/no minPence/);
    expect(() => rollUp([o('skipped', { reason: 'tired' })])).toThrow(/unknown reason: tired/);
    expect(() => rollUp([o('skipped')])).toThrow(/unknown reason: null/);
  });
});

describe('mergeWithinProvider (spec §6.6 monotone merge)', () => {
  type M = 'priced' | 'empty' | 'no_data' | 'error';
  const RANK: Record<M, number> = { priced: 3, empty: 2, no_data: 1, error: 0 };
  const rankOf = (s: CellOutcomeStatus): number => {
    switch (s) {
      case 'priced':
      case 'empty':
      case 'no_data':
      case 'error':
        return RANK[s];
      default:
        throw new Error(`not mergeable: ${s}`);
    }
  };
  const m = (
    status: M,
    minPence: number | null = null,
    reason: string | null = null,
    over: Partial<O> = {},
  ): O => outcome(K, status, { minPence, reason, ...over });
  const merged = (x: O) => ({ status: x.status, minPence: x.minPence, reason: x.reason });

  it.each([
    [m('priced', 500), m('error', null, 'upstream'), { status: 'priced', minPence: 500, reason: null }],
    [
      m('error', null, 'upstream'),
      m('priced', 500, 'partial-expansion'),
      { status: 'priced', minPence: 500, reason: 'partial-expansion' },
    ],
    [m('empty'), m('no_data'), { status: 'empty', minPence: null, reason: null }],
    [m('empty', null, 'x'), m('error', null, 'upstream'), { status: 'empty', minPence: null, reason: 'x' }],
    [m('no_data'), m('error', null, 'parse'), { status: 'no_data', minPence: null, reason: null }],
    [m('priced', 700), m('priced', 450), { status: 'priced', minPence: 450, reason: null }],
    [
      m('priced', 450, 'offers-dropped:2'),
      m('priced', 700, 'partial-expansion'),
      { status: 'priced', minPence: 450, reason: 'partial-expansion' },
    ],
    [
      m('priced', 700, 'partial-expansion'),
      m('priced', 450, 'offers-dropped:2'),
      { status: 'priced', minPence: 450, reason: 'partial-expansion' },
    ],
    [
      m('priced', 450, 'offers-dropped:2'),
      m('priced', 700),
      { status: 'priced', minPence: 450, reason: 'offers-dropped:2' },
    ],
    [
      m('error', null, 'upstream'),
      m('error', null, 'parse'),
      { status: 'error', minPence: null, reason: 'parse' },
    ],
    [m('error'), m('error', null, 'network'), { status: 'error', minPence: null, reason: 'network' }],
    [m('error'), m('error', null, 'parse'), { status: 'error', minPence: null, reason: 'parse' }],
    [m('error'), m('error'), { status: 'error', minPence: null, reason: null }],
  ])('merge(%j, %j) has status/minPence/reason %j', (a, b, expected) => {
    expect(merged(mergeWithinProvider(a, b))).toEqual(expected);
  });

  it('both priced: every other field travels with the cheaper input (ties to a)', () => {
    const a = m('priced', 700, null, { fetchedAt: asIsoDateTime('2026-10-14T05:00:00.000Z'), attempts: 1 });
    const b = m('priced', 450, null, { fetchedAt: asIsoDateTime('2026-10-14T06:00:00.000Z'), attempts: 2 });
    expect(mergeWithinProvider(a, b)).toEqual(b);
    expect(mergeWithinProvider(b, a)).toEqual(b);
    const tie = m('priced', 700, null, { attempts: 3 });
    expect(mergeWithinProvider(a, tie)).toEqual(a);
  });

  describe('fresh replaces reused outright (spec §6.6, rev 11)', () => {
    const reused450 = m('priced', 450, null, { reusedFromExecutionId: 'exec-0' });
    const fresh700 = m('priced', 700);
    it('reused priced 450 + fresh priced 700 → fresh 700, in both argument orders', () => {
      expect(mergeWithinProvider(reused450, fresh700)).toEqual(fresh700);
      expect(mergeWithinProvider(fresh700, reused450)).toEqual(fresh700);
    });
    it('reused priced + fresh empty → fresh empty', () => {
      const freshEmpty = m('empty');
      expect(mergeWithinProvider(reused450, freshEmpty)).toEqual(freshEmpty);
      expect(mergeWithinProvider(freshEmpty, reused450)).toEqual(freshEmpty);
    });
    it('a fresh error never displaces a stronger reused result; it replaces a reused error', () => {
      const freshError = m('error', null, 'upstream');
      expect(mergeWithinProvider(reused450, freshError)).toEqual(reused450);
      expect(mergeWithinProvider(freshError, reused450)).toEqual(reused450);
      const reusedEmpty = m('empty', null, null, { reusedFromExecutionId: 'exec-0' });
      expect(mergeWithinProvider(reusedEmpty, freshError)).toEqual(reusedEmpty);
      const reusedError = m('error', null, 'parse', { reusedFromExecutionId: 'exec-0' });
      expect(mergeWithinProvider(reusedError, freshError)).toEqual(freshError);
    });
  });

  it('a reused priced row and a fresh cheaper fetch: the fresh price keeps its own provenance', () => {
    const reused = m('priced', 700, null, {
      reusedFromExecutionId: 'exec-0',
      fetchedAt: asIsoDateTime('2026-10-10T05:00:00.000Z'),
    });
    const fresh = m('priced', 450, null, { fetchedAt: asIsoDateTime('2026-10-14T06:00:00.000Z') });
    const r = mergeWithinProvider(reused, fresh);
    expect(r.reusedFromExecutionId).toBeNull();
    expect(r.fetchedAt).toBe('2026-10-14T06:00:00.000Z');
    expect(r.minPence).toBe(450);
  });

  it('different statuses: the higher-ranked outcome wins whole', () => {
    const e = m('empty', null, null, { attempts: 3 });
    const p = m('priced', 700, null, { attempts: 1 });
    expect(mergeWithinProvider(e, p)).toEqual(p);
  });

  it('refuses outcomes of different cells, stages, providers or executions', () => {
    const a = m('priced', 500);
    const other = outcome(key('LHR', 'JFK', '2027-03-02', '2027-03-09'), 'empty');
    expect(() => mergeWithinProvider(a, other)).toThrow(/one cell, stage, provider and execution/);
    expect(() => mergeWithinProvider(a, m('empty', null, null, { stage: 'verification' }))).toThrow(
      /one cell/,
    );
    expect(() => mergeWithinProvider(a, m('empty', null, null, { providerId: 'searchapi' }))).toThrow(
      /one cell/,
    );
    expect(() => mergeWithinProvider(a, m('empty', null, null, { executionId: 'exec-2' }))).toThrow(
      /one cell/,
    );
  });

  it('refuses not_run and skipped (seeding and skipping replace outcomes, they never merge)', () => {
    expect(() => mergeWithinProvider(m('priced', 500), outcome(K, 'not_run'))).toThrow(
      /cannot merge priced with not_run/,
    );
    expect(() => mergeWithinProvider(outcome(K, 'skipped', { reason: 'budget' }), m('empty'))).toThrow(
      /cannot merge skipped/,
    );
  });

  it('refuses a priced outcome without minPence, like rollUp', () => {
    expect(() => mergeWithinProvider(m('priced', null), m('empty'))).toThrow(/no minPence/);
    expect(() => mergeWithinProvider(m('empty'), m('priced', null))).toThrow(/no minPence/);
  });

  // Distinct fetchedAt per generated outcome so the winner is identifiable; about half the
  // outcomes are fresh (reusedFromExecutionId null), the rest reused from distinct executions.
  let serial = 0;
  const stamp = (reused: boolean) => {
    serial += 1;
    return {
      fetchedAt: asIsoDateTime(new Date(Date.UTC(2026, 9, 1) + serial * 60_000).toISOString()),
      reusedFromExecutionId: reused ? `exec-${serial}` : null,
    };
  };
  const arb: fc.Arbitrary<O> = fc.oneof(
    fc
      .tuple(
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom(null, 'partial-expansion', 'offers-dropped:1', 'offers-dropped:2'),
      )
      .chain(([p, r]) => fc.boolean().map((reused) => m('priced', p, r, stamp(reused)))),
    fc
      .tuple(fc.constantFrom<M>('empty', 'no_data', 'error'), fc.constantFrom(null, 'upstream', 'parse'))
      .chain(([st, r]) => fc.boolean().map((reused) => m(st, null, r, stamp(reused)))),
  );
  /** The input whose non-merged fields the result must carry. */
  const winnerOf = (a: O, b: O): O => {
    const aFresh = a.reusedFromExecutionId === null;
    if (aFresh !== (b.reusedFromExecutionId === null)) {
      const fresh = aFresh ? a : b;
      const reused = aFresh ? b : a;
      return fresh.status === 'error' && reused.status !== 'error' ? reused : fresh;
    }
    if (rankOf(a.status) !== rankOf(b.status)) return rankOf(a.status) > rankOf(b.status) ? a : b;
    if (a.status === 'priced' && a.minPence !== null && b.minPence !== null && b.minPence < a.minPence)
      return b;
    return a;
  };

  it('property: a fresh error against a reused priced, empty or no_data outcome keeps the reused one whole', () => {
    const reusedStrong = fc
      .tuple(fc.constantFrom<M>('priced', 'empty', 'no_data'), fc.integer({ min: 0, max: 100_000 }))
      .map(([st, p]) => m(st, st === 'priced' ? p : null, null, stamp(true)));
    const freshError = fc
      .constantFrom(null, 'upstream', 'parse')
      .map((r) => m('error', null, r, stamp(false)));
    fc.assert(
      fc.property(reusedStrong, freshError, (r, e) => {
        expect(mergeWithinProvider(r, e)).toEqual(r);
        expect(mergeWithinProvider(e, r)).toEqual(r);
      }),
    );
  });

  it('property: status/minPence commutative, associative, idempotent; fresh beats reused; otherwise monotone; provenance travels with the winner', () => {
    fc.assert(
      fc.property(arb, arb, arb, (a, b, c) => {
        const ab = mergeWithinProvider(a, b);
        const ba = mergeWithinProvider(b, a);
        expect([ab.status, ab.minPence]).toEqual([ba.status, ba.minPence]);
        const left = mergeWithinProvider(ab, c);
        const right = mergeWithinProvider(a, mergeWithinProvider(b, c));
        expect([left.status, left.minPence]).toEqual([right.status, right.minPence]);
        expect(merged(mergeWithinProvider(a, a))).toEqual(merged(a));
        const w = winnerOf(a, b);
        expect(ab.fetchedAt).toBe(w.fetchedAt);
        expect(ab.reusedFromExecutionId).toBe(w.reusedFromExecutionId);
        const sameFreshness = (a.reusedFromExecutionId === null) === (b.reusedFromExecutionId === null);
        if (!sameFreshness) {
          // fresh replaces reused outright, except that a fresh error never displaces a stronger result
          expect(ab).toEqual(w);
          return;
        }
        expect(rankOf(ab.status)).toBe(Math.max(rankOf(a.status), rankOf(b.status)));
        const prices = [a, b].flatMap((x) =>
          x.status === 'priced' && x.minPence !== null ? [x.minPence] : [],
        );
        expect(ab.minPence).toBe(prices.length > 0 ? Math.min(...prices) : null);
        if (a.status === 'priced' && b.status === 'priced') {
          const partial = a.reason === 'partial-expansion' || b.reason === 'partial-expansion';
          expect(ab.reason).toBe(partial ? 'partial-expansion' : w.reason);
        }
      }),
      { numRuns: 1000 },
    );
  });
});
