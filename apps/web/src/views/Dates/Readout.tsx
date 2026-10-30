import type { DatePair } from '@gmt/core';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { detailHref, detailPatch } from '../../state/datesState.js';
import { navigateTo } from '../../state/urlState.js';
import { CheaperCached, FigurePrice } from './BoardCard.js';
import { howFarChecked } from './howFar.js';
import type { CellView } from './OverviewMonth.js';

const O = COPY.datesView.overview;
const M = COPY.datesView.marks;

/** A cell's dates for its accessible name: a single date pair's two dates, or a band's departure day. */
export function cellWords(
  date: string,
  column: { from: number; to: number },
  model: { pairs: readonly DatePair[] },
): string {
  const single = column.from === column.to ? model.pairs[0] : undefined;
  return single !== undefined
    ? `${formatIsoDate(single.departureDate)}–${formatIsoDate(single.returnDate)}`
    : O.bandDates(formatIsoDate(date));
}

/** A cell's dates and stay in the readout: a date pair's dates and nights, or a band's departure day and stays. */
export function cellDates(c: Pick<CellView, 'date' | 'column' | 'model'>): string {
  const single = c.column.from === c.column.to ? c.model.pairs[0] : undefined;
  return single !== undefined
    ? COPY.dateRange(formatIsoDate(single.departureDate), formatIsoDate(single.returnDate), single.nights)
    : `${O.bandDates(formatIsoDate(c.date))}, ${O.stay(c.column.from, c.column.to)}`;
}

/**
 * Spec §11 Overview "Readout": the cell under the pointer or the focus, in one line beside the legend: its dates and
 * nights; the figure through PriceCell's row form (point of sale in words, "≈" on a converted price, "not checked"
 * on a calendar price) with how far checked ("cheapest of the rows read" on a truncated figure) and airports; or its
 * marks with their counts by bucket. It is every cell's `aria-describedby`, so an amount is read only from PriceCell.
 * Its "Open these dates" link is the touch path to the detail (revision 50).
 */
export function Readout({
  id,
  cell,
  airportPairs,
  journeyLimit,
  notes,
}: {
  id: string;
  cell: CellView | null;
  airportPairs: number;
  journeyLimit: number | null;
  notes: DefinitionResponse['destinationNotes'];
}) {
  const lead = cell?.model.lead ?? null;
  const f = lead?.figure ?? null;
  return (
    <section
      aria-label={O.readoutLabel}
      aria-live="polite"
      className="ov-readout flex min-h-11 flex-wrap items-center gap-2 text-[13px]"
    >
      <span id={id} className="flex flex-wrap items-center gap-2" data-testid="dates-readout">
        {cell === null ? (
          O.readoutEmpty
        ) : (
          <>
            <span className="font-bold text-fg">{cellDates(cell)}</span>
            {lead !== null && f !== null ? (
              <>
                <FigurePrice figure={f} notes={notes} />
                <CheaperCached figure={f} notes={notes} />
                <span>{howFarChecked(lead, airportPairs, journeyLimit).join(' · ')}</span>
                <span>{COPY.datesView.airports(f.origin, f.destination)}</span>
              </>
            ) : (
              <>
                <span>{cell.model.marks.map((m) => M.words[m]).join(' · ') || O.noMark}</span>
                {/* why: a date pair's own counts say how far it was checked; a band's are summed by bucket */}
                {cell.model.pairs.length === 1 && cell.model.pairs[0] !== undefined ? (
                  <span>{howFarChecked(cell.model.pairs[0], airportPairs, journeyLimit).join(' · ')}</span>
                ) : (
                  <span>{O.buckets(COPY.bucketBreakdown(cell.model.buckets))}</span>
                )}
              </>
            )}
          </>
        )}
      </span>
      {cell !== null && cell.column.from === cell.column.to && cell.model.pairs[0] !== undefined ? (
        <a
          href={detailHref(cell.model.pairs[0])}
          onClick={navigateTo(detailPatch(cell.model.pairs[0]))}
          className="link"
        >
          {O.openThese}
        </a>
      ) : null}
    </section>
  );
}
