/**
 * The dated selectors module (spec §2 "Selectors are accessible roles and names, never CSS classes, in one dated
 * module"; brief WP14 §9). Every rule the driver and the classifier apply to Google's page lives here, with the
 * verification flags that gate each click and each page kind. A flag flips only in the commit that adds the recording
 * proving it, and `PROOFS` names that recording's date; `/v1/status` reports the flags.
 *
 * What is verified (2026-10-18): the results page's structure, from the feasibility load (a `tablist` with "Best" and
 * "Cheapest from £…", "N results returned.", unnamed lists, each after a heading "Top departing flights" or
 * "Other departing flights", of `listitem`s each holding one `link` named with the whole option, the "Date grid" button, "Currency GBP" and
 * "Location·United Kingdom"), and the consent page's heading from the signed-out test. The landing view (2026-10-25):
 * research 17.0c's two sessions, whose views after the choice were `/travel/flights?hl=en-GB&gl=GB` with no query, the
 * heading "Flights" first among the page's headings, and no Cheapest tab, Date grid button or result link. Everything else (the search
 * form's controls, the Cheapest flow, "View more", the no-flights line, the grid) is unverified until
 * Task 14.2's recordings; until then the server refuses to start (FORM_VERIFIED) and nothing is clicked. SOCS stability
 * is verified by the 2026-10-18 socs-stability recording (operator ruling).
 */
import { CAMOUFOX_BUILDS, FLAG_NAMES, type FlagName, flagsFor, type OsArch } from '@gmt/core';

export { FLAG_NAMES, type FlagName };

export const SELECTORS_VERSION = '2026-10-27-tab-price';

/**
 * The module's default flags: the operator's Mac (darwin-arm64) on its pinned build, the 2026-10-18 recordings' values
 * (PROOFS names each). The running worker never reads these: it runs on `selectorsFor(osArch, build)`, the entry and
 * build it actually has (decision 75), and every flag it reads goes through that one object.
 */
const VERIFIED = flagsFor('darwin-arm64', CAMOUFOX_BUILDS['darwin-arm64'].build);

/** The roles the driver queries (a subset of Playwright's AriaRole). */
export type Role =
  | 'button'
  | 'link'
  | 'tab'
  | 'tablist'
  | 'heading'
  | 'list'
  | 'listitem'
  | 'combobox'
  | 'textbox'
  | 'main'
  // why: the Price graph exploration (2026-10-18) looks for whichever of these appeared after its click, and lists the
  // controls inside it; nothing here assumes how the graph itself is built
  | 'dialog'
  | 'alertdialog'
  | 'region'
  | 'slider'
  | 'option'
  | 'tabpanel'
  | 'grid'
  | 'gridcell'
  | 'img';

export interface Selectors {
  version: string;
  hosts: { results: string; consent: string; signIn: string };
  /** The one allowed document path and its subtree (`/travel/flightsevil` is refused). */
  resultsPath: string;
  /** The one sub-frame document prefix allowed on the results host (never the main frame; never `/recaptcha/`). */
  frontEndFramePrefix: string;
  blocked: {
    /** A frame on the results host whose path starts here is a reCAPTCHA (PIE-R2-09: never an iframe name). */
    captchaPath: string;
    sorryPathPrefix: string;
    unusualTraffic: RegExp;
    /** The page's own challenge text. */
    challenge: RegExp;
    signInHeading: RegExp;
    /** A signed-in account control's accessible name (feasibility load: "Google Account: …"). */
    accountControl: RegExp;
  };
  consent: { heading: RegExp };
  /**
   * The landing page the consent command opens (`/travel/flights?hl=…&gl=…`, no query; WP17 Task 17.4), dated by
   * research 17.0c's recording of 2026-10-25, which set LANDING_VERIFIED for darwin-arm64.
   */
  landing: { heading: RegExp };
  results: {
    /** The Cheapest tab, whose name carries the tab price once settled. */
    cheapestTab: RegExp;
    /**
     * The tab price in the Cheapest tab's name: right after "Cheapest from" (and the hidden "Fetching results" label),
     * as "£1,204" (group 1) or "451 British pounds" (group 2); any later price in the name is never read.
     */
    cheapestTabPrice: RegExp;
    dateGridButton: string;
    /** A result link's own accessible name (the result-name grammar then reads it whole). */
    resultLink: RegExp;
    /** The one button that may close the information pop-up attached to the Cheapest tab (exact name). */
    cheapestPopupClose: string;
    resultsReturned: RegExp;
    fetching: RegExp;
    currencyButton: RegExp;
    locationButton: RegExp;
    viewMoreButton: string;
    /** The button that opens the price-per-departure-day graph (exact name; the exploration recorder only). */
    priceGraphButton: string;
    /** Inside the graph's dialog (exploration only): the chart region, the Dates tab and the forward scroll button. */
    graphDialog: { chartRegion: string; datesTab: string; scrollForwards: string };
    /** The date grid inside that dialog (WP15; recorder only until GRID_VERIFIED): its names, all exact. */
    dateGrid: {
      dialog: string;
      datesTab: string;
      grid: string;
      scroll: { left: string; right: string; up: string; down: string };
      /** The button the grid adds once the query's pair has scrolled out of view; a control, never a cell. */
      reset: string;
    };
    /** Google's own "no flights" line; a hypothesis until NO_FLIGHTS_VERIFIED. */
    noFlights: RegExp;
  };
  /**
   * The search form (decision 69: round trip, one adult, the query's dates). The brief's hypothesis from round 1,
   * replaced by Task 14.2's recording; FORM_VERIFIED is false until then, and the server refuses to start.
   */
  form: {
    tripType: RegExp;
    passengers: RegExp;
    departure: string;
    return: string;
  };
  /** A result name longer than this is counted as unparsed, never parsed (spec §2, PIE-R2-10). */
  maxNameLength: number;
  RESULTS_VERIFIED: boolean;
  FORM_VERIFIED: boolean;
  CHEAPEST_FLOW_VERIFIED: boolean;
  VIEW_MORE_ADDS_CHEAPER: boolean;
  NO_FLIGHTS_VERIFIED: boolean;
  SOCS_STABLE: boolean;
  GRID_VERIFIED: boolean;
  /** The consent command's landing view (WP17 Task 17.4); set by research 17.0c's recording of 2026-10-25. */
  LANDING_VERIFIED: boolean;
  /** The date grid's unpriced cells, "no flights, …" and "price unknown, …" (spec §2 "Cells by name"). */
  GRID_UNPRICED_VERIFIED: boolean;
}

export const SELECTORS: Selectors = {
  version: SELECTORS_VERSION,
  hosts: { results: 'www.google.com', consent: 'consent.google.com', signIn: 'accounts.google.com' },
  resultsPath: '/travel/flights',
  // why: observed 2026-10-18; the app's bscframe helper iframe (`/_/FlightsFrontendUi/bscframe`): aborting it kept the
  // first recording run's page from settling. Operator ruling of 2026-10-18: sub-frames only, this prefix only.
  frontEndFramePrefix: '/_/FlightsFrontendUi/',
  blocked: {
    captchaPath: '/recaptcha/',
    sorryPathPrefix: '/sorry/',
    unusualTraffic: /unusual traffic/i,
    challenge: /not a robot/i,
    signInHeading: /^Sign in$/,
    accountControl: /^Google Account: /,
  },
  consent: { heading: /^Before you continue/ },
  // why: observed 2026-10-25 (consent-research/2026-10-25/1): the landing view's first heading, in both sessions'
  // views after the choice; classifyLanding also needs the bare URL and no results structure
  landing: { heading: /^Flights$/ },
  results: {
    cheapestTab: /^Cheapest\b/,
    // why: observed 2026-10-18 to 2026-10-27 (every results, cheapest and grid recording): the name runs on into an
    // information pop-up's text after the price ("Cheapestfrom Fetching results £579Close dialogueLooking for the lowest
    // fares? …"), so only the price at the name's start counts (CodeRabbit on PR #33: a digit in the pop-up is no price)
    cheapestTabPrice:
      /^Cheapest\s*from\s*(?:Fetching results\s*)?(?:£([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?![0-9.,])|([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+) British pounds)/,
    dateGridButton: 'Date grid',
    // why: observed 2026-10-18 (feasibility snapshot; recording run 3): the result lists carry no accessible name (a
    // level-3 heading "Top departing flights" / "Other departing flights" precedes each), so results are found by the
    // link's own name inside `main`, never by a list name. The grammar still checks the price and currency.
    resultLink: /^From [\d,]+ [A-Za-z ]+ round trip total\. /,
    // why: observed 2026-10-18 (the Cheapest recording): Google attaches an information pop-up ("Looking for the
    // lowest fares? …") to the Cheapest tab, and its close button intercepts the tab's click. Operator ruling of
    // 2026-10-18: only this button, by exact name, inside that tab, on the results page, may be clicked to close it;
    // it is not a consent or verification page, and nothing else is ever clicked to dismiss anything.
    cheapestPopupClose: 'Close dialogue',
    resultsReturned: /^\d+ results? returned\.$/,
    fetching: /Fetching results/,
    currencyButton: /^Currency /,
    locationButton: /^Location/,
    viewMoreButton: 'View more flights',
    // why: observed 2026-10-18 (the feasibility load's results page names it); clicked only by record --graph-explore,
    // never by the provider, until a recording shows what the graph holds
    priceGraphButton: 'Price graph',
    // why: observed 2026-10-18 (graph-explore/2026-10-18/1): the button opens a dialog "Price insights" holding a tablist
    // ("Dates", "Price graph"), a region "Price graph" with no accessible children, and "Scroll forwards"
    graphDialog: { chartRegion: 'Price graph', datesTab: 'Dates', scrollForwards: 'Scroll forwards' },
    // why: observed 2026-10-18 (graph-explore/2026-10-18/2): the dialog "Price insights", its tab "Dates" holding an
    // empty grid "Date grid", and the four scroll buttons around it
    dateGrid: {
      dialog: 'Price insights',
      datesTab: 'Dates',
      grid: 'Date grid',
      scroll: { left: 'Scroll left', right: 'Scroll right', up: 'Scroll up', down: 'Scroll down' },
      // why: observed 2026-10-30 (grid/2026-10-30/1): once the selected pair scrolls out of view the panel holds this
      // button too; read as a cell, it made a whole view one too many (and a view one short look drawn)
      reset: 'Reset back to centre',
    },
    noFlights: /^No (?:results|flights) (?:returned|found)/,
  },
  form: {
    tripType: /^Change ticket type\./,
    passengers: /passengers?, change number of passengers\.$/,
    departure: 'Departure',
    return: 'Return',
  },
  maxNameLength: 4000,
  // why: the flags come from core's FLAGS (VERIFIED above): set 2026-10-18 from that day's recordings (operator
  // instruction); View more stays off (its minimum was no lower than the results page's); GRID_VERIFIED still needs
  // CAMOUFOX_MODE=grid in worker.env for grid pages
  ...VERIFIED,
};

/**
 * The selectors with the flags `osArch` earned for the build it runs (decision 75: all false on any other build or
 * entry). `flags` is core's `flagsFor`; a test passes its own to state a partly verified entry.
 */
export function selectorsFor(
  osArch: OsArch,
  build: string,
  flags: (osArch: OsArch, build: string) => Readonly<Record<FlagName, boolean>> = flagsFor,
): Selectors {
  return { ...SELECTORS, ...flags(osArch, build) };
}

/**
 * The recording that proved each true flag (TS-13), per `<os>-<arch>` entry (decision 75: a flag counts only on the
 * entry and build it was recorded under): its date and what it was. The recordings are local-only (decision 61), named
 * here by kind, date and number.
 */
export const PROOFS: Readonly<Record<OsArch, Partial<Record<FlagName, string>>>> = {
  'darwin-arm64': {
    RESULTS_VERIFIED:
      '2026-10-18 results/2026-10-18/1 (23 links, every name parses; first seen in the feasibility load)',
    FORM_VERIFIED:
      '2026-10-18 results/2026-10-18/1 (round trip, 1 passenger, 14 Mar to 24 Mar as asked) and no-flights/2026-10-18/1 (1 Dec to 10 Dec as asked)',
    CHEAPEST_FLOW_VERIFIED:
      '2026-10-18 cheapest/2026-10-18/1 (21 links after the tab click; their minimum equals the tab price, SOCS same)',
    NO_FLIGHTS_VERIFIED:
      '2026-10-18 no-flights/2026-10-18/1 (a date beyond the sale window: the line visible with 0 links, form as asked)',
    SOCS_STABLE:
      '2026-10-18 socs-stability recording, passes 1–3 all read back same (operator ruling of 2026-10-18)',
    LANDING_VERIFIED:
      '2026-10-25 consent-research/2026-10-25/1 (both sessions’ views after the choice: /travel/flights?hl=en-GB&gl=GB with no query, the heading "Flights", no tab, Date grid button or result link)',
    GRID_VERIFIED:
      '2026-10-18 grid/2026-10-18/1–4 (every cell name parses, each view’s cells name its lines’ dates, one scroll moves one day on its axis, SOCS same) and the renamed 0-explore',
    GRID_UNPRICED_VERIFIED:
      '2026-10-26 grid/2026-10-26/7 and 8 (a sparse route, ten views of 49 cells, every view drawn: each pair shown without a price a button named "no flights, <d> <Mon> to <d> <Mon>" or "price unknown, <d> <Mon> to <d> <Mon>", 14 to 19 of them a view, every other name priced and parsed, each view’s cells name its lines’ dates, SOCS same)',
  },
  // why: WP17 Task 17.8's recording sessions fill these, one commit per entry
  // why: WP17 Task 17.8, the operator's Mac under Rosetta (an official x86_64 Node 22, a throwaway HOME,
  // CAMOUFOX_PAGE_TIMEOUT_SECONDS 180); GRID_VERIFIED stays false (pin.ts says why)
  'darwin-x64': {
    RESULTS_VERIFIED: '2026-10-26 results/2026-10-26/3 (23 links, every name parses, SOCS same)',
    FORM_VERIFIED:
      '2026-10-26 results/2026-10-26/3 (round trip, 1 passenger, 14 Mar to 24 Mar as asked) and no-flights/2026-10-26/3 (1 Dec to 10 Dec as asked)',
    CHEAPEST_FLOW_VERIFIED:
      '2026-10-26 cheapest/2026-10-26/3 (23 links after the tab click; their minimum equals the tab price, SOCS same)',
    NO_FLIGHTS_VERIFIED:
      '2026-10-26 no-flights/2026-10-26/3 (a date beyond the sale window: the line visible with 0 links, form as asked)',
    SOCS_STABLE: '2026-10-26 socs-stability/2026-10-26/7–9 (three spaced pages, every read-back same)',
    LANDING_VERIFIED:
      '2026-10-26 landing/2026-10-26/3 (/travel/flights?hl=en-GB&gl=GB with no query, the heading "Flights", no tab, Date grid button or result link, SOCS same)',
    GRID_VERIFIED:
      '2026-10-26 grid/2026-10-26/5 and 6 (under the settle that waits for every cell: five views of 49 cells each, every view drawn, every cell name parses, each view’s cells name its lines’ dates, each of the four scrolls moves one day on its axis, SOCS same)',
  },
  // why: WP17 Task 17.8, a Linux arm64 container on the operator's Mac (headless, the generated fonts.conf)
  'linux-arm64': {
    RESULTS_VERIFIED: '2026-10-26 results/2026-10-26/1 (23 links, every name parses, SOCS same)',
    FORM_VERIFIED:
      '2026-10-26 results/2026-10-26/1 (round trip, 1 passenger, 14 Mar to 24 Mar as asked) and no-flights/2026-10-26/1 (1 Dec to 10 Dec as asked)',
    CHEAPEST_FLOW_VERIFIED:
      '2026-10-26 cheapest/2026-10-26/1 (22 links after the tab click; their minimum equals the tab price, SOCS same)',
    NO_FLIGHTS_VERIFIED:
      '2026-10-26 no-flights/2026-10-26/1 (a date beyond the sale window: the line visible with 0 links, form as asked)',
    SOCS_STABLE: '2026-10-26 socs-stability/2026-10-26/1–3 (three spaced pages, every read-back same)',
    LANDING_VERIFIED:
      '2026-10-26 landing/2026-10-26/1 (/travel/flights?hl=en-GB&gl=GB with no query, the heading "Flights", no tab, Date grid button or result link, SOCS same)',
    GRID_VERIFIED:
      '2026-10-26 grid/2026-10-26/1 (five views of 49 cells, every cell name parses, each view’s cells name its lines’ dates, each of the four scrolls moves one day on its axis, SOCS same)',
  },
  // why: WP17 Task 17.8, a Linux x86_64 container under emulation on the operator's Mac (headless, the generated
  // fonts.conf, CAMOUFOX_PAGE_TIMEOUT_SECONDS 180 after a first View more page did not settle within 90 s)
  'linux-x64': {
    RESULTS_VERIFIED: '2026-10-26 results/2026-10-26/2 (23 links, every name parses, SOCS same)',
    FORM_VERIFIED:
      '2026-10-26 results/2026-10-26/2 (round trip, 1 passenger, 14 Mar to 24 Mar as asked) and no-flights/2026-10-26/2 (1 Dec to 10 Dec as asked)',
    CHEAPEST_FLOW_VERIFIED:
      '2026-10-26 cheapest/2026-10-26/2 (22 links after the tab click; their minimum equals the tab price, SOCS same)',
    NO_FLIGHTS_VERIFIED:
      '2026-10-26 no-flights/2026-10-26/2 (a date beyond the sale window: the line visible with 0 links, form as asked)',
    SOCS_STABLE: '2026-10-26 socs-stability/2026-10-26/4–6 (three spaced pages, every read-back same)',
    LANDING_VERIFIED:
      '2026-10-26 landing/2026-10-26/2 (/travel/flights?hl=en-GB&gl=GB with no query, the heading "Flights", no tab, Date grid button or result link, SOCS same)',
    GRID_VERIFIED:
      '2026-10-26 grid/2026-10-26/2 (five views of 49 cells, every cell name parses, each view’s cells name its lines’ dates, each of the four scrolls moves one day on its axis, SOCS same)',
  },
};

/** The flags as `/v1/status` reports them. */
export function flagsOf(S: Selectors = SELECTORS): Record<FlagName, boolean> {
  return {
    RESULTS_VERIFIED: S.RESULTS_VERIFIED,
    FORM_VERIFIED: S.FORM_VERIFIED,
    CHEAPEST_FLOW_VERIFIED: S.CHEAPEST_FLOW_VERIFIED,
    VIEW_MORE_ADDS_CHEAPER: S.VIEW_MORE_ADDS_CHEAPER,
    NO_FLIGHTS_VERIFIED: S.NO_FLIGHTS_VERIFIED,
    SOCS_STABLE: S.SOCS_STABLE,
    GRID_VERIFIED: S.GRID_VERIFIED,
    LANDING_VERIFIED: S.LANDING_VERIFIED,
    GRID_UNPRICED_VERIFIED: S.GRID_UNPRICED_VERIFIED,
  };
}
