import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PriceBoundary } from '../../src/components/PriceBoundary.js';
import { PriceCell } from '../../src/components/PriceCell.js';
import { COPY } from '../../src/copy.js';
import { fxConverted, provCalendar, provSearch } from '../fixtures.js';
import { expectConsoleErrors } from '../guards.js';
import { renderWithProviders } from '../render.js';

// Design 2026-11-08 §5.1 (trip-page plan Task 7): PriceCell's bare face, the amount alone beside its one label.

describe('PriceCell bare', () => {
  it('is the amount alone, no provenance line or badge', () => {
    renderWithProviders(
      <PriceCell pricePence={41_200} provenance={provSearch} calendar={false} stale="refresh" bare />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(cell).toHaveTextContent(/^£412$/);
    expect(screen.queryByTestId('provenance')).toBeNull();
  });

  it('keeps the "≈" of a converted price, its words spoken', () => {
    renderWithProviders(
      <PriceCell
        pricePence={41_200}
        provenance={{ ...provCalendar, fx: fxConverted }}
        calendar
        bare
        stale={false}
      />,
    );
    const cell = screen.getByTestId('price-cell');
    expect(cell).toHaveTextContent(
      `${COPY.fxApprox}${COPY.fxSpoken(COPY.fxTitle('2026-10-13', 'frankfurter'))}£412`,
    );
  });

  it('a price without a provenance is withheld all the same', () => {
    expectConsoleErrors(/price withheld|price rendered without valid provenance/);
    renderWithProviders(
      <PriceBoundary>
        <PriceCell
          pricePence={41_200}
          provenance={{ providerId: 'searchapi' }}
          calendar={false}
          stale={false}
          bare
        />
      </PriceBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(COPY.priceWithheld);
  });
});
