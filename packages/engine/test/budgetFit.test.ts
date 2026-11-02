// Spec revision 56 §8.1 "Estimate" and §8.2 budgetFit (cost-r3-001; R-estimate): with the return leg planned, a run's
// flight requests count toward its free calls one a pair (10), and its flight pages toward the month at the bound (2 a
// pair, the allowance of 20); a schedule's monthly load counts the same, so two daily schedules with a 168 h refresh
// (5 discovery runs a month, 5 × (100 + 20) = 600 pages each) both fit a 1,500-page month.
import { describe, expect, it } from 'vitest';
import { budgetFitFor } from '../src/budgetFit.js';
import { runsPerMonth } from '../src/scheduler/parseCron.js';
import { engineWith, rankedPairs, stubCamoufox } from './support/camoufox.js';
import { T0 } from './support/harness.js';

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
  it('the free-call line counts flight requests (10), the month line the page bound (20 a run)', () => {
    const e = scheduled(15, '0 5 * * 1', BOTH);
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    expect(line(fit, 'execution-free-calls')).toBe(15 + 10);
    const runs = runsPerMonth('0 5 * * 1', 'Europe/London', new Date(T0));
    expect(line(fit, 'provider-month:camoufox')).toBe(Math.ceil(runs * (15 + 20)));
  });

  it('without the return flag the month line counts 1 page a pair (10 a run)', () => {
    const e = scheduled(15, '0 5 * * 1', null);
    const fit = budgetFitFor(e.ctx, e.definition, e.definition.id);
    expect(line(fit, 'execution-free-calls')).toBe(15 + 10);
    const runs = runsPerMonth('0 5 * * 1', 'Europe/London', new Date(T0));
    expect(line(fit, 'provider-month:camoufox')).toBe(Math.ceil(runs * (15 + 10)));
  });

  it('cost-r3-001: two daily 168 h schedules of 100 grid pages each plan 600 pages a month and both fit 1,500', () => {
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
    const month = fit.perScope.find((x) => x.scope === 'provider-month:camoufox');
    expect(month).toEqual({ scope: 'provider-month:camoufox', estimated: 1200, cap: 1500, fits: true });
    expect(fit.fits).toBe(true);
  });
});
