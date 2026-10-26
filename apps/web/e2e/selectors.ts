import { COPY } from '../src/copy.js';

const D = COPY.datesView;
const OVERVIEW = '[data-testid="dates-overview"]';

/**
 * What the Playwright smoke looks for on the Dates view, the date pair detail and the nav, shared with the jsdom test
 * that proves each one matches the markup (test/e2e/selectors.test.tsx; review arch2-001, ui-r2-002): the smoke needs
 * a running api, so it cannot run in `pnpm test`, but its selectors can never drift from the components (WP19 Task
 * 19.9).
 */
export const SMOKE = {
  /** The board: a table captioned "Best dates" (its caption goes on with the order note and the shown count). */
  boardTable: /^Best dates/,
  /** A board row: each carries its date pair's index. */
  boardRow: 'tr[data-pair]',
  /** A board row's link to its date pair detail ("Open 14 Mar 2027 to 28 Mar 2027"). */
  rowLink: /^Open \d{1,2} [A-Z][a-z]{2} \d{4} to \d{1,2} [A-Z][a-z]{2} \d{4}$/,
  /** The overview's one tab stop (roving tabindex). */
  overviewTabStop: `${OVERVIEW} [data-cell][tabindex="0"]`,
  /** Every overview cell. */
  overviewCell: `${OVERVIEW} [data-cell]`,
  /** A cell ringed because its date pair is a shown board row (spec §11 Rings). */
  ringedCell: `${OVERVIEW} [data-cell][data-ringed]`,
  /** The cell lit from the board, or lit itself. */
  litCell: `${OVERVIEW} [data-cell][data-lit]`,
  /** A cell's glyphs: one per mark it carries. */
  cellGlyphs: '[data-testid="cell-glyphs"]',
  legend: '[data-testid="dates-legend"]',
  /** Each mark of the legend, with its glyph in `legendGlyph`. */
  legendMark: '[data-testid="dates-legend"] [data-mark]',
  legendGlyph: '[data-testid="legend-glyph"]',
  readout: '[data-testid="dates-readout"]',
  openThese: D.overview.openThese,
  /** A board row as a stacked card below 900 px. */
  phoneCard: '[data-testid="board-card"]',
  previousMonth: D.overview.previousMonth,
  nextMonth: D.overview.nextMonth,
  coverageToggle: D.coverageToggle,
  /** The nav, labelled "Views", with its two tiers as lists labelled by their names. */
  nav: COPY.navLabel,
  navTiers: [COPY.navTier.decide, COPY.navTier.setup],
  navCurrent: '[aria-current="page"]',
  /** The date pair detail: its table, headline, panels and the way back. */
  detailTable: COPY.resultsTableLabel,
  detailHeadline: '[data-testid="detail-headline"]',
  backToDates: '[data-testid="back-to-dates"]',
  airportPairPanel: '[data-testid="airport-pair-panel"]',
} as const;
