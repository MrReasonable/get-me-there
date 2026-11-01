import { COPY } from '../../copy.js';
import { estimateMoney } from '../Definitions/EstimatePanel.js';

// Spec rev 55 §11 "Ties" (WP20 Task 20.10): the line above a run of date pairs at one price.

/**
 * "4 date pairs tie at £86, listed by shortest flight time" when at least one of them has flights shown, else "… in
 * date order", as one full-width row of the board above the run's first shown row; a tie that runs past the shown rows
 * counts all of it and adds "; 4 shown here" (ruling R-tie-count). The price is formatted only by the estimate panel's
 * one cost formatter, in whole pounds when it has no pence (spec rev 55 §11, ruling R-pounds, `sourceGuard.test.ts`),
 * and is a price quoted in text (`data-quote`), not a fare: the run's figures are each beside their own row through
 * PriceCell.
 */
export function TieLine({
  count,
  shown,
  pricePence,
  byFlights,
}: {
  count: number;
  /** How many of the tie the board shows now. */
  shown: number;
  pricePence: number;
  byFlights: boolean;
}) {
  return (
    <tr className="tie-row">
      <td colSpan={8}>
        <span data-testid="tie-line" data-quote="">
          {COPY.flights.tie(
            count,
            estimateMoney(pricePence, { wholePounds: true }),
            byFlights,
            shown < count ? shown : null,
          )}
        </span>
      </td>
    </tr>
  );
}
