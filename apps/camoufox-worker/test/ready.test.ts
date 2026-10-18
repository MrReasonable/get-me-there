import { describe, expect, it } from 'vitest';
import { isSettled } from '../src/ready.js';

const settled = { resultsReturned: true, fetching: false, cheapestPriced: true };
describe('isSettled (spec §2; brief §9)', () => {
  it('a settled results page', () => {
    expect(isSettled({ resultLinks: 3 }, settled)).toBe(true);
  });
  it.each([
    ['without the results-returned line', { ...settled, resultsReturned: false }, 3],
    ['still fetching', { ...settled, fetching: true }, 3],
    ['a tab name without a price', { ...settled, cheapestPriced: false }, 3],
    ['zero result links', settled, 0],
  ])('%s is not', (_n, s, links) => {
    expect(isSettled({ resultLinks: links }, s)).toBe(false);
  });
});
