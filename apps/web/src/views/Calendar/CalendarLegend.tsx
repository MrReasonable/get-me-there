import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';
import { GLYPH_ORDER } from './display.js';
import type { CalendarModel } from './model.js';
import { BAND_CLASSES, FLAT_CLASS, MIN_BANDED_DAYS, PRICELESS_CLASS } from './scale.js';
import type { DayBasis } from './types.js';

/**
 * Numeric legend (spec §11 View B): the basis on the scale and how it is banded (or why it is flat), each band's pence
 * range and day count, the hatched days, the dashed outline and the glyphs stay open; the explanations of the marks (stale,
 * coverage cue, "cached from", "cheapest of the rows read", the stay, the band number and the phone glyphs) fold into "What the marks mean" (review ui-r2-006), so a phone reaches the grid soon.
 * `data-scale` marks the legend's scale values (the band items and a flat range), never the whole legend: the one
 * exemption the rendered sweep grants (plan decision 52).
 */
export function CalendarLegend({ model }: { model: CalendarModel }) {
  const C = COPY.calendarView;
  const L = C.legend;
  const other: DayBasis = model.colourBasis === 'verified' ? 'calendar' : 'verified';
  const basis = COPY.basisName[model.colourBasis];
  const s = model.scale;
  const range =
    s.minPence !== null && s.maxPence !== null ? [formatPence(s.minPence), formatPence(s.maxPence)] : null;
  return (
    <section aria-label={L.title} data-testid="calendar-legend" className="flex flex-col gap-1 text-sm">
      {/* why: data-scale marks the scale values only, the flat range here and the band items below, so the sweep's
      exemption never covers the legend's explanations or a fare (plan decision 52, CodeRabbit batch 3) */}
      <p {...(s.mode === 'flat-narrow' && range !== null ? { 'data-scale': '' } : {})}>
        {s.mode === 'quintile'
          ? L.scaleQuintile(basis, s.count)
          : s.mode === 'flat-few'
            ? L.scaleFlatFew(basis, s.count, MIN_BANDED_DAYS)
            : s.mode === 'flat-narrow' && range !== null
              ? L.scaleFlatNarrow(basis, s.count, range[0] ?? '', range[1] ?? '')
              : L.scaleEmpty(basis)}
      </p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {s.legend.map((e) => (
          <li key={e.band} data-scale>
            <span
              aria-hidden="true"
              className={`mr-1 inline-block h-3 w-3 align-middle ${BAND_CLASSES[e.band]}`}
            />
            {L.band(e.band, formatPence(e.minPence), formatPence(e.maxPence), e.count)}
          </li>
        ))}
        {s.mode === 'flat-few' || s.mode === 'flat-narrow' ? (
          <li>
            <span aria-hidden="true" className={`mr-1 inline-block h-3 w-3 align-middle ${FLAT_CLASS}`} />
            {L.flatSwatch(s.count)}
          </li>
        ) : null}
        {model.hatchedDays > 0 ? (
          <li>
            <span aria-hidden="true" className="day-hatched mr-1 inline-block h-3 w-3 align-middle" />
            {L.hatched(other, model.hatchedDays)}
          </li>
        ) : null}
        <li>
          <span aria-hidden="true" className={`mr-1 inline-block h-3 w-3 align-middle ${PRICELESS_CLASS}`} />
          {L.priceless}
        </li>
      </ul>
      {/* why: UI-F3: the dashed outline is the face's "constraints not checked" cue, so its key is never folded away */}
      <p>{L.dashed}</p>
      <p>{L.glyphs}</p>
      <ul className="flex flex-wrap gap-x-4">
        {GLYPH_ORDER.map((g) => (
          <li key={g}>
            <span aria-hidden="true">{C.glyphSymbol[g]}</span> {COPY.bucket[g]}
            {g === 'skipped' ? <span>{L.skippedWhy}</span> : null}
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer">{L.more}</summary>
        <ul className="flex flex-col gap-0.5">
          <li>{L.stale}</li>
          <li>
            <span aria-hidden="true" className="cov-swatch cov-partial mr-1 align-middle" />
            {L.coveragePartial}
          </li>
          <li>{L.cachedFrom}</li>
          <li>{L.unconfirmed}</li>
          <li>{L.truncated}</li>
          <li>{L.stay}</li>
          <li>{L.bandNumber}</li>
          <li>{L.phone}</li>
          <li>{L.phoneProviders}</li>
        </ul>
      </details>
    </section>
  );
}
