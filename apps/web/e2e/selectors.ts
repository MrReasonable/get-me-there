import { COPY } from '../src/copy.js';

const D = COPY.datesView;
const OVERVIEW = '[data-testid="dates-overview"]';

/**
 * What the Playwright smoke looks for on the Dates view, the Trip page and the nav, shared with the jsdom test
 * that proves each one matches the markup (test/e2e/selectors.test.tsx; review arch2-001, ui-r2-002): the smoke needs
 * a running api, so it cannot run in `pnpm test`, but its selectors can never drift from the components (WP19 Task
 * 19.9).
 */
export const SMOKE = {
  /** The board: a table captioned "Best dates" (its caption goes on with the order note and the shown count). */
  boardTable: /^Best dates/,
  /** A board row: each carries its date pair's index. */
  boardRow: 'tr[data-pair]',
  /** A board row's link to its Trip page ("Open 14 Mar 2027 to 28 Mar 2027"). */
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
  /** The nav, labelled "Main", with its two links: Trips and Settings (design 2026-11-08 Ruling 9). */
  nav: COPY.navLabel,
  navItems: [COPY.nav.trips, COPY.nav.settings],
  /** The breadcrumb: a nav named "Breadcrumb" holding an ordered list (Ruling 12). */
  crumbs: COPY.crumbsLabel,
  navCurrent: '[aria-current="page"]',
  /** The Trip page (design 2026-11-08 §6.1): its answer card, named; its breadcrumb back to the search; its folds. */
  tripPage: '[data-testid="trip-page"]',
  tripCard: COPY.trip.cardLabel,
  tripBack: '[data-testid="trip-back"]',
  priceLabel: '[data-testid="price-label"] > summary',
  aboutPrice: '[data-testid="about-price"] > summary',
  searchLog: '[data-testid="search-log"] > summary',
  /** The new-search form (WP20): the form that holds the From picker; at 900 px and narrower it is first in the DOM. */
  newSearchForm: 'form:has(#origins-input)',
  /** The press that starts a search: the new-search form's, a card's and the page's (Search again) share the verb. */
  searchNow: /^Search now/,
  /** The search page's state line, read by a screen reader as a status named "Search state". */
  stateLine: COPY.searchPage.stateLabel,
  /** One search's card on the Searches view. */
  searchCard: '[data-card]',
  /** A card's actions: its links and buttons. */
  cardAction: '[data-card] [data-testid="card-actions"] :is(a, button)',
  /** The flights block of a date pair on a search's page (absent where flight lists cannot be read). */
  flightsBlock: '[data-testid="flights-block"]',
  /**
   * The pairing section of a read list: the Back line, the other returns and the seller's price (WP21 Task 21.8). The
   * fixture-only smoke cannot show one (the fixture provider has no flight lists), so no e2e run uses it; the jsdom
   * test pins that it matches a rendered block with returns.
   */
  pairing: '[data-testid="flights-pairing"]',
  /** The one line under the board when flight lists cannot be read here. */
  flightsUnavailable: '[data-testid="flights-unavailable"]',
} as const;
