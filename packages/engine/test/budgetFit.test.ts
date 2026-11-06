// Spec revision 56 §8.1 "Estimate" and §8.2 budgetFit (cost-r3-001; R-estimate): with the return leg planned, a run's
// flight requests count toward its free calls one a pair (10). The browser worker has no monthly cap (spec §2), so the
// fit has no month line for it, and two daily schedules of browser pages both fit.
import { describe, expect, it } from 'vitest';
import { budgetFitFor } from '../src/budgetFit.js';
import { engineWith, rankedPairs, stubCamoufox } from './support/camoufox.js';

const BOTH = { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };

function scheduled(cells: number, cron: string, flags: Record<string, boolean> | null) {
  const e = engineWith([stubCamoufox({ cells, flights: {} })], {
    rankedDatePairs: rankedPairs(15),
    scheduleCron: cron,
  });
  if (flags !== null) e.ctx.workerFlags.set('camoufox', flags);
  return e;
}
const line = (fit: ReturnType<typeof budgetFitFor>, prefix: string) =>
  fit.perScope.find((x) => x.scope.startsWith(prefix))?.estimated;

describe('budgetFit with the return leg (spec rev 56 §8.1, §8.2)', () => {
  it('the free-call line counts flight requests (10), one a pair, with no month line for the browser', () => {
    const e = scheduled(15, '0 5 * * 1', BOTH);
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    expect(line(fit, 'execution-free-calls')).toBe(15 + 10);
    expect(line(fit, 'provider-month:camoufox')).toBeUndefined();
  });

  it('without the return flag the free-call line still counts one request a pair (10 a run)', () => {
    const e = scheduled(15, '0 5 * * 1', { RETURN_SELECT_VERIFIED: false });
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    expect(line(fit, 'execution-free-calls')).toBe(15 + 10);
  });

  // why: final review B-M3: flags not yet read count the return phase, as the read button does (prov-008)
  it('with the flags unread the free-call line counts one request a pair (10 a run)', () => {
    const e = scheduled(15, '0 5 * * 1', null);
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    expect(line(fit, 'execution-free-calls')).toBe(15 + 10);
  });

  it('cost-r3-001: two daily 168 h schedules of 100 grid pages each both fit, with no month line for the browser', () => {
    const e = scheduled(100, '0 5 * * *', BOTH);
    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      deletedAt: _d,
      confirmedCostPence: _p,
      confirmedCalls: _n,
      ...input
    } = e.definition;
    e.ctx.repos.definitions.create({ ...input, name: 'London to New York, again' });
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    expect(fit.perScope.find((x) => x.scope === 'provider-month:camoufox')).toBeUndefined();
    expect(fit.fits).toBe(true);
  });
});
