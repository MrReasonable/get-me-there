// The recorded suites' year anchor (test/support/recordedGrid.ts): a first view prints its range line, or, when the
// query's pair is unpriced (grid/2026-10-27/2), only the selected cell's name. Synthetic snapshot text only.
import { describe, expect, it } from 'vitest';
import { recordedAnchor } from './support/recordedGrid.js';

describe('recordedAnchor', () => {
  it('reads the return date from the range line when one is printed', () => {
    expect(
      recordedAnchor('- generic: text: 14 – 24 Mar 2027£462 · Round trip', '2026-10-18T05:00:00.000Z'),
    ).toBe('2027-03-24');
  });
  it('reads it from a selected unpriced cell when no range line is printed, every month token the grammar reads', () => {
    expect(
      recordedAnchor(
        '- button "no flights, 14 Nov to 22 Nov, selected": no flights',
        '2026-10-27T01:00:00.000Z',
      ),
    ).toBe('2026-11-22');
    expect(
      recordedAnchor(
        '- button "price unknown, 20 Sept to 28 Sept, selected": price unknown',
        '2026-08-01T01:00:00.000Z',
      ),
    ).toBe('2026-09-28');
  });
  it('a month already past the recording takes the next year', () => {
    expect(
      recordedAnchor(
        '- button "no flights, 10 Jan to 20 Jan, selected": no flights',
        '2026-11-01T01:00:00.000Z',
      ),
    ).toBe('2027-01-20');
  });
  it('a first view with neither is refused', () => {
    expect(() =>
      recordedAnchor('- button "£462, 14 Mar to 24 Mar": £462', '2026-10-18T05:00:00.000Z'),
    ).toThrow(/no range line/);
  });
});
