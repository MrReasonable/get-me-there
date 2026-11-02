import type { ReducedMark } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';
import { MARK_CLASS, RING_CLASS } from './OverviewMonth.js';
import { CELL_MARKS, type CellMark, KEY_MARKS } from './overview.js';
import { BAND_CLASSES, FLAT_CLASS, MIN_BANDED_DAYS, type QuintileScale } from './shade.js';

const L = COPY.datesView.legend;
const M = COPY.datesView.marks;
/** The five marks' names, so the cell marks besides them are listed once, after them. */
const KEYED: ReadonlySet<string> = new Set(KEY_MARKS);

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

/** What the key counts (spec rev 55 §11 Overview): the five marks, the parts of "no price shown", the cell marks. */
export interface KeyCounts {
  key: Readonly<Record<ReducedMark, number>>;
  noPrice: { empty: number; no_data: number };
  cells: Readonly<Record<CellMark, number>>;
}

/**
 * Spec §11 Overview, revision 55 (WP20 Task 20.6): the legend, the key in plain words, is numeric and always open. It
 * lists the five marks with their counts in view (core's `reducedMark`, the same counts as the header line and the
 * card): priced, shown by its shade; no price shown, with its parts beneath ("12 no fares, 3 no cached data"); couldn't
 * be read; not reached; not searched; each but priced with the same glyph as the cells. Then the shading's price bands
 * as scale values ("brighter is cheaper": the board's lamps burn brightest for the cheapest band), the striped "partly
 * not searched", the other cell marks with their counts, "each dot is one stay length" and what "not checked" means.
 * Nothing rests on colour: priced is the only mark without a glyph, and the striped mark is a pattern.
 */
export function Legend({ scale, counts }: { scale: QuintileScale; counts: KeyCounts }) {
  return (
    <section
      aria-label={L.title}
      className="ov-legend space-y-2 text-[13px] text-fg-2"
      data-testid="dates-legend"
    >
      <h4 className="label-caps">{L.title}</h4>
      <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3" aria-label={L.marksLabel}>
        {KEY_MARKS.map((m) => (
          <li key={m} className="flex flex-wrap items-center gap-1" data-mark={m}>
            {m === 'priced' ? (
              <span
                aria-hidden="true"
                data-testid="legend-glyph"
                className={`legend-swatch ${scale.mode === 'quintile' ? BAND_CLASSES[0] : FLAT_CLASS}`}
              />
            ) : (
              <span
                aria-hidden="true"
                data-testid="legend-glyph"
                className={`legend-swatch lamp-none ${MARK_CLASS[m]}`}
              >
                {M.glyph[m]}
              </span>
            )}
            {L.markCount(M.words[m], counts.key[m])}
            {m === 'no-price-shown' && counts.key[m] > 0 ? (
              <span className="basis-full pl-5">
                {L.noPriceParts(counts.noPrice.empty, counts.noPrice.no_data)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
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
        {CELL_MARKS.filter((m) => !KEYED.has(m)).map((m) => (
          <li key={m} className="flex items-center gap-1" data-mark={m}>
            <span
              aria-hidden="true"
              data-testid="legend-glyph"
              className={`legend-swatch lamp-none ${MARK_CLASS[m]}`}
            >
              {M.glyph[m]}
            </span>
            {m === 'partly' ? L.striped(counts.cells[m]) : L.markCount(M.words[m], counts.cells[m])}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <span aria-hidden="true" className={`legend-swatch lamp-lit bg-[#d9cfb4] ${RING_CLASS}`} />
          {L.ring}
        </li>
      </ul>
      <p>{L.dot}</p>
      <p>{L.notChecked}</p>
      <p>{L.noAmount}</p>
    </section>
  );
}
