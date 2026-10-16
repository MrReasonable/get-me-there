import { describe, expectTypeOf, it } from 'vitest';
import type { ErrorReason, NoPricedOptionsReason } from '../../src/types/execution.js';

describe('ErrorReason (spec §3, §5.4; decision 37)', () => {
  it('the closed list names no-priced-options as a reason of its own', () => {
    expectTypeOf<NoPricedOptionsReason>().toEqualTypeOf<'no-priced-options'>();
    expectTypeOf<'no-priced-options'>().toExtend<ErrorReason>();
    expectTypeOf<'upstream'>().toExtend<ErrorReason>();
    expectTypeOf<'no-return-legs'>().toExtend<ErrorReason>();
    expectTypeOf<'offers-dropped'>().not.toExtend<ErrorReason>();
  });
});
