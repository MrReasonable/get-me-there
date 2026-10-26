import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';
import { MARK_CLASS } from './OverviewMonth.js';
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
    <section aria-label={L.title} className="space-y-1 text-xs" data-testid="dates-legend">
      <h4 className="font-semibold">{L.title}</h4>
      <p data-scale="">{scaleText(scale)}</p>
      {scale.mode === 'quintile' ? (
        <ul className="flex flex-wrap gap-2" data-scale="">
          {scale.legend.map((e) => (
            <li key={e.band} className="flex items-center gap-1">
              <span aria-hidden="true" className={`inline-block h-4 w-4 rounded ${BAND_CLASSES[e.band]}`} />
              {L.band(e.band, formatPence(e.minPence), formatPence(e.maxPence), e.count)}
            </li>
          ))}
        </ul>
      ) : scale.mode !== 'empty' ? (
        <p className="flex items-center gap-1">
          <span aria-hidden="true" className={`inline-block h-4 w-4 rounded ${FLAT_CLASS}`} />
          {L.flat(scale.count)}
        </p>
      ) : null}
      <p>{L.offScale}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={L.title}>
        {MARK_ORDER.map((m) => (
          <li key={m} className="flex items-center gap-1" data-mark={m}>
            <span
              aria-hidden="true"
              data-testid="legend-glyph"
              className={`inline-flex h-4 w-4 items-center justify-center rounded border border-slate-500 bg-white text-black ${MARK_CLASS[m]}`}
            >
              {M.glyph[m]}
            </span>
            {L.markCount(M.words[m], counts[m])}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-4 w-4 rounded border-2 border-black" />
          {L.ring}
        </li>
      </ul>
      <p>{L.notChecked}</p>
      <p>{L.noAmount}</p>
    </section>
  );
}
