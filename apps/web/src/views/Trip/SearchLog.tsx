import {
  type IsoDateTime,
  mainPathSource,
  type PriceLabelKind,
  priceLabelKind,
  stopDetailClause,
} from '@gmt/core';
import { type ReactNode, useState } from 'react';
import type { PriceCellData, TripResponse } from '../../api/types.js';
import { PriceLabel } from '../../components/PriceLabel.js';
import { COPY } from '../../copy.js';
import { labelDetail } from '../../lib/figureLabel.js';
import { Amount } from './Amount.js';
import { LOG_SHOWN, logSince, logWhen } from './model.js';

const T = COPY.trip;
const F = COPY.flights;

type LogRow = TripResponse['log'][number];

/**
 * A log price with its one label beside it (`Kind · age`, amber when the wire marks it stale, its detail one tap down:
 * CodeRabbit PR #58 finding 16, a price never stands without its label), and with each source shown where it came
 * from ("(the browser worker)").
 */
function LogPrice({
  price,
  kind,
  detail,
  sources,
}: {
  price: PriceCellData;
  kind: PriceLabelKind;
  detail: string;
  sources: boolean;
}) {
  return (
    <>
      <Amount price={price} />{' '}
      <PriceLabel
        kind={kind}
        ageHours={price.ageHours}
        stale={price.stale}
        provenance={price.provenance}
        detail={detail}
      />
      {sources ? (
        <span className="trip-log-source"> {T.logSourceOf(mainPathSource(price.provenance.providerId))}</span>
      ) : null}
    </>
  );
}

/** What a row's flight read found, in the log's words; a trip with its price and seller. */
function flightsPart(row: LogRow, sources: boolean): ReactNode {
  const f = row.flights;
  switch (f.kind) {
    case 'trip': {
      const kind = priceLabelKind({ kind: 'pairing', pairingKind: f.pairingKind }, false);
      return (
        <>
          {T.logFlights}{' '}
          <LogPrice
            price={f.price}
            kind={kind}
            // why: the log keeps a seller's name but not how many were read, so its detail names the seller alone
            detail={
              kind === 'seller' && f.seller !== null
                ? T.labelDetail.sellerNamed(f.seller)
                : labelDetail(kind, null, f.pairingKind)
            }
            sources={sources}
          />
          {f.seller === null ? null : <> {f.seller}</>}
        </>
      );
    }
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
  const calendarKind =
    c === null ? null : priceLabelKind({ kind: 'calendar', providerId: c.provenance.providerId }, false);
  return (
    <li data-testid="log-row">
      {logWhen(row.at, now)}
      {row.byHand ? (
        <>
          {F.separator}
          {T.logByHand}
        </>
      ) : calendarKind === null || c === null ? null : (
        <>
          {F.separator}
          {T.logCalendar}{' '}
          <LogPrice
            price={c}
            kind={calendarKind}
            detail={labelDetail(calendarKind, null)}
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
