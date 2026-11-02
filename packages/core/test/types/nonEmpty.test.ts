import { describe, expect, expectTypeOf, it } from 'vitest';
import { mapNonEmpty, type NonEmpty, nonEmpty } from '../../src/types/nonEmpty.js';

describe('nonEmpty (how a stop cause writer builds its non-empty sources, spec rev 55 §8.1)', () => {
  it('is null for an empty list, and the same elements in order otherwise', () => {
    expect(nonEmpty([])).toBeNull();
    expect(nonEmpty(['camoufox'])).toEqual(['camoufox']);
    expect(nonEmpty(['camoufox', 'travelpayouts', 'searchapi'])).toEqual([
      'camoufox',
      'travelpayouts',
      'searchapi',
    ]);
  });

  it('keeps null elements, and types the result as a non-empty tuple', () => {
    expect(nonEmpty([null, 'x'])).toEqual([null, 'x']);
    const list = nonEmpty(['a', 'b']);
    expectTypeOf(list).toEqualTypeOf<NonEmpty<string> | null>();
    if (list !== null) expectTypeOf(list[0]).toEqualTypeOf<string>();
  });

  it('does not share the input array', () => {
    const input = ['a'];
    const out = nonEmpty(input);
    input.push('b');
    expect(out).toEqual(['a']);
  });
});

describe('mapNonEmpty', () => {
  it('maps every element in order and stays non-empty', () => {
    expect(mapNonEmpty(['a', 'b', 'c'], (s) => s.toUpperCase())).toEqual(['A', 'B', 'C']);
    expect(mapNonEmpty([2], (n) => n * 3)).toEqual([6]);
    expectTypeOf(mapNonEmpty(['a'], (s) => s.length)).toEqualTypeOf<NonEmpty<number>>();
  });
});
