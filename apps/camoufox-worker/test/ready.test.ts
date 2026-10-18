import { describe, expect, it } from 'vitest';
import { isSettled, STABLE_MS, stableAcross } from '../src/ready.js';

const settled = { resultsReturned: true, fetching: false, cheapestPriced: true, cheapestSelected: false };
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

// why: ruling of 2026-10-18: settled means the same links across two polls at least 2 s apart
describe('stableAcross', () => {
  const at = (signature: string, links: number, ms: number) => ({ signature, links, at: ms });
  it('needs a previous poll', () => {
    expect(stableAcross(null, at('a', 2, 2000))).toBe(false);
  });
  it('the same links 2 s apart are stable; 1,999 ms apart are not', () => {
    expect(stableAcross(at('a', 2, 0), at('a', 2, STABLE_MS))).toBe(true);
    expect(stableAcross(at('a', 2, 0), at('a', 2, STABLE_MS - 1))).toBe(false);
  });
  it('other names or another count are not stable', () => {
    expect(stableAcross(at('a', 2, 0), at('b', 2, 5000))).toBe(false);
    expect(stableAcross(at('a', 2, 0), at('a', 3, 5000))).toBe(false);
  });
  it('STABLE_MS is 2 s', () => {
    expect(STABLE_MS).toBe(2000);
  });
});

// why: ruling of 2026-10-18 (the Cheapest flow): the Cheapest view shows no "N results returned." line; it settles on
// its tab being selected instead, and the Best view still needs the line
describe('isSettled by view', () => {
  const base = { resultsReturned: false, fetching: false, cheapestPriced: true, cheapestSelected: true };
  it('the Cheapest view settles without the results line when its tab is selected', () => {
    expect(isSettled({ resultLinks: 21 }, base, 'cheapest')).toBe(true);
    expect(isSettled({ resultLinks: 21 }, { ...base, cheapestSelected: false }, 'cheapest')).toBe(false);
    expect(isSettled({ resultLinks: 21 }, { ...base, fetching: true }, 'cheapest')).toBe(false);
    expect(isSettled({ resultLinks: 21 }, { ...base, cheapestPriced: false }, 'cheapest')).toBe(false);
    expect(isSettled({ resultLinks: 0 }, base, 'cheapest')).toBe(false);
  });
  it('the Best view still requires the results line, whatever the tab says', () => {
    expect(isSettled({ resultLinks: 21 }, base, 'best')).toBe(false);
    expect(isSettled({ resultLinks: 21 }, { ...base, resultsReturned: true }, 'best')).toBe(true);
    expect(isSettled({ resultLinks: 21 }, { ...base, resultsReturned: true })).toBe(true);
  });
});
