import { describe, expect, it } from 'vitest';
import { figureMarks } from '../../src/lib/marks.js';

describe('figureMarks (decision 54)', () => {
  it('reads not-seen hours and superseded from a figure, and nothing from a figure without them', () => {
    expect(figureMarks({ notSeenInLatest: { ageHours: 30 } })).toEqual({
      notSeenInLatestHours: 30,
      superseded: false,
    });
    expect(figureMarks({ notSeenInLatest: { ageHours: 'unknown' } }).notSeenInLatestHours).toBe('unknown');
    expect(figureMarks({ notSeenInLatest: null, superseded: true })).toEqual({
      notSeenInLatestHours: null,
      superseded: true,
    });
    expect(figureMarks({})).toEqual({ notSeenInLatestHours: null, superseded: false });
  });
});
