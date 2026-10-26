import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayShort } from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import type { DayPrice, DaySlice } from './types.js';

// The Calendar side panel's day section. Its outcome, price and verify sections moved to the date pair detail's
// per-airport-pair panel (views/Results/PanelSections.tsx, WP19 Task 19.6) and are re-exported here until Task 19.8
// removes the Calendar view.
export { CellDetailBody, VerifyCost, VerifySection } from '../Results/PanelSections.js';

const P = COPY.calendarView.panel;

/** The day's own prices with full provenance (the day cell shows them compact). */
export function DayPrices({ slice, notes }: { slice: DaySlice; notes: Partial<Record<string, string>> }) {
  const rows: Array<{ key: string; label: string; price: DayPrice; calendar: boolean }> = [];
  if (slice.cheapestVerified !== null)
    rows.push({ key: 'v', label: P.dayVerified, price: slice.cheapestVerified, calendar: false });
  if (slice.cheapestPartiallyVerified !== null)
    rows.push({
      key: 'pv',
      label: P.dayPartlyVerified,
      price: slice.cheapestPartiallyVerified,
      calendar: false,
    });
  if (slice.cheapestCalendar !== null)
    rows.push({ key: 'c', label: P.dayCalendar, price: slice.cheapestCalendar, calendar: true });
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const destination = r.price.cell.destination;
        return (
          <li key={r.key}>
            <span className="text-xs">{r.label}</span>
            <span className="block text-xs">
              {P.dayCell(r.price.cell.nights, formatDayShort(r.price.cell.returnDate))}
            </span>
            <PriceBoundary>
              <PriceCell
                {...figureMarks(r.price)}
                pricePence={r.price.pricePence}
                provenance={r.price.provenance}
                calendar={r.calendar}
                stale={r.price.stale}
                truncated={r.price.truncated}
                destination={destination}
                destinationNote={notes[destination] ?? null}
              />
            </PriceBoundary>
          </li>
        );
      })}
    </ul>
  );
}
