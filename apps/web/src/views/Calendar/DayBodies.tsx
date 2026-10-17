import type { Iata } from '@gmt/core';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatIsoDateShort } from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import { CoverageCue } from './CoverageCue.js';
import type { DayDisplay, Glyph } from './display.js';
import { coverageOf, showsUnconfirmed } from './marker.js';
import type { DaySlice } from './types.js';

export function DayBody(props: {
  display: DayDisplay;
  slice: DaySlice;
  notes: Partial<Record<Iata, string>>;
}) {
  const { display, slice, notes } = props;
  if (display.kind === 'price') return <DayPriceBlock display={display} slice={slice} notes={notes} />;
  const C = COPY.calendarView;
  return (
    <span className="block text-[11px]">
      <Unconfirmed slice={slice} />
      <GlyphList glyphs={display.glyphs} />
      {display.reason === 'no-run' ? <span className="block">{C.noRunCoversDay}</span> : null}
      {display.reason === 'no-provider' ? <span className="block">{C.noDiscoveryProvider}</span> : null}
      {display.reason === 'inconsistent' ? <span className="block">{C.countsInconsistent}</span> : null}
      {/* why: ui-r2-003, ruling 4: a grey day's glyph counts are its buckets, so it needs no second cue */}
    </span>
  );
}

/**
 * The phone face (plan decision 52, review ui-r2-001): at 375 px a column is about 45 px, so a day shows its number and
 * band, the amount through PriceCell's `face` (marks as single glyphs, the provider mark with the destination, the short
 * age and "not checked" visible, words in its title and spoken text) or the
 * glyphs of a priceless day, and one-glyph marks for "price not confirmed" and partial coverage. Stay, provider,
 * "cached from" and the counts are in the panel, one tap away.
 */
export function PhoneDayBody(props: {
  display: DayDisplay;
  slice: DaySlice;
  notes: Partial<Record<Iata, string>>;
}) {
  const { display, slice, notes } = props;
  const C = COPY.calendarView;
  const coverage = coverageOf(slice);
  const partial = coverage.kind === 'fraction' && coverage.searched < coverage.total;
  const inconsistent = coverage.kind === 'inconsistent';
  const unconfirmed = showsUnconfirmed(slice);
  const marks = (
    <>
      {unconfirmed ? (
        <span data-testid="day-unconfirmed">
          <span aria-hidden="true">{COPY.priceMarkGlyph.unconfirmed}</span>
          <span className="sr-only">{C.unconfirmedShort}</span>
        </span>
      ) : null}
      {inconsistent ? (
        <span data-coverage="inconsistent">
          <span aria-hidden="true">{C.phoneMark.inconsistent}</span>
          <span className="sr-only">{C.countsInconsistent}</span>
        </span>
      ) : null}
      {partial ? (
        <span data-coverage="partial">
          <span aria-hidden="true">{C.phoneMark.partial}</span>
          <span className="sr-only">{C.phonePartial}</span>
        </span>
      ) : null}
    </>
  );
  if (display.kind === 'price') {
    const p = display.price;
    return (
      <span data-testid="day-price-face" className="block min-w-0 text-[11px]">
        <span className="sr-only">
          {display.basis === 'calendar' ? C.calendarPrice : COPY.classLabel.verified}
        </span>
        <PriceBoundary>
          <PriceCell
            face
            {...figureMarks(p)}
            pricePence={p.pricePence}
            provenance={p.provenance}
            calendar={display.basis === 'calendar'}
            stale={display.stale}
            truncated={p.truncated}
            destination={p.cell.destination}
            destinationNote={notes[p.cell.destination] ?? null}
          />
        </PriceBoundary>
        {/* why: the stay's night count is on the face (decision 38); the dates are in the panel */}
        <span data-testid="day-nights" className="block">
          {C.phoneNights(p.cell.nights)} {marks}
        </span>
      </span>
    );
  }
  return (
    <span className="block min-w-0 text-[11px]">
      {display.glyphs.map((g) => (
        <span key={g.status} data-glyph={g.status}>
          {/* why: UI-007: the legend promises counts, so the count is visible beside the glyph, not only spoken */}
          <span aria-hidden="true" className="font-bold">
            {C.glyphSymbol[g.status]}
          </span>
          {g.count === null ? null : <span data-glyph-count="">{g.count}</span>}
          <span className="sr-only">{g.count === null ? glyphWords(g) : ` ${COPY.bucket[g.status]}`}</span>
        </span>
      ))}
      {display.reason === 'no-provider' ? <span className="sr-only">{C.noDiscoveryProvider}</span> : null}
      <span className="block">{marks}</span>
    </span>
  );
}

/**
 * The day's price in WP9's PriceCell compact form (decisions 36, 38, ruling 3 of decision 67): the amount with "≈", a
 * short provider badge, the destination code, the stale, truncated and unconfirmed marks and the short age line with
 * "not checked" on a calendar price, visible without hover; source words, the full age and the note in its title; then
 * the stay, any cheaper cached fare with its own destination and stay (decision 52) and the coverage cue. Everything
 * else is in the side panel. A price without provenance is withheld (spec §9 item 6).
 */
function DayPriceBlock(props: {
  display: Extract<DayDisplay, { kind: 'price' }>;
  slice: DaySlice;
  notes: Partial<Record<Iata, string>>;
}) {
  const { display, slice, notes } = props;
  const C = COPY.calendarView;
  const p = display.price;
  const isCalendar = display.basis === 'calendar';
  const cached = display.cheaperCached;
  return (
    <span data-testid="day-price-block" className="flex flex-col gap-0.5 text-xs">
      <span className="sr-only">{isCalendar ? C.calendarPrice : COPY.classLabel.verified}</span>
      <Unconfirmed slice={slice} />
      <PriceBoundary>
        <PriceCell
          compact
          {...figureMarks(p)}
          pricePence={p.pricePence}
          provenance={p.provenance}
          calendar={isCalendar}
          stale={display.stale}
          truncated={p.truncated}
          destination={p.cell.destination}
          destinationNote={notes[p.cell.destination] ?? null}
        />
      </PriceBoundary>
      <span data-testid="day-stay" className="block text-[11px]">
        {C.stay(p.cell.nights, formatIsoDateShort(p.cell.returnDate))}
      </span>
      {cached !== null ? (
        <span data-testid="cached-from" className="block text-[11px]">
          <span>{C.cachedFrom}</span>
          <PriceBoundary>
            <PriceCell
              compact
              {...figureMarks(cached)}
              pricePence={cached.pricePence}
              provenance={cached.provenance}
              calendar
              stale={cached.stale}
              truncated={cached.truncated}
              destination={cached.cell.destination}
              destinationNote={notes[cached.cell.destination] ?? null}
            />
          </PriceBoundary>
          <span className="block">
            {C.stay(cached.cell.nights, formatIsoDateShort(cached.cell.returnDate))}
          </span>
        </span>
      ) : null}
      <CoverageCue coverage={coverageOf(slice)} />
    </span>
  );
}

/**
 * Decision 48: a day whose itinerary search priced cells but confirmed no price says "price not confirmed", so it never
 * reads as "nothing found" or as a confirmed fare. Only when the day shows no class-verified price; under a filter the
 * api counts that destination's cells only (decisions 51, 53; review prov-r2-004).
 */
function Unconfirmed({ slice }: { slice: DaySlice }) {
  if (!showsUnconfirmed(slice)) return null;
  return (
    <span data-testid="day-unconfirmed" className="block text-[11px] font-semibold">
      {COPY.calendarView.unconfirmedShort}
    </span>
  );
}

/** "47 not searched": the glyph's words with its count when one is known. */
function glyphWords(g: Glyph): string {
  return g.count === null
    ? COPY.bucket[g.status]
    : COPY.calendarView.glyphCount(g.count, COPY.bucket[g.status]);
}

function GlyphList({ glyphs }: { glyphs: readonly Glyph[] }) {
  if (glyphs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {glyphs.map((g) => (
        <span key={g.status} data-glyph={g.status}>
          <span aria-hidden="true" className="font-bold">
            {COPY.calendarView.glyphSymbol[g.status]}
          </span>{' '}
          {glyphWords(g)}
        </span>
      ))}
    </span>
  );
}
