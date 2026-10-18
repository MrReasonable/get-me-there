/**
 * The dated selectors module (spec §2 "Selectors are accessible roles and names, never CSS classes, in one dated
 * module"; brief WP14 §9). Every rule the driver and the classifier apply to Google's page lives here, with the
 * verification flags that gate each click and each page kind. A flag flips only in the commit that adds the recording
 * proving it, and `PROOFS` names that recording's date; `/v1/status` reports the flags.
 *
 * What is verified (2026-10-18): the results page's structure, from the feasibility load (a `tablist` with "Best" and
 * "Cheapest from £…", "N results returned.", lists "Top departing flights" and "Other departing flights" of
 * `listitem`s each holding one `link` named with the whole option, the "Date grid" button, "Currency GBP" and
 * "Location·United Kingdom"), and the consent page's heading from the signed-out test. Everything else (the search
 * form's controls, the Cheapest flow, "View more", the no-flights line, SOCS stability, the grid) is unverified until
 * Task 14.2's recordings; until then the server refuses to start (FORM_VERIFIED) and nothing is clicked.
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
  | 'textbox';

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
    /** The result lists ("Top departing flights", "Other departing flights"). */
    resultLists: RegExp;
    resultsReturned: RegExp;
    fetching: RegExp;
    currencyButton: RegExp;
    locationButton: RegExp;
    viewMoreButton: string;
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
    resultLists: /departing flights$/,
    resultsReturned: /^\d+ results? returned\.$/,
    fetching: /Fetching results/,
    currencyButton: /^Currency /,
    locationButton: /^Location/,
    viewMoreButton: 'View more flights',
    noFlights: /^No (?:results|flights) (?:returned|found)/,
  },
  form: {
    tripType: /^Change ticket type\./,
    passengers: /passengers?, change number of passengers\.$/,
    departure: 'Departure',
    return: 'Return',
  },
  maxNameLength: 4000,
  RESULTS_VERIFIED: true,
  FORM_VERIFIED: false,
  CHEAPEST_FLOW_VERIFIED: false,
  VIEW_MORE_ADDS_CHEAPER: false,
  NO_FLIGHTS_VERIFIED: false,
  SOCS_STABLE: false,
  // why: decision 69: grid mode is not built in WP14; this flag stays false here whatever a recording shows.
  GRID_VERIFIED: false,
};

/** The recording that proved each true flag (TS-13): its date and what it was. */
export const PROOFS: Readonly<Partial<Record<FlagName, string>>> = {
  RESULTS_VERIFIED: '2026-10-18 feasibility load (signed in, through camofox-browser; brief introduction)',
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
