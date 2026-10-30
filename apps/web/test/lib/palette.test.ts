import { describe, expect, it } from 'vitest';
import { CHART_GROUND, SERIES_COLOURS, seriesColour } from '../../src/lib/palette.js';
import { contrast } from '../contrast.js';

describe('the chart series palette (the departure board)', () => {
  it('every colour holds 3:1 (WCAG non-text) on the enamel plate and on a stale dot’s white fill', () => {
    for (const c of SERIES_COLOURS) {
      expect(contrast(c, CHART_GROUND), c).toBeGreaterThanOrEqual(3);
      expect(contrast(c, '#ffffff'), c).toBeGreaterThanOrEqual(3);
    }
  });

  it('has six distinct colours and cycles past the last', () => {
    expect(new Set(SERIES_COLOURS).size).toBe(6);
    expect(seriesColour(0)).toBe(SERIES_COLOURS[0]);
    expect(seriesColour(SERIES_COLOURS.length + 1)).toBe(SERIES_COLOURS[1]);
  });
});
