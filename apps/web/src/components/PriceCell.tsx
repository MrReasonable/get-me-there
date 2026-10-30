import { effectiveAge, formatAgeFull, formatAgeShort, formatFetchedAgo, sourceLabel } from '@gmt/core';
import { COPY } from '../copy.js';
import { Flaps } from '../flaps/Flaps.js';
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
   * provider's short mark with the destination, the short age ("5d old", "age unknown") and "not checked" on a calendar
   * price, all visible
   * because touch has no hover; the full provider, destination, source, age, note and the marks' words are in the
   * title and in spoken text, so nothing is lost.
   */
  face?: boolean;
  /**
   * The row form's amount on split-flap cells (the departure board): the amount is still written out for readers, and
   * the cells beside it are decorative. `flapSlot` names the board slot the cells flip in (BoardTable).
   */
  flaps?: boolean;
  flapSlot?: string | undefined;
}

// why: a badge is a state tag, a black flap chip carrying its own ink (white, amber or red), so it reads the same on
// steel, on an enamel plate and on a board, and never inherits its surroundings' colour (review ui C1).
const badge = 'tag ml-1';

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
        <span className="figure text-[1.35em]">{formatPence(props.pricePence)}</span>
        {marks.length > 0 ? <span aria-hidden="true">{marks.map((m) => m.glyph).join('')}</span> : null}
        {/* why: provenance visible without hover (spec §11): the provider's short mark and the destination, since touch
        has no title and two destinations would otherwise leave a price without its airport (CodeRabbit batch 3) */}
        <span aria-hidden="true" data-testid="face-provider" className="block font-medium">
          {props.destination === undefined
            ? COPY.providerMark[p.providerId]
            : `${COPY.providerMark[p.providerId]} ${props.destination}`}
        </span>
        {/* why: ruling 3: the age and the unchecked mark on the face; 10px words of at most 7 characters fit 45 px */}
        <span aria-hidden="true" data-testid="face-age" className="block text-[10px] font-normal">
          {/* why: an unknown vendor age says nothing of when the price was fetched, so the fetch age leads (hard rule: fetched time without hover) */}
          {age.kind === 'unknown' ? `${formatFetchedAgo(age)} · ${formatAgeShort(age)}` : formatAgeShort(age)}
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
      <span className="figure inline-flex flex-wrap items-center gap-x-1">
        {fxTitle !== null ? (
          <>
            <span aria-hidden="true" title={fxTitle}>
              {COPY.fxApprox}
            </span>
            <span className="sr-only">{COPY.fxSpoken(fxTitle)}</span>
          </>
        ) : null}
        {props.flaps === true ? (
          <>
            <span className="sr-only">{formatPence(props.pricePence)}</span>
            <Flaps
              text={formatPence(props.pricePence)}
              cells={6}
              align="right"
              slot={props.flapSlot}
              className="price-flaps"
            />
          </>
        ) : (
          formatPence(props.pricePence)
        )}
        {props.qualifier !== undefined ? (
          <span className="ml-1 text-xs font-normal">{props.qualifier}</span>
        ) : null}
        {props.unconfirmed === true ? (
          <span className={`${badge} tag-bad`}>{COPY.priceNotConfirmed}</span>
        ) : null}
        {props.stale ? <span className={`${badge} tag-warn`}>{COPY.stale}</span> : null}
        {age.kind === 'unknown' ? <span className={`${badge} tag-dim`}>{COPY.vendorAgeUnknown}</span> : null}
      </span>
      {compact ? (
        <span className="inline-flex gap-1 text-xs">
          <span className="chip">{COPY.providerShort[p.providerId]}</span>
          {props.destination !== undefined ? <span>{props.destination}</span> : null}
        </span>
      ) : null}
      {/* why: ruling 3: the short age line is always on the face; an unknown vendor age is the badge above, and the line then says when the price was fetched, which no hover is needed to read */}
      {compact ? (
        <span data-testid="face-age" className="text-[11px]">
          {[
            age.kind !== 'unknown' ? formatAgeShort(age) : formatFetchedAgo(age),
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
