import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';
import { isTruncated, TRUNCATED_NOTE } from '../../src/labels/truncated.js';

describe('TRUNCATED_NOTE (decisions 30, 36, 37)', () => {
  it('is the exact label the engine writes and WP8 matches, exported from the barrel', () => {
    expect(TRUNCATED_NOTE).toBe('cheapest of the rows read');
    expect(core.TRUNCATED_NOTE).toBe(TRUNCATED_NOTE);
  });
  it('isTruncated reads the label at the start of last_error only (decision 47)', () => {
    expect(isTruncated('cheapest of the rows read')).toBe(true);
    expect(isTruncated('cheapest of the rows read; a row without a price')).toBe(true);
    expect(isTruncated('a row without a price; cheapest of the rows read')).toBe(false);
    expect(isTruncated(null)).toBe(false);
    expect(isTruncated('')).toBe(false);
    expect(core.isTruncated).toBe(isTruncated);
  });
});
