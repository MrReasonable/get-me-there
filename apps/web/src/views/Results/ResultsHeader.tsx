import { priceUnconfirmed } from '@gmt/core';
import type { ResultRow, ResultsResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { coverageLineText } from '../../lib/coverageLine.js';
import { isThinCoverage } from '../../lib/thinCoverage.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';

/**
 * Line 1 (spec §11): "cheapest found £X · destination dates · basis · class" with the price through
 * PriceCell, so the headline carries the same "≈", stale, truncated and not-seen marks as the table,
 * the provider badge and the full age form (headers show it, spec §3).
 */
function Headline({ row, overall }: { row: ResultRow; overall: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-start gap-2 text-lg font-semibold ${row.basis === 'calendar' ? 'rounded border border-dashed border-slate-500 px-1' : ''}`}
    >
      <span>{COPY.headlineLead}</span>
      <PriceBoundary>
        <PriceCell
          pricePence={row.pricePence}
          provenance={row.provenance}
          calendar={row.basis === 'calendar'}
          stale={row.stale}
          truncated={row.truncated}
          superseded={row.superseded}
          unconfirmed={priceUnconfirmed(row)}
          destinationNote={row.destinationNote}
          notSeenInLatestHours={row.notSeenInLatest?.ageHours ?? null}
          fullAge
        />
      </PriceBoundary>
      <span>
        {COPY.headlineRest({
          destination: row.cell.destination,
          dates: COPY.dateRange(
            formatIsoDate(row.cell.departureDate),
            formatIsoDate(row.cell.returnDate),
            row.cell.nights,
          ),
          basis: COPY.basisName[row.basis],
          cls: COPY.classLabel[row.verdictClass],
        })}
      </span>
      {overall ? <span className="font-normal italic">{COPY.headlineOverall}</span> : null}
    </div>
  );
}

export interface ResultsHeaderProps {
  data: ResultsResponse;
  /** The first row of the filtered set in server order (decision 36); null when the filters leave none. */
  filteredFirst: ResultRow | null;
}

/** Spec §11: the two-line Results header, plus the truncation and current-space notes. */
export function ResultsHeader({ data, filteredFirst }: ResultsHeaderProps) {
  // why: the headline follows what the operator is looking at; when the filters leave nothing, the API's
  // overall cheapest is shown and labelled as such, never passed off as matching the filters.
  const headline = filteredFirst ?? data.cheapest;
  const overall = filteredFirst === null && data.cheapest !== null;
  const c = data.coverage;
  const b = c.buckets;
  const line2 = coverageLineText(
    c,
    data.verificationProviderConfigured,
    data.executions.find((e) => !e.isChild),
  );
  return (
    <div className="space-y-1">
      {headline !== null ? (
        <Headline row={headline} overall={overall} />
      ) : (
        <p className="text-lg font-semibold">{COPY.noHeadline}</p>
      )}
      <p className="text-sm">
        <a
          href={hrefWith({ view: 'coverage' })}
          onClick={navigateTo({ view: 'coverage' })}
          className="underline"
        >
          {line2}
        </a>
      </p>
      {isThinCoverage(b.no_data, c.total) ? <p className="text-sm">{COPY.thinCoverage}</p> : null}
      {data.truncated ? <p className="text-sm">{COPY.truncated(data.rows.length, data.total)}</p> : null}
      {data.excludedByCurrentSpace > 0 ? (
        <p className="text-sm">{COPY.excludedByCurrentSpace(data.excludedByCurrentSpace)}</p>
      ) : null}
    </div>
  );
}
