import { describe, expect, it } from 'vitest';
import { PriceCell } from '../../../src/components/PriceCell.js';
import { provCalendar } from '../../fixtures.js';
import { renderWithProviders } from '../../render.js';
import { mainPathWords } from './jargon.js';

// The sweep's own rule (minor 9): only a PriceCell's provenance note is left out (its source, provider and age words,
// in the row form's provenance line, the faces' spoken text and their titles); the rest of the cell is swept.

describe('mainPathWords', () => {
  it('keeps a price cell’s amount and marks, and leaves out its provenance note (row form)', () => {
    renderWithProviders(
      <PriceCell pricePence={41_200} provenance={provCalendar} calendar stale="refresh" superseded />,
    );
    const words = mainPathWords();
    expect(words).toContain('£412');
    expect(words).toContain('superseded by a later search');
    expect(words).toContain("older than this search's refresh");
    expect(words).not.toContain('Aviasales cache');
  });

  it('the compact and phone faces: their visible marks are swept, their provenance title and spoken note are not', () => {
    for (const face of [{ compact: true }, { face: true }]) {
      const r = renderWithProviders(
        <PriceCell pricePence={41_200} provenance={provCalendar} calendar stale="refresh" {...face} />,
      );
      const words = mainPathWords();
      expect(words, JSON.stringify(face)).toContain('£412');
      expect(words, JSON.stringify(face)).not.toContain('Aviasales cache');
      expect(words, JSON.stringify(face)).not.toContain('Travelpayouts');
      r.unmount();
    }
  });
});
