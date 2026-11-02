import { describe, expect, it } from 'vitest';
import {
  definitionResponseSchema,
  definitionShapeSchema,
  definitionUpdateRequestSchema,
} from '../../src/api-contract/definitions.js';
import { startExecutionRequestSchema } from '../../src/api-contract/executions.js';

describe('confirmed calls beside confirmed pence (decision 37)', () => {
  it('a start request confirms pence and calls, each a non-negative integer', () => {
    expect(startExecutionRequestSchema.parse({ confirmCostPence: 0, confirmCalls: 3 })).toEqual({
      confirmCostPence: 0,
      confirmCalls: 3,
    });
    expect(startExecutionRequestSchema.safeParse({ confirmCalls: -1 }).success).toBe(false);
    expect(startExecutionRequestSchema.safeParse({ confirmCalls: 2.5 }).success).toBe(false);
  });
  it('a definition update may carry confirmedCalls; a stored row is read without it; a response states it, null when none', () => {
    expect(definitionUpdateRequestSchema.parse({ confirmedCalls: 40 })).toEqual({ confirmedCalls: 40 });
    expect(definitionUpdateRequestSchema.safeParse({ confirmedCalls: -2 }).success).toBe(false);
    expect(Object.keys(definitionShapeSchema.shape)).not.toContain('confirmedCalls');
    expect(definitionResponseSchema.shape.confirmedCalls.safeParse(null).success).toBe(true);
    expect(definitionResponseSchema.shape.confirmedCalls.safeParse(12).success).toBe(true);
    expect(definitionResponseSchema.shape.confirmedCalls.safeParse(-1).success).toBe(false);
  });
  it('an update may say its confirmation is the shown runnable totals (spec rev 55 §10: Repeat weekly’s Save)', () => {
    const save = { scheduleCron: '0 5 * * 1', enabled: true, confirmedCostPence: 120, confirmedCalls: 300 };
    expect(definitionUpdateRequestSchema.parse({ ...save, confirmShown: true })).toEqual({
      ...save,
      confirmShown: true,
    });
    expect(definitionUpdateRequestSchema.parse(save)).not.toHaveProperty('confirmShown');
    expect(definitionUpdateRequestSchema.safeParse({ ...save, confirmShown: 'yes' }).success).toBe(false);
    // why: a stored row never carries it; it is a property of one request
    expect(Object.keys(definitionShapeSchema.shape)).not.toContain('confirmShown');
  });
});
