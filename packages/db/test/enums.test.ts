import {
  apiContract,
  cabinSchema,
  providerIdSchema,
  returnDateSourceSchema,
  sourceKindSchema,
  vendorPriceMarkSchema,
} from '@gmt/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CABINS,
  ERROR_REASONS,
  EXECUTION_STATUSES,
  exhaustive,
  PROVIDER_IDS,
  RESULT_BASES,
  RETURN_DATE_SOURCES,
  SOURCE_KINDS,
  STAGES,
  VENDOR_PRICE_MARKS,
} from '../src/internal/enums.js';

// arch-M2: a list that re-states a core union cannot silently fall behind it.
describe('internal/enums', () => {
  it('every list core also has as a z.enum equals its options, in order', () => {
    expect(PROVIDER_IDS).toEqual(providerIdSchema.options);
    expect(SOURCE_KINDS).toEqual(sourceKindSchema.options);
    expect(CABINS).toEqual(cabinSchema.options);
    expect(STAGES).toEqual(apiContract.stageSchema.options);
    expect(EXECUTION_STATUSES).toEqual(apiContract.executionStatusSchema.options);
    expect(RESULT_BASES).toEqual(apiContract.resultBasisSchema.options);
    // why: fix round 1 (CA 7): the grid's two lists stay literal (drizzle-kit loads the schema without workspace
    // resolution) and are pinned to core's here
    expect(RETURN_DATE_SOURCES).toEqual(returnDateSourceSchema.options);
    expect(VENDOR_PRICE_MARKS).toEqual(vendorPriceMarkSchema.options);
  });

  it('every other list must name every member of its union (compile-time check)', () => {
    expect(exhaustive<'a' | 'b'>()(['a', 'b'] as const)).toEqual(['a', 'b']);
    // why: the list parameter of a list missing a member is `never`, so no such call compiles; checked by tsc.
    const ab = exhaustive<'a' | 'b'>();
    expectTypeOf<Parameters<typeof ab<readonly ['a']>>[0]>().toBeNever();
    expectTypeOf<Parameters<typeof ab<readonly ['a', 'b']>>[0]>().not.toBeNever();
  });

  it('the error-reason list follows core: cell-mismatch (a NormalisationReason) is accepted', () => {
    expect(ERROR_REASONS).toContain('cell-mismatch');
  });
});
