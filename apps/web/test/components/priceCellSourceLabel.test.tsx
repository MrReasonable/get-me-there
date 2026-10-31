import { sourceLabel } from '@gmt/core';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceCell } from '../../src/components/PriceCell.js';
import { assertProvenance } from '../../src/components/Provenance.js';
import { provSearch } from '../fixtures.js';
import { renderWithProviders } from '../render.js';

// WP20 Task 20.3: `sourceLabel` replaces the source's words on every face of PriceCell (Task 20.10 passes a flight list's
// own name); the provenance is validated all the same, so an amount never prints without it.

const LABEL = 'a source with a name of its own';

describe('PriceCell sourceLabel', () => {
  it('the compact face carries the label in its title instead of the provenance’s source words', () => {
    renderWithProviders(
      <PriceCell
        compact
        pricePence={8600}
        provenance={provSearch}
        calendar={false}
        stale={false}
        sourceLabel={LABEL}
      />,
    );
    expect(screen.getByTestId('price-cell').getAttribute('title')).toContain(LABEL);
  });

  it('the full form prints the label in the provenance line', () => {
    renderWithProviders(
      <PriceCell
        pricePence={8600}
        provenance={provSearch}
        calendar={false}
        stale={false}
        sourceLabel={LABEL}
      />,
    );
    expect(within(screen.getByTestId('provenance')).getByText(LABEL)).toBeInTheDocument();
  });

  it('without it the provenance’s own source words stay', () => {
    renderWithProviders(
      <PriceCell pricePence={8600} provenance={provSearch} calendar={false} stale={false} />,
    );
    const provenance = screen.getByTestId('provenance');
    expect(within(provenance).queryByText(LABEL)).toBeNull();
    expect(within(provenance).getByText(sourceLabel(assertProvenance(provSearch)))).toBeInTheDocument();
  });

  it('still refuses an amount whose provenance is incomplete', () => {
    expect(() =>
      renderWithProviders(
        <PriceCell
          pricePence={8600}
          provenance={{ providerId: 'searchapi' }}
          calendar={false}
          stale={false}
          sourceLabel={LABEL}
        />,
      ),
    ).toThrow();
  });
});
