import { describe, expect, it } from 'vitest';
import { ACTIVE_STATUSES, RESUMABLE_STATUSES } from '../../src/types/execution.js';

describe('execution status sets (spec §7)', () => {
  it('active statuses are the ones the parent and child partial unique indexes cover', () => {
    expect(ACTIVE_STATUSES).toEqual(['pending', 'running', 'paused_budget', 'paused_error', 'interrupted']);
  });
  it('resumable statuses are the ones /resume accepts (completed only for retry-errors)', () => {
    expect(RESUMABLE_STATUSES).toEqual([
      'interrupted',
      'paused_budget',
      'paused_error',
      'cancelled',
      'completed',
    ]);
  });
});
