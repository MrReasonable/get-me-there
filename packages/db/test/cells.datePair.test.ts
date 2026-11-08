// Design 2026-11-08 §6.1 (plan Task 5): the Trip page's log has a row for every run that searched a date pair, a run
// that found it empty included, so the read returns each searched discovery outcome of that date pair.
import { asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CELLS, historySeed, statementsOf } from './helpers/history.js';

describe('CellsRepo.searchedForDatePair', () => {
  it("every discovery outcome that searched the date pair itself, newest run first, never another definition's", () => {
    const seed = historySeed();
    const dep = CELLS[0]?.departureDate ?? asIsoDate('2027-03-14');
    const ret = CELLS[0]?.returnDate ?? asIsoDate('2027-03-28');
    const { result, statements } = statementsOf(seed.db, () =>
      seed.cells.searchedForDatePair(seed.definition.id, dep, ret),
    );
    expect(statements).toBe(1);
    const all = seed.executions.listForDefinition(seed.definition.id, {
      limit: 'all',
      includeChildren: true,
    });
    // the reference: per execution newest first, its own searched discovery outcomes of the date pair
    const expected = all.flatMap((e) =>
      seed.cells
        .outcomes(e.id, { stage: 'discovery' })
        .filter(
          (o) =>
            o.departureDate === dep &&
            o.returnDate === ret &&
            ['priced', 'empty', 'no_data'].includes(o.status) &&
            o.reusedFromExecutionId === null,
        )
        .sort((a, b) =>
          `${a.origin}${a.destination}${a.providerId}` < `${b.origin}${b.destination}${b.providerId}`
            ? -1
            : 1,
        ),
    );
    expect(result).toEqual(expected);
    // the seed's fates give this date pair empty and no_data outcomes too, so the read is told apart from the prices
    expect(result.some((o) => o.status === 'empty' || o.status === 'no_data')).toBe(true);
    expect(seed.cells.searchedForDatePair(seed.definition.id, dep, asIsoDate('2027-03-27'))).toEqual([]);
  });
});
