/**
 * The dated selectors module (spec §2 "Selectors are accessible roles and names, never CSS classes, in one dated
 * module"; brief WP14 §9). Every rule the driver and the classifier apply to Google's page lives here, with the
 * verification flags that gate each click and each page kind. A flag flips only in the commit that adds the recording
 * proving it, and `PROOFS` names that recording's date; `/v1/status` reports the flags.
 *
 * What is verified (2026-10-18): the results page's structure, from the feasibility load (a `tablist` with "Best" and
 * "Cheapest from £…", "N results returned.", unnamed lists, each after a heading "Top departing flights" or
 * "Other departing flights", of `listitem`s each holding one `link` named with the whole option, the "Date grid" button, "Currency GBP" and
 * "Location·United Kingdom"), and the consent page's heading from the signed-out test. Everything else (the search
 * form's controls, the Cheapest flow, "View more", the no-flights line, the grid) is unverified until
 * Task 14.2's recordings; until then the server refuses to start (FORM_VERIFIED) and nothing is clicked. SOCS stability
 * is verified by the 2026-10-18 socs-stability recording (operator ruling).
 */
export const SELECTORS_VERSION = '2026-10-18-results';

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

export const FLAG_NAMES = [
  'RESULTS_VERIFIED',
  'FORM_VERIFIED',
  'CHEAPEST_FLOW_VERIFIED',
  'VIEW_MORE_ADDS_CHEAPER',
  'NO_FLIGHTS_VERIFIED',
  'SOCS_STABLE',
  'GRID_VERIFIED',
] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

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
  results: {
    /** The Cheapest tab, whose name carries the tab price once settled. */
    cheapestTab: RegExp;
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
  results: {
    cheapestTab: /^Cheapest\b/,
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
  // why: the flags below were set 2026-10-18 from that day's recordings (operator instruction); PROOFS names each file
  RESULTS_VERIFIED: true,
  FORM_VERIFIED: true,
  CHEAPEST_FLOW_VERIFIED: true,
  // why: stays false: the view-more recording's minimum (81 links) was no lower than the results page's
  VIEW_MORE_ADDS_CHEAPER: false,
  NO_FLIGHTS_VERIFIED: true,
  // why: set 2026-10-18 by operator ruling: the socs-stability recording's passes 1–3 all read the cookie back `same`
  SOCS_STABLE: true,
  // why: decision 69: grid mode is not built in WP14; this flag stays false here whatever a recording shows.
  GRID_VERIFIED: false,
};

/** The recording that proved each true flag (TS-13): its date and what it was. */
export const PROOFS: Readonly<Partial<Record<FlagName, string>>> = {
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
  };
}
