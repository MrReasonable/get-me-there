import { describe, expect, it } from 'vitest';
import { smokePlanResponseSchema } from '../../src/api-contract/system.js';

const plan = (camoufox: unknown) => ({ searchApi: null, travelpayouts: null, camoufox });

describe('smokePlanResponseSchema (spec §10, §13)', () => {
  it('the browser entry states its page’s bound as a whole number of seconds, at least 1', () => {
    expect(smokePlanResponseSchema.safeParse(plan(null)).success).toBe(true);
    expect(
      smokePlanResponseSchema.safeParse(plan({ pages: 1, scrolls: 30, pageBoundSeconds: 2145 })).success,
    ).toBe(true);
    expect(
      smokePlanResponseSchema.safeParse(plan({ pages: 1, scrolls: 0, pageBoundSeconds: 1 })).success,
    ).toBe(true);
    expect(smokePlanResponseSchema.safeParse(plan({ pages: 1, scrolls: 30 })).success).toBe(false);
    expect(
      smokePlanResponseSchema.safeParse(plan({ pages: 1, scrolls: 0, pageBoundSeconds: 0 })).success,
    ).toBe(false);
    expect(
      smokePlanResponseSchema.safeParse(plan({ pages: 1, scrolls: 0, pageBoundSeconds: 1.5 })).success,
    ).toBe(false);
  });
});
