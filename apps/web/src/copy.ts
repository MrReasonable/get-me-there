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
  type Stage,
  TRUNCATED_NOTE,
  type Verdict,
  type VerdictClass,
} from '@gmt/core';
import type { z } from 'zod';

/** Derived from the contract (decision 46), so a new plan id or bucket fails `satisfies` here. */
/** The six buckets a progress line names (spec §3); `reused` sits inside its bucket and is not a seventh. */
type ProgressBuckets = {
  priced: number;
  empty: number;
  no_data: number;
  error: number;
  skipped: number;
  not_run: number;
};
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
/** The Results header's itinerary-search clause (spec §3, §11); see COPY.itineraryLine. */
function itineraryLine(c: { searched: number; selected: number; onDemand: number }): string {
  return c.selected === 0 && c.onDemand > 0
    ? ` · itinerary-searched ${c.onDemand} ${c.onDemand === 1 ? 'cell' : 'cells'} on demand; none selected by the run`
    : ` · itinerary-searched ${c.searched} of ${c.selected} selected +${c.onDemand} on demand`;
}

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
  /** The three-letter-or-less provider mark of the phone day face, where `providerShort`'s "synthetic" is 50 px wide. */
  providerMark: { travelpayouts: 'TP', searchapi: 'SA', fixture: 'syn' } satisfies Record<ProviderId, string>,
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
  // why: pft-008, po-008: a run that selected nothing beside on-demand searches says so in words, without a policy
  // clause for a stage it never had; "outbound" agrees with its number.
  itineraryLine,
  itineraryLineExpand: (c: { searched: number; selected: number; expandTop: number; onDemand: number }) =>
    c.selected === 0
      ? itineraryLine(c)
      : ` · itinerary-searched ${c.searched} of ${c.selected} selected (${c.expandTop} ${c.expandTop === 1 ? 'outbound' : 'outbounds'} each) +${c.onDemand} on demand`,
  noItinerarySearch: ' · itinerary search not configured',
  // why: ruling 16 (pft-006): when most cells came back "no cached data", say what would answer them; copy only.
  thinCoverage:
    'Most cells came back "no cached data", which is not evidence that no flights exist. Next: add SearchApi discovery to this definition, widen its airports, or run the Coverage check on the definition form.',
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
  // why: UI-010: "run" means a parent run everywhere; on-demand searches are counted apart.
  spanExecutions: (runs: number, onDemand: number) =>
    `across ${runs} ${runs === 1 ? 'run' : 'runs'}${onDemand === 0 ? '' : ` and ${onDemand} on-demand ${onDemand === 1 ? 'search' : 'searches'}`}; no single run status applies`,
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
  // why: ruling 4 (decision 67): the bar names every bucket; an umbrella ("searched", "attempted") is View D's alone.
  progress: (p: { stage: string; provider: string; buckets: ProgressBuckets; total: number }) =>
    `${p.stage} · ${p.provider}: ${p.buckets.priced} priced · ${p.buckets.empty} no fares · ${p.buckets.no_data} no cached data · ${p.buckets.error} error · ${p.buckets.skipped} skipped · ${p.buckets.not_run} not searched of ${p.total} cells`,
  progressSelected: (p: { provider: string; buckets: ProgressBuckets; selected: number }) =>
    `itinerary search · ${p.provider}: ${p.buckets.priced} priced · ${p.buckets.empty} no fares · ${p.buckets.no_data} no cached data · ${p.buckets.error} error of ${p.selected} selected · ${p.buckets.skipped} skipped · ${p.buckets.not_run} not searched`,
  progressLabel: (stage: string, provider: string) => `${stage} progress, ${provider}`,
  spendRunCalls: (calls: number, cap: string) => `this run: ${calls} of ${cap} billed calls`,
  spendRunFreeCalls: (calls: number, cap: string) => `this run: ${calls} of ${cap} free calls`,
  spendRunCost: (used: string, cap: string) => `this run: ${used} of ${cap}`,
  spendMonth: (used: string, cap: string) => `this month: ${used} of ${cap}`,
  spendProviderMonth: (provider: string, calls: number, cap: string) =>
    `this month: ${provider} ${calls} of ${cap} calls`,
  spendProviderLifetime: (provider: string, calls: number, cap: string) =>
    `${provider} ${calls} of ${cap} calls over the plan's lifetime`,
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
    `${calls} of ${planned} planned calls · ${hits} cache hits · ledger cost ${cost}, from configured rates`,
  requestRowTiles: (tiles: number, planned: string, calls: number, hits: number, cost: string) =>
    `${tiles} of ${planned} planned tiles (${calls} ${calls === 1 ? 'call' : 'calls'}) · ${hits} cache hits · ledger cost ${cost}, from configured rates`,
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
  maxAgeAssumed: (age: string) => `assumed ≤${age} (undocumented)`,
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
    glyphSymbol: { empty: '∅', no_data: '◇', error: '✕', skipped: '–', not_run: '○' },
    calendarPrice: 'calendar price',
    bandAria: (band: number) => `price band ${band + 1} of 5${band === 0 ? ', cheapest' : ''}`,
    flatAria: 'one shade: the scale is flat',
    hatchedAria: 'not on the colour scale',
    stay: (nights: number, back: string) => `${nights}n · back ${back}`,
    cachedFrom: 'cached from',
    glyphCount: (n: number, words: string) => `${n} ${words}`,
    // why: one symbol per meaning across the whole legend (review ui I2); the unconfirmed mark is priceMarkGlyph.unconfirmed.
    phoneMark: { partial: '◐' },
    phonePartial: 'part of the day not searched',
    phoneNights: (n: number) => `${n}n`,
    // why: ruling 4: the buckets that apply, in the spec §3 order, zero buckets left out; never the "searched" umbrella.
    bucketBreakdown: (b: {
      priced: number;
      empty: number;
      no_data: number;
      error: number;
      skipped: number;
      not_run: number;
    }) =>
      (
        [
          [b.priced, 'priced'],
          [b.empty, 'no fares'],
          [b.no_data, 'no cached data'],
          [b.error, 'error'],
          [b.skipped, 'skipped'],
          [b.not_run, 'not searched'],
        ] as const
      )
        .filter(([n]) => n > 0)
        .map(([n, words]) => `${n} ${words}`)
        .join(', '),
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
      coveragePartial:
        'counts under the price (e.g. "3 priced, 9 no cached data") name the buckets of its best-covered source; a striped square: part of the day not searched; per-source counts are in the panel',
      cachedFrom:
        'cached from £X: a cheaper calendar price exists for this day, with its destination and stay; constraints not checked',
      unconfirmed:
        'price not confirmed: an itinerary search priced this day, but the final step confirmed none of its prices',
      truncated: 'cheapest of the rows read: the provider returned more rows than were read for that month',
      stay: 'Nn · back <date>: the stay of the cheapest cell; the panel lists every cell of the day',
      bandNumber: 'the small number beside the day is its price band, 1 cheapest to 5 dearest',
      phone:
        'On a narrow screen a day shows its number, band, amount and one-glyph marks: ≠ price not confirmed, ◷ stale, … cheapest of the rows read, ↺ superseded by a later search, ◌ not seen in latest search, ◐ part of the day not searched; under the amount its provider, its age ("5d old", "age unknown") and "not checked" on a calendar price. A day without a price shows each glyph with its count. Open a day for the rest.',
      phoneProviders:
        'On a narrow screen the amount is followed by the provider: TP Travelpayouts (Aviasales cache), SA SearchApi (Google Flights via SearchApi), syn Fixture (synthetic fixture data).',
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
      verifyConfirmRefused: (message: string) => `Needs confirmation: ${message}`,
      verifyConflict: 'An itinerary search for this cell is already running.',
    },
  },
  durationView: {
    title: 'Duration',
    chartTitle: 'Cheapest found by stay length',
    chartNote:
      'n = priced cells behind each minimum; the legend gives n summed over all stay lengths. A tick marked with a star (*) = no source searched that stay length. A missing bar elsewhere means that series found no class-verified or calendar price; the table names each gap. Calendar bars are paler with a dashed outline (constraints not checked); a faded bar with a black outline is stale.',
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
    chartScroll: 'Cheapest found by stay length, chart (scrolls sideways on a narrow screen)',
    tableScroll: 'Cheapest found per stay length, table (scrolls sideways on a narrow screen)',
    staleLine: (stale: number, shown: number) =>
      `${stale} of ${shown} shown prices are stale (older than one refresh cycle by fetch age plus any known vendor age)`,
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
    routeProvenance: (source: string, trip: string | null, cabin: string, age: string) =>
      `${source} · indicative price history for ${trip ?? 'an unknown trip'} · ${cabin} · ${age}`,
    // why: prov-004: the repository stores vendor-stated GBP points only, so nothing on this table was converted.
    routeGbp: 'vendor-stated GBP, unconverted',
    rowLink: 'price history',
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
    requireAllCalendarNote:
      'Calendar prices carry no constraint checks, so this option applies to the itinerary-search basis only.',
    cooldown: 'Cooldown (hours)',
    cooldownHint: 'Default 336 h (two weeks), deliberately longer than a weekly schedule.',
    cooldownText: (hours: number) => `cooldown ${hours}h`,
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
    notRecorded: 'not recorded',
  },
} as const;
