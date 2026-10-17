import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { CALENDAR_PARAMS, parseColourBasis, parseDestination } from '../../src/state/calendarState.js';

describe('calendar URL state (review arch M3)', () => {
  it('keeps the destination only when it is one of the definition’s, else all', () => {
    const dests = [asIata('JFK'), asIata('EWR')];
    expect(parseDestination('EWR', dests)).toBe('EWR');
    expect(parseDestination('BBB', dests)).toBe('all');
    expect(parseDestination(null, dests)).toBe('all');
  });
  it('reads a colour basis only when it is one of the two', () => {
    expect(parseColourBasis('verified')).toBe('verified');
    expect(parseColourBasis('calendar')).toBe('calendar');
    expect(parseColourBasis('other')).toBeNull();
    expect(parseColourBasis(null)).toBeNull();
  });
  it('names the three parameters', () => {
    expect(CALENDAR_PARAMS).toEqual({ destination: 'cal.dest', basis: 'cal.basis', month: 'cal.month' });
  });
});
