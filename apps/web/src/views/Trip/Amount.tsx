import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import type { Priced } from './model.js';

/**
 * A price on the Trip page: the amount alone through PriceCell (the one component that prints a price; its label sits
 * beside it), in its own price boundary, so a provenance that is not one withholds this price and nothing else.
 * `variant` is its size: the card's large or middle figure, a figure in a sentence, or the plain text size.
 */
export function Amount({
  price,
  variant = 'plain',
  muted = false,
}: {
  price: Pick<Priced, 'pricePence' | 'provenance' | 'stale'>;
  variant?: 'big' | 'mid' | 'inline' | 'plain';
  muted?: boolean;
}) {
  return (
    <span className={`trip-amount trip-amount-${variant}${muted ? ' trip-amount-muted' : ''}`}>
      <PriceBoundary>
        <PriceCell
          pricePence={price.pricePence}
          provenance={price.provenance}
          calendar={false}
          stale={price.stale}
          bare
        />
      </PriceBoundary>
    </span>
  );
}
