import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATUSES,
  IN_FLIGHT_STATUSES,
  PAUSED_STATUSES,
  RESUMABLE_STATUSES,
  STOPPED_STATUSES,
} from '../../src/types/execution.js';

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

describe('the status sets the cards, the bar and the api share (review finding 11)', () => {
  it('in flight is pending and running; stopped is every status a run stops or is skipped in, and never completed or in flight', () => {
    expect(IN_FLIGHT_STATUSES).toEqual(['pending', 'running']);
    expect([...STOPPED_STATUSES].sort()).toEqual(
      [
        'cancelled',
        'interrupted',
        'paused_budget',
        'paused_error',
        'skipped_budget',
        'skipped_confirm',
        'skipped_missed',
        'skipped_window',
      ].sort(),
    );
    expect(STOPPED_STATUSES).not.toContain('completed');
    for (const s of IN_FLIGHT_STATUSES) expect(STOPPED_STATUSES).not.toContain(s);
  });
});
