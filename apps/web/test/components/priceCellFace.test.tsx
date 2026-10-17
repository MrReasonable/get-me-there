import { describe, expect, it } from 'vitest';
import { PriceCell } from '../../src/components/PriceCell.js';
import { COPY } from '../../src/copy.js';
import { fxConverted, provCalendar, provSearch } from '../fixtures.js';
import { renderWithProviders } from '../render.js';

// WP10's `face` prop on WP9's PriceCell (plan decision 52, review ui-r2-001): the phone day cell's amount.
describe('PriceCell face (phone day cell)', () => {
  it('shows "≈" and one glyph per mark; every word is spoken and in the title, unconfirmed first', () => {
    const { getByTestId } = renderWithProviders(
      <PriceCell
        face
        pricePence={41200}
        provenance={{ ...provSearch, maxAgeHours: 'unknown', fx: fxConverted }}
        calendar={false}
        stale
        truncated
        unconfirmed
        superseded
        notSeenInLatestHours={30}
        destination="EWR"
        destinationNote="onward leg not included"
      />,
    );
    const cell = getByTestId('price-cell');
    expect(cell).toHaveAttribute('data-face');
    expect(cell).not.toHaveClass('border-dashed');
    const hidden = [...cell.querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent);
    expect(hidden).toEqual(['≈', '≠◷?…↺◌', COPY.providerMark.searchapi]);
    const title = cell.getAttribute('title') ?? '';
    expect(title.indexOf('price not confirmed by the final step')).toBe(0);
    for (const words of [
      'stale',
      "vendor's cache age unknown",
      'cheapest of the rows read',
      'superseded by a later search',
      'not seen in latest search (30h ago)',
      'EWR',
      'onward leg',
    ])
      expect(title).toContain(words);
    expect(cell).toHaveTextContent('£412');
    expect(cell).toHaveTextContent(/converted/);
  });

  it('a plain calendar price has the dashed outline, no marks, and no destination or note when none is given', () => {
    const { getByTestId } = renderWithProviders(
      <PriceCell face pricePence={30000} provenance={provCalendar} calendar stale={false} />,
    );
    const cell = getByTestId('price-cell');
    expect(cell).toHaveClass('border-dashed');
    // why: no marks, so the only aria-hidden part is the provider's short mark (visible provenance without hover)
    expect([...cell.querySelectorAll('[aria-hidden="true"]')].map((e) => e.textContent)).toEqual([
      COPY.providerMark.travelpayouts,
    ]);
    expect(cell.getAttribute('title')).not.toContain('onward');
    expect(cell.getAttribute('title')).toContain('constraints not checked');
  });

  it('the full form badges a superseded calendar price after "stale" (decision 54)', () => {
    const { getByTestId } = renderWithProviders(
      <PriceCell pricePence={30000} provenance={provCalendar} calendar stale superseded />,
    );
    const text = getByTestId('price-cell').textContent ?? '';
    expect(text).toContain('superseded by a later search');
    expect(text.indexOf('stale')).toBeLessThan(text.indexOf('superseded'));
  });
});
