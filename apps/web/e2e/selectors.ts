import { COPY } from '../src/copy.js';

const D = COPY.datesView;
const P = COPY.searchPage;
const C = COPY.calendar;
const MONTHS = '[data-testid="calendar-months"]';

/**
 * What the Playwright smoke looks for on a search's page, the Trip page and the nav, shared with the jsdom test that
 * proves each one matches the markup (test/e2e/selectors.test.tsx; review arch2-001, ui-r2-002): the smoke needs a
 * running api, so it cannot run in `pnpm test`, but its selectors can never drift from the components (WP19 Task
 * 19.9).
 */
export const SMOKE = {
  /** Design 2026-11-08 §5.2: the two sections, each a region named by its heading. */
  cheapestTrips: P.cheapestHeading,
  lowerOnCalendar: P.lowerHeading,
  /** The shared rows (Ruling 20): a trip, and a calendar price. */
  tripRow: '[data-testid="trip-row"]',
  calendarRow: '[data-testid="calendar-row"]',
  /** A trip row's › to its Trip page ("Details for Sun 14 Mar → Wed 24 Mar", a pair before the dates when several). */
  detailsLink: /^Details for /,
  /** The run line under the header ("Searched today 16:40–17:02 · calendar prices for … · what was searched"). */
  runLine: '[data-testid="dates-run"]',
  /** The one filter row (Ruling 16), a group named "Filter". */
  filterRow: P.filterLabel,
  /** Lower on the calendar's link down to the calendar, and the calendar's anchor. */
  seeAll: P.seeAll,
  calendar: '#calendar',
  /** The calendar's one tab stop (roving tabindex), a day's button (Ruling 18). */
  calendarTabStop: `${MONTHS} button[data-day][tabindex="0"]`,
  /** Every day of the window, each a button named by its date and what it shows. */
  calendarDay: `${MONTHS} button[data-day]`,
  /** A day that prints a price (inside a PriceCell), and one that prints the trip's dot. */
  pricedDay: `${MONTHS} button[data-day][data-heat]`,
  tripDay: `${MONTHS} button[data-day][data-trip]`,
  /** The key: a list named "Key" with its five items. */
  calendarKey: C.key.label,
  /** The day panel: a region named "Sun 14 Mar: 3 stays", its Close and its "Show N more stays". */
  dayPanel: /^\w{3} \d{1,2} \w{3}: \d+ stays?$/,
  dayClose: C.close,
  showMoreStays: /^Show \d+ more stays?$/,
  previousMonth: C.previousMonth,
  nextMonth: C.nextMonth,
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
  /** The new-search form (WP20): the form that holds the From picker, inside the panel after the cards (Ruling 13). */
  newSearchForm: 'form:has(#origins-input)',
  /** The new-search panel: the region named by its "New search" heading, holding the form. */
  newSearchPanel: '[aria-labelledby="new-search-heading"]',
  /** The panel's press: "Search", or "Search · <cost>" on a run that costs (Ruling 13). */
  searchNow: /^Search( · .+)?$/,
  /** The search page's state line, read by a screen reader as a status named "Search state". */
  stateLine: COPY.searchPage.stateLabel,
  /** One search's card on the Searches view. */
  searchCard: '[data-card]',
  /** A card's actions: its links and buttons. */
  cardAction: '[data-card] [data-testid="card-actions"] :is(a, button)',
  /** The one line under Lower on the calendar when flight lists cannot be read here (no row offers a read). */
  flightsUnavailable: '[data-testid="flights-unavailable"]',
} as const;
