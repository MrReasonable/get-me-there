import {
  type IsoDateTime,
  mainPathSource,
  type PriceLabelKind,
  priceLabelKind,
  stopDetailClause,
} from '@gmt/core';
import { type ReactNode, useState } from 'react';
import type { PriceCellData, TripResponse } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { LOG_SHOWN, logSince, logWhen } from './model.js';

const T = COPY.trip;
const F = COPY.flights;

type LogRow = TripResponse['log'][number];

/** A log price, and with each source shown its label and where it came from ("(Seller, the browser worker)"). */
function LogPrice({
  price,
  kind,
  sources,
}: {
  price: PriceCellData;
  kind: PriceLabelKind;
  sources: boolean;
}) {
  return (
    <>
      <PriceBoundary>
        <PriceCell
          pricePence={price.pricePence}
          provenance={price.provenance}
          calendar={false}
          stale={price.stale}
          bare
        />
      </PriceBoundary>
      {sources ? (
        <span className="trip-log-source">
          {' '}
          {T.logSourceOf(T.label[kind], mainPathSource(price.provenance.providerId))}
        </span>
      ) : null}
    </>
  );
}

/** What a row's flight read found, in the log's words; a trip with its price and seller. */
function flightsPart(row: LogRow, sources: boolean): ReactNode {
  const f = row.flights;
  switch (f.kind) {
    case 'trip':
      return (
        <>
          {T.logFlights}{' '}
          <LogPrice
            price={f.price}
            kind={priceLabelKind({ kind: 'pairing', pairingKind: f.pairingKind }, false)}
            sources={sources}
          />
          {f.seller === null ? null : <> {f.seller}</>}
        </>
      );
    case 'failed':
      return T.logFailed(stopDetailClause(f.cause, 'camoufox', true));
    case 'outbound-only':
      return T.logOutboundOnly;
    case 'no-return':
      return T.logNoReturn;
    case 'none-within':
      return T.logNoneWithin;
    case 'other-limits':
      return T.logOtherLimits;
    case 'not-read':
      return T.logNotRead;
  }
}

/** One row: "Today 16:40 · calendar £388 · flights £412 Kiwi.com"; a read by hand says so in place of the calendar. */
function Row({ row, now, sources }: { row: LogRow; now: IsoDateTime; sources: boolean }) {
  const c = row.calendar;
  return (
    <li data-testid="log-row">
      {logWhen(row.at, now)}
      {row.byHand ? (
        <>
          {F.separator}
          {T.logByHand}
        </>
      ) : c === null ? null : (
        <>
          {F.separator}
          {T.logCalendar}{' '}
          <LogPrice
            price={c}
            kind={priceLabelKind({ kind: 'calendar', providerId: c.provenance.providerId }, false)}
            sources={sources}
          />
        </>
      )}
      {F.separator}
      {flightsPart(row, sources)}
    </li>
  );
}

/**
 * Design 2026-11-08 §6.1 "Search log for these dates", one click down: one row per run that touched these dates and per
 * read by hand, newest first, five shown; "Show all N, with each source" shows every row with each price's label and
 * source. Why a run didn't read the dates' flights isn't recorded, so it says "flights not read" and never guesses.
 */
export function SearchLog({ log, now }: { log: TripResponse['log']; now: IsoDateTime }) {
  const [all, setAll] = useState(false);
  const since = logSince(log);
  const rows = all ? log : log.slice(0, LOG_SHOWN);
  return (
    <details className="trip-fold" data-testid="search-log">
      <summary>
        <span>
          {T.logSummary}{' '}
          <span className="trip-fold-sub">{since === null ? T.logNone : T.logCount(log.length, since)}</span>
        </span>
      </summary>
      {log.length > 0 ? (
        <div className="trip-fold-body">
          <ul className="trip-log">
            {rows.map((row, i) => (
              <Row key={`${row.at}-${i}`} row={row} now={now} sources={all} />
            ))}
          </ul>
          <button type="button" className="trip-btn trip-btn-quiet" onClick={() => setAll(!all)}>
            {all ? T.logShowFewer : T.logShowAll(log.length)}
          </button>
        </div>
      ) : null}
    </details>
  );
}
