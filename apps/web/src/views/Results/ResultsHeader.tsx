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
      data-testid="detail-headline"
      className={`detail-headline flex flex-wrap items-start gap-x-2 gap-y-1 ${row.basis === 'calendar' ? 'rounded border border-dashed border-line-strong px-2 py-1' : ''}`}
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
      {overall ? <span className="font-normal italic text-fg-2">{COPY.headlineOverall}</span> : null}
    </div>
  );
}

type BoardFigureData = NonNullable<ResultsResponse['datePairFigure']>;

/**
 * Whether the board's figure for this date pair is another price than the detail's cheapest row (revision 50): another
 * amount, basis, airport pair or provider. The board prefers a price the latest search returned, then a fresh one, so
 * a cheaper row the latest search no longer returned leads here while the board shows the current one.
 */
function figureDiffers(figure: BoardFigureData, cheapest: ResultRow | null): boolean {
  return (
    cheapest === null ||
    figure.price.pricePence !== cheapest.pricePence ||
    figure.basis !== cheapest.basis ||
    figure.origin !== cheapest.cell.origin ||
    figure.destination !== cheapest.cell.destination ||
    figure.price.provenance.providerId !== cheapest.provenance.providerId
  );
}

/** "Dates board price: £X · <airport pair> · <basis>" through PriceCell, and why it differs (spec §11, revision 50). */
function BoardFigure({ figure }: { figure: BoardFigureData }) {
  const D = COPY.detailView;
  return (
    <div
      data-testid="board-figure"
      className={`flex flex-wrap items-start gap-x-2 gap-y-1 text-sm ${figure.basis === 'calendar' ? 'rounded border border-dashed border-line-strong px-2 py-1' : ''}`}
    >
      <span>{D.boardPriceLead}</span>
      <PriceBoundary>
        <PriceCell
          pricePence={figure.price.pricePence}
          provenance={figure.price.provenance}
          calendar={figure.basis === 'calendar'}
          stale={figure.price.stale}
          truncated={figure.price.truncated}
          superseded={figure.superseded}
          destination={figure.destination}
          notSeenInLatestHours={figure.notSeenInLatest?.ageHours ?? null}
        />
      </PriceBoundary>
      <span>
        {D.boardPriceRest(
          COPY.datesView.airports(figure.origin, figure.destination),
          COPY.basisName[figure.basis],
        )}
      </span>
      <span className="w-full text-fg-2">{D.boardDiffers}</span>
    </div>
  );
}

export interface ResultsHeaderProps {
  data: ResultsResponse;
  /** The first row of the filtered set in server order (decision 36); null when the filters leave none. */
  filteredFirst: ResultRow | null;
  /** Where the coverage line links: the Dates view's coverage section (spec §11 Date pair detail). */
  coveragePatch: Record<string, string | null>;
}

/**
 * Spec §11 Date pair detail: the headline, the board's figure when it is not the cheapest row (revision 50), and the
 * coverage line over the date pair's cells; then the thin-coverage, truncation and current-space notes.
 */
export function ResultsHeader({ data, filteredFirst, coveragePatch }: ResultsHeaderProps) {
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
    <div className="space-y-1.5">
      {headline !== null ? (
        <Headline row={headline} overall={overall} />
      ) : (
        <p className="detail-headline">{COPY.noHeadline}</p>
      )}
      {data.datePairFigure !== null && figureDiffers(data.datePairFigure, data.cheapest) ? (
        <BoardFigure figure={data.datePairFigure} />
      ) : null}
      <p className="text-sm">
        <a
          href={hrefWith(coveragePatch)}
          onClick={navigateTo(coveragePatch)}
          className="text-fg-2 underline decoration-1 underline-offset-4"
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
