import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

// The plan's WP1 "Produces" list: every name later packages import from @gmt/core.
const WP1_FUNCTIONS = [
  'toEpochDay',
  'fromEpochDay',
  'addDays',
  'daysBetween',
  'monthOf',
  'monthsSpanned',
  'isLeapYear',
  'resolveWindow',
  'generateCells',
  'countCells',
  'validateSearchSpace',
  'rollUp',
  'mergeWithinProvider',
  'sixBuckets',
  'selectedNotReached',
  'selectCandidates',
] as const;

describe('@gmt/core barrel exports WP1', () => {
  // why: spreading the namespace into a plain record lets the test index it by name without a cast.
  const exported: Record<string, unknown> = { ...core };
  it.each(WP1_FUNCTIONS)('exports %s', (name) => {
    expect(typeof exported[name]).toBe('function');
  });
});
