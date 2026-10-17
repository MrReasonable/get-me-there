import { type ConstraintName, effectiveAge, formatAgeFull, type Verdicts } from '@gmt/core';
import { COPY } from '../copy.js';
import { formatPence } from '../format.js';
import { useNow } from '../now.js';
import { assertProvenance, isCalendarPrice, Provenance } from './Provenance.js';

/**
 * True when the final step did not confirm the price (decisions 37, 44): core judges `priceConfirmed`
 * only as `unverified`, so either the verdict or the unverified list says so.
 */
export function priceUnconfirmed(r: { unverified: readonly ConstraintName[]; verdicts?: Verdicts }): boolean {
  return r.unverified.includes('priceConfirmed') || r.verdicts?.priceConfirmed === 'unverified';
}

export interface PriceCellProps {
  pricePence: number;
  /** Validated before anything renders; typed unknown because validation is this component's job. */
  provenance: unknown;
  calendar: boolean;
  stale: boolean;
  /** The price is the cheapest of the rows a truncated tile read (decision 36). */
  truncated?: boolean;
  /** A newer parent search found this cell empty or without data (decision 57): marked, never hidden. */
  superseded?: boolean;
  /** The final step did not confirm the price: the primary badge, beside the amount (decision 44). */
  unconfirmed?: boolean;
  destination?: string | undefined;
  destinationNote?: string | null | undefined;
  /** The row's `notSeenInLatest.ageHours`, when the latest search no longer returned it. */
  notSeenInLatestHours?: number | 'unknown' | null;
  /** A words-only qualifier after the amount, e.g. the adjusted price's "incl. operator-entered onward cost". */
  qualifier?: string;
  /** Beside the wide Results table's columns: the Provider and Destination columns carry those, so the line omits them. */
  besideColumns?: boolean;
  /**
   * Decision 46's compact variant (WP10's calendar day cells): the amount with "≈", a short provider badge,
   * the destination code and the stale, truncated and unconfirmed marks; source words, the age line and the
   * destination note move to the title. WP10 adds props here, never a second price component.
   */
  compact?: boolean;
  /** Headers: the full age form, visible (spec §11). */
  fullAge?: boolean;
}

const badge = 'ml-1 rounded px-1 text-xs font-normal';

/**
 * The only component that prints a price (spec §11, §9 item 6); wrap it in PriceBoundary. The "≈"
 * sits on the amount, so a converted price can never be read as exact. An unconfirmed price says so
 * first; a stale one says "stale"; a price whose vendor age is unknown is labelled, not called stale
 * (decision 44: staleness is by fetch age).
 */
export function PriceCell(props: PriceCellProps) {
  const now = useNow();
  // why: validate before formatting, so a bare number can never reach the DOM even for one frame.
  const p = assertProvenance(props.provenance);
  const age = effectiveAge(p, now);
  const fxTitle = p.fx.converted ? COPY.fxTitle(p.fx.rateDate, p.fx.source) : null;
  const notSeen = props.notSeenInLatestHours ?? null;
  const compact = props.compact === true;
  const calendar = isCalendarPrice(p, props.calendar);
  const detail = [
    COPY.provider[p.providerId],
    COPY.source[p.sourceKind],
    formatAgeFull(age),
    ...(calendar ? [COPY.constraintsNotChecked] : []),
  ];
  return (
    <span
      data-testid="price-cell"
      title={
        compact
          ? [...detail, ...(props.destinationNote ? [props.destinationNote] : [])].join(' · ')
          : undefined
      }
      className={`flex flex-col gap-0.5 ${compact && calendar ? 'rounded border border-dashed border-slate-500 px-1' : ''}`}
    >
      <span className="font-semibold tabular-nums">
        {fxTitle !== null ? (
          <>
            <span aria-hidden="true" title={fxTitle}>
              {COPY.fxApprox}
            </span>
            <span className="sr-only">{COPY.fxSpoken(fxTitle)}</span>
          </>
        ) : null}
        {formatPence(props.pricePence)}
        {props.qualifier !== undefined ? (
          <span className="ml-1 text-xs font-normal">{props.qualifier}</span>
        ) : null}
        {props.unconfirmed === true ? (
          <span className={`${badge} border border-red-800 bg-red-50 font-semibold text-red-900`}>
            {COPY.priceNotConfirmed}
          </span>
        ) : null}
        {props.stale ? <span className={`${badge} bg-amber-200`}>{COPY.stale}</span> : null}
        {age.kind === 'unknown' ? (
          <span className={`${badge} bg-slate-100`}>{COPY.vendorAgeUnknown}</span>
        ) : null}
      </span>
      {compact ? (
        <span className="inline-flex gap-1 text-xs">
          <span className="rounded bg-slate-200 px-1 font-medium">{COPY.providerShort[p.providerId]}</span>
          {props.destination !== undefined ? <span>{props.destination}</span> : null}
        </span>
      ) : (
        <Provenance
          provenance={p}
          calendar={props.calendar}
          destination={props.besideColumns === true ? undefined : props.destination}
          destinationNote={props.destinationNote}
          showProvider={props.besideColumns !== true}
          fullAge={props.fullAge === true}
        />
      )}
      {props.superseded === true ? <span className="text-xs font-medium">{COPY.superseded}</span> : null}
      {props.truncated === true ? <span className="text-xs font-medium">{COPY.truncatedNote}</span> : null}
      {notSeen !== null ? <span className="text-xs">{COPY.notSeenInLatest(COPY.agoOf(notSeen))}</span> : null}
    </span>
  );
}
