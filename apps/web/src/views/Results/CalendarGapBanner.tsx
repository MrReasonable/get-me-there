import { cellKeyString } from '@gmt/core';
import { useCalendarGap, useExecutionActions } from '../../api/queries.js';
import { LoadError } from '../../components/LoadState.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';

/**
 * Spec §11: "N cells have calendar prices below your cheapest verified (£X)" with per-cell verify.
 * Rendered only when the results response says a verification provider is configured, so the
 * query never runs on the £0 configuration. Every price renders through PriceCell. A failed fetch
 * says so in the banner's place rather than looking like "no gap" (review prov-019).
 */
export function CalendarGapBanner({ definitionId }: { definitionId: string }) {
  const gap = useCalendarGap(definitionId, true);
  const actions = useExecutionActions();
  if (gap.error) return <LoadError error={gap.error} retry={() => void gap.refetch()} />;
  const data = gap.data;
  if (data === undefined || data.cells.length === 0 || data.cheapestVerified === null) return null;
  const cv = data.cheapestVerified;
  // why: no unconfirmed badge on these prices. cheapestVerified is chosen from class-verified rows only (WP8),
  // and a price the final step did not confirm is never class verified (decision 37); the calendar prices are
  // discovery prices, which carry the calendar marker instead. Should the selection rule change, the gap contract
  // must carry the unverified names and this PriceCell must pass `unconfirmed` (review prov-wp09-r3-002).
  return (
    <section
      aria-label={COPY.calendarGapList}
      className="rounded border border-amber-700 bg-amber-50 p-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span>{COPY.calendarGapLead(data.cells.length)}</span>
        <PriceBoundary>
          <PriceCell
            pricePence={cv.pricePence}
            provenance={cv.provenance}
            calendar={false}
            stale={cv.stale}
            truncated={cv.truncated}
            destination={cv.cell.destination}
            notSeenInLatestHours={cv.notSeenInLatest?.ageHours ?? null}
          />
        </PriceBoundary>
      </div>
      <ul className="mt-1 space-y-1">
        {data.cells.map((c) => {
          const { nights, ...key } = c.cell;
          return (
            <li key={cellKeyString(key)} className="flex flex-wrap items-center gap-2">
              <span>
                {COPY.coverageCheckPair(c.cell.origin, c.cell.destination)}{' '}
                {COPY.dateRange(
                  formatIsoDate(c.cell.departureDate),
                  formatIsoDate(c.cell.returnDate),
                  nights,
                )}
              </span>
              <PriceBoundary>
                <PriceCell
                  pricePence={c.calendar.pricePence}
                  provenance={c.calendar.provenance}
                  calendar
                  stale={c.calendar.stale}
                  truncated={c.calendar.truncated}
                  destination={c.cell.destination}
                />
              </PriceBoundary>
              {c.verifyAvailable ? (
                <button
                  type="button"
                  className="min-h-11 rounded border border-slate-500 px-3"
                  onClick={() => actions.verify.mutate({ definitionId, cell: key })}
                >
                  {COPY.verifyCell}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {actions.verify.isSuccess ? <p role="status">{COPY.verifyStarted}</p> : null}
      {actions.verify.error ? <p role="alert">{COPY.actionFailed(actions.verify.error.message)}</p> : null}
    </section>
  );
}
