import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../src/copy.js';
import { contrast } from '../../contrast.js';
import { at, bucketsOf, type DatesOptions, pricedPair, verifiedFig } from '../../fixtures.dates.js';
import { renderedCopy } from '../../guards.js';
import { dayButton, findCalendar, renderDates } from './render.js';

// Spec §9's pinned review focus "Coverage marks never read as no flights" and "Nothing conveyed by colour alone", for
// the calendar (Ruling 18): each day without a price says why in its name and on the day itself, in words or a glyph
// or a pattern; no day reads "no flights"; each cue keeps its contrast, light and dark.

const C = COPY.calendar;
const css = readFileSync(resolve(__dirname, '../../../src/views/Dates/dates.css'), 'utf8');
const theme = readFileSync(resolve(__dirname, '../../../src/styles/theme.css'), 'utf8');

/** One priced day (so the page draws) and one day per case on 15 Mar onwards, every stay of that day alike. */
function body(cases: Array<Parameters<typeof bucketsOf>[0]>): DatesOptions {
  const pairs: DatesOptions['pairs'] = { [at('2027-03-14', 10)]: pricedPair(verifiedFig()) };
  cases.forEach((b, i) => {
    for (const n of [10, 11, 12]) pairs[at(`2027-03-${15 + i}`, n)] = { buckets: bucketsOf(b) };
  });
  return { rest: { no_data: 4 }, pairs };
}

describe('coverage marks never read as no flights (spec §9; Ruling 18)', () => {
  const alone: Array<[Parameters<typeof bucketsOf>[0], string, string, string]> = [
    [{ empty: 4 }, 'no-price-shown', 'no price', C.noPrice],
    [{ no_data: 4 }, 'no-price-shown', 'no price', C.noPrice],
    [{ error: 4 }, 'couldnt-read', "couldn't read", C.couldntReadGlyph],
    [{ skipped: 4 }, 'not-reached', 'not reached', ''],
    [{}, 'not-searched', 'not searched', ''],
  ];

  it('each day without a price: its mark, its name in that mark’s words, and what it prints', async () => {
    renderDates({ body: body(alone.map(([b]) => b)) });
    await findCalendar();
    alone.forEach(([, mark, words, printed], i) => {
      const day = dayButton(`2027-03-${15 + i}`);
      expect(day.getAttribute('data-mark'), mark).toBe(mark);
      expect(day, mark).toHaveAccessibleName(new RegExp(`, ${words}$`));
      expect(day.querySelector('.cal-dp')?.textContent ?? '', mark).toBe(printed);
    });
    // why: Review Focus 3's own sentence, the key's "(not 'no flights')" and "That isn't the same as no flights" are
    // the only ones that say it
    expect(
      renderedCopy()
        .replaceAll(COPY.searchPage.noTrip, '')
        .replaceAll(C.key.noPrice, '')
        .replace(/isn't the same as no flights/g, ''),
    ).not.toMatch(/no flights/i);
  });

  it('a day of mixed stays takes §6.6’s precedence over them all: one empty stay and the rest not run is not searched', async () => {
    renderDates({
      body: {
        rest: { no_data: 4 },
        pairs: {
          [at('2027-03-14', 10)]: pricedPair(verifiedFig()),
          [at('2027-03-15', 10)]: { buckets: bucketsOf({ empty: 1 }) },
          [at('2027-03-15', 11)]: { buckets: bucketsOf({ empty: 4 }) },
          [at('2027-03-15', 12)]: { buckets: bucketsOf({ empty: 4 }) },
          [at('2027-03-16', 10)]: { buckets: bucketsOf({ error: 1, empty: 3 }) },
        },
      },
    });
    await findCalendar();
    expect(dayButton('2027-03-15')).toHaveAccessibleName('Mon 15 Mar, not searched');
    expect(dayButton('2027-03-15')).not.toHaveAccessibleName(/no price/);
    expect(dayButton('2027-03-16')).toHaveAccessibleName("Tue 16 Mar, couldn't read");
  });

  it('no day’s name reads "no flights" or "no fares"', async () => {
    renderDates({ body: body([{ empty: 4 }, { no_data: 4 }, { error: 4 }, { skipped: 4 }, {}]) });
    await findCalendar();
    expect(screen.queryAllByRole('button', { name: /no fares|no flights/ })).toEqual([]);
  });
});

describe('nothing by colour alone (spec §9, §11; Ruling 18)', () => {
  it('not searched and not reached are hatched, a pattern; no price and couldn’t read print their words or glyph', () => {
    const hatched =
      /\.cal-day:is\(\[data-mark="not-searched"\], \[data-mark="not-reached"\]\)\s*\{([^}]*)\}/.exec(
        css,
      )?.[1];
    expect(hatched).toMatch(/background-image: repeating-linear-gradient/);
    expect(C.noPrice).toBe('no price');
    expect(C.couldntReadGlyph).toBe('×');
    // the trip's dot is a glyph, so it survives forced colours, and the key draws the same one
    expect(C.tripGlyph).toBe('●');
    expect(C.key.trip).toMatch(/^a trip with flights read/);
  });

  it('forced colours keep every day’s edge, and the hatching turns to a dashed edge', () => {
    const forced = /@media \(forced-colors: active\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(forced).toMatch(/\.cal-day\s*\{[^}]*border: 1px solid CanvasText/);
    expect(forced).toMatch(/border-style: dashed/);
  });

  it.each([
    ['light', /\n:root \{([^}]*)\}/],
    ['dark', /@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/],
  ] as const)('%s: a day without a price reads its muted words at 4.5:1 on its ground', (_s, re) => {
    const block = re.exec(theme)?.[1] ?? '';
    const token = (name: string) => new RegExp(`--t-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1] ?? '';
    expect(contrast(token('muted'), token('sunk'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('muted'), token('surface'))).toBeGreaterThanOrEqual(4.5);
    // a stale price's amber chip sits on the surface colour
    expect(contrast(token('warn'), token('surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('each heat step takes the ink the theme pins for it (test/views/trip/contrast.test.ts)', () => {
    expect(css).toMatch(/\.cal-day\[data-heat="1"\]\s*\{[^}]*color: var\(--t-heat-ink-dark\)/);
    for (const step of ['2', '3', '4', '5', 'flat'])
      expect(css, step).toMatch(
        new RegExp(`\\.cal-day\\[data-heat="${step}"\\]\\s*\\{[^}]*color: var\\(--t-heat-ink-light\\)`),
      );
  });
});
