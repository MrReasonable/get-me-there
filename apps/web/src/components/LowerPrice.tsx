import type { SearchCard } from '../api/types.js';
import { labelDetail } from '../lib/figureLabel.js';
import { PriceBoundary } from './PriceBoundary.js';
import { PriceCell } from './PriceCell.js';
import { PriceLabel } from './PriceLabel.js';
import { assertProvenance } from './Provenance.js';

type Lower = NonNullable<SearchCard['lowerOnCalendar']>['cheapest'];

function Inner({ lower }: { lower: Lower }) {
  const p = lower.price;
  assertProvenance(p.provenance);
  return (
    <>
      <PriceCell
        bare
        pricePence={p.pricePence}
        provenance={p.provenance}
        calendar
        stale={p.stale}
        truncated={p.truncated}
        destination={lower.destination}
      />{' '}
      <PriceLabel
        kind={lower.kind}
        ageHours={p.ageHours}
        stale={p.stale}
        provenance={p.provenance}
        detail={labelDetail(lower.kind, null)}
      />
    </>
  );
}

/**
 * A card's lowest calendar price (Ruling 5): the amount, calendar-styled, and its one label (Calendar or Cached, by the
 * wire's `kind`) with the age and stale mark the wire gives it. A provenance that is not one withholds this price and its
 * label, never the card.
 */
export function LowerPrice({ lower }: { lower: Lower }) {
  return (
    <PriceBoundary>
      <Inner lower={lower} />
    </PriceBoundary>
  );
}
