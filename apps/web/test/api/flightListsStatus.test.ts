import { describe, expect, it } from 'vitest';
import { listsStatusOf } from '../../src/api/flights.js';

// Spec rev 56 §11 (21.7 prov-004, re-review N1): the board's flight-lists state from its page queries. A query that
// failed with an earlier answer still held (a failed background poll) is not a failed load: the board keeps its flights.
describe('listsStatusOf', () => {
  const q = (o: { isError?: boolean; isPending?: boolean; data?: unknown }) => ({
    isError: o.isError ?? false,
    isPending: o.isPending ?? false,
    data: o.data,
  });

  it('idle with no page asked', () => {
    expect(listsStatusOf([])).toBe('idle');
  });

  it('failed only when a page failed with no answer held', () => {
    expect(listsStatusOf([q({ data: {} }), q({ isError: true })])).toBe('failed');
    expect(listsStatusOf([q({ isError: true, data: {} })])).toBe('ready');
  });

  it('loading while a page has no answer yet, ready once every page has one', () => {
    expect(listsStatusOf([q({ data: {} }), q({ isPending: true })])).toBe('loading');
    expect(listsStatusOf([q({ data: {} }), q({ data: {} })])).toBe('ready');
  });
});
