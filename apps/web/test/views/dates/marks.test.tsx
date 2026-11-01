import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { MARK_CLASS, NEUTRAL_CLASS } from '../../../src/views/Dates/OverviewMonth.js';
import { CELL_MARKS, type CellMark, MARK_ORDER } from '../../../src/views/Dates/overview.js';
import { BAND_COLOURS, type Band } from '../../../src/views/Dates/shade.js';
import { contrast } from '../../contrast.js';
import {
  at,
  bucketsOf,
  calendarFig,
  type DatesOptions,
  priced,
  pricedPair,
  verifiedFig,
} from '../../fixtures.dates.js';
import { renderedCopy } from '../../guards.js';
import { findBoard, renderDates } from './render.js';

// Spec §9's pinned review focus "Coverage marks never read as no flights" and "Nothing conveyed by colour alone", for
// the overview (spec rev 55 §3, §6.6, §11: the five marks): each unpriced date pair's mark in words on the cell, its
// name, its readout; no mark reads "no flights"; distinct glyphs and patterns in the cells and the key; each mark
// legible on every shade.

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
  const alone: Array<[Parameters<typeof bucketsOf>[0], CellMark]> = [
    [{ empty: 4 }, 'no-price-shown'],
    [{ no_data: 4 }, 'no-price-shown'],
    [{ error: 4 }, 'couldnt-read'],
    [{ skipped: 4 }, 'not-reached'],
    [{}, 'not-searched'],
  ];
  it('each unpriced date pair alone: the cell’s mark, its accessible name and its readout use that mark’s words', async () => {
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
    // an error cell says "couldn't be read" in its name (spec rev 55 §11)
    expect(cell('2027-03-17', 10)).toHaveAccessibleName(/couldn't be read$/);
    // why: the thin-coverage line's own words ("not evidence that no flights exist") are the spec's, and the only ones
    expect(renderedCopy().replaceAll(COPY.searchPage.thinCoverage, '')).not.toMatch(/no flights/i);
  });

  it('mixed with the others, §6.6’s precedence decides, and "partly not searched" when some are not searched', async () => {
    const mixed: Array<[Parameters<typeof bucketsOf>[0], string]> = [
      [{ error: 1, empty: 1, no_data: 1, skipped: 1, not_run: 0 }, 'couldnt-read'],
      [{ empty: 2, no_data: 1, skipped: 1, not_run: 0 }, 'no-price-shown'],
      [{ no_data: 2, skipped: 2, not_run: 0 }, 'no-price-shown'],
      [{ empty: 1, no_data: 2 }, 'not-searched partly'],
      [{ error: 3 }, 'not-searched partly'],
    ];
    renderDates({ body: body(mixed.map(([b]) => b)) });
    await findBoard();
    mixed.forEach(([, mark], i) => {
      expect(cell(`2027-03-${15 + i}`, 10).getAttribute('data-marks'), String(i)).toBe(mark);
    });
  });

  it('one empty airport pair and three not searched is "not searched" with the stripes, never "no price shown"', async () => {
    renderDates({ body: body([{ empty: 1 }]) });
    await findBoard();
    const c = cell('2027-03-15', 10);
    expect(c).toHaveAccessibleName(/: not searched, partly not searched$/);
    expect(c.className).toContain('dates-partly');
    expect(c).not.toHaveAccessibleName(/no price shown/);
  });

  it('no mark reads "no flights", and "no fares" only under "no price shown" in the key', async () => {
    renderDates({ body: body([{ empty: 4 }, { no_data: 4 }, { error: 4 }, { skipped: 4 }, {}]) });
    await findBoard();
    const overview = screen.getByTestId('dates-overview');
    expect(within(overview).queryAllByRole('button', { name: /no fares|no flights/ })).toEqual([]);
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
    expect(cell('2027-03-15', 10).getAttribute('data-marks')).toBe('not-searched');
    expect(cell('2027-03-14', 10)).toHaveAttribute('data-shade', 'flat');
    expect(cell('2027-03-14', 10).getAttribute('data-marks')).toBe('partly');
    expect(cell('2027-03-14', 10).className).toContain('dates-partly');
    fireEvent.pointerOver(cell('2027-03-14', 10));
    expect(readout()).toHaveTextContent('price from an earlier search');
  });
});

describe('distinct marks, never colour alone (spec §9, §11)', () => {
  it('the cell marks have pairwise-distinct glyphs, and the striped mark a pattern of its own', () => {
    const glyphs = CELL_MARKS.map((m) => COPY.datesView.marks.glyph[m]);
    expect(glyphs.every((g) => g.length > 0)).toBe(true);
    expect(new Set(glyphs).size).toBe(CELL_MARKS.length);
    expect(CELL_MARKS.filter((m) => MARK_CLASS[m] !== '')).toEqual(['partly']);
    // a class-level guard: no mark is drawn by a background colour; its pattern is a background image (dates.css)
    for (const m of CELL_MARKS) expect(MARK_CLASS[m], m).not.toMatch(/\bbg-/);
  });

  it('the key: the five marks with their counts, "no price shown" with its parts, then the cell marks besides, each with the same glyph as the cells', async () => {
    renderDates({
      body: {
        rest: { no_data: 4 },
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(calendarFig()),
          [at('2027-03-15', 10)]: pricedPair(calendarFig({ superseded: true })),
          [at('2027-03-16', 10)]: pricedPair(verifiedFig({ notSeenInLatest: { ageHours: 3 } })),
          [at('2027-03-17', 10)]: { buckets: bucketsOf({ empty: 4 }) },
          [at('2027-03-18', 10)]: { buckets: bucketsOf({ error: 1, empty: 3 }) },
          [at('2027-03-19', 10)]: { buckets: bucketsOf({ skipped: 4 }) },
          [at('2027-03-20', 10)]: { buckets: bucketsOf({}) },
        },
      },
    });
    await findBoard();
    const legend = screen.getByTestId('dates-legend');
    // 31 days × 3 stays = 93 date pairs: 3 priced, 1 empty, 86 no cached data (the rest), 1 error, 1 skipped, 1 not run
    const key = (m: string) => {
      const item = legend.querySelector<HTMLElement>(`[data-mark="${m}"]`);
      if (item === null) throw new Error(`the key has no ${m}`);
      return item;
    };
    expect(key('priced')).toHaveTextContent('priced: 3');
    expect(key('no-price-shown')).toHaveTextContent('no price shown: 87');
    expect(key('no-price-shown')).toHaveTextContent('1 no fares, 86 no cached data');
    expect(key('couldnt-read')).toHaveTextContent("couldn't be read: 1");
    expect(key('not-reached')).toHaveTextContent('not reached: 1');
    expect(key('not-searched')).toHaveTextContent('not searched: 1');
    // priced is its shade (a lit swatch, no glyph); every other mark carries the cells' own glyph
    expect(within(key('priced')).getByTestId('legend-glyph').className).toContain('lamp-lit');
    for (const m of CELL_MARKS) {
      expect(key(m), m).toHaveTextContent(W[m]);
      expect(within(key(m)).getByTestId('legend-glyph'), m).toHaveTextContent(COPY.datesView.marks.glyph[m]);
    }
    expect([...legend.querySelectorAll('[data-mark]')].map((e) => e.getAttribute('data-mark'))).toEqual([
      ...MARK_ORDER,
    ]);
    // one price is too few for bands, so the key says the shade is flat, not which way it runs
    expect(legend).not.toHaveTextContent('brighter is cheaper');
    expect(legend).toHaveTextContent('striped: partly not searched');
    expect(legend).toHaveTextContent('each dot is one stay length');
    expect(legend).toHaveTextContent('not checked: a calendar price; its constraints');
    expect(legend).not.toHaveTextContent(/no flights/i);
    expect(cell('2027-03-14', 10).getAttribute('data-marks')).toBe('notChecked');
    expect(cell('2027-03-15', 10).getAttribute('data-marks')).toBe('superseded notChecked');
    expect(cell('2027-03-16', 10).getAttribute('data-marks')).toBe('notSeen');
  });

  it('with price bands, the key says which way the shade runs, with the bands as scale values', async () => {
    // eleven current prices from £300 to £400: enough, and spread enough, for five bands (decision 38)
    const eleven = Object.fromEntries(
      Array.from({ length: 11 }, (_x, i) => [
        at(`2027-03-${14 + i}`, 10),
        pricedPair(priced(30_000 + i * 1_000)),
      ]),
    );
    renderDates({ body: { rest: { no_data: 4 }, pairs: eleven } });
    await findBoard();
    const legend = screen.getByTestId('dates-legend');
    expect(legend).toHaveTextContent('brighter is cheaper');
    expect(legend).toHaveTextContent(/band 1: £\d/);
  });

  it('every mark’s ink meets 4.5:1 on every shade it can sit on (the band’s own text colour, black on the plain fill)', () => {
    for (const b of [0, 1, 2, 3, 4] as const satisfies readonly Band[]) {
      const { fill, text } = BAND_COLOURS[b];
      expect(contrast(fill, text), `band ${b}`).toBeGreaterThanOrEqual(4.5);
    }
    // the plain fill is an unlit socket on the board: the board's white ink on the lamp-off grey
    expect(NEUTRAL_CLASS).toContain('bg-[#2a2d30]');
    expect(NEUTRAL_CLASS).toContain('text-[#f1f1ec]');
    expect(contrast('#2a2d30', '#f1f1ec')).toBeGreaterThanOrEqual(4.5);
  });
});
