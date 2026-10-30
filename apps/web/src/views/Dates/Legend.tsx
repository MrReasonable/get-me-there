import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';
import { MARK_CLASS, RING_CLASS } from './OverviewMonth.js';
import { MARK_ORDER, type Mark } from './overview.js';
import { BAND_CLASSES, FLAT_CLASS, MIN_BANDED_DAYS, type QuintileScale } from './shade.js';

const L = COPY.datesView.legend;
const M = COPY.datesView.marks;

/** The scale's own line: banded, flat (too few or too narrow, decision 38), or nothing to shade. */
function scaleText(s: QuintileScale): string {
  switch (s.mode) {
    case 'quintile':
      return L.scaleQuintile(s.count);
    case 'flat-few':
      return L.scaleFlatFew(s.count, MIN_BANDED_DAYS);
    case 'flat-narrow':
      return L.scaleFlatNarrow(s.count, formatPence(s.minPence ?? 0), formatPence(s.maxPence ?? 0));
    case 'empty':
      return L.scaleEmpty;
  }
}

/**
 * Spec §11 Overview: the legend is numeric and always open: each mark in words with its glyph and its count in view,
 * the shading's price bands as scale values (in [data-scale]: scale values, never a fare), and what "not checked"
 * means. The same glyphs and patterns as the cells, so nothing rests on colour.
 */
export function Legend({ scale, counts }: { scale: QuintileScale; counts: Readonly<Record<Mark, number>> }) {
  return (
    <section
      aria-label={L.title}
      className="ov-legend space-y-2 text-[13px] text-fg-2"
      data-testid="dates-legend"
    >
      <h4 className="label-caps">{L.title}</h4>
      <p data-scale="">{scaleText(scale)}</p>
      {scale.mode === 'quintile' ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1" data-scale="">
          {scale.legend.map((e) => (
            <li key={e.band} className="flex items-center gap-1">
              <span aria-hidden="true" className={`legend-swatch ${BAND_CLASSES[e.band]}`} />
              {L.band(e.band, formatPence(e.minPence), formatPence(e.maxPence), e.count)}
            </li>
          ))}
        </ul>
      ) : scale.mode !== 'empty' ? (
        <p className="flex items-center gap-1">
          <span aria-hidden="true" className={`legend-swatch ${FLAT_CLASS}`} />
          {L.flat(scale.count)}
        </p>
      ) : null}
      <p>{L.offScale}</p>
      <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3" aria-label={L.title}>
        {MARK_ORDER.map((m) => (
          <li key={m} className="flex items-center gap-1" data-mark={m}>
            <span
              aria-hidden="true"
              data-testid="legend-glyph"
              className={`legend-swatch lamp-none ${MARK_CLASS[m]}`}
            >
              {M.glyph[m]}
            </span>
            {L.markCount(M.words[m], counts[m])}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className={`legend-swatch lamp-lit bg-[#d9cfb4] ${RING_CLASS}`} />
          {L.ring}
        </li>
      </ul>
      <p>{L.notChecked}</p>
      <p>{L.noAmount}</p>
    </section>
  );
}
