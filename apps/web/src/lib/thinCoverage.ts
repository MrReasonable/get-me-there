/**
 * Ruling 16 (decision 67, pft-006): coverage is thin when more than half the dates searched showed no price; the
 * What was searched fold then says so, and that it isn't the same as no flights. Counts only; the line itself is copy.
 */
export function isThinCoverage(noData: number, total: number): boolean {
  return total > 0 && noData * 2 > total;
}
