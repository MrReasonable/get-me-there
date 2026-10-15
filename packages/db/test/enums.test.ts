import { apiContract, cabinSchema, providerIdSchema, sourceKindSchema } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  CABINS,
  ERROR_REASONS,
  EXECUTION_STATUSES,
  exhaustive,
  PROVIDER_IDS,
  RESULT_BASES,
  SOURCE_KINDS,
  STAGES,
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
  });

  it('every other list must name every member of its union (compile-time check)', () => {
    expect(exhaustive<'a' | 'b'>()(['a', 'b'] as const)).toEqual(['a', 'b']);
    // @ts-expect-error a list missing a member of the union does not compile
    exhaustive<'a' | 'b'>()(['a'] as const);
  });

  it('the error-reason list follows core: cell-mismatch (a NormalisationReason) is accepted', () => {
    expect(ERROR_REASONS).toContain('cell-mismatch');
  });
});
