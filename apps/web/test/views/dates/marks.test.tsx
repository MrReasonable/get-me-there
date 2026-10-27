import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { MARK_CLASS, NEUTRAL_CLASS } from '../../../src/views/Dates/OverviewMonth.js';
import { MARK_ORDER, type Mark } from '../../../src/views/Dates/overview.js';
import { BAND_COLOURS, type Band } from '../../../src/views/Dates/shade.js';
import { contrast } from '../../contrast.js';
import {
  at,
  bucketsOf,
  calendarFig,
  type DatesOptions,
  pricedPair,
  verifiedFig,
} from '../../fixtures.dates.js';
import { renderedCopy } from '../../guards.js';
import { findBoard, renderDates } from './render.js';

// Spec §9's pinned review focus "Coverage marks never read as no flights" and "Nothing conveyed by colour alone", for
// the overview: each unpriced bucket's own words on the cell, its name, its readout; only empty says "no fares";
// distinct glyphs and patterns in the cells and the legend; each mark legible on every shade.

const cell = (date: string, from: number) => {
  const el = document.querySelector<HTMLElement>(`[data-cell="${date}|${from}"]`);
  if (el === null) throw new Error(`no cell ${date}|${from}`);
  return el;
};
const readout = () => screen.getByTestId('dates-readout');
const W = COPY.datesView.marks.words;

/** One priced date pair (so the board draws) and one date pair per case on 15 Mar onwards. */
function body(cases: Array<Parameters<typeof bucketsOf>[0]>): DatesOptions {
  return {
    rest: { no_data: 4 },
    pairs: {
      [at('2027-03-14', 10)]: pricedPair(verifiedFig()),
      ...Object.fromEntries(cases.map((b, i) => [at(`2027-03-${15 + i}`, 10), { buckets: bucketsOf(b) }])),
    },
  };
}

describe('coverage marks never read as no flights (spec §9)', () => {
  const alone: Array<[Parameters<typeof bucketsOf>[0], Mark]> = [
    [{ empty: 4 }, 'empty'],
    [{ no_data: 4 }, 'no_data'],
    [{ error: 4 }, 'error'],
    [{ skipped: 4 }, 'skipped'],
    [{}, 'not_run'],
  ];
  it('each unpriced bucket alone: the cell’s mark, its accessible name and its readout use that bucket’s words', async () => {
    renderDates({ body: body(alone.map(([b]) => b)) });
    await findBoard();
    alone.forEach(([, mark], i) => {
      const c = cell(`2027-03-${15 + i}`, 10);
      expect(c.getAttribute('data-marks'), mark).toBe(mark);
      expect(c, mark).toHaveAccessibleName(new RegExp(`: ${W[mark]}$`));
      expect(within(c).getByTestId('cell-glyphs'), mark).toHaveTextContent(COPY.datesView.marks.glyph[mark]);
      fireEvent.pointerOver(c);
      expect(readout(), mark).toHaveTextContent(W[mark]);
    });
    // why: the thin-coverage line's own words ("not evidence that no flights exist") are the spec's, and the only ones
    expect(renderedCopy().replaceAll(COPY.thinCoverage, '')).not.toMatch(/no flights/i);
  });

  it('mixed with the others, §6.6’s precedence decides, and "partly not searched" when some are not searched', async () => {
    const mixed: Array<[Parameters<typeof bucketsOf>[0], string]> = [
      [{ error: 1, empty: 1, no_data: 1, skipped: 1, not_run: 0 }, 'error'],
      [{ empty: 2, no_data: 1, skipped: 1, not_run: 0 }, 'empty'],
      [{ no_data: 2, skipped: 2, not_run: 0 }, 'no_data'],
      [{ empty: 1, no_data: 2 }, 'partly'],
      [{ error: 3 }, 'partly'],
    ];
    renderDates({ body: body(mixed.map(([b]) => b)) });
    await findBoard();
    mixed.forEach(([, mark], i) => {
      expect(cell(`2027-03-${15 + i}`, 10).getAttribute('data-marks'), String(i)).toBe(mark);
    });
  });

  it('only an empty bucket says "no fares"', async () => {
    renderDates({ body: body([{ no_data: 4 }, { error: 4 }, { skipped: 4 }, {}]) });
    await findBoard();
    const overview = screen.getByTestId('dates-overview');
    expect(within(overview).queryAllByRole('button', { name: /no fares/ })).toEqual([]);
  });

  it('not searched, defined: a date pair whose every airport pair is not searched is never shaded; a figure from an earlier run on a pair the run has not reached is shaded, striped, and its readout says so', async () => {
    renderDates({
      body: {
        rest: { no_data: 4 },
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(verifiedFig({ fromEarlierSearch: true }), {
            buckets: bucketsOf({ priced: 1 }),
          }),
          [at('2027-03-15', 10)]: { buckets: bucketsOf({}) },
        },
      },
    });
    await findBoard();
    expect(cell('2027-03-15', 10)).toHaveAttribute('data-shade', 'none');
    expect(cell('2027-03-15', 10).getAttribute('data-marks')).toBe('not_run');
    expect(cell('2027-03-14', 10)).toHaveAttribute('data-shade', 'flat');
    expect(cell('2027-03-14', 10).getAttribute('data-marks')).toBe('partly');
    expect(cell('2027-03-14', 10).className).toContain('dates-partly');
    fireEvent.pointerOver(cell('2027-03-14', 10));
    expect(readout()).toHaveTextContent('price from an earlier search');
  });
});

describe('distinct marks, never colour alone (spec §9, §11)', () => {
  it('the eleven marks have pairwise-distinct glyphs, and the striped mark a pattern of its own', () => {
    const glyphs = MARK_ORDER.map((m) => COPY.datesView.marks.glyph[m]);
    expect(glyphs.every((g) => g.length > 0)).toBe(true);
    expect(new Set(glyphs).size).toBe(MARK_ORDER.length);
    expect(MARK_ORDER.filter((m) => MARK_CLASS[m] !== '')).toEqual(['partly']);
    // a class-level guard: no mark is drawn by a background colour; its pattern is a background image (dates.css)
    for (const m of MARK_ORDER) expect(MARK_CLASS[m], m).not.toMatch(/\bbg-/);
  });

  it('the legend shows each mark with the same glyph and its word, and the not-checked, superseded and not-seen marks in the cells', async () => {
    renderDates({
      body: {
        rest: { no_data: 4 },
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(calendarFig()),
          [at('2027-03-15', 10)]: pricedPair(calendarFig({ superseded: true })),
          [at('2027-03-16', 10)]: pricedPair(verifiedFig({ notSeenInLatest: { ageHours: 3 } })),
        },
      },
    });
    await findBoard();
    const legend = screen.getByTestId('dates-legend');
    for (const m of MARK_ORDER) {
      const item = legend.querySelector<HTMLElement>(`[data-mark="${m}"]`);
      if (item === null) throw new Error(`the legend has no ${m}`);
      expect(item, m).toHaveTextContent(W[m]);
      expect(within(item).getByTestId('legend-glyph'), m).toHaveTextContent(COPY.datesView.marks.glyph[m]);
    }
    expect(cell('2027-03-14', 10).getAttribute('data-marks')).toBe('notChecked');
    expect(cell('2027-03-15', 10).getAttribute('data-marks')).toBe('superseded notChecked');
    expect(cell('2027-03-16', 10).getAttribute('data-marks')).toBe('notSeen');
    expect(legend).toHaveTextContent('not checked: a calendar price; its constraints');
  });

  it('every mark’s ink meets 4.5:1 on every shade it can sit on (the band’s own text colour, black on the plain fill)', () => {
    for (const b of [0, 1, 2, 3, 4] as const satisfies readonly Band[]) {
      const { fill, text } = BAND_COLOURS[b];
      expect(contrast(fill, text), `band ${b}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(NEUTRAL_CLASS).toContain('bg-white');
    expect(NEUTRAL_CLASS).toContain('text-black');
    expect(contrast('#ffffff', '#000000')).toBeGreaterThanOrEqual(4.5);
  });
});
