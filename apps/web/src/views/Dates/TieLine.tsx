import { COPY } from '../../copy.js';
import { estimateMoney } from '../Definitions/EstimatePanel.js';

// Spec rev 55 §11 "Ties" (WP20 Task 20.10): the line above a run of date pairs at one price.

/**
 * "4 date pairs tie at £86, listed by shortest flight time" when at least one of them has flights shown, else "… in
 * date order", as one full-width row of the board above the run's first shown row. The price is formatted only by the
 * estimate panel's one cost formatter (spec rev 55 §11, `sourceGuard.test.ts`), and is a price quoted in text
 * (`data-quote`), not a fare: the run's figures are each beside their own row through PriceCell.
 */
export function TieLine({
  count,
  pricePence,
  byFlights,
}: {
  count: number;
  pricePence: number;
  byFlights: boolean;
}) {
  return (
    <tr className="tie-row">
      <td colSpan={8}>
        <span data-testid="tie-line" data-quote="">
          {COPY.flights.tie(count, estimateMoney(pricePence), byFlights)}
        </span>
      </td>
    </tr>
  );
}
