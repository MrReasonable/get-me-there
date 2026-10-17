import {
  type apiContract,
  type Buckets,
  type Cabin,
  CONSTRAINT_LABELS,
  type ConstraintName,
  type ErrorReason,
  type ExecutionStatus,
  formatAgo,
  type MIXED_ERROR_REASON,
  type NoDataReason,
  type PARTIAL_EXPANSION,
  type PRICE_UNCONFIRMED,
  type ProviderId,
  type SkipReason,
  type SourceKind,
  type Stage,
  TRUNCATED_NOTE,
  type Verdict,
  type VerdictClass,
} from '@gmt/core';
import type { z } from 'zod';

/** Derived from the contract (decision 46), so a new plan id or bucket fails `satisfies` here. */
type PlanId = z.output<typeof apiContract.providersResponseSchema>['providers'][number]['plan'];
/** Every outcome reason core can write (review arch2-005): a new or renamed one fails `satisfies` in the panel's map. */
type OutcomeReasonKey =
  | SkipReason
  | NoDataReason
  | ErrorReason
  | typeof MIXED_ERROR_REASON
  | typeof PARTIAL_EXPANSION
  | typeof PRICE_UNCONFIRMED;
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
export const COPY = {
  appTitle: 'get-me-there',
  skipToContent: 'Skip to the main content',
  navLabel: 'Views',
  nav: {
    results: 'Results',
    calendar: 'Calendar',
    duration: 'Duration',
    history: 'History',
    coverage: 'Coverage',
    definitions: 'Definitions',
    alerts: 'Alerts',
    providers: 'Providers',
  },
  placeholder: 'This view is not available yet.',
  calendarPlaceholderHint:
    'Until it is, the Results filters slice the window by month: set "Departs on or after" and "Departs on or before".',
  definitionSelectorLabel: 'Search definition',
  noDefinitions: 'No search definitions yet. Create one under Definitions.',
  definitionNotFound: 'The definition in this link no longer exists. Pick another one above.',
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
  // why: a fixture-provider row that is not tagged synthetic cannot be trusted for any of its fields (ruling 3).
  rowWithheld: "details withheld: this row's provenance is invalid",
  withheldCell: 'withheld',
  provider: { travelpayouts: 'Travelpayouts', searchapi: 'SearchApi', fixture: 'Fixture' } satisfies Record<
    ProviderId,
    string
  >,
  source: {
    'authorised-cached': 'Aviasales cache',
    'scraped-aggregate': 'Google date grid via SearchApi',
    'scraped-search': 'Google Flights via SearchApi',
    synthetic: 'synthetic fixture data',
  } satisfies Record<SourceKind, string>,
  fxApprox: '≈',
  /** WP10 (decision 52): PriceCell's `face` marks on a phone day cell; the words stay in its title and spoken text. */
  priceMarkGlyph: {
    unconfirmed: '!',
    stale: '◷',
    ageUnknown: '?',
    truncated: '…',
    notSeen: '◌',
    superseded: '↺',
  },
  fxSpoken: (detail: string) => `approximately (${detail})`,
  fxTitle: (rateDate: string, source: string) => `converted to GBP at the ${rateDate} rate (${source})`,
  constraintsNotChecked: 'constraints not checked',
  notChecked: 'not checked',
  stale: 'stale',
  vendorAgeUnknown: "vendor's cache age unknown",
  // why: core's label, so web, email and the verdict list say the same words (decisions 37, 44).
  priceNotConfirmed: CONSTRAINT_LABELS.priceConfirmed,
  staleView: 'Every row here is older than one refresh cycle.',
  bandCheapest: (hours: number) => `cheapest in its ${hours}h travel-time band`,
  notSeenInLatest: (age: string) => `not seen in latest search (${age})`,
  truncatedNote: TRUNCATED_NOTE,
  // why: a newer parent search found this cell empty; the price stays visible, ranked after current rows (decision 54, 57).
  superseded: 'superseded by a later search',
  providerShort: { travelpayouts: 'TP', searchapi: 'SA', fixture: 'synthetic' } satisfies Record<
    ProviderId,
    string
  >,
  ageUnknown: 'age unknown',
  agoOf: (hours: number | 'unknown') => (hours === 'unknown' ? 'age unknown' : formatAgo(hours)),
  adjustedQualifier: 'incl. operator-entered onward cost',

  // classes, bases, verdicts (spec §3, §6.2, §6.9)
  classLabel: {
    verified: 'verified',
    'partially-verified': 'partially verified',
    failed: 'failed',
    unchecked: 'constraints not checked',
  } satisfies Record<VerdictClass | 'unchecked', string>,
  classSpoken: 'verdict class:',
  basisName: { verified: 'itinerary-search basis', calendar: 'calendar basis' },
  basisSwitchLabel: 'Price basis',
  // why: core's CONSTRAINT_LABELS is the one set of plain-English constraint names (web and email); kept
  // under COPY so the catalogue test sweeps it for banned words like every other string.
  constraint: CONSTRAINT_LABELS satisfies Record<ConstraintName, string>,
  verdictWord: { pass: 'pass', fail: 'fail', unverified: 'unverified' } satisfies Record<Verdict, string>,
  verdictGlyph: { pass: '✓', fail: '✗', unverified: '?' } satisfies Record<Verdict, string>,
  verdictLine: (constraint: string, verdict: string) => `${constraint}: ${verdict}`,
  verdictsHeading: 'Constraint verdicts',
  noVerdicts: 'No constraints evaluated for this row.',
  notApplied: (names: string) => `not applied: ${names}`,
  unverifiedList: (names: string) => `unverified: ${names}`,

  // results table
  columns: {
    expand: 'Details',
    price: 'Price',
    totalTime: 'Travel time',
    departure: 'Departure',
    return: 'Return',
    nights: 'Nights',
    destination: 'Destination',
    carriers: 'Carriers',
    stops: 'Stops',
    class: 'Class',
    fetched: 'Fetched',
    provider: 'Provider',
    adjusted: 'Adjusted (operator-entered onward cost)',
  },
  resultsTableLabel: 'Round trips found',
  sortBy: (column: string, dir: string) => `Sort by ${column}, ${dir}`,
  sortDir: { asc: 'ascending', desc: 'descending' },
  sortSelect: 'Sort rows by',
  sortOption: (column: string, dir: string) => `${column}, ${dir}`,
  serverOrder: 'server ranking (class, then price)',
  orderNow: (order: string) => `Order: ${order}`,
  sortedWithin: (column: string, shown: number, total: number) =>
    `sorted by ${column} within the cheapest ${shown} of ${total}`,
  showDetails: (what: string) => `Show details for ${what}`,
  hideDetails: (what: string) => `Hide details for ${what}`,
  detailsFor: (what: string) => `Details for ${what}`,
  rowName: (destination: string, departure: string, ret: string) => `${destination} ${departure} to ${ret}`,
  stopsValue: (out: number, back: number) => `${out} out · ${back} back`,
  nightsValue: (n: number) => `${n}n`,
  noRowsFromRun: 'This run has no rows on this basis. Coverage shows what was searched and what was not.',
  noRowsAfterFilter: 'No rows match these filters.',
  showingRows: (shown: number, total: number) => `showing ${shown} of ${total} rows (filters active)`,
  staleHidden: (n: number) => `${n} stale ${n === 1 ? 'row' : 'rows'} hidden`,
  failedHidden: (n: number) => `${n} failed ${n === 1 ? 'row' : 'rows'} hidden by default`,
  showFailed: 'Show failed rows',

  // results header (spec §11)
  headlineLead: 'cheapest found',
  headlineRest: (p: { destination: string; dates: string; basis: string; cls: string }) =>
    `${p.destination} ${p.dates} · ${p.basis} · ${p.cls}`,
  headlineOverall: 'overall, filters not applied',
  dateRange: (dep: string, ret: string, nights: number) => `${dep}–${ret} (${nights}n)`,
  noHeadline: 'No round trip found yet for this definition.',
  coverageLine: (c: {
    priced: number;
    empty: number;
    noData: number;
    error: number;
    skipped: number;
    notRun: number;
    total: number;
    reused: number;
  }) =>
    `discovery: ${c.priced} priced · ${c.empty} no fares · ${c.noData} no cached data · ${c.error} error · ${c.skipped} skipped · ${c.notRun} not searched of ${c.total} (${c.reused} reused)`,
  itineraryLine: (c: { searched: number; selected: number; onDemand: number }) =>
    ` · itinerary-searched ${c.searched} of ${c.selected} selected +${c.onDemand} on demand`,
  itineraryLineExpand: (c: { searched: number; selected: number; expandTop: number; onDemand: number }) =>
    ` · itinerary-searched ${c.searched} of ${c.selected} selected (${c.expandTop} outbounds each) +${c.onDemand} on demand`,
  noItinerarySearch: ' · itinerary search not configured',
  truncated: (shown: number, total: number) => `within the cheapest ${shown} of ${total}`,
  excludedByCurrentSpace: (n: number) =>
    `${n} rows outside the current window and nights range are not shown`,

  // view header (spec §11)
  executionsShown: (list: string) => `showing ${list}`,
  executionItem: (started: string, status: string, age: string) =>
    `run started ${started} (${status}, ${age})`,
  childExecutionItem: (started: string, status: string, age: string) =>
    `itinerary search for one cell, started ${started} (${status}, ${age})`,
  executionNotStarted: (status: string) => `run not started yet (${status})`,
  childExecutionNotStarted: (status: string) => `itinerary search for one cell, not started yet (${status})`,
  spanExecutions: (n: number) => `across ${n} ${n === 1 ? 'run' : 'runs'}; no single run status applies`,
  notCompletedBanner: (status: string) => `The latest run is ${status}; these results may be partial.`,
  noExecution: 'No run yet for this definition.',
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
    skipped_missed: 'skipped: missed while the app was stopped',
  } satisfies Record<ExecutionStatus, string>,
  stageName: { discovery: 'discovery', verification: 'itinerary search' } satisfies Record<Stage, string>,

  // status bar (spec §11)
  statusBarLabel: 'Run status',
  progress: (p: {
    stage: string;
    provider: string;
    verb: string;
    done: number;
    total: number;
    error: number;
    skipped: number;
    notRun: number;
  }) =>
    `${p.stage} · ${p.provider}: ${p.verb} ${p.done} of ${p.total} cells (${p.error} error) · ${p.skipped} skipped · ${p.notRun} not searched`,
  progressSelected: (p: {
    provider: string;
    done: number;
    selected: number;
    error: number;
    skipped: number;
    notRun: number;
  }) =>
    `itinerary search · ${p.provider}: attempted ${p.done} of ${p.selected} selected (${p.error} error) · ${p.skipped} skipped · ${p.notRun} not searched`,
  // why: the bar counts attempts (answered or failed); "searched" is View D's definition and excludes errors (ruling 1).
  progressVerb: { discovery: 'attempted', verification: 'attempted' } satisfies Record<Stage, string>,
  progressLabel: (stage: string, provider: string) => `${stage} progress, ${provider}`,
  spendRunCalls: (calls: number, cap: string) => `this run: ${calls} of ${cap} billed calls`,
  spendRunFreeCalls: (calls: number, cap: string) => `this run: ${calls} of ${cap} free calls`,
  spendRunCost: (used: string, cap: string) => `this run: ${used} of ${cap}`,
  spendMonth: (used: string, cap: string) => `this month: ${used} of ${cap}`,
  spendProviderMonth: (provider: string, calls: number, cap: string) =>
    `this month: ${provider} ${calls} of ${cap} calls`,
  nearCap: 'near cap',
  noCap: 'no cap',
  paused: (reason: string) => `Paused: ${reason}`,
  resumesAt: (when: string) => `resumes ${when}`,
  scheduleBlocked: (date: string) => `schedule blocked since ${date}`,
  childRun: (status: string) => `itinerary search for one cell: ${status}`,
  resume: 'Resume',
  cancel: 'Cancel',
  confirmCancel: 'Confirm: cancel this run',
  keepRunning: 'Keep running',
  runNow: (calls: number, cap: number, cost: string) =>
    `Run now: about ${calls} calls, hard stop ${cap} · ${cost}`,
  runNowUnestimated: 'Run now',
  working: 'Working…',
  runDetails: 'Progress and spend',
  runNowBlocked: 'The estimate is above what you confirmed; confirm it under Definitions before running.',

  // filters (spec §6.5)
  filtersHeading: 'Filter',
  filtersSummary: (n: number) => `Filters (${n} active)`,
  filterClass: 'Verdict class',
  filterProvider: 'Provider',
  filterMaxStops: 'Max stops',
  filterCarriers: 'Carriers (comma-separated codes)',
  carriersIgnored: (entries: string) => `ignored, not two-character carrier codes: ${entries}`,
  filterDestinations: 'Destination',
  filterMaxPrice: 'Max price (£)',
  filterNightsMin: 'Min nights',
  filterNightsMax: 'Max nights',
  filterDepartFrom: 'Departs on or after',
  filterDepartTo: 'Departs on or before',
  filterHideStale: 'Hide stale rows',
  filterUnverified: 'Has this constraint unverified',
  any: 'any',
  applyFilters: 'Apply',
  clearFilters: 'Clear filters',
  filtersDisabledCalendar: 'Stops and carriers are not known on the calendar basis.',

  // expanded row (spec §11)
  outbound: 'Outbound',
  inbound: 'Return',
  segment: (carrier: string, flight: number, from: string, dep: string, to: string, arr: string) =>
    `${carrier} ${flight} ${from} ${dep} → ${to} ${arr}`,
  noSegments: 'calendar price, no itinerary',
  layovers: 'Layovers',
  layover: (at: string, duration: string) => `${at}: ${duration}`,
  overnightLayover: 'overnight',
  selfTransfer: 'self-transfer: you re-check bags and the airlines do not protect the connection',
  airportChange: 'airport change',
  noLayovers: 'none',
  baggage: 'Baggage',
  cabinBag: { included: 'cabin bag included', 'not-included': 'cabin bag not included' },
  cabinBagUnknown: 'cabin bag not stated',
  checkedBags: (n: number) => `${n} checked bag${n === 1 ? '' : 's'}`,
  checkedBagsUnknown: 'checked bags not stated',
  conditions: 'Fare conditions',
  refundable: (v: boolean | undefined) =>
    v === undefined ? 'refunds not stated' : v ? 'refundable' : 'not refundable',
  changeable: (v: boolean | undefined) =>
    v === undefined ? 'changes not stated' : v ? 'changeable' : 'not changeable',
  seller: (s: string) => `sold by ${s}`,
  booking: 'Booking',
  noLink: 'no link',
  openOn: (host: string) => `open on ${host}`,
  continueOnForm: (host: string) => `continue on ${host} (sends a form)`,
  noSearchLink: 'no search link',
  hostShown: (host: string) => `(${host})`,
  otherOffers: 'Other sellers for this itinerary',
  summary: 'Summary',
  verifyCellFor: (cell: string) => `Search ${cell} for itineraries (uses billed calls)`,
  verifyStartedFor: (cell: string) => `Itinerary search started for ${cell}; the status bar follows it.`,

  // basis and calendar gap (spec §6.9, §11)
  calendarGapLead: (n: number) =>
    `${n} ${n === 1 ? 'cell has a calendar price' : 'cells have calendar prices'} (constraints not checked) below your reference verified price (latest seen, then fresh, then cheapest)`,
  calendarGapList: 'Cells to search',

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
  resultsScroll: 'Round trips found (scrolls sideways on a narrow screen)',
  coverageCheckScroll: 'Coverage check months (scrolls sideways on a narrow screen)',
  coverageScroll: 'Coverage counts (scrolls sideways on a narrow screen)',
  coverageLegend: 'What the columns mean',
  bucketHelp: {
    priced:
      'priced: the provider returned a price for exactly this cell; for itinerary search that may be a price not confirmed by the final step.',
    empty: 'no fares: the provider said there are no fares for this cell.',
    no_data: 'no cached data: asked, nothing returned; this is not evidence that no flights exist.',
    error: 'error: the request failed; the error list below says why.',
    skipped: 'skipped: deliberately not asked (not selected, over budget, provider disabled, or departed).',
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
  overrunFlag: 'Overrun: ledger calls exceed the plan by more than 10%.',
  parityFlag: 'Parity break: tile requests differ from the plan.',
  requestsHeading: 'Requests (estimate vs ledger)',
  requestRow: (calls: number, planned: string, hits: number, cost: string) =>
    `${calls} of ${planned} planned calls · ${hits} cache hits · ledger cost ${cost}, from configured rates`,
  errorsHeading: 'Errors',
  // why: the contract's error reason is nullable; an unrecorded reason is said, never shown as an empty string.
  noReasonRecorded: 'no reason recorded',
  errorRow: (reason: string, attempts: number) =>
    `${reason} after ${attempts} attempt${attempts === 1 ? '' : 's'}`,
  lastError: (message: string) => `(${message})`,
  noErrors: 'No errors.',
  retry: 'Retry errors',

  // providers view (spec §10, §11)
  providersHeading: 'Providers',
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
  maxAgeAtFetch: 'provider states no age beyond the fetch time',
  usageWindow: (calls: number, cap: string, start: string, end: string) =>
    `${calls} of ${cap} calls · window ${start} to ${end}`,
  usageLifetime: (calls: number, cap: string) => `${calls} of ${cap} calls over the plan's lifetime`,
  usageMonth: 'this month: ',
  usageNoWindow: (calls: number, cap: string) => `${calls} of ${cap} calls`,
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
  enabled: 'Enabled: scheduled runs happen',
  advanced: 'Advanced: constraints and policy',
  constraintsHeading: 'Constraints',
  inPounds: (label: string) => `${label} (£)`,
  minutesAsHours: (text: string) => `= ${text}`,
  // why: one end of a time window alone is an unfinished constraint; say so rather than dropping it silently.
  required: 'required',
  invalidPounds: 'not an amount in pounds (for example 450 or 450.50)',
  invalidWholeNumber: 'not a whole number',
  blockedByRequired: 'Cannot estimate or save: fill in the required number fields.',
  creatingBlocked: 'Cannot create while a field above has an error.',
  bothEndsNeeded: 'both ends needed',
  blockedByTimeWindow: 'Cannot estimate or save: a time window needs both ends, or neither.',
  timeFrom: 'from',
  timeTo: 'to',
  airlinesHelp: 'comma-separated carrier codes',
  policyHeading: 'Itinerary search policy',
  maxCells: 'Max cells per run',
  topN: 'Top N by discovery price',
  priceCeiling: 'Price ceiling in £ (optional)',
  perDepartureDateBest: 'Best cells per departure date (optional)',
  expandTop: 'Outbounds expanded per cell',
  bookingLinks: 'Fetch booking options',
  bookingLinksForced: 'Always on for SearchApi: its sellers can undercut the airline fare.',
  providersSection: 'Providers',
  discoveryProviders: 'Discovery',
  verificationProviders: 'Itinerary search',
  refreshHours: (provider: string) => `${provider} refresh interval (hours)`,
  budgetHeading: 'Run budget',
  maxCalls: 'Max billed calls per run',
  maxFreeCalls: 'Max free calls per run',
  maxCost: 'Max cost per run in £',
  scheduleHeading: 'Schedule',
  scheduleCron: 'Cron (blank: manual runs only)',
  scheduleTz: 'Time zone',
  coverageCheck: 'Check free coverage',
  coverageCheckIntro:
    'Free check of the Aviasales cache for these pairs: cells with a cached price, of the cells in your nights range, per departure month. A count of 0 means the cache has nothing for that pair and month, not that there are no flights; "not checked" means the check could not read that month.',
  coverageCheckNeedsTravelpayouts: 'The free coverage check needs TRAVELPAYOUTS_TOKEN.',
  coverageCheckPair: (o: string, d: string) => `${o} → ${d}`,
  coverageCheckCalls: (n: number) => `${n} free tile requests used`,
  coverageCheckMonth: 'Month',
  coverageCheckStale: 'The airports, window or nights changed since this check; run it again.',
  cachedOf: (rows: number, cells: number) => `${rows} of ${cells}`,
  importExample: (label: string) => `Import example (${label})`,
  showEstimate: 'Show estimate',
  estimateStale: 'The draft changed since this estimate; show the estimate again before creating.',
  save: 'Save changes',
  createConfirm: (calls: number, cap: number, amount: string) =>
    `Create and confirm about ${calls} calls (hard stop ${cap}), ${amount} per run`,
  created: 'Created. Scheduled runs use the calls and cost you confirmed.',
  saved: 'Saved.',
  fieldErrorsHeading: 'Fix these before saving:',
  fieldError: (field: string, message: string) => `${field}: ${message}`,
  estimateHeading: 'Estimate',
  estimateCells: (n: number) => `${n} cells`,
  estimateRow: (provider: string, stage: string, calls: number, cost: string, time: string) =>
    `${provider} ${stage}: ${calls} calls · ${cost} · about ${time}`,
  estimateTotal: (calls: number, cap: number, cost: string, time: string) =>
    `about ${calls} calls (hard stop ${cap}), ${cost} per run · about ${time}`,
  windowClamped: 'The window was moved to start tomorrow.',
  estimateBlocked: (reason: string) => `blocked: ${reason}`,
  definitionNotices: 'Notices for this definition',
  assumptions: 'Assumptions',
  budgetFitOk: (runs: number) => `Fits every cap at ${runs} runs a month:`,
  budgetFitWarn: (runs: number) => `Does not fit every cap at ${runs} runs a month:`,
  budgetScope: (scope: string, estimated: number, cap: string) =>
    `${scope}: ${estimated} estimated a month, cap ${cap}`,
  overCap: 'over the cap',
  needsConfirmation: (p: { calls: number; cap: number; estimate: string; confirmed: string }) =>
    `The new estimate, about ${p.calls} calls (hard stop ${p.cap}) and ${p.estimate} per run, is above what you confirmed (${p.confirmed}). Scheduled runs are skipped until you confirm.`,
  confirmedWas: (calls: string, amount: string) => `${calls} calls, ${amount}`,
  confirmNew: (calls: number, cap: number, amount: string) =>
    `Confirm about ${calls} calls (hard stop ${cap}), ${amount} per run`,
  none: 'none',
  // --- WP10 (spec §11 View B, View C, History; plan decisions 38, 44, 46, 48) ---
  calendarView: {
    title: 'Calendar',
    discoveryMarker: (
      b: { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number },
      total: number,
    ) =>
      `${b.priced} priced · ${b.empty} no fares · ${b.no_data} no cached data · ${b.error} error · ${b.skipped} skipped · ${b.not_run} not searched of ${total}`,
    countsInconsistent: 'counts inconsistent',
    verificationMarker: (searched: number, selected: number, onDemand: number) =>
      `itinerary-searched ${searched} of ${selected} selected +${onDemand} on demand`,
    verificationNotConfigured: 'itinerary search: no verification provider configured',
    noDiscoveryProvider: 'no discovery provider configured',
    noRunCoversDay: 'not searched yet: no run covers this day',
    providerNotSearched: (source: string) => `${source}: not searched yet for this day`,
    markerSource: (source: string, marker: string) => `${source}: ${marker}`,
    partlyVerified: (count: number) =>
      `${count} partially verified ${count === 1 ? 'itinerary' : 'itineraries'} found for this day (never the day price)`,
    glyphSymbol: { empty: '∅', no_data: '?', error: '!', skipped: '–', not_run: '○' },
    calendarPrice: 'calendar price',
    bandAria: (band: number) => `price band ${band + 1} of 5${band === 0 ? ', cheapest' : ''}`,
    flatAria: 'one shade: the scale is flat',
    hatchedAria: 'not on the colour scale',
    stay: (nights: number, back: string) => `${nights}n · back ${back}`,
    cachedFrom: 'cached from',
    glyphCount: (n: number, words: string) => `${n} ${words}`,
    phoneMark: { partial: '◐', unconfirmed: '!' },
    phonePartial: 'part of the day not searched',
    searchedFraction: (searched: number, total: number) => `${searched}/${total} searched`,
    destinationFilter: 'Destination',
    allDestinations: 'All destinations',
    colourBy: 'Colour by',
    empty: 'No days to show yet. The calendar fills in as cells are searched.',
    staleLine: (stale: number, shown: number, verifiedAfter: string) =>
      `${stale} of ${shown} shown prices are stale by fetch age plus any known vendor age (itinerary prices after ${verifiedAfter}, calendar prices after their provider's refresh interval)`,
    unconfirmedShort: 'price not confirmed',
    unconfirmedCells: (n: number) =>
      `price not confirmed: ${n} itinerary-searched ${n === 1 ? 'cell' : 'cells'} priced nothing the final step confirmed`,
    unconfirmedCellsFor: (n: number, destination: string) =>
      `price not confirmed: ${n} itinerary-searched ${destination} ${n === 1 ? 'cell' : 'cells'} priced nothing the final step confirmed`,
    monthNav: 'Month',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    legend: {
      title: 'Legend',
      scaleQuintile: (basis: string, days: number) =>
        `Colour: ${basis} prices on ${days} days, in five price bands (quintiles of the days shown)`,
      scaleFlatFew: (basis: string, days: number, min: number) =>
        `Colour: one shade for ${basis} prices on ${days} ${days === 1 ? 'day' : 'days'}; fewer than ${min} days are too few for price bands`,
      scaleFlatNarrow: (basis: string, days: number, min: string, max: string) =>
        `Colour: one shade for ${basis} prices on ${days} days; they span ${min}–${max}, less than 10%, too narrow for price bands`,
      scaleEmpty: (basis: string) => `Colour: no ${basis} prices to colour yet`,
      band: (band: number, min: string, max: string, days: number) =>
        `band ${band + 1}: ${min}–${max} (${days} ${days === 1 ? 'day' : 'days'})`,
      flatSwatch: (days: number) => `one shade: ${days} ${days === 1 ? 'day' : 'days'}`,
      hatched: (shown: 'verified' | 'calendar', days: number) =>
        `hatched: ${days} ${days === 1 ? 'day shows' : 'days show'} a ${shown === 'verified' ? 'class-verified' : 'calendar'} price instead and ${days === 1 ? 'is' : 'are'} not on this scale`,
      priceless: 'grey with a label: no price for this day',
      more: 'What the marks mean',
      dashed: 'dashed outline: a calendar price; constraints not checked',
      stale:
        'stale: older than one refresh cycle by fetch age plus any known vendor age; shown and labelled, never hidden. A price whose vendor age is unknown says "vendor\'s cache age unknown" instead',
      coverageFull:
        'S/M searched with a solid square: every cell of the day searched (priced, no fares or no cached data) by its best-covered source',
      coveragePartial:
        'S/M searched with a striped square: part of the day not searched; per-source counts are in the panel',
      cachedFrom:
        'cached from £X: a cheaper calendar price exists for this day, with its destination and stay; constraints not checked',
      unconfirmed:
        'price not confirmed: an itinerary search priced this day, but the final step confirmed none of its prices',
      truncated: 'cheapest of the rows read: the provider returned more rows than were read for that month',
      stay: 'Nn · back <date>: the stay of the cheapest cell; the panel lists every cell of the day',
      bandNumber: 'the small number beside the day is its price band, 1 cheapest to 5 dearest',
      phone:
        'On a narrow screen a day shows its number, band, amount and one-glyph marks: ! price not confirmed, ◷ stale, ? vendor cache age unknown, … cheapest of the rows read, ◐ part of the day not searched. Open a day for the rest.',
      glyphs: 'Days without a price show, with how many cells of the best-covered source:',
      skippedWhy: ' (a budget stop, a disabled provider or a passed date; reasons in the panel)',
    },
    panel: {
      title: (date: string) => `Departing ${date}`,
      close: 'Close',
      dayHeading: 'This day',
      dayVerified: 'cheapest class-verified price',
      dayPartlyVerified: 'cheapest partially verified itinerary',
      dayCalendar: 'cheapest calendar price',
      dayCell: (nights: number, back: string) => `${nights} nights · back ${back}`,
      cellPicker: 'Cell',
      cellOption: (origin: string, destination: string, nights: number, back: string) =>
        `${origin}→${destination} · ${nights} nights · back ${back}`,
      outcomes: 'Outcomes per run, stage and provider (newest run first)',
      columns: {
        run: 'Run',
        stage: 'Stage',
        provider: 'Provider',
        status: 'Outcome',
        reason: 'Reason',
        attempts: 'Attempts',
        fetched: 'Fetched (Europe/London)',
        detail: 'Detail',
        reused: 'Reused from',
      },
      run: (label: string) => `run ${label}`,
      latestRun: 'latest run',
      reasons: {
        not_selected: 'not selected for itinerary search',
        budget: 'stopped: a budget cap was reached',
        provider_disabled: 'provider disabled',
        departed: 'departure date has passed',
        'cabin-not-offered': "the provider does not offer this definition's cabin",
        auth: 'the provider refused the credentials',
        'rate-limit': 'the provider rate-limited the request',
        quota: "the provider's quota is used up",
        upstream: 'the provider failed',
        parse: "the provider's answer could not be read",
        network: 'network failure',
        'limiter-timeout': 'waited too long for a request slot',
        'fx-unavailable': 'no exchange rate available',
        'currency-unsupported': 'currency not supported',
        'unknown-airport-tz': 'airport time zone unknown',
        'no-return-legs': 'no return legs offered',
        'unmappable-carrier': 'carrier code not recognised',
        'bad-local-time': 'a flight time could not be read',
        'cell-mismatch': 'the answer was for different dates or airports',
        'no-priced-options': 'the provider answered with no priced options',
        mixed: 'several different errors',
        'partial-expansion': 'some outbound flights could not be expanded',
        'price-unconfirmed': 'price not confirmed by the final step',
      } satisfies Record<OutcomeReasonKey, string>,
      offersDropped: (n: number) => `${n} ${n === 1 ? 'offer' : 'offers'} could not be read and were dropped`,
      reasonRaw: (reason: string) => `other: ${reason}`,
      dash: '—',
      reusedFrom: (run: string) => `reused from ${run}`,
      prices: 'Prices for this cell',
      noPrices: 'No prices stored for this cell.',
      calendarPriceRun: (run: string) => `calendar price · ${run}`,
      observation: (seller: string, cls: string) => `itinerary offer · ${seller} · ${cls}`,
      showInResults: 'show in results',
      verifyCost: (maxCalls: number, headroom: number) =>
        `hard stop ${maxCalls} ${maxCalls === 1 ? 'call' : 'calls'} · ${headroom} ${headroom === 1 ? 'call' : 'calls'} of budget headroom left`,
      verifyNoHeadroom: 'No budget headroom left for this search.',
      verifyCostLoading: 'Loading what this search may spend…',
      verifyCapRefused: (message: string) => `Refused by a budget cap: ${message}`,
      verifyConflict: 'An itinerary search for this cell is already running.',
    },
  },
  durationView: {
    title: 'Duration',
    chartTitle: 'Cheapest found by stay length',
    chartNote:
      'n = priced cells behind each minimum; the legend gives n summed over all stay lengths. A star on the axis (13*) = no source searched that stay length. A missing bar elsewhere means that series found no class-verified or calendar price; the table names each gap. Calendar bars are paler with a dashed outline (constraints not checked); a faded bar with a black outline is stale.',
    xAxis: 'nights',
    yAxis: 'price (GBP)',
    tickNotSearched: (nights: number) => `${nights}*`,
    verifiedSeries: (n: number) => `min among verified (class verified, n=${n})`,
    verifiedShort: 'min among verified',
    calendarSeries: (source: string, n: number) => `calendar, ${source} (constraints not checked, n=${n})`,
    calendarShort: (source: string) => `calendar, ${source}`,
    nightsLabel: (n: number) => `${n} nights`,
    nightsLink: (n: number) => `${n} nights: show in results`,
    tooltipDetail: (n: number, departs: string) => `n=${n} · departs ${departs}`,
    seriesLine: (series: string, value: string) => `${series}: ${value}`,
    cellDetail: (n: number, departs: string) => `n=${n} · departs ${departs}`,
    notSearched: 'not searched',
    searchedNoPrice: 'searched, no price',
    partlySearchedNoPrice: (k: number, total: number) => `searched ${k} of ${total} cells, no price`,
    notItinerarySearched: 'not itinerary-searched',
    itinerarySearchedNoPrice: 'itinerary-searched, no class-verified price',
    partlyItinerarySearchedNoPrice: (k: number, total: number) =>
      `itinerary-searched ${k} of ${total} selected cells, no class-verified price`,
    tableCaption: 'Cheapest found per stay length, with provenance',
    staleLine: (stale: number, shown: number) =>
      `${stale} of ${shown} shown prices are stale (older than one refresh cycle by fetch age)`,
    empty:
      "No prices yet for any stay length in this definition's range. Run a search; Coverage shows what has been searched.",
  },
  historyView: {
    title: 'History',
    fetchChartTitle: 'Price by fetch date',
    connectorNote:
      'Each point is one run. A line joins two points only when they come from consecutive runs of this definition; a run that did not fetch the series breaks the line. No price was fetched between two points.',
    coloursRepeat: (lines: number, colours: number) =>
      `${lines} series share ${colours} colours: tell them apart by the legend name and line style`,
    xAxisFetched: 'fetched (Europe/London)',
    yAxis: 'price (GBP)',
    routeChartTitle: 'Route-level series (indicative): price by travel date',
    routeChartNote:
      'Reported by the vendor, not searched cell by cell; the vendor does not state its route scope or which date pairs it covers. Indicative: not an offer, no seller, constraints not checked.',
    xAxisTravelDate: 'travel date',
    routeSeries: (provider: string, cabin: string) => `${provider} route-level series, indicative · ${cabin}`,
    calendarSeries: (source: string, cabin: string) =>
      `${source} · ${cabin} · cheapest calendar price across this pair's cells, per run (constraints not checked)`,
    offerSeries: (source: string, seller: string) => `${source} · itinerary offer · ${seller}`,
    offerUnconfirmedSeries: (source: string, seller: string) =>
      `${source} · itinerary offer · ${seller} · price not confirmed by the final step`,
    pairPrefix: (pair: string, name: string) => `${pair} · ${name}`,
    cheapestCell: (origin: string, destination: string, dep: string, ret: string) =>
      `cheapest searched cell ${origin}→${destination} ${dep}–${ret}`,
    cellChanged: 'a different cell from the previous point',
    routePicker: 'Route',
    pairOption: (origin: string, destination: string) => `${origin}→${destination}`,
    allPairs: (shown: number, total: number) =>
      shown === total ? 'All pairs' : `All pairs (first ${shown} of ${total})`,
    itineraryHeading: (route: string, departs: string, back: string, carriers: string) =>
      `${route} · ${departs} to ${back} · ${carriers}`,
    itineraryHash: (hash: string) => `itinerary ${hash}`,
    backToRoute: 'Show route history',
    spanLine: (points: number, from: string, to: string) =>
      `${points} ${points === 1 ? 'run' : 'runs'} shown, ${from} to ${to}`,
    tableCaption: (series: string) => `${series}: every point, with provenance`,
    whenColumn: 'Fetched (Europe/London)',
    travelDateColumn: 'Travel date',
    priceColumn: 'Price',
    detailColumn: 'Detail',
    cabinNotStated: 'cabin not stated',
    routeProvenance: (source: string, cabin: string, age: string) =>
      `${source} · indicative route-level series · ${cabin} · ${age}`,
    rowLink: 'price history',
    empty: 'No price history yet for this selection. Each run adds a point.',
  },
} as const;
