import { describe, expect, it } from 'vitest';
import { listWords } from '../../src/text/list.js';

describe('listWords', () => {
  it('joins with commas and the conjunction before the last', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['A'])).toBe('A');
    expect(listWords(['A', 'B'])).toBe('A and B');
    expect(listWords(['A', 'B', 'C'])).toBe('A, B and C');
    expect(listWords(['A', 'B', 'C'], 'or')).toBe('A, B or C');
  });
});
