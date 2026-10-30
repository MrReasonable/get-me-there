import { describe, expect, it } from 'vitest';
import { PriceCell } from '../../src/components/PriceCell.js';
import { RING_CLASS } from '../../src/views/Dates/OverviewMonth.js';
import { BAND_CLASSES, BAND_COLOURS, type Band } from '../../src/views/Dates/shade.js';
import { contrast } from '../contrast.js';
import { provCalendar, provSearch } from '../fixtures.js';
import { renderWithProviders } from '../render.js';

// Review ui C1: PriceCell can sit on a lamp whose band sets the inherited text colour. Every badge is a state tag, a
// black flap chip that names its own ink (white, amber, red or dim), so it never inherits the band's colour; the dashed
// calendar outline takes the band's text colour (border-current), which holds the band's own 4.5:1 against its fill.
/** A tag's ink by its class (styles/world.css): the board's white, amber, dim red and dim grey, on the tag's black. */
const TAG_INKS: Readonly<Record<string, string>> = {
  'tag-warn': '#ffb22e',
  'tag-bad': '#ff6b5f',
  'tag-dim': '#9ca1a5',
};
const TAG_FILL = '#0b0c0d';
const TAG_WHITE = '#f1f1ec';
const bands: Band[] = [0, 1, 2, 3, 4];

describe.each(bands)('PriceCell inside band %i (review ui C1)', (band) => {
  for (const form of ['compact', 'face'] as const) {
    it(`${form}: every badge is a tag with its own ink at 4.5:1 and the outline follows the band's text`, () => {
      const { getByTestId, container } = renderWithProviders(
        <div className={BAND_CLASSES[band]}>
          <PriceCell
            {...{ [form]: true }}
            pricePence={41200}
            provenance={{ ...provCalendar, maxAgeHours: 'unknown' }}
            calendar
            stale
            unconfirmed
          />
        </div>,
      );
      const cell = getByTestId('price-cell');
      expect(cell.className).toContain('border-dashed');
      expect(cell.className).toContain('border-current');
      const { fill, text } = BAND_COLOURS[band];
      // why: the face's spans inherit the band's text colour, so this is the contrast of the face's own text (spec: 4.5:1)
      expect(contrast(fill, text)).toBeGreaterThanOrEqual(4.5);
      const badges = [...container.querySelectorAll('span')].filter((e) => e.classList.contains('tag'));
      if (form === 'compact') expect(badges.length).toBeGreaterThanOrEqual(3);
      else {
        // why: the face renders no badge, so the loop below would run zero times; a future badge on it must be covered
        expect(badges).toHaveLength(0);
        // the face's own text takes the band's text colour: no span may set a light class of its own
        for (const e of cell.querySelectorAll('span'))
          expect(e.className, e.textContent ?? '').not.toMatch(/\btext-(white|slate-(50|100|200|300))\b/);
      }
      for (const b of badges) {
        const ink = Object.keys(TAG_INKS).find((k) => b.classList.contains(k));
        expect(
          contrast(TAG_FILL, ink === undefined ? TAG_WHITE : (TAG_INKS[ink] ?? TAG_WHITE)),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it('the provider mark of the compact form is an outlined chip in the band’s own text colour', () => {
    const { container } = renderWithProviders(
      <div className={BAND_CLASSES[band]}>
        <PriceCell compact pricePence={41200} provenance={provSearch} calendar={false} stale={false} />
      </div>,
    );
    const chip = [...container.querySelectorAll('span')].find((e) => e.classList.contains('chip'));
    expect(chip).toBeDefined();
    // why: no colour of its own, so it inherits the band's text, which holds 4.5:1 on the band's fill
    expect(chip?.className).not.toMatch(/\btext-/);
  });
});

/** A CSS hex colour as #rrggbb (`#000` → `#000000`), the form `contrast` reads. */
const sixDigit = (hex: string): string =>
  hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex.toLowerCase();

// Spec §11 Rings: the board's shown rows are ringed in the overview by an outline, the non-colour cue, so the ring must
// stand out from every band's fill (WCAG 1.4.11, 3:1 for a non-text indicator). A one-tone black ring is about 2.2:1 on
// band 0's #134e4a (CodeRabbit on PR #32), so the ring has two tones: at least one of them clears 3:1 on each band.
describe('the overview ring on every band (spec §11 Rings)', () => {
  const tones = [...RING_CLASS.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map((m) => sixDigit(m[0]));
  it('names its tones as hex colours', () => {
    expect(tones.length).toBeGreaterThan(0);
  });
  it.each(bands)('band %i: a ring tone reaches 3:1 against the fill', (band) => {
    const { fill } = BAND_COLOURS[band];
    expect(Math.max(...tones.map((t) => contrast(t, fill)))).toBeGreaterThanOrEqual(3);
  });
});
