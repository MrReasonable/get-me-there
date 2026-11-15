import {
  type apiContract,
  type BlockedPage,
  type Buckets,
  type Cabin,
  CONSTRAINT_LABELS,
  type ConstraintName,
  type ExecutionStatus,
  formatAgo,
  mainPathSource,
  type PairingRead,
  PROVIDER_NAMES,
  type PriceLabelKind,
  type ProviderId,
  type ReducedMark,
  type Stage,
  TRUNCATED_NOTE,
} from '@gmt/core';
import type { z } from 'zod';
import { DAY_PLURAL, listText } from './copy/setup.js';
import { EXAMPLE_PAIR_CELLS } from './example.js';

/** The singular noun for a count of exactly one (a number, or a cap already formatted as text), else the plural. */
const noun = (n: number | string, one: string, many: string): string => (String(n) === '1' ? one : many);

/**
 * What a calendar price says of its flights, by the figure's read of them (`readStateWords`): one record, so the Search
 * page's rows and the Trip card's calendar sentence say the same of one read.
 */
const READ_STATE_WORDS = {
  'not-read': 'Flights not read',
  'outbound-only': 'Return flights not read',
  'no-pairing-read': 'Google listed no return flights',
  'list-failed': "Flights couldn't be read",
  within: 'Flights read',
  'within-older': 'Flights read earlier, not the latest',
  'sellers-not-read': 'Flights read, sellers not read',
  'offers-incomplete': 'Flights read, some sellers not read',
  'over-limit': 'Flights read, over your journey limit',
  'within-other-limits': 'Flights read under other limits',
} as const satisfies Record<PairingRead, string>;

/** A whole number with a comma between thousands ("2184" → "2,184"), as the plan words its counts. */
const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
/** A small count in words ("five"), as mockup 02 says the trips the reading stopped at; digits past ten. */
const SMALL_NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = (n: number): string => SMALL_NUMBERS[n] ?? thousands(n);
/** Review Focus 3's first sentence, said alone where flight lists can't be read for the search (Task 8 fix round 1). */
const NO_TRIP_LEAD = 'No flights read yet for these dates.';

/** Derived from the contract (decision 46), so a new plan id or bucket fails `satisfies` here. */
type PlanId = z.output<typeof apiContract.providersResponseSchema>['providers'][number]['plan'];
/** The six coverage buckets; `reused` is a count beside them, not a bucket (spec §3). */
export type BucketName = Exclude<keyof Buckets, 'reused'>;

/**
 * Every user-facing string of the web app. Spec §11: the banned-word list applies to all copy,
 * and "verified" appears only beside class-verified values. Components import from here and
 * never write literal copy in JSX (test/copy/sourceGuard.test.ts enforces that); the catalogue
 * test walks every entry. Strings that come from the API (basisReason, error messages, the
 * zero-cap message, provenance notes, search-link labels, airport names) are WP8's and core's and
 * are tested there. The worked example's words live in src/example.ts and arrive as arguments.
 */
// final review B-M2 (ruling ui-006): the one lead phrase of a limit edit, on the board and the search's page block alike
const LIMITS_CHANGED = 'your limits have changed since these return flights were read';
// final review B-I3: what happens to a read that did not finish: tried again while a read would go now (the button
// shown beside the note), else once the list is past 0.9 × the refresh, the reuse limit (two transient ends in a row:
// R-retry). Final whole-branch review I4: in confirm mode the step reads past its first 10 date pairs until its
// stopping rule ends it (design 2026-11-08 §4.2), so the words name no count: the next search reads the date when it
// reaches it
const NEXT_READ = (readNow: boolean): string =>
  readNow
    ? 'tried again when the next search reaches this date, or press Read flights for this date now'
    : "read again once the read is nearly as old as this search's refresh";

export const COPY = {
  appTitle: 'get-me-there',
  skipToContent: 'Skip to the main content',
  navLabel: 'Main',
  /** The nav's two items (design 2026-11-08 Ruling 9); every other view sits under one of them (`navItemOf`). */
  nav: { trips: 'Trips', settings: 'Settings' },
  /** The logo links to Trips. */
  logoLink: 'get-me-there, Trips',
  /** The breadcrumb's nav name and the steps shared across pages (Ruling 12). */
  crumbsLabel: 'Breadcrumb',
  crumbs: {
    trips: 'Trips',
    edit: 'Edit',
    priceOverTime: 'Price over time',
    settings: 'Settings',
    priceSources: 'Price sources',
    alerts: 'Alerts',
    system: 'System',
  },
  noDefinitions: 'No searches yet. Plan one under Searches.',
  definitionNotFound: 'The search in this link no longer exists. Pick one under Searches.',
  loading: 'Loading…',
  loadFailed: (message: string) => `Could not load: ${message}`,
  retryLoad: 'Try again',
  actionFailed: (message: string) => `That did not work: ${message}`,
  appFailed: 'Something went wrong while drawing this page. Reload to try again; nothing was sent.',
  providersUnknown: (message: string) =>
    `Provider status unknown, so this page cannot say whether its prices are synthetic: ${message}`,
  emptyNoProviders:
    'No flight data provider is configured. Set TRAVELPAYOUTS_TOKEN in .env for the free Aviasales cache, or SEARCHAPI_KEY for Google Flights via SearchApi, then restart the app.',
  syntheticBanner:
    'Synthetic data: the fixture provider is enabled. Every price on this page is made up for development and testing.',

  // provenance (spec §11)
  priceWithheld: 'price withheld: provenance missing or invalid',
  provider: PROVIDER_NAMES satisfies Record<ProviderId, string>,
  fxApprox: '≈',
  /** WP10 (decision 52): PriceCell's `face` marks on a phone day cell; the words stay in its title and spoken text. */
  priceMarkGlyph: {
    unconfirmed: '≠',
    stale: '◷',
    truncated: '…',
    notSeen: '◌',
    superseded: '↺',
  },
  fxSpoken: (detail: string) => `approximately (${detail})`,
  fxTitle: (rateDate: string, source: string) => `converted to GBP at the ${rateDate} rate (${source})`,
  constraintsNotChecked: 'constraints not checked',
  // spec §2 rev 34: where a calendar price's return date came from, and a vendor's own mark, in the vendor's scope
  returnDateFromGrid: 'return date: read from the grid; whole pounds',
  returnDateAsked: 'return date: the date asked for',
  vendorMark: {
    cheapest: "Google's date grid marked this the cheapest of the prices shown in that view",
    low: "Google's date grid marked this a low price among the prices shown in that view",
  },
  scrollsRow: (n: number) => `${n} scroll${n === 1 ? '' : 's'} in the date grid beside the pages`,
  vendorMarkSearchApi: "SearchApi's response flagged this the lowest of the prices it returned",
  notChecked: 'not checked',
  stale: 'stale',
  vendorAgeUnknown: "vendor's cache age unknown",
  // why: core's label, so web, email and the verdict list say the same words (decisions 37, 44).
  priceNotConfirmed: CONSTRAINT_LABELS.priceConfirmed,
  staleView: 'Every row here is older than one refresh cycle.',
  notSeenInLatest: (age: string) => `not seen in latest search (${age})`,
  truncatedNote: TRUNCATED_NOTE,
  // why: a newer parent search found this cell empty; the price stays visible, ranked after current rows (decision 54, 57).
  superseded: 'superseded by a later search',
  providerShort: {
    travelpayouts: 'TP',
    searchapi: 'SA',
    camoufox: 'CF',
    fixture: 'synthetic',
  } satisfies Record<ProviderId, string>,
  /** The three-letter-or-less provider mark of the phone day face, where `providerShort`'s "synthetic" is 50 px wide. */
  providerMark: { travelpayouts: 'TP', searchapi: 'SA', camoufox: 'CF', fixture: 'syn' } satisfies Record<
    ProviderId,
    string
  >,
  ageUnknown: 'age unknown',
  agoOf: (hours: number | 'unknown') => (hours === 'unknown' ? 'age unknown' : formatAgo(hours)),
  basisKindName: {
    seller: 'cheapest of the sellers read, not checked with the airline',
    'google-unread': "Google's price, sellers not read, not checked with the airline",
    'google-incomplete': "Google's price, not every seller read, not checked with the airline",
  } satisfies Record<'seller' | 'google-unread' | 'google-incomplete', string>,
  // why: core's CONSTRAINT_LABELS is the one set of plain-English constraint names (web and email); kept
  // under COPY so the catalogue test sweeps it for banned words like every other string.
  constraint: CONSTRAINT_LABELS satisfies Record<ConstraintName, string>,
  noRowsFromRun: 'This run has no rows on this basis. Coverage shows what was searched and what was not.',
  dateRange: (dep: string, ret: string, nights: number) => `${dep}–${ret} (${nights}n)`,

  // view header (spec §11)
  executionsShown: (list: string) => `showing ${list}`,
  executionItem: (started: string, status: string, age: string) =>
    `run started ${started} (${status}, ${age})`,
  childExecutionItem: (started: string, status: string, age: string) =>
    `itinerary search for one cell, started ${started} (${status}, ${age})`,
  executionNotStarted: (status: string) => `run not started yet (${status})`,
  // why: spec §8.2 rev 36 (review R17) — a scheduled row that never started names its firing and why
  firingNotStarted: (firing: string, status: string) => `run scheduled for ${firing} (${status})`,
  skippedWhy: (status: string, why: string) => `${status}: ${why}`,
  childExecutionNotStarted: (status: string) => `itinerary search for one cell, not started yet (${status})`,
  // why: UI-010: "run" means a parent run everywhere; on-demand searches are counted apart.
  spanExecutions: (runs: number, onDemand: number) =>
    `across ${runs} ${runs === 1 ? 'run' : 'runs'}${onDemand === 0 ? '' : ` and ${onDemand} on-demand ${onDemand === 1 ? 'search' : 'searches'}`}; no single run status applies`,
  notCompletedBanner: (status: string) => `The latest run is ${status}; these results may be partial.`,
  noExecution: 'No run yet for this search.',
  // why: the bar's status word (spec rev 55 §3, §11): a stopped run is "stopped", never "paused: error"; its sentence
  // follows. Every other status keeps its set-up word.
  // why: a run that is pending or running reads "Searching", as its card does (cardWords.stateLine words both so)
  barStatusName: {
    pending: 'Searching',
    running: 'Searching',
    paused_budget: 'stopped',
    paused_error: 'stopped',
    interrupted: 'interrupted',
    cancelled: 'cancelled',
    completed: 'completed',
    skipped_budget: 'skipped: over budget',
    skipped_confirm: 'skipped: cost not confirmed',
    skipped_window: 'skipped: window has no dates',
    skipped_missed: 'skipped: missed and not caught up',
  } satisfies Record<ExecutionStatus, string>,
  statusName: {
    pending: 'pending',
    running: 'running',
    paused_budget: 'paused: budget',
    paused_error: 'paused: error',
    interrupted: 'interrupted',
    cancelled: 'cancelled',
    completed: 'completed',
    skipped_budget: 'skipped: over budget',
    skipped_confirm: 'skipped: cost not confirmed',
    skipped_window: 'skipped: window has no dates',
    skipped_missed: 'skipped: missed and not caught up',
  } satisfies Record<ExecutionStatus, string>,
  stageName: { discovery: 'discovery', verification: 'itinerary search' } satisfies Record<Stage, string>,

  // --- The interim Settings page (design 2026-11-08 Ruling 9; stage 3 replaces it) ---
  settingsView: {
    heading: 'Settings',
    lede: 'Where prices come from, who gets emails, and whether everything is working.',
    sectionsLabel: 'Settings sections',
    priceSources:
      'Where prices come from: the browser, the Aviasales cache and SearchApi, and what each has left.',
    alerts: 'The emails sent when a price you are watching drops.',
    system: 'Whether everything is working, and what to do when something is not.',
  },

  // --- The top bar and run progress (design 2026-11-08 Rulings 10 and 11); main-path words only ---
  topBar: {
    /** The bar's first line: the health of the install, one word each for the worst problem (`barSummary`). */
    allWorking: 'All working',
    needsAttention: (name: string) => `${name} needs attention`,
    failing: (name: string) => `${name} failing`,
    severalNeedYou: (count: number) => `${count} things need you`,
    /** The link's tail: the Status page says what to do (the System page of Settings). */
    fix: 'fix',
    limitsLabel: 'Limits',
    /** The window in use: a monthly plan's month, or a trial's one-off allowance (`searchApiCallsLeft`). */
    callsLeftMonth: (left: number, cap: number) =>
      `SearchApi: ${thousands(left)} of ${thousands(cap)} ${noun(cap, 'call', 'calls')} left this month`,
    callsLeftTrial: (left: number, cap: number) =>
      `SearchApi: ${thousands(left)} of ${thousands(cap)} trial ${noun(cap, 'call', 'calls')} left`,
    spent: (used: string, cap: string) => `Spent ${used} of ${cap} this month`,
    spentNoCap: (used: string) => `Spent ${used} this month`,
    nearCap: 'near cap',
    searching: (name: string) => `Searching: ${name}`,
  },
  runProgress: {
    label: 'Search progress',
    /** The bar's own name, read with its value text. */
    barLabel: 'Dates read',
    calendar: (done: number, total: number, left: string | null) =>
      `Reading the calendar, ${thousands(done)} of ${thousands(total)} ${noun(total, 'date', 'dates')}${left === null ? '' : ` · ${left}`}`,
    minutesLeft: (minutes: number) => `about ${minutes} min left`,
    lessThanAMinuteLeft: 'less than a minute left',
    flights: (read: number) => `Reading flights for the cheapest dates, ${read} read so far`,
    resumesAt: (when: string) => `resumes ${when}`,
    childRun: (status: string) => `Reading flights for one more date: ${status}`,
    cancel: 'Cancel',
    confirmCancel: 'Confirm: cancel this run',
    keepRunning: 'Keep running',
    resume: 'Resume',
    working: 'Working…',
  },
  noCap: 'no cap',
  working: 'Working…',
  carriersIgnored: (entries: string) => `ignored, not two-character carrier codes: ${entries}`,
  clearFilters: 'Clear filters',

  // coverage view (spec §11 View D)
  coverageHeading: 'Coverage',
  coverageStage: 'Stage',
  coverageProvider: 'Provider',
  bucket: {
    priced: 'priced',
    empty: 'no fares',
    no_data: 'no cached data',
    error: 'error',
    skipped: 'skipped',
    not_run: 'not searched',
  } satisfies Record<BucketName, string>,
  coverageCells: 'cells',
  reusedNote: (n: number) => `(${n} reused from earlier runs)`,
  cellLabel: (o: string, d: string, dep: string, ret: string) => `${o} → ${d} ${dep} to ${ret}`,
  coverageSearched: 'searched (priced + no fares + no cached data)',
  coverageWithPrice: 'with a price',
  withPriceValue: (priced: number, total: number) => `${priced} of ${total}`,
  coverageCheckScroll: 'Coverage check months (scrolls sideways on a narrow screen)',
  coverageScroll: 'Coverage counts (scrolls sideways on a narrow screen)',
  coverageLegend: 'What the columns mean',
  bucketHelp: {
    priced:
      'priced: the provider returned a price for exactly this cell; for itinerary search that may be a price not confirmed by the final step.',
    empty: 'no fares: the provider said there are no fares for this cell.',
    no_data: 'no cached data: asked, nothing returned; this is not evidence that no flights exist.',
    error: 'error: the request failed; the error list below says why.',
    skipped:
      'skipped: deliberately not asked (not selected, over budget, provider disabled or not reachable, left for a later run, or departed).',
    not_run: 'not searched: not asked yet. Different from no fares: nobody has looked.',
  } satisfies Record<BucketName, string>,
  searchedHelp: 'searched: priced + no fares + no cached data, the cells a provider answered.',
  withPriceHelp: 'with a price: the cells that have a price, out of every cell.',
  coverageEmpty: 'No run yet, so nothing has been searched.',
  sumMismatch: (sum: number, total: number) => `buckets sum to ${sum}, not ${total}; report this`,
  selectedNotReached: 'Selected but not reached',
  reasonNotRun: 'not searched',
  reasonBudget: 'skipped: budget',
  noneSelectedNotReached: 'Every selected cell was reached.',
  // why: spec §3, §8.2 rev 36 — the browser provider's cells a run left, with core's text: who fetches them (the api's
  // browserLeftFor, review R12, S6) and why they were left
  scheduledOnlyHeading: (leftFor: string) => `${leftFor.charAt(0).toUpperCase()}${leftFor.slice(1)}`,
  scheduledOnlyRow: (provider: string, stage: string, n: number, why: string) =>
    `${provider} (${stage}): ${n} ${n === 1 ? 'cell' : 'cells'} left: ${why}`,
  overrunFlag: 'Overrun: ledger calls exceed the plan by more than 10%.',
  // why: cost-008: discovery is planned in tiles and a paged tile is one tile (decision 43), so its flag says tiles.
  overrunFlagTiles: 'Overrun: tiles requested exceed the plan by more than 10%.',
  parityFlag: 'Parity break: tile requests differ from the plan.',
  requestsHeading: 'Requests (estimate vs ledger)',
  // why: ruling 15 (UI-004): the children below the parent run, so View D never shows the parent's ledger as all spend.
  coverageOnDemandHeading: 'On-demand itinerary searches (one cell each)',
  coverageOnDemandNone: 'No on-demand itinerary search has run for this definition.',
  coverageOnDemandScroll: 'On-demand itinerary searches (scrolls sideways on a narrow screen)',
  coverageOnDemandCell: 'Cell',
  coverageOnDemandRun: 'Run',
  coverageOnDemandRunText: (status: string, started: string) => `${status}, started ${started}`,
  coverageOnDemandCalls: (calls: number, hits: number, cost: string) =>
    `${calls} ${calls === 1 ? 'call' : 'calls'} · ${hits} cache ${hits === 1 ? 'hit' : 'hits'} · ${cost}`,
  requestRow: (calls: number, planned: string, hits: number, cost: string) =>
    `${calls} of ${planned} planned ${noun(planned, 'call', 'calls')} · ${hits} cache ${noun(hits, 'hit', 'hits')} · ledger cost ${cost}, from configured rates`,
  requestRowTiles: (tiles: number, planned: string, calls: number, hits: number, cost: string) =>
    `${tiles} of ${planned} planned ${noun(planned, 'tile', 'tiles')} (${calls} ${noun(calls, 'call', 'calls')}) · ${hits} cache ${noun(hits, 'hit', 'hits')} · ledger cost ${cost}, from configured rates`,
  errorsHeading: 'Errors',
  // why: the contract's error reason is nullable; an unrecorded reason is said, never shown as an empty string.
  noReasonRecorded: 'no reason recorded',
  errorRow: (reason: string, attempts: number) =>
    `${reason} after ${attempts} attempt${attempts === 1 ? '' : 's'}`,
  lastError: (message: string) => `(${message})`,
  noErrors: 'No errors.',
  retry: 'Retry errors',

  // providers view (spec §10, §11)
  /**
   * WP14 (prov-008, prov-015, ruling 11): the camoufox provider's own words. Each page kind is worded distinctly, and
   * only a real CAPTCHA is called a challenge page; the adapter writes the same words to last_error.
   */
  camoufox: {
    pageKinds: {
      captcha: 'Google showed a challenge page (CAPTCHA)',
      'unusual-traffic': 'Google reported unusual traffic',
      'consent-unhandled': 'Google showed its cookie page (the rejection did not hold)',
      'sign-in': 'Google asked to sign in',
      'signed-in': 'the browser profile was signed in',
      'off-allowlist': 'Google sent the browser elsewhere',
      unrecognised: "Google's page was not one this app reads (it may have changed)",
    } satisfies Record<BlockedPage, string>,
    coolingDown: (until: string) => `cooling down until ${until}; Google was not contacted`,
    unavailable: 'browser worker not reachable',
    note: `Off by default. Reads Google Flights in Camoufox, a Firefox-based browser you have installed, in its own signed-out profile, from your own IP address, one day pair a page, at most one page every 30 seconds, so a run takes hours (${EXAMPLE_PAIR_CELLS} day pairs). Whenever a page is not a recognised results page (a challenge or verification page, a sign-in page, a consent page, or anything unrecognised) it stops and pauses (48 hours, or 1 hour for an unrecognised page). Read the provider's terms before enabling it; the operator is responsible for how it is used.`,
  },
  providersHeading: 'Price sources',
  providerEnabled: 'configured',
  providerDisabled: 'not configured',
  plan: (p: string) => `plan: ${p}`,
  planName: {
    trial: 'SearchApi trial credits (lifetime allowance)',
    '40usd': 'SearchApi $40 a month',
    free: 'free',
    synthetic: 'synthetic fixture',
  } satisfies Record<PlanId, string>,
  capability: (title: string, source: string, age: string) => `${title}: ${source} · ${age}`,
  capabilityDiscovery: 'Discovery',
  capabilityVerification: 'Itinerary search',
  maxAge: (age: string) => `prices up to ${age} old when fetched`,
  maxAgeUnknown: "vendor's cache age unknown",
  maxAgeAssumed: (age: string) => `assumed ≤${age} (undocumented)`,
  maxAgeAtFetch: 'provider states no age beyond the fetch time',
  usageWindow: (calls: number, cap: string, start: string, end: string) =>
    `${calls} of ${cap} ${noun(cap, 'call', 'calls')} · window ${start} to ${end}`,
  usageLifetime: (calls: number, cap: string) =>
    `${calls} of ${cap} ${noun(cap, 'call', 'calls')} over the plan's lifetime`,
  usageMonth: 'this month: ',
  usageNoWindow: (calls: number, cap: string) => `${calls} of ${cap} ${noun(cap, 'call', 'calls')}`,
  excludedFromSchedule: 'excluded from scheduled runs',

  // definitions form (spec §11)
  definitionsHeading: 'Definitions',
  definitionsList: 'Definitions to edit',
  newDefinition: 'New definition',
  editDefinition: (name: string) => `Edit ${name}`,
  name: 'Name',
  origins: 'Origins',
  destinations: 'Destinations',
  airportInputHelp: 'Type an airport code or name. A three-letter code is upper-cased.',
  addAirport: 'Add',
  addOrigin: 'Add origin',
  addDestination: 'Add destination',
  removeAirport: (code: string) => `Remove ${code}`,
  iataFormat: 'An airport code is three letters.',
  duplicateAirport: (code: string) => `${code} is already in the list.`,
  metroExpanded: (code: string, airports: string) => `${code} is a city code: added ${airports}.`,
  airportOption: (name: string, city: string, country: string) => `${name}, ${city}, ${country}`,
  destinationNote: (iata: string) => `Note for ${iata} (shown on every row)`,
  onwardCost: (iata: string) => `Onward cost to ${iata} in £ (optional, shown as a separate adjusted column)`,
  windowHeading: 'Departure window',
  windowRelative: 'Relative to today',
  windowAbsolute: 'Fixed dates',
  startOffsetDays: 'Starts in (days)',
  lengthDays: 'Length (days)',
  resolvedWindow: (from: string, to: string) => `departures from ${from} to ${to}, as resolved today`,
  windowFrom: 'From',
  windowTo: 'To',
  minNights: 'Min nights',
  maxNights: 'Max nights',
  cabin: 'Cabin',
  cabinName: {
    economy: 'economy',
    premium_economy: 'premium economy',
    business: 'business',
    first: 'first',
  } satisfies Record<Cabin, string>,
  constraintsHeading: 'Constraints',
  inPounds: (label: string) => `${label} (£)`,
  minutesAsHours: (text: string) => `= ${text}`,
  // why: one end of a time window alone is an unfinished constraint; say so rather than dropping it silently.
  required: 'required',
  invalidPounds: 'not an amount in pounds (for example 450 or 450.50)',
  blockedByRequired: 'Cannot estimate or save: fill in the required number fields.',
  creatingBlocked: 'Cannot create while a field above has an error.',
  bothEndsNeeded: 'both ends needed',
  blockedByTimeWindow: 'Cannot estimate or save: a time window needs both ends, or neither.',
  timeFrom: 'from',
  timeTo: 'to',
  airlinesHelp: 'comma-separated carrier codes',
  priceCeiling: 'Price ceiling in £ (optional)',
  bookingLinks: 'Fetch booking options',
  bookingLinksForced: 'Always on for SearchApi: its sellers can undercut the airline fare.',
  budgetHeading: 'Run budget',
  maxCalls: 'Max billed calls per run',
  maxFreeCalls: 'Max free calls per run',
  maxCost: 'Max cost per run in £',
  coverageCheck: 'Check free coverage',
  coverageCheckIntro:
    'Free check of the Aviasales cache for these airport pairs: date pairs with a cached price, of the date pairs in your nights range, per departure month. A count of 0 means the cache has nothing for that airport pair and month, not that there are no flights; "not checked" means the check could not read that month.',
  coverageCheckNeedsTravelpayouts: 'The free coverage check needs TRAVELPAYOUTS_TOKEN.',
  coverageCheckPair: (o: string, d: string) => `${o} → ${d}`,
  coverageCheckCalls: (n: number) => `${n} free ${noun(n, 'request', 'requests')} used`,
  coverageCheckMonth: 'Month',
  coverageCheckStale: 'The airports, window or nights changed since this check; run it again.',
  cachedOf: (rows: number, cells: number) => `${rows} of ${cells}`,
  importExample: (label: string) => `Import example (${label})`,
  fieldErrorsHeading: 'Fix these before saving:',
  fieldError: (field: string, message: string) => `${field}: ${message}`,
  definitionNotices: 'Notices for this search',
  budgetFitOk: (runs: number) => `Fits every cap at ${runs} ${noun(runs, 'run', 'runs')} a month:`,
  budgetFitWarn: (runs: number) => `Does not fit every cap at ${runs} ${noun(runs, 'run', 'runs')} a month:`,
  overCap: 'over the cap',
  // why: spec rev 55 §3 word table — "hard stop 6" reads "stops at 6" on the main path (ruling 20.5 concern 8)
  needsConfirmation: (p: { calls: number; cap: number; estimate: string; confirmed: string }) =>
    `The new estimate, about ${p.calls} ${noun(p.calls, 'call', 'calls')} (stops at ${p.cap}) and ${p.estimate} per run, is above what you confirmed (${p.confirmed}). Scheduled runs are skipped until you confirm.`,
  confirmedWas: (calls: string, amount: string) => `${calls} ${noun(calls, 'call', 'calls')}, ${amount}`,
  confirmNew: (calls: number, cap: number, amount: string) =>
    `Confirm about ${calls} ${noun(calls, 'call', 'calls')} (stops at ${cap}), ${amount} per run`,
  none: 'none',
  // --- WP20: the Searches view, the first screen (spec rev 55 §11); main-path words only ---
  searchesView: {
    heading: 'Trips',
    newSearch: '+ New search',
    listLabel: 'Your searches',
    sideHeading: 'New search',
    noSearches: 'No searches yet',
    codes: (origins: string, destinations: string) => `${origins} → ${destinations}`,
    windowSpan: (from: string, to: string) => `${from} – ${to}`,
    windowRolling: (lengthDays: number, startOffsetDays: number) =>
      `rolling: ${lengthDays} ${noun(lengthDays, 'day', 'days')} from ${startOffsetDays} ${noun(startOffsetDays, 'day', 'days')} ahead`,
    repeats: (days: readonly number[], time: string) =>
      days.length === 7
        ? `repeats every day ${time}`
        : `repeats ${listText(days.map((d) => DAY_PLURAL[d] ?? String(d)))} ${time}`,
    repeatsDaily: (time: string) => `repeats every day ${time}`,
    repeatsOther: 'repeats on a set schedule',
    // the state line
    datesChanged: 'Dates changed since this was last searched',
    notSearchedYet: 'Not searched yet',
    // why: the card's own words (design 2026-11-08 §5.3, Rulings 5 and 8); a sentence that shows a price takes its
    // label as a parameter, so the label sits inside the sentence
    tripsLabel: (name: string) => `Cheapest trips, ${name}`,
    leaveWindow: (span: string) => `leave ${span}`,
    searchedMeta: (ago: string) => `searched ${ago}`,
    allTripsAndDates: 'All trips and dates',
    allTripsAndDatesOf: (name: string) => `All trips and dates for ${name}`,
    datesWithFlightsRead: (n: number) =>
      `${thousands(n)} ${noun(n, 'date', 'dates')} with flights read; these are the cheapest.`,
    lowerLink: (n: number) =>
      `${thousands(n)} ${noun(n, 'date', 'dates')} ${noun(n, 'looks', 'look')} lower on the calendar`,
    lowerFrom: ', from',
    lowerTail: '.',
    calendarOnlyLink: (n: number) => `Calendar prices for ${thousands(n)} ${noun(n, 'date', 'dates')}`,
    calendarOnlyTail: '; no flights read yet.',
    previousRun: 'Trips from the previous search',
    // Ruling 8: why a finished search with no trip and no lower calendar price found nothing, the first that applies
    nothingFound: {
      stoppedBefore: (n: number) => `The search stopped before ${thousands(n)} ${noun(n, 'date', 'dates')}.`,
      browserUnavailable: (n: number) =>
        `The browser was unavailable for ${thousands(n)} ${noun(n, 'date', 'dates')}; the next search tries them again.`,
      couldntRead: (n: number) =>
        `${thousands(n)} ${noun(n, 'date', 'dates')} couldn't be read; the next search tries them again.`,
      browserOff:
        "The other sources found nothing, and the browser is off for this search. That isn't the same as no flights.",
      noPriceShown: "Every date showed no price. That isn't the same as no flights.",
      noneFit: "Prices were found, but none fit this search's limits.",
      nothing: "No prices were found. That isn't the same as no flights.",
    },
    turnOnBrowser: 'Turn on the browser for this search and search again',
    turnOnBrowserOf: (name: string) => `Turn on the browser for ${name} and search again`,
    turnOnBrowserFailed: (message: string) => `Couldn't turn the browser on: ${message}`,
    browserNotSetUp: 'The browser is not set up yet. Set it up in',
    browserNotSetUpLink: 'Settings',
    previousSearchDetail: 'Read by the previous search.',
    previousSearchReplaced: 'Read by the previous search; the search running now will replace it.',
    searchAgainOf: (name: string) => `Search again: ${name}`,
    edit: 'Edit',
    editOf: (name: string) => `Edit ${name}`,
    remove: 'Remove',
    removeOf: (name: string) => `Remove ${name}`,
    // remove, inline and undoable
    removeAsk: (name: string) => `Remove ${name}?`,
    cancelAndRemoveAsk: (name: string) => `Cancel and remove ${name}?`,
    removeConfirm: 'Remove',
    keep: 'Keep',
    removed: (name: string) => `Removed ${name}.`,
    undo: 'Undo',
    undoOf: (name: string) => `Undo removing ${name}`,
    removeFailedLine: (message: string) => `Could not remove: ${message}`,
    restoreFailedLine: (message: string) => `Could not undo: ${message}`,
  },
  // --- WP20: Search again and Search now, one button (spec rev 55 §8.1, §11) ---
  searchAgain: {
    label: 'Search again',
    searchNow: 'Search now',
    working: 'Searching…',
    startedUnread: (message: string) => `The search started, but its progress could not be read: ${message}`,
    // why: a refusal is said in plain words beside the button (spec §11); `already` is the 409 of a search that is running
    refused: {
      active: 'Already searching',
      cap: 'A spending limit stops this search from starting. Raise the limit in Edit, or search again when it resets.',
      disabled: 'No price source is set up, so nothing was searched. Set up a price source (Providers).',
      window: 'None of the dates in this search are still ahead. Change the dates in Edit.',
      'shutting-down': 'The app is shutting down, so nothing was started.',
      not_found: 'This search no longer exists.',
    } satisfies Record<string, string>,
  },
  // --- WP20 Task 20.5: the new-search form's press, its reasons and its failures (spec rev 55 §11) ---
  newSearch: {
    // design 2026-11-08 Ruling 13: the panel's press, its sources with their cost, and Edit's second fold
    search: 'Search',
    whereToLook: 'Where to look',
    source: {
      camoufox: 'Google Flights, in your browser',
      travelpayouts: 'Aviasales cache',
      searchapi: 'SearchApi',
    },
    sourceNote: {
      camoufox: 'free, takes a while',
      travelpayouts: "free, prices from other people's searches, often days old",
    },
    // why: fix round 1 — the run budget's cap is not what a run uses; the sentence states the run's own calls once ticked
    searchapiNote: (left: number | null) => `uses calls${left === null ? '' : `, ${thousands(left)} left`}`,
    /** A source not set up on this install, by the name the sentence gives it (lower case: the sentence capitalises). */
    sourceUnset: {
      camoufox: 'the browser',
      travelpayouts: 'the Aviasales cache',
      searchapi: 'SearchApi',
    },
    notSetUp: (names: readonly string[]) => {
      const list = listText(names);
      const many = names.length > 1;
      return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${many ? "aren't" : "isn't"} set up yet; set ${many ? 'them' : 'it'} up in`;
    },
    notSetUpLink: 'Settings',
    sourceInSearch: 'in this search',
    sourceInSearchUnset: 'in this search, but not set up here; untick it to stop using it',
    // Ruling 14: one Repeat control over the schedule
    repeat: 'Repeat',
    repeatMode: { never: 'Never', weekly: 'Weekly', other: 'Other' },
    repeatOther: (words: string) => `Other: ${words}`,
    repeatChange: 'Change',
    repeatChangeName: 'Change how this search repeats',
    limitsHeading: 'Limits and checks',
    estimateRegion: 'Estimate',
    working: 'Working out the estimate…',
    // why: the first reason the form cannot be estimated, as the button's accessible description (spec rev 55 §11)
    reasons: {
      airports: 'Enter From and To',
      dates: 'Enter the dates',
      datePast: 'The first date is before today',
      dateOrder: 'The last date is before the first',
      stay: 'Enter the stay',
      stayOrder: 'The shortest stay is longer than the longest',
      fields: 'Fix the fields marked above',
    },
    estimateFailed: (message: string) => `Couldn't work out the estimate: ${message}`,
    saveFailed: (message: string) => `Couldn't save the search: ${message}`,
  },
  // --- WP20 Task 20.5: Edit's two presses (spec rev 55 §11 Edit) ---
  editSearch: {
    heading: (name: string) => `Edit ${name}`,
    saveAndSearch: 'Save and search again',
    save: 'Save',
    saved: 'Saved.',
    startFailed: (message: string) => `Saved, but the search could not start: ${message}`,
    estimateChanged: 'Saved, but the estimate changed; check it and press again.',
  },
  // --- WP20 Task 20.5: Repeat weekly… on a search's page (spec rev 55 §8.2, §11) ---
  repeatWeekly: {
    open: 'Repeat weekly…',
    fieldsLabel: 'Repeat this search',
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Saved: this search now repeats.',
    stopped: 'This search no longer repeats.',
    stop: 'Stop repeating',
    change: 'Change',
    repeats: (days: string, time: string) => `Repeats ${days} ${time}`,
    repeatsDaily: (time: string) => `Repeats every day ${time}`,
    repeatsOther: 'Repeats on a set schedule',
    overBudget:
      'Repeating on this schedule would go over a monthly limit; see the monthly figure, or choose fewer runs.',
    monthHeading: 'Each month',
    pickSchedule: 'Choose when it repeats',
    estimateChanged: 'The estimate changed; check it and save again.',
  },
  // --- WP20 Task 20.6: a search's page, its header and state lines (spec rev 55 §3, §6.6, §11); main-path words only ---
  searchPage: {
    // the header (design 2026-11-08 §5, mockup 02; Ruling 18: a rolling window moves forward each day)
    leaveRolling: (span: string) => `leave ${span} (moves forward each day)`,
    eachWayUnder: (limit: string) => `each way under ${limit}`,
    actionsLabel: 'Actions for this search',
    // the run line (Rulings 6 and 7): when, the calendar's priced dates over the whole search, the dates with flights
    // read over every search so far, and the link to what was searched; never "all" or "every"
    searched: (when: string) => `Searched ${when}`,
    today: 'today',
    yesterday: 'yesterday',
    dayTime: (day: string, time: string) => `${day} ${time}`,
    span: (from: string, to: string) => `${from}–${to}`,
    fromOnly: (time: string) => `from ${time}`,
    calendarPrices: (priced: number, total: number) =>
      `calendar prices for ${thousands(priced)} of ${thousands(total)} ${noun(total, 'date', 'dates')}`,
    datesWithFlightsRead: (n: number) => `${thousands(n)} ${noun(n, 'date', 'dates')} with flights read`,
    whatWasSearched: 'what was searched',
    // the state
    stateLabel: 'Search state',
    notSearchedYet: 'Not searched yet',
    noSource: 'No price source is set up, so nothing was searched',
    noSourceFix: 'Set up a price source (Providers)',
    // why: the hidden live line says only the kind of state, so a poll that moves a count announces nothing new
    stateKind: {
      searching: 'Searching',
      reading: 'Reading flights',
      checking: 'Checking fares',
      stopped: 'Stopped',
      searched: 'Searched',
      changed: 'Dates changed',
    },
    // the filter row (Ruling 16)
    filterLabel: 'Filter',
    stay: 'Stay',
    stayShortest: 'Shortest stay',
    stayLongest: 'Longest stay',
    nights: 'nights',
    stayInvalid: 'a stay is two whole numbers, the first no larger than the second',
    from: 'From',
    to: 'To',
    onePerWeek: 'One per week',
    journeyChip: (limit: string) => `Each way under ${limit}`,
    journeyChipRemove: (limit: string) => `Remove the filter each way under ${limit}`,
    // Cheapest trips (Rulings 4 and 22)
    cheapestHeading: 'Cheapest trips',
    cheapestLead: 'Flights read for these dates.',
    noTrip: `${NO_TRIP_LEAD} Read flights on a date below to see trips with flights read.`,
    noTripLead: NO_TRIP_LEAD,
    noPriceInFilters: 'No date in these filters has a price found so far.',
    stillSearching: 'No prices yet: the search is still going.',
    overLimit: (n: number, limit: string) =>
      `${thousands(n)} ${noun(n, "date's", "dates'")} trips are over ${limit} each way.`,
    showMore: (n: number) => `Show ${n} more`,
    // Lower on the calendar (Ruling 5)
    lowerHeading: 'Lower on the calendar, flights not read',
    lowerLead:
      "The calendar shows these lower than the cheapest trip, but their flights haven't been read yet. Calendar prices often rise once flights are read.",
    lowerLeadNoTrip:
      "The lowest calendar prices. Their flights haven't been read yet, and calendar prices often rise once they are.",
    inAll: (n: number) => `${thousands(n)} ${noun(n, 'date', 'dates')} in all.`,
    seeAll: 'See all on the calendar',
    // the three folds under the calendar (Ruling 19): one group of details rows, each summary its one-line state
    folds: {
      groupLabel: 'More about this search',
      priceOverTime: 'Price over time',
      priceHeading: 'Lowest calendar price per search',
      lowestCalendar: 'lowest calendar price',
      priceNone: 'No calendar prices have been read for this search yet.',
      priceNotTrips: 'These are calendar prices, not trips with flights read.',
      fullHistory: 'Full price history',
      searched: 'What was searched',
      count: (n: number) => thousands(n),
      searchedSummary: (priced: number, total: number) =>
        `${thousands(priced)} of ${thousands(total)} ${noun(total, 'date', 'dates')} priced, ${thousands(total - priced)} not`,
      searchedNone: 'Not searched yet, so there is nothing to count.',
      // the five marks of core's `reducedMark`, each with the one thing it means
      marks: {
        priced: 'Calendar price found',
        'no-price-shown': 'No price listed',
        'couldnt-read': "Couldn't read",
        'not-reached': 'Not reached',
        'not-searched': 'Not searched',
      } satisfies Record<ReducedMark, string>,
      markNotes: {
        priced: 'A calendar price, not a fare.',
        'no-price-shown': "The calendar showed none. That isn't the same as no flights.",
        'couldnt-read': "The page didn't load; the next search tries them again.",
        'not-reached': 'The search stopped before these dates.',
        'not-searched': 'Not asked yet.',
      } satisfies Record<ReducedMark, string>,
      flightsRead: 'Flights read',
      flightsReadValue: (n: number) => `${thousands(n)} ${noun(n, 'date', 'dates')}`,
      flightsReadNote: 'Counted across every search so far.',
      thin: "Most of the dates searched had no price listed. That isn't the same as no flights.",
      fullLog: 'Full search log',
      fullLogNote: '(every run, source and outcome)',
      hideLog: 'Close the full search log',
      alert: 'Alert',
      alertOff: 'off',
      alertOn: (n: number) => `${thousands(n)} on`,
      alertNone: 'No alert is set for this search.',
      alertWatches: 'Alerts watch calendar prices, not trips with flights read.',
      changeAlerts: 'Change alerts',
      emailNotSet: "Email isn't set up yet",
      emailSetUp: 'set it up in Settings',
    },
  },
  // --- Trips and Search plan, Ruling 18 (Task 9): a search's calendar, its key and the day panel (mockup 02) ---
  calendar: {
    heading: 'Calendar',
    lead: (min: number, max: number) =>
      `Each day shows its cheapest trip with flights read, or else its lowest calendar price, for ${
        min === max
          ? `a stay of ${min} ${noun(min, 'night', 'nights')}`
          : `any stay from ${min} to ${max} nights`
      }. Pick a day to see its stays.`,
    monthsLabel: 'Months',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    // a day's name (Ruling 18): "Wed 11 Nov, £372, Calendar · 3h", "…, £412, Seller · 3h, trip with flights read"
    dayPrice: (day: string, price: string, label: string, trip: boolean) =>
      `${day}, ${price}, ${label}${trip ? ', trip with flights read' : ''}`,
    dayMark: (day: string, words: string) => `${day}, ${words}`,
    // a day without a price shown, by its mark; a priced day with none shown has no price that can be shown
    markWords: {
      priced: 'no price to show',
      'no-price-shown': 'no price',
      'couldnt-read': "couldn't read",
      'not-reached': 'not reached',
      'not-searched': 'not searched',
    } satisfies Record<ReducedMark, string>,
    notSeenAgain: 'not seen again',
    // what a day prints without a price: "no price", or the cross of a day that couldn't be read
    noPrice: 'no price',
    couldntReadGlyph: '×',
    tripGlyph: '●',
    // the key's five items (Ruling 18), each worded as the ruling gives it
    key: {
      label: 'Key',
      scale: 'Shade by price:',
      lower: 'lower',
      higher: 'higher',
      trip: 'a trip with flights read; other prices are calendar prices, not fares',
      couldntRead: "couldn't read",
      noPrice: "no price (not 'no flights')",
      hatched: 'hatched: not searched or not reached',
    },
    // the day panel: "Wed 11 Nov: 12 stays", five rows, then "Show 7 more stays"
    panelHeading: (day: string, n: number) => `${day}: ${thousands(n)} ${noun(n, 'stay', 'stays')}`,
    close: 'Close',
    showMore: (n: number) => `Show ${thousands(n)} more ${noun(n, 'stay', 'stays')}`,
    // a stay with no price to show: its word beside the dash, and its line (never "no flights" alone)
    stayName: {
      'no-price-shown': 'No price listed',
      'couldnt-read': "Couldn't read",
      'not-reached': 'Not reached',
      'not-searched': 'Not searched',
      'over-limit': 'Over your limit',
      unshown: 'No price to show',
    },
    stayLine: {
      'no-price-shown': "The calendar showed no price for these dates. That isn't the same as no flights.",
      'couldnt-read': "The calendar couldn't be read for these dates; the next search tries them again.",
      'not-reached': "The latest search stopped before these dates. They'll be searched next time.",
      'not-searched': "These dates weren't searched yet. They'll be searched next time.",
      'over-limit': (limit: string | null) =>
        limit === null
          ? 'Every price found for these dates is over the journey limit.'
          : `Every price found for these dates is over ${limit} each way.`,
      unshown: 'A price was found for these dates, but none can be shown here.',
    },
  },
  // --- WP20 Task 20.10: the flights on a search's page (spec rev 55 §11 Flights and Ties, §6.9, §2) ---
  // why: the flight list is Google's page as the browser worker read it, so its words name Google's list; "verified"
  // never appears here (a flight read is never checked with the airline). Amounts are PriceCells placed between these
  // pieces (ruling C3), so a sentence with a price is split around it.
  flights: {
    changes: (n: number) => (n === 0 ? 'direct' : `${n} ${noun(n, 'change', 'changes')}`),
    operatedBy: (carriers: string, operator: string) => `${carriers}, operated by ${operator}`,
    separator: ' · ',
    from: 'from',
    // why: every flight amount's source name on the main path (spec rev 55 §3): the browser worker's flight list
    sourceLabel: `${mainPathSource('camoufox')}'s flight list`,
    sellerLine: (seller: string, fare: string | null, n: number) =>
      `${fare === null ? seller : `${seller}, ${fare}`} · cheapest of ${n} ${noun(n, 'offer', 'offers')} read`,
    sellersNotRead: 'sellers not read',
    notEverySellerRead: 'not every seller read',
    // "2 return options unread, 1 for other airports or days"; the noun goes with the first count said
    returnCounts: (unread: number, other: number) => {
      const first = unread > 0 ? unread : other;
      const rest = [
        ...(unread > 0 ? ['unread'] : []),
        ...(other > 0 ? [`${unread > 0 ? `${other} ` : ''}for other airports or days`] : []),
      ];
      return `${first} return ${noun(first, 'option', 'options')} ${rest.join(', ')}`;
    },
    moreListed: (stated: number, read: number) =>
      `Google listed ${stated} return flights; this app read the first ${read}`,
    moreListedNoCount: 'Google listed more return flights than this app read',
    // status notes, with what happens next (spec rev 56 §11 "Status notes")
    returnTransient: (readNow: boolean) => `return flights not read: ${NEXT_READ(readNow)}`,
    returnSkipped: (why: string) => `return flights not read: ${why}`,
    returnNotVerified:
      'return flights are not yet read on this kind of machine; see the recording session in docs/setup.md',
    // a skipped step's rule in words (the worker's bounded rule tokens; an unknown one is worded generally)
    skippedRule: {
      spacing: 'the wait between pages ran past its time',
      'not-cheapest-view': 'the list was not on its Cheapest view',
      'second-selection': 'the second outbound could not be selected',
      reload: 'the list could not be loaded again',
    },
    skippedOther: 'a step before them was not made',
    reading: 'Reading flights…',
    // what the block's live region says when a read here ends (finding 3)
    readDone: (dates: string) => `Flights read for ${dates}`,
    readDoneReturns: (dates: string, n: number) =>
      `Flights read for ${dates}, ${n} return ${noun(n, 'flight', 'flights')}`,
    readNotDone: (dates: string) => `Flights not read for ${dates}`,
    // a refused read, worded from the api's code (and, for not_available, its reason; ruling A33), never its text
    busy: 'The browser worker is busy with a search; try again when it finishes',
    outsideSpace: "These dates are no longer in this search's dates",
    readFailed: "The flights couldn't be read just now; try again later",
    // one line under the list when flight lists cannot be read here
    unavailable: 'Flight times need the browser worker; set it up in Providers',
    unavailableCabin: 'Flight times are read for economy searches only',
    datesShort: (departure: string, back: string) => `${departure} → ${back}`,
  },
  // --- WP19: the Dates view (spec §11 Dates; revision 50) ---
  datesView: {
    scopeNights: (min: number, max: number) =>
      min === max ? `${min} ${noun(min, 'night', 'nights')}` : `${min}–${max} nights`,
    loadingFiltered: 'Loading dates for these filters',
    // --- spec rev 56 §6.9, §11 Board: the pairing figure and the flight read beneath a calendar figure (Task 21.7) ---
    // the words beside a pairing figure: whose price it is (design 2026-11-08 §4.1, operator ruling 2026-11-08)
    priceKind: {
      seller: "seller's price",
      'google-unread': "Google's price, sellers not read",
      'google-incomplete': "Google's price, not every seller read",
    } satisfies Record<'seller' | 'google-unread' | 'google-incomplete', string>,
    // 21.7 ui-008: "Out:" and "Back:" as the search's page block writes them
    pairingTimes: (out: string, back: string) => `Out: ${out} · Back: ${back}`,
    mismatchMark: 'Google listed from',
    fromPrice: 'from',
    pairingBeneath: (ago: string) => `return flights read ${ago}, older than this search's refresh:`,
    pairingOtherLimits: `${LIMITS_CHANGED}:`,
    pairingRead: {
      // why: design 2026-11-08 §5.1: "not checked" only when the date's flights were never read
      'not-read': 'flights not checked',
      'outbound-only': 'return leg not read',
      'no-pairing-read': 'no return flight read',
      'over-limit': 'no pairing within your limits read',
    },
    // 21.7 ui-008: no trailing colon when no reason is known (the contract always sends one)
    listFailed: (reason: string | null) => `flights couldn't be read${reason === null ? '' : `: ${reason}`}`,
    // 21.7 prov-004: the flight-lists request pending, and failed
    loadingFlights: 'loading flights',
    // --- design 2026-11-08 §5.5: how checking flights ended, in one line under the board. The operator reads "trips with
    // flights read", never "confirmed" (the price-not-confirmed mark owns that word) ---
    confirm: {
      dates: (n: number) => `${n} ${noun(n, 'date', 'dates')}`,
      trips: (n: number) => `${n} ${noun(n, 'trip', 'trips')} with flights read`,
      unread: (n: number) => `${n} couldn't be read`,
      checked: (dates: string, unread: string | null) =>
        `Checked ${dates}${unread === null ? '' : `, ${unread}`}`,
      checkedEvery: (unread: string | null) =>
        `Checked every date with a calendar price${unread === null ? '' : `, ${unread}`}`,
      // why: fewer than the target of trips: what the other dates' flights were (they are not "unchecked cheaper")
      fewTrips: "the other dates' flights didn't fit your limits or couldn't be read",
      cheaperUnchecked: (n: number) =>
        n === 1
          ? "1 date looks cheaper on the calendar but wasn't checked."
          : `${n} dates look cheaper on the calendar but weren't checked.`,
      cheaperStopped: (n: number) =>
        n === 1
          ? "1 date that looks cheaper on the calendar wasn't checked."
          : `${n} dates that look cheaper on the calendar weren't checked.`,
      unchecked: (n: number) => (n === 1 ? "1 date wasn't checked." : `${n} dates weren't checked.`),
      stopped: (dates: string, because: string) =>
        `Stopped checking flights after ${dates} because ${because}`,
      because: {
        window: "the browser's time ran out",
        returnsStopped: "return flights couldn't be read",
        cancelled: 'the search was cancelled',
        budget: 'a spending limit was reached',
        fatal: 'the app hit an error',
        other: 'the search stopped',
      },
      outboundOnly: "Trips couldn't be checked on this machine: it can't read return flights.",
      flagsUnread: "Trips couldn't be checked this run: the browser hadn't yet said what it can read.",
      running: (dates: number, trips: string) =>
        `Checking flights: ${dates} ${noun(dates, 'date', 'dates')} so far; ${trips}.`,
      // Ruling 22 (mockup 02): how a patient stop ended, "these five" only when the section shows those five, unfiltered
      patience: (reads: number, which: string) =>
        `Reading stopped after ${reads} reads in a row found nothing cheaper than ${which}.`,
      theseTrips: (n: number) => `these ${countWord(n)}`,
      cheapestTrips: (n: number) => `the ${countWord(n)} cheapest`,
    },
    // states
    noSearch: 'No search yet.',
    noSearchLink: 'Plan one under Searches',
    onDemandOnly: (n: number) =>
      `Not searched yet: ${thousands(n)} ${noun(n, 'date was', 'dates were')} checked on ${noun(n, 'its', 'their')} own so far, and the prices found are below.`,
    tooManyCells: (cells: number, bound: number) =>
      `This search covers ${thousands(cells)} combinations of dates and airports, more than the ${thousands(bound)} this page reads at once. Pick one airport in From or To above to bring it under ${thousands(bound)}.`,
    // the coverage section (Task 19.5; what the Coverage view held)
    coverageNotFiltered:
      'The filters above do not narrow this section: it covers the latest run over the whole search.',
  },
  // --- Design 2026-11-08 §5, §6.1 (trip-page plan Task 7): the Trip page, one pair of dates ending in a booking link.
  // Its main path never says definition, cell, date pair, basis, discovery, itinerary search, verdict, reused,
  // superseded or billed calls; a sentence that shows a price takes the price beside it, never inside its words ---
  trip: {
    heading: (departure: string, back: string) => `${departure} → ${back}`,
    nights: (n: number) => `· ${n} ${noun(n, 'night', 'nights')}`,
    cardLabel: 'Cheapest trip for these dates',
    caption: 'Cheapest trip read',
    // design §5.1: one label per price, `Kind · age`; the age turns amber once older than the search's refresh
    label: {
      seller: 'Seller',
      'google-price': 'Google price',
      'google-list': 'Google list',
      calendar: 'Calendar',
      cached: 'Cached',
      'not-seen-again': 'Not seen again',
    } satisfies Record<PriceLabelKind, string>,
    labelText: (kind: string, age: string) => `${kind} · ${age}`,
    // the summary's spoken name when the age is amber: the stale mark's words, said once
    labelStale: (label: string, staleWords: string) => `${label}, ${staleWords}`,
    // the detail's source line (spec rev 69: the provider, market and FX in the tap detail), in the main path's name
    // for the provider (spec rev 55 §3, `mainPathSource`): "Source: the browser worker."
    labelSource: (source: string) => `Source: ${source}.`,
    // design §5.1's tap details, two lines: what the price is, then its full age (core's formatAgeFull)
    labelDetail: {
      seller: (seller: string, offers: number) =>
        `A seller's price as Google's booking page listed it (${seller}, cheapest of ${offers}). Not checked with the seller or airline; it can change at checkout.`,
      // the search log's seller price, whose row keeps the seller's name but not how many were read
      sellerNamed: (seller: string) =>
        `A seller's price as Google's booking page listed it (${seller}). Not checked with the seller or airline; it can change at checkout.`,
      sellerSearchApi:
        "A seller's price from SearchApi's booking options. Not checked with the seller or airline; it can change at checkout. Your limits checked: stops, journey time.",
      'google-price':
        "Google's price for these two flights. No seller's price was read; the booking page may show a different total.",
      // Google's price for a pairing whose booking page was read in part (`google-incomplete`): some sellers were read
      'google-incomplete':
        "Google's price for these two flights, not every seller read; the booking page may show a different total.",
      'google-list':
        "Google's 'from' price for this outbound on its flight list. Its returns and sellers weren't read.",
      calendar:
        "Google's calendar price for these dates. Not a fare: no flights or sellers read, and your journey limit isn't checked.",
      cached: 'A price an Aviasales user saw, then cached. Not a fare quote.',
      'not-seen-again': "The latest search didn't find it again. Probably gone.",
    },
    sellerLine: (seller: string, n: number) => `${seller} · cheapest of ${n} ${noun(n, 'seller', 'sellers')}`,
    // design §5.3: the booking targets, best first; only an external link carries ↗ and says it opens a new tab
    bookOn: (host: string) => `Book on ${host} ↗`,
    bookOnGoogle: 'Book on Google Flights ↗',
    findOnGoogle: 'Find on Google Flights ↗',
    bookingPageLine: "Opens Google's booking page for these two flights, where the sellers are listed.",
    newTab: ', opens in a new tab',
    nameContext: (what: string) => `, ${what}`,
    priceJoin: ' · ',
    // the two legs (design §6.1): times with airports, the day ("lands Sun 29 Nov" when it arrives another day),
    // the leg's own duration, its changes and its airline
    out: 'Out',
    back: 'Back',
    lands: (date: string) => `lands ${date}`,
    // a leg's meta separator: a non-breaking space holds each "·" to the item before it, so a line that wraps at
    // 375 px never starts with one (deferred minor 22)
    legSeparator: '\u00a0· ',
    legDay: (date: string, lands: string | null) => (lands === null ? date : `${date}, ${lands}`),
    legName: (leg: string, departs: string, from: string, arrives: string, to: string) =>
      `${leg} ${departs} ${from} → ${arrives} ${to}`,
    // the actions (design §6.1): a free read by hand, and a SearchApi check only where it can run
    readFlights: (again: boolean, minutes: number) =>
      `${again ? 'Read flights again' : 'Read flights'} · free, ~${minutes} min`,
    tryAgain: (minutes: number) => `Try again · free, ~${minutes} min`,
    readStarted: 'Reading flights for these dates; this page follows the read.',
    checkWithSearchApi: 'Check with SearchApi · 1 credit',
    checkStarted: 'Checking these dates with SearchApi; the status bar follows it.',
    // what the card says in each state (design §6.1's table, Rulings 3 and 4)
    unreachable: "Can't reach the app's server; showing nothing rather than old prices.",
    retry: 'Retry',
    reading: (minutes: number) => `Reading flights for these dates… about ${minutes} min.`,
    calendarShowed: 'The calendar showed',
    sentenceEnd: '.',
    noneWithin: (ago: string, limits: string) => `Flights were read ${ago}: none within ${limits}.`,
    cheapestRead: 'The cheapest read was',
    cheapestReadLeg: (duration: string) => `, ${duration} out.`,
    otherLimits: (ago: string) => `Flights were read ${ago} under different limits from yours now.`,
    outboundOnly: (ago: string) => `Outbound flights were read ${ago}, but not their returns.`,
    noReturn: (ago: string) =>
      `Flights were read ${ago}, but Google listed no return for the outbounds tried.`,
    calendarOnly: `${READ_STATE_WORDS['not-read']} yet, so there's nothing to book here.`,
    // a failed read of the dates' flights, in the row's own words (`readStateWords`): "Flights couldn't be read: <why>."
    calendarFailed: (words: string) => `${words}. There's nothing to book here.`,
    calendarWithTrip: (ago: string) =>
      `The trip below was read ${ago}, longer ago than this search's refresh, and doesn't lead.`,
    readWithoutCalendar: (ago: string) =>
      `No calendar price for these dates; their flights were read by hand ${ago}.`,
    gone: "The latest search didn't find this price again. Probably gone.",
    overJourneyLimit: "Every price found for these dates is over the journey limit set on the search's page.",
    couldNotRead: "Google's page for these dates couldn't be read in the latest search. Nothing was saved.",
    noPrice:
      "Google's calendar listed no price for these dates in the latest search. That doesn't mean there are no flights.",
    notOffered:
      "The price sources had no data for these dates in the latest search. That doesn't mean there are no flights.",
    notReached:
      "These dates weren't reached: the latest search stopped at its limit. They'll be searched next time.",
    browserUnavailable:
      "These dates weren't searched: the browser wasn't available for the latest search. They'll be searched next time.",
    notSearched:
      "These dates weren't searched: the latest search stopped before reaching them. They'll be searched next time.",
    outsideWindow: "These dates are outside this search's dates now.",
    listFailed: (time: string, cause: string) =>
      `The flights page didn't load at ${time}: ${cause}. Nothing was saved.`,
    // the limits no flight read met (cardState's `failing`), in the order journey, stops, departure, arrival
    limitJourney: (hours: string) => `your ${hours} limit each way`,
    limitStops: (max: number) => `your ${max === 0 ? 'direct-only' : `${max}-change`} limit`,
    limitDeparture: 'your departure window',
    limitArrival: 'your arrival window',
    limitAny: 'your limits',
    // design §6.1 "Other flights on these dates": Google's own prices from the card's flight list
    otherHeading: 'Other flights on these dates',
    otherSub: "Google's own prices on its flight list. Sellers weren't read for these.",
    otherReturns: 'Other returns with this outbound',
    otherReturnsSecond: 'Returns with the other outbound tried',
    otherOutbounds: 'Other outbounds',
    returnsNotRead: 'returns not read',
    folded: (n: number, leg: 'outbound' | 'return', parts: string) =>
      `${n} more ${leg === 'outbound' ? noun(n, 'outbound', 'outbounds') : noun(n, 'return', 'returns')} read: ${parts}.`,
    foldedOver: (n: number, limit: string | null) =>
      limit === null ? `${n} outside your limits` : `${n} over your ${limit} limit`,
    foldedDearer: (n: number) => `${n} dearer`,
    showThem: 'Show them',
    // design §6.1 "About this price": what it is, when read, what was and wasn't checked, the other prices
    aboutSummary: 'About this price',
    aboutSub: "· what was and wasn't checked",
    about: {
      // the market the price was read in (design §5.1: in the tap detail and in About this price): "Priced for the UK
      // market."; final review M8: one natural sentence, and its own when the market wasn't stated
      market: (market: string) => `Priced for the ${market}.`,
      marketNotStated: "The market it was priced for wasn't stated.",
      seller: (seller: string, when: string) =>
        `is ${seller}'s price on Google's booking page for the two flights above, read by the browser ${when}.`,
      sellerSearchApi: (when: string) =>
        `is a seller's price from SearchApi's booking options, read ${when}.`,
      'google-price': (when: string) =>
        `is Google's price for the two flights above, read ${when}. No seller's price was read.`,
      'google-incomplete': (when: string) =>
        `is Google's price for the two flights above, read ${when}, not every seller read.`,
      calendar: (when: string) =>
        `is Google's calendar price for these dates, read ${when}. No flights or sellers were read.`,
      cached: (when: string) => `is a price an Aviasales user saw, cached ${when}. Not a fare quote.`,
      'not-seen-again': (when: string) =>
        `was read ${when}; the latest search didn't find it again. Probably gone.`,
      checkedJourney: (hours: string) => `Checked: both legs are under your ${hours} limit.`,
      checkedLimits: 'Checked: both legs are within your limits.',
      checkedSearchApi: 'Checked: your limits on stops and journey time.',
      notCheckedTrip: 'Not checked: the price with the seller or the airline, bags, fare rules.',
      notCheckedCalendar: 'Not checked: the flights, the sellers, your journey limit.',
      calendarShowed: "Google's calendar showed",
      forTheseDates: 'for these dates.',
      // final review I4: a calendar or cached price read for another airport pair than the card's names it
      forTheseDatesOn: (origin: string, destination: string) =>
        `for these dates on ${origin} → ${destination}.`,
      calendarNone: "Google's calendar: no price for these dates.",
      cachedShowed: 'The Aviasales cache showed',
      cachedNone: 'Aviasales cache: no price for these dates.',
      otherPair: (origin: string, destination: string, state: string) =>
        `${origin} → ${destination}: ${state}`,
      pairState: {
        priced: 'priced in the latest search',
        empty: 'no price listed in the latest search',
        no_data: 'no data in the latest search',
        error: "couldn't be read in the latest search",
        skipped: 'not searched in the latest search',
        not_run: 'not searched in the latest search',
      } satisfies Record<BucketName, string>,
    },
    // design §6.1 "Search log for these dates": one row per run or read by hand, newest first
    logSummary: 'Search log for these dates',
    logCount: (n: number, since: string) => `· ${n} ${noun(n, 'search', 'searches')} since ${since}`,
    logToday: (time: string) => `Today ${time}`,
    logCalendar: 'calendar',
    logFlights: 'flights',
    logByHand: 'read by hand',
    logFailed: (cause: string) => `couldn't read flights: ${cause}`,
    logOutboundOnly: 'outbound flights read, returns not',
    logNoReturn: 'flights read, no return listed',
    logNoneWithin: 'flights read, none within your limits',
    logOtherLimits: 'flights read under different limits',
    logNotRead: 'flights not read',
    logShowAll: (n: number) => `Show all ${n}, with each source`,
    logShowFewer: 'Show the newest five',
    logNone: '· none yet',
    agoUnknown: 'at a time not known',
    // the source beside a log price's label in "Show all N, with each source": "(the browser worker)"
    logSourceOf: (source: string) => `(${source})`,
    dayOffset: (n: number) => (n > 0 ? `+${n}` : `−${-n}`),
    // when a price was read, for About this price: "today at 16:42", "yesterday at 09:10", "on 12 Mar at 11:44"
    aboutWhen: {
      today: (time: string) => `today at ${time}`,
      yesterday: (time: string) => `yesterday at ${time}`,
      day: (date: string, time: string) => `on ${date} at ${time}`,
    },
  },
  historyView: {
    title: 'History',
    fetchChartTitle: 'Price by fetch date',
    connectorNote:
      'Each point is one run. A line joins two points only when they come from consecutive runs of this definition; a run that did not fetch the series breaks the line. No price was fetched between two points.',
    coloursRepeat: (lines: number, colours: number) =>
      `${lines} series share ${colours} ${noun(colours, 'colour', 'colours')}: tell them apart by the legend name and line style`,
    xAxisFetched: 'fetched (Europe/London)',
    // why: spec §8.2 rev 36 — a catch-up's prices keep their own fetch time; the run says which firing it stood for
    catchUpRun: (ran: string, missed: string) => `ran ${ran}, catch-up for ${missed}`,
    yAxis: 'price (GBP)',
    // why: ruling 6: SearchApi's price_insights series is the vendor's history for the one searched trip, not the route.
    routeChartTitle: 'Vendor price history for a searched trip (indicative): price by date',
    routeChartNote:
      "Each line is the vendor's own price history for one searched trip (the dates in its name), reported with an itinerary search; this app did not search those dates day by day. Indicative: not an offer, no seller, constraints not checked.",
    xAxisTravelDate: 'date of the vendor price',
    routeSeries: (vendor: string, trip: string | null, cabin: string) =>
      trip === null
        ? `${vendor}'s price history, trip unknown · ${cabin}, indicative`
        : `${vendor}'s price history for ${trip} · ${cabin}, indicative`,
    historyVendor: {
      searchapi: 'Google',
      travelpayouts: 'Aviasales',
      camoufox: 'Google',
      fixture: 'Synthetic fixture',
    } satisfies Record<ProviderId, string>,
    calendarSeries: (source: string, cabin: string) =>
      `${source} · ${cabin} · cheapest calendar price across this pair's cells, per run (constraints not checked)`,
    offerSeries: (source: string, seller: string, cabin: string) =>
      `${source} · itinerary offer · ${seller} · ${cabin}`,
    offerUnconfirmedSeries: (source: string, seller: string, cabin: string) =>
      `${source} · itinerary offer · ${seller} · ${cabin} · price not confirmed by the final step`,
    pairPrefix: (pair: string, name: string) => `${pair} · ${name}`,
    cheapestCell: (origin: string, destination: string, dep: string, ret: string) =>
      `cheapest searched cell ${origin}→${destination} ${dep}–${ret}`,
    cellChanged: 'a different cell from the previous point',
    routePicker: 'Route',
    // why: UI-010: the route view plots calendar series only, so it says where an itinerary offer's history is.
    offersPerItinerary:
      "Itinerary offers are shown per itinerary: open a row's price history in Results to see one.",
    pairOption: (origin: string, destination: string) => `${origin}→${destination}`,
    allPairs: (shown: number, total: number) =>
      shown === total ? 'All pairs' : `All pairs (first ${shown} of ${total})`,
    itineraryHeading: (route: string, departs: string, back: string, carriers: string) =>
      `${route} · ${departs} to ${back} · ${carriers}`,
    itineraryHash: (hash: string) => `itinerary ${hash}`,
    backToRoute: 'Show route history',
    spanLine: (runs: number, onDemand: number, from: string, to: string) =>
      `${runs} ${runs === 1 ? 'run' : 'runs'}${onDemand === 0 ? '' : ` and ${onDemand} on-demand ${onDemand === 1 ? 'search' : 'searches'}`} shown, ${from} to ${to}`,
    tableCaption: (series: string) => `${series}: every point, with provenance`,
    chartScroll: (title: string) => `${title}, chart (scrolls sideways on a narrow screen)`,
    tableScroll: (series: string) => `${series}: table of points (scrolls)`,
    whenColumn: 'Fetched (Europe/London)',
    travelDateColumn: 'Date',
    priceColumn: 'Price',
    detailColumn: 'Detail',
    cabinNotStated: 'cabin not stated',
    routeProvenance: (source: string, trip: string | null, cabin: string, pointOfSale: string, age: string) =>
      `${source} · indicative price history for ${trip ?? 'an unknown trip'} · ${cabin} · point of sale ${pointOfSale} · ${age}`,
    // why: prov-004: the repository stores vendor-stated GBP points only, so nothing on this table was converted.
    routeGbp: 'vendor-stated GBP, unconverted',
    empty: 'No price history yet for this selection. Each run adds a point.',
  },
  // Alerts view (WP11; spec §6.8, §11). "verified" appears only beside class-verified values.
  alertsView: {
    heading: 'Alerts',
    intro:
      'At most one email per rule each time a run stops (a run paused by a budget cap and later completed can send two): the ten cheapest matches and a count of the rest, each price with its source and age.',
    formLabel: 'New alert rule',
    ruleType: 'Rule type',
    typeAbsolute: 'Price at or below',
    typeDropPct: 'Drop by percent',
    typeDropAbs: 'Drop by amount',
    threshold: 'Threshold (£)',
    dropPct: 'Drop (%)',
    notSet: 'not set',
    basis: 'Basis',
    basisVerified: 'Itinerary-search basis (class verified or partially-verified)',
    basisCalendar: 'Calendar basis (constraints not checked)',
    requireAll: 'Only class verified (every constraint passed)',
    // the same three bases in the words the Search page's Alert fold uses (its main path says no "basis")
    plainBasis: {
      calendar: 'calendar prices, limits not checked',
      verified: 'flights read',
      requireAll: 'flights read, every limit passed',
    },
    requireAllCalendarNote:
      'Calendar prices carry no constraint checks, so this option applies to the itinerary-search basis only.',
    cooldown: 'Cooldown (hours)',
    cooldownHint: 'Default 336 h (two weeks), deliberately longer than a weekly schedule.',
    cooldownText: (hours: number) => `cooldown ${hours}h`,
    // the plain wording the Search page's Alert fold uses: days where the cooldown is a whole number of them
    plainCooldown: (hours: number) =>
      hours % 24 === 0
        ? hours === 24
          ? 'at most one email a day'
          : `at most one email every ${hours / 24} days`
        : `at most one email every ${hours} hours`,
    addRule: 'Add rule',
    deleteRule: 'Delete rule',
    deleteKeepsHistory: 'Deleting a rule stops it firing; its alert history below is kept.',
    notSaved: (message: string) => `Rule not saved: ${message}`,
    rulesHeading: 'Rules',
    noRules: 'No alert rules for this definition yet.',
    eventsHeading: 'Alert events',
    eventsTable: 'Alert events',
    eventsScroll: 'Alert events (scrolls sideways on a narrow screen)',
    noEvents: 'No alerts have fired for this definition yet.',
    colFired: 'Fired',
    colRule: 'Rule',
    colStatus: 'Status',
    colTrip: 'Trip',
    colPrice: 'Price',
    colPrevious: 'Previous price',
    colClass: 'Constraints',
    colReason: 'Reason',
    // why: decision 59 — only a later pass of its own execution resends a queued event; its reason says if one will
    status: { queued: 'not delivered', notified: 'sent', suppressed: 'suppressed' },
    listedAsNew: 'listed as new (not a drop)',
    classVerified: 'class verified',
    classPartial: (unverified: string) => `partially-verified; unverified: ${unverified}`,
    classUnchecked: 'constraints not checked',
    noPrevious: 'none',
    noReason: 'no reason recorded',
    payloadInvalid: 'invalid record: it does not match the alert format',
    reasonWithheld: 'reason withheld: its record is invalid',
  },

  // Status (spec §10 `GET /status`, §11 Status and the status bar; brief WP18 Task 18.6)
  statusView: {
    heading: 'System',
    /** "checked 40 s ago", "checked 3 min ago": from the report's own generatedAt. */
    checkedAgo: (seconds: number) =>
      seconds < 60 ? `checked ${seconds} s ago` : `checked ${Math.floor(seconds / 60)} min ago`,
    stale: (checked: string) => `stale, ${checked}`,
    notAnswering: 'The app is not answering.',
    // why: V11 (po-b1-011, ui-b1-003): an answer that is an error is not "not answering"; each is said in plain words
    signInRefused: 'The app refused the sign-in, so the report cannot be read. Sign in again.',
    reportFailed: 'The app answered with an error instead of a report; its log has the cause.',
    state: { ok: 'ok', warn: 'to check', fail: 'failing', off: 'off' } satisfies Record<
      apiContract.StatusState,
      string
    >,
    areaName: {
      app: 'App',
      database: 'Database',
      backups: 'Backups',
      schedule: 'Schedule',
      data: 'Data',
      provider: 'Provider',
      worker: 'Browser worker',
      consent: 'Consent',
      email: 'Email',
    } satisfies Record<apiContract.StatusArea, string>,
    /** What an off check is called in the folded line. */
    offName: {
      app: 'app',
      database: 'database',
      backups: 'backups',
      schedule: 'schedule',
      data: 'searches',
      provider: 'provider',
      worker: 'browser provider',
      consent: 'consent',
      email: 'email',
    } satisfies Record<apiContract.StatusArea, string>,
    offLine: {
      'not-set-up': (names: string) => `not set up: ${names}`,
      'awaiting-verification': (names: string) => `awaiting verification for this build: ${names}`,
      'not-visible': (names: string) => `not visible from here: ${names}`,
      disabled: (names: string) => `disabled: ${names}`,
    },
    cardLabel: (area: string, name: string | null) => (name === null ? area : `${area}, ${name}`),
    fixLabel: 'Fix:',
    noteLabel: 'Note:',
    copyCommand: (command: string) => `Copy command: ${command}`,
    copy: 'Copy',
    copied: 'Copied',
    selectedInstead: (command: string) => `Command, selected: ${command}`,
    providersLink: 'Providers view',
    coverageLink: 'Coverage in the Dates view',
    sendTest: 'Send test',
    sending: 'Sending…',
    testSent: 'Test email sent. Check the inbox, and the spam folder.',
    testNotConfigured: 'Email is not set up.',
    testLimit: 'A test email was sent a moment ago. Try again in a minute.',
    testFailed: 'The test email failed to send.',
    testFailedCall: (message: string) => `The test email request failed: ${message}`,
  },
  /** The shared trip and calendar rows (Trips and Search plan, Ruling 20): their column names, links and leg words. */
  rows: {
    head: { price: 'Price', dates: 'Dates', nights: 'Nights', out: 'Out', back: 'Back' },
    nights: 'Nights',
    nightsInline: (n: number) => `· ${n} ${noun(n, 'night', 'nights')}`,
    out: 'Out',
    back: 'Back',
    pair: (origin: string, destination: string) => `${origin} → ${destination}`,
    detailsFor: (dates: string, pair: string | null) =>
      pair === null ? `Details for ${dates}` : `Details for ${pair}, ${dates}`,
    readFlights: 'Read flights',
    // a stay with no price shows a dash where the price would be (its word beside it says why)
    noPrice: '—',
    readFlightsFor: (dates: string, pair: string | null) =>
      pair === null ? `Read flights for ${dates}` : `Read flights for ${pair}, ${dates}`,
    legTimes: (depart: string, arrive: string) => `${depart} → ${arrive}`,
    direct: 'direct',
    changes: (n: number) => `${n} ${noun(n, 'change', 'changes')}`,
    legJoin: ' · ',
    carrierJoin: ', ',
  },
  /** What a calendar price says of its flights, by the figure's read of them (`readStateWords`, one line each). */
  readState: {
    words: READ_STATE_WORDS,
    failed: (reason: string) => `Flights couldn't be read: ${reason}`,
  },
  /** The health line's words when the report cannot be had or is old (the line itself is `topBar`, from core's barSummary). */
  statusLink: {
    stale: (checked: string) => `Status: stale, ${checked}`,
    notAnswering: 'Status: app not answering',
    signInRefused: 'Status: sign-in refused',
    reportFailed: 'Status: report failed, see the app log',
  },
} as const;
