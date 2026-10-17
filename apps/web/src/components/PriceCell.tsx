import { effectiveAge, formatAgeFull, formatAgeShort, sourceLabel } from '@gmt/core';
import { COPY } from '../copy.js';
import { formatPence } from '../format.js';
import { useNow } from '../now.js';
import { assertProvenance, isCalendarPrice, Provenance } from './Provenance.js';

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
   * The compact variant (WP10's calendar day cells): the amount with "≈", a short provider badge, the destination code,
   * the stale, truncated and unconfirmed marks and, visible without hover (spec §11, ruling 3, overruling decision 46),
   * a short age line ("5d old") with "not checked" on a calendar price; the source words, the full age and the
   * destination note are also in the title. WP10 adds props here, never a second price component.
   */
  compact?: boolean;
  /** Headers: the full age form, visible (spec §11). */
  fullAge?: boolean;
  /**
   * WP10's phone day-cell face (plan decision 52, ruling 3): the amount with "≈", each mark as one glyph, the
   * provider's short mark, the short age ("5d old", "age unknown") and "not checked" on a calendar price, all visible
   * because touch has no hover; the full provider, destination, source, age, note and the marks' words are in the
   * title and in spoken text, so nothing is lost.
   */
  face?: boolean;
}

// why: a badge sits on its own pale fill, so it names its text colour; inside a dark calendar band it would otherwise
// inherit the band's white text (white on slate-200 is about 1.2:1; review ui C1).
const badge = 'ml-1 rounded px-1 text-xs font-normal text-slate-900';

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
    sourceLabel(p),
    formatAgeFull(age),
    ...(calendar ? [COPY.constraintsNotChecked] : []),
  ];
  if (props.face === true) {
    const G = COPY.priceMarkGlyph;
    const marks = [
      ...(props.unconfirmed === true ? [{ glyph: G.unconfirmed, words: COPY.priceNotConfirmed }] : []),
      ...(props.stale ? [{ glyph: G.stale, words: COPY.stale }] : []),
      ...(props.truncated === true ? [{ glyph: G.truncated, words: COPY.truncatedNote }] : []),
      ...(props.superseded === true ? [{ glyph: G.superseded, words: COPY.superseded }] : []),
      ...(notSeen !== null ? [{ glyph: G.notSeen, words: COPY.notSeenInLatest(COPY.agoOf(notSeen)) }] : []),
    ];
    const spoken = [
      ...marks.map((m) => m.words),
      ...detail,
      ...(props.destination !== undefined ? [props.destination] : []),
      ...(props.destinationNote ? [props.destinationNote] : []),
    ].join(' · ');
    return (
      <span
        data-testid="price-cell"
        data-face
        title={spoken}
        className={`block min-w-0 text-[11px] font-semibold tabular-nums ${calendar ? 'rounded border border-dashed border-current' : ''}`}
      >
        {fxTitle !== null ? (
          <>
            <span aria-hidden="true">{COPY.fxApprox}</span>
            <span className="sr-only">{COPY.fxSpoken(fxTitle)}</span>
          </>
        ) : null}
        {formatPence(props.pricePence)}
        {marks.length > 0 ? <span aria-hidden="true">{marks.map((m) => m.glyph).join('')}</span> : null}
        {/* why: provenance visible without hover (spec §11): the provider's short mark, since touch has no title */}
        <span aria-hidden="true" className="block font-medium">
          {COPY.providerMark[p.providerId]}
        </span>
        {/* why: ruling 3: the age and the unchecked mark on the face; 10px words of at most 7 characters fit 45 px */}
        <span aria-hidden="true" data-testid="face-age" className="block text-[10px] font-normal">
          {formatAgeShort(age)}
        </span>
        {calendar ? (
          <span aria-hidden="true" data-testid="face-unchecked" className="block text-[10px] font-normal">
            {COPY.notChecked}
          </span>
        ) : null}
        <span className="sr-only">{spoken}</span>
      </span>
    );
  }
  return (
    <span
      data-testid="price-cell"
      title={
        compact
          ? [...detail, ...(props.destinationNote ? [props.destinationNote] : [])].join(' · ')
          : undefined
      }
      className={`flex flex-col gap-0.5 ${compact && calendar ? 'rounded border border-dashed border-current px-1' : ''}`}
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
          <span className="rounded bg-slate-200 px-1 font-medium text-slate-900">
            {COPY.providerShort[p.providerId]}
          </span>
          {props.destination !== undefined ? <span>{props.destination}</span> : null}
        </span>
      ) : null}
      {/* why: ruling 3: an unknown age is already the visible badge above; any other age is a short line on the face */}
      {compact && (age.kind !== 'unknown' || calendar) ? (
        <span data-testid="face-age" className="text-[11px]">
          {[
            ...(age.kind !== 'unknown' ? [formatAgeShort(age)] : []),
            ...(calendar ? [COPY.notChecked] : []),
          ].join(' · ')}
        </span>
      ) : null}
      {compact ? null : (
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
