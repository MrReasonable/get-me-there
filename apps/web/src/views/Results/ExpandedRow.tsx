import { effectiveAge, formatFetchedAgo } from '@gmt/core';
import type { ResultRow } from '../../api/types.js';
import { BookingAction, SearchLink } from '../../components/BookingAction.js';
import { ClassBadge } from '../../components/ClassBadge.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell, priceUnconfirmed } from '../../components/PriceCell.js';
import { provenanceConsistent } from '../../components/Provenance.js';
import { VerdictList } from '../../components/VerdictList.js';
import { VerifyCellButton } from '../../components/VerifyCellButton.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatLocalDateTime, formatMinutes } from '../../format.js';
import { useNow } from '../../now.js';

type Segment = NonNullable<ResultRow['outbound']>[number];

function Segments({ segments }: { segments: readonly Segment[] | null }) {
  if (segments === null) return <p>{COPY.noSegments}</p>;
  return (
    <ul>
      {segments.map((s) => (
        <li key={`${s.marketingCarrier}${s.flightNumber}${s.departLocal}`}>
          {COPY.segment(
            s.marketingCarrier,
            s.flightNumber,
            s.from,
            formatLocalDateTime(s.departLocal),
            s.to,
            formatLocalDateTime(s.arriveLocal),
          )}
        </li>
      ))}
    </ul>
  );
}

/** The accessible name of a row: destination and dates. */
export function rowName(row: ResultRow): string {
  return COPY.rowName(
    row.cell.destination,
    formatIsoDate(row.cell.departureDate),
    formatIsoDate(row.cell.returnDate),
  );
}

export interface ExpandedRowProps {
  row: ResultRow;
  /** At 375px the columns that left the primary row are shown here (spec §11). */
  extras: boolean;
  verificationConfigured: boolean;
  definitionId: string;
}

/**
 * Spec §11 expanded row: segments, layovers, baggage, conditions, every verdict, booking, search
 * link, other sellers. One labelled region per row; plain blocks with headings inside (review UI-9).
 */
export function ExpandedRow({ row, extras, verificationConfigured, definitionId }: ExpandedRowProps) {
  const now = useNow();
  const { nights: _nights, ...cellKey } = row.cell;
  const providerId = row.provenance.providerId;
  if (!provenanceConsistent(row.provenance)) {
    return (
      <section aria-label={COPY.detailsFor(rowName(row))} className="p-2 text-sm">
        <p role="alert">{COPY.rowWithheld}</p>
      </section>
    );
  }
  return (
    <section aria-label={COPY.detailsFor(rowName(row))} className="grid gap-3 p-2 text-sm md:grid-cols-2">
      {extras ? (
        <div>
          <h3 className="font-semibold">{COPY.summary}</h3>
          <dl className="grid grid-cols-2 gap-x-2">
            <dt>{COPY.columns.destination}</dt>
            <dd>{row.cell.destination}</dd>
            <dt>{COPY.columns.totalTime}</dt>
            <dd>{row.totalMinutes === null ? COPY.notChecked : formatMinutes(row.totalMinutes)}</dd>
            <dt>{COPY.columns.nights}</dt>
            <dd>{COPY.nightsValue(row.cell.nights)}</dd>
            <dt>{COPY.columns.carriers}</dt>
            <dd>{row.basis === 'calendar' ? COPY.notChecked : row.carriers.join(', ')}</dd>
            <dt>{COPY.columns.fetched}</dt>
            <dd>{formatFetchedAgo(effectiveAge(row.provenance, now))}</dd>
            <dt>{COPY.columns.provider}</dt>
            <dd>{COPY.provider[providerId]}</dd>
            {row.adjustedPence !== null ? (
              <>
                <dt>{COPY.columns.adjusted}</dt>
                <dd>
                  <PriceBoundary>
                    <PriceCell
                      pricePence={row.adjustedPence}
                      provenance={row.provenance}
                      calendar={row.basis === 'calendar'}
                      stale={row.stale}
                      truncated={row.truncated}
                      superseded={row.superseded}
                      unconfirmed={priceUnconfirmed(row)}
                      qualifier={COPY.adjustedQualifier}
                    />
                  </PriceBoundary>
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
      <div>
        <h3 className="font-semibold">{COPY.outbound}</h3>
        <Segments segments={row.outbound} />
      </div>
      <div>
        <h3 className="font-semibold">{COPY.inbound}</h3>
        <Segments segments={row.inbound} />
      </div>
      <div>
        <h3 className="font-semibold">{COPY.layovers}</h3>
        {row.layovers.length === 0 ? (
          <p>{COPY.noLayovers}</p>
        ) : (
          <ul>
            {row.layovers.map((l, i) => (
              <li key={`${l.at}-${i}`}>
                {COPY.layover(l.at, formatMinutes(l.minutes))}
                {l.overnight ? <span className="ml-1 font-semibold">{COPY.overnightLayover}</span> : null}
                {l.airportChange ? <span className="ml-1 font-semibold">{COPY.airportChange}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {row.selfTransfer === true ? <p className="font-semibold">{COPY.selfTransfer}</p> : null}
      </div>
      <div>
        <h3 className="font-semibold">{COPY.baggage}</h3>
        <p>
          {row.baggage?.cabinBag !== undefined ? COPY.cabinBag[row.baggage.cabinBag] : COPY.cabinBagUnknown}
        </p>
        <p>
          {row.baggage?.checkedBags !== undefined
            ? COPY.checkedBags(row.baggage.checkedBags)
            : COPY.checkedBagsUnknown}
        </p>
      </div>
      <div>
        <h3 className="font-semibold">{COPY.conditions}</h3>
        <p>{COPY.refundable(row.fareConditions?.refundable)}</p>
        <p>{COPY.changeable(row.fareConditions?.changeable)}</p>
      </div>
      <div>
        <h3 className="font-semibold">{COPY.verdictsHeading}</h3>
        <VerdictList verdicts={row.verdicts} unverified={row.unverified} />
        {row.notApplied.length > 0 ? (
          <p>{COPY.notApplied(row.notApplied.map((n) => COPY.constraint[n]).join(', '))}</p>
        ) : null}
      </div>
      <div>
        <h3 className="font-semibold">{COPY.booking}</h3>
        {row.seller !== null ? <p>{COPY.seller(row.seller)}</p> : null}
        <BookingAction booking={row.booking} providerId={providerId} />
        <SearchLink link={row.searchLink} providerId={providerId} />
      </div>
      {row.otherOffers.length > 0 ? (
        <div>
          <h3 className="font-semibold">{COPY.otherOffers}</h3>
          <ul aria-label={COPY.otherOffers}>
            {row.otherOffers.map((o, i) => (
              <li key={`${o.seller}-${i}`} className="flex flex-wrap items-center gap-2">
                <span>{COPY.seller(o.seller)}</span>
                <PriceBoundary>
                  <PriceCell
                    pricePence={o.pricePence}
                    provenance={o.provenance}
                    calendar={false}
                    stale={o.stale}
                    notSeenInLatestHours={o.notSeenInLatest?.ageHours ?? null}
                    unconfirmed={priceUnconfirmed(o)}
                  />
                </PriceBoundary>
                <ClassBadge cls={o.verdictClass} />
                {/* why: priceConfirmed is the badge on the price; listing it as "unverified: price not confirmed…" would be a double negative. */}
                {o.unverified.some((n) => n !== 'priceConfirmed') ? (
                  <span>
                    {COPY.unverifiedList(
                      o.unverified
                        .filter((n) => n !== 'priceConfirmed')
                        .map((n) => COPY.constraint[n])
                        .join(', '),
                    )}
                  </span>
                ) : null}
                <BookingAction booking={o.booking} providerId={o.provenance.providerId} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {row.basis === 'calendar' && verificationConfigured ? (
        <div>
          <VerifyCellButton definitionId={definitionId} cell={cellKey} nights={row.cell.nights} />
        </div>
      ) : null}
    </section>
  );
}
