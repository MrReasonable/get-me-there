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

describe('@gmt/core barrel exports the roll-up reason literals', () => {
  // why: WP7 writes and WP3/WP9 read these strings; pinning them stops a writer spelling one differently.
  it('PARTIAL_EXPANSION and MIXED_ERROR_REASON', () => {
    expect([core.PARTIAL_EXPANSION, core.MIXED_ERROR_REASON]).toEqual(['partial-expansion', 'mixed']);
  });
});
