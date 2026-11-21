import { describe, expect, it } from 'vitest';
import {
  choiceOf,
  choiceValue,
  presetWindow,
  windowChoice,
} from '../../../src/views/Definitions/windowChoice.js';

// Spec §11 "When to leave": which choice a window reads as, and the select's values for them.

describe('windowChoice', () => {
  it('reads each preset, fixed dates and any other rolling window', () => {
    expect(
      [1, 3, 6, 9, 12].map((n) => windowChoice({ kind: 'months', startOffsetDays: 14, lengthMonths: n })),
    ).toEqual([1, 3, 6, 9, 12]);
    expect(windowChoice({ kind: 'absolute', from: '', to: '' })).toBe('range');
    expect(windowChoice({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 })).toBe('custom');
    // a months window that is not a preset: another length, or another start
    expect(windowChoice({ kind: 'months', startOffsetDays: 14, lengthMonths: 2 })).toBe('custom');
    expect(windowChoice({ kind: 'months', startOffsetDays: 7, lengthMonths: 3 })).toBe('custom');
  });

  it('a preset stores a months window starting 14 days ahead, which reads back as the same preset', () => {
    expect(presetWindow(9)).toEqual({ kind: 'months', startOffsetDays: 14, lengthMonths: 9 });
    expect(windowChoice(presetWindow(9))).toBe(9);
  });

  it('round-trips every choice through the select value, and refuses a value no option has', () => {
    for (const c of [1, 3, 6, 9, 12, 'range', 'custom'] as const) expect(choiceOf(choiceValue(c))).toBe(c);
    expect(choiceOf('2')).toBeNull();
    expect(choiceOf('')).toBeNull();
  });
});
