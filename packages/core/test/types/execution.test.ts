import { describe, expect, it } from 'vitest';
import { ACTIVE_STATUSES, PAUSED_STATUSES, RESUMABLE_STATUSES } from '../../src/types/execution.js';

describe('execution status sets (spec §7)', () => {
  it('active statuses are the ones the parent and child partial unique indexes cover', () => {
    expect(ACTIVE_STATUSES).toEqual(['pending', 'running', 'paused_budget', 'paused_error', 'interrupted']);
  });
  it('paused statuses are the active ones with no pass running (a paused catch-up, spec §8.2 rev 36)', () => {
    expect(PAUSED_STATUSES).toEqual(['paused_budget', 'paused_error', 'interrupted']);
    expect(PAUSED_STATUSES.every((s) => ACTIVE_STATUSES.includes(s))).toBe(true);
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
