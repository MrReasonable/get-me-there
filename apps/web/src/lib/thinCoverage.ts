/**
 * Ruling 16 (decision 67, pft-006): coverage is thin when more than half the counted cells came back "no cached data";
 * Results and Calendar then name the next move. Counts only; the line itself is copy.
 */
export function isThinCoverage(noData: number, total: number): boolean {
  return total > 0 && noData * 2 > total;
}
