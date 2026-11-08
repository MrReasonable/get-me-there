import {
  type apiContract,
  type BlockedPage,
  type Buckets,
  type Cabin,
  CONSTRAINT_LABELS,
  type ConstraintName,
  type ErrorReason,
  type ExecutionStatus,
  type FigureBasis,
  FLIGHT_LIST_COUNT,
  formatAgo,
  type MIXED_ERROR_REASON,
  mainPathSource,
  type NoDataReason,
  type PARTIAL_EXPANSION,
  type PRICE_UNCONFIRMED,
  PROVIDER_NAMES,
  type ProviderId,
  type SkipReason,
  type Stage,
  TRUNCATED_NOTE,
  type Verdict,
  type VerdictClass,
} from '@gmt/core';
import type { z } from 'zod';
import { DAY_PLURAL, listText } from './copy/setup.js';
import { EXAMPLE_PAIR_CELLS } from './example.js';

/** The singular noun for a count of exactly one (a number, or a cap already formatted as text), else the plural. */
const noun = (n: number | string, one: string, many: string): string => (String(n) === '1' ? one : many);

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

/** 21.7 prov-001: the head's clause when the first Back line shows a seller's stated price (spec rev 56 §11). */
const SELLER_SHOWN = "; the first Back price is a seller's stated price";
// final review B-M2 (ruling ui-006): the one lead phrase of a limit edit, on the board and the search's page block alike
const LIMITS_CHANGED = 'your limits have changed since these return flights were read';
// final review B-I3: what happens to a read that did not finish: tried again while a read would go now (the button
// shown beside the note; the step reads only the run's FLIGHT_LIST_COUNT cheapest date pairs: final re-review), else
// once the list is past 0.9 × the refresh, the reuse limit (two transient ends in a row: R-retry)
const NEXT_READ = (readNow: boolean): string =>
  readNow
    ? `tried again at the next search while among its ${FLIGHT_LIST_COUNT} cheapest date pairs, or press Read flights for this date now`
    : "read again once the read is nearly as old as this search's refresh";

export const COPY = {
  appTitle: 'get-me-there',
  skipToContent: 'Skip to the main content',
  navLabel: 'Views',
  // WP19 Task 19.7 (spec §11 layout): the nav's two tiers
  navTier: { decide: 'Decide', setup: 'Set up' },
  /** The phone's one nav row opens the full nav (departure board, Ian 2026-10-27). */
  navMenu: 'All views',
  nav: {
    searches: 'Searches',
    // why: the nav names this entry by the search last opened (spec rev 55 §11); this word is only the Record's key
    dates: 'Dates',
    // why: the date pair detail and the Edit page are not in the nav (spec §11); the words name the views in the Record every ViewId keys
    results: 'Results',
    history: 'History',
    definitions: 'Edit',
    alerts: 'Alerts',
    providers: 'Providers',
    status: 'Status',
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
  // why: a fixture-provider row that is not tagged synthetic cannot be trusted for any of its fields (ruling 3).
  rowWithheld: "details withheld: this row's provenance is invalid",
  withheldCell: 'withheld',
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
  bandCheapest: (hours: number) => `cheapest in its ${hours}h travel-time band`,
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
  adjustedQualifier: 'incl. operator-entered onward cost',

  // classes, bases, verdicts (spec §3, §6.2, §6.9)
  classLabel: {
    verified: 'verified',
    'partially-verified': 'partially verified',
    failed: 'failed',
    unchecked: 'constraints not checked',
  } satisfies Record<VerdictClass | 'unchecked', string>,
  classSpoken: 'verdict class:',
  // why: spec rev 56 §6.9, §11 (prov-006; 21.7 persona H1): a pairing figure is the cheapest of the sellers read for one
  // outbound and one return (never "the lowest seller price": only the sellers read are), never checked with the
  // airline; a card and the detail's header word it so, carrying no seller or count
  basisName: {
    verified: 'itinerary-search basis',
    calendar: 'calendar basis',
    pairing: 'cheapest of the sellers read, not checked with the airline',
  } satisfies Record<FigureBasis, string>,
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
  showingRows: (shown: number, total: number) =>
    `showing ${shown} of ${total} ${noun(total, 'row', 'rows')} (filters active)`,
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
    `${n} ${noun(n, 'row', 'rows')} outside the current window and nights range ${noun(n, 'is', 'are')} not shown`,

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
  // why: spec rev 55 §3 — the status bar speaks in main-path words; the coverage section keeps the set-up terms above
  barStageName: {
    discovery: 'the first pass across your dates',
    verification: 'checking fares',
  } satisfies Record<Stage, string>,

  // status bar (spec §11)
  statusBarLabel: 'Run status',
  // why: ruling 4 (decision 67): the bar names every bucket; an umbrella ("searched", "attempted") is View D's alone.
  // why: spec rev 55 §3, §11 — the bar shows a source's cells as the five marks (no fares and no cached data are both
  // "no price shown"), the stage and source in main-path words, and the six buckets under the count (`progressBuckets`).
  progress: (p: { stage: string; provider: string; buckets: ProgressBuckets; total: number }) =>
    `${p.stage} · ${p.provider}: ${p.buckets.priced} priced · ${p.buckets.empty + p.buckets.no_data} no price shown · ${p.buckets.error} couldn't be read · ${p.buckets.skipped} not reached · ${p.buckets.not_run} not searched of ${p.total} date and airport ${noun(p.total, 'pair', 'pairs')}`,
  progressSelected: (p: { provider: string; buckets: ProgressBuckets; selected: number }) =>
    `checking fares · ${p.provider}: ${p.buckets.priced} priced · ${p.buckets.empty + p.buckets.no_data} no price shown · ${p.buckets.error} couldn't be read of ${p.selected} chosen · ${p.buckets.skipped} not reached · ${p.buckets.not_run} not searched`,
  /** The six buckets under a progress count (spec §11: "the six buckets under the count"), the coverage section's terms. */
  progressBuckets: (b: ProgressBuckets) =>
    `${b.priced} priced · ${b.empty} no fares · ${b.no_data} no cached data · ${b.error} error · ${b.skipped} skipped · ${b.not_run} not searched`,
  progressLabel: (stage: string, provider: string) => `${stage} progress, ${provider}`,
  spendRunCalls: (calls: number, cap: string) =>
    `this run: ${calls} of ${cap} billed ${noun(cap, 'call', 'calls')}`,
  spendRunFreeCalls: (calls: number, cap: string) =>
    `this run: ${calls} of ${cap} free ${noun(cap, 'call', 'calls')}`,
  spendRunCost: (used: string, cap: string) => `this run: ${used} of ${cap}`,
  spendMonth: (used: string, cap: string) => `this month: ${used} of ${cap}`,
  spendProviderMonth: (provider: string, calls: number, cap: string) =>
    `this month: ${provider} ${calls} of ${cap} ${noun(cap, 'call', 'calls')}`,
  spendProviderLifetime: (provider: string, calls: number, cap: string) =>
    `${provider} ${calls} of ${cap} ${noun(cap, 'call', 'calls')} over the plan's lifetime`,
  nearCap: 'near cap',
  noCap: 'no cap',
  resumesAt: (when: string) => `resumes ${when}`,
  scheduleBlocked: (date: string) => `schedule blocked since ${date}`,
  childRun: (status: string) => `checking fares for one date pair: ${status}`,
  /** The bar names the search whose run it shows when the view does not (ruling R-bar). */
  barSearchName: (name: string) => `${name}:`,
  monthSpendLabel: 'Spend this month',
  resume: 'Resume',
  cancel: 'Cancel',
  confirmCancel: 'Confirm: cancel this run',
  keepRunning: 'Keep running',
  working: 'Working…',
  runDetails: 'Progress and spend',
  // WP19 Task 19.7 (spec §11): the status bar's progress breakdown links to the Dates view's coverage section
  progressCoverageLink: 'Coverage of this search',

  // filters (spec §6.5)
  filtersHeading: 'Filter',
  filtersSummary: (n: number) => `Filters (${n} active)`,
  filterClass: 'Verdict class',
  filterProvider: 'Provider',
  filterMaxStops: 'Max stops',
  filterCarriers: 'Carriers (comma-separated codes)',
  carriersIgnored: (entries: string) => `ignored, not two-character carrier codes: ${entries}`,
  filterMaxPrice: 'Max price (£)',
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
  enabled: 'Enabled: scheduled runs happen',
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
  scheduleHeading: 'Schedule',
  scheduleTz: 'Time zone',
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
    heading: 'Searches',
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
    searching: (done: number, total: number, left: string | null) =>
      `Searching · ${done} of ${total} date ${noun(total, 'pair', 'pairs')}${left === null ? '' : ` · ${left}`}`,
    readingFlights: (read: number, planned: number) => `Reading flights · ${read} of ${planned}`,
    left: (span: string) => `about ${span} left`,
    lessThanAMinuteLeft: 'less than a minute left',
    searchedAgo: (ago: string) => `Searched ${ago}`,
    // why: the card's screen-reader line says only the kind of state, so a poll that changes a count announces nothing
    stateKind: {
      searching: 'Searching',
      flights: 'Reading flights',
      changed: 'Dates changed',
      searched: 'Searched',
      never: 'Not searched yet',
    },
    datesChanged: 'Dates changed since this was last searched',
    notSearchedYet: 'Not searched yet',
    neverSearched: (never: number, total: number) =>
      `${never} of ${total} date ${noun(total, 'pair', 'pairs')} never searched`,
    cheapestSoFar: 'cheapest so far',
    trip: (departure: string, back: string) => `${departure} → ${back}`,
    // actions
    seeDates: 'See dates',
    seeDatesOf: (name: string) => `See dates for ${name}`,
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
    // the header
    route: (cities: string, codes: string) => `${cities} (${codes})`,
    windowSpan: (from: string, to: string) => `${from} – ${to}`,
    windowRolling: (lengthDays: number, startOffsetDays: number, span: string) =>
      `rolling: ${lengthDays} ${noun(lengthDays, 'day', 'days')} from ${startOffsetDays} ${noun(startOffsetDays, 'day', 'days')} ahead, now ${span}`,
    actionsLabel: 'Actions for this search',
    // the header line: when, then the five marks' counts, the reused count and the sources (never "all" or "every")
    searched: (when: string) => `Searched ${when}`,
    today: 'today',
    yesterday: 'yesterday',
    dayTime: (day: string, time: string) => `${day} ${time}`,
    span: (from: string, to: string) => `${from}–${to}`,
    fromOnly: (time: string) => `from ${time}`,
    pricedOf: (priced: number, total: number) =>
      `${priced} of ${total} date ${noun(total, 'pair', 'pairs')} priced`,
    noPriceShown: (n: number) => `${n} showed no price`,
    notSearched: (n: number) => `${n} not searched`,
    notReached: (n: number) => `${n} not reached`,
    couldntRead: (n: number) => `${n} couldn't be read`,
    reused: (n: number) => `(${n} reused from earlier runs)`,
    // the state line
    stateLabel: 'Search state',
    readingFlights: (done: number, planned: number, left: string | null) =>
      `Reading flights · ${done} of ${planned} date ${noun(planned, 'pair', 'pairs')}${left === null ? '' : ` · ${left}`}`,
    checkingFares: 'Checking fares for the cheapest date pairs',
    flightsReadFor: (done: number, planned: number) =>
      `flights read for ${done} of ${planned} date ${noun(planned, 'pair', 'pairs')}`,
    flightsRest: {
      window: "the rest were left: outside this run's browser window",
      // why: spec rev 64: only a run stored before the browser's monthly caps were withdrawn ends this way
      'monthly-cap': "the rest were not read: the browser worker's monthly page limit",
      stopped: 'the rest were not read: a limit for this run',
      disabled: 'the rest were not read: the browser worker was paused for this run',
      failed: "the rest couldn't be read",
    },
    flightsFailed: (n: number) => `${n} couldn't be read`,
    flightsNotRead: 'flights not read: the browser worker was paused for this run',
    noneSearched: (total: number) => `0 of ${total} searched`,
    stoppedBoard: 'The board shows the prices found before the stop.',
    notSearchedYet: 'Not searched yet',
    noSource: 'No price source is set up, so nothing was searched',
    noSourceFix: 'Set up a price source (Providers)',
    cancel: 'Cancel',
    resume: 'Resume',
    // why: the hidden live line says only the kind of state, so a poll that moves a count announces nothing new
    stateKind: {
      searching: 'Searching',
      reading: 'Reading flights',
      checking: 'Checking fares',
      searched: 'Searched',
      changed: 'Dates changed',
    },
    // the stale mark's header label (spec rev 55 §3: the stale mark's words, only when true)
    staleAll: (mark: string) => `Every price shown is ${mark}.`,
    or: ' or ',
    // the next move on thin coverage (spec §11), in main-path words
    thinCoverage:
      'Most date pairs came back "no cached data", which is not evidence that no flights exist. Next: add Google Flights via SearchApi to the first pass across your dates, widen the airports, or run the coverage check on the Edit page.',
    // the calendar-gap banner (spec §6.9, §11), in main-path words: each entry is a date pair on one airport pair
    gapList: 'Date pairs to check',
    gapLead: (n: number) =>
      `${n} ${n === 1 ? 'date pair on one airport pair has a calendar price' : 'date pairs on their airport pairs have calendar prices'} (constraints not checked) below your reference verified price (latest seen, then fresh, then cheapest)`,
  },
  // --- WP20 Task 20.10: the flights on a search's page (spec rev 55 §11 Flights and Ties, §6.9, §2) ---
  // why: the flight list is Google's page as the browser worker read it, so its words name Google's list; "verified"
  // never appears here (a flight read is never checked with the airline). Amounts are PriceCells placed between these
  // pieces (ruling C3), so a sentence with a price is split around it.
  flights: {
    // the outcome beside the figure, from the figure's own airport pair's list only (persona-003, prov-r2-004)
    outcomeFrom: "Google's list: from",
    outcomeAt: (when: string) => `, ${when}`,
    notInList: "not in Google's list",
    showedNone: "Google's list showed no flights",
    // the block's provenance note (spec rev 55 §2): the age, and the date and time when not read today
    head: (ago: string, when: string | null) =>
      `Outbound flights only · each price is the lowest round trip listed with it · read ${ago}${when === null ? '' : `, ${when}`} · prices from Google Flights, not checked with the airline`,
    // spec rev 56 §11 (21.7 ui-003/004, prov-001, code I2): the one-sentence head of a list whose return read is `read`
    // with returns, naming the outbound the pairing used; each "from" price says itself what it is, so the head names
    // only the seller's stated price, and only when the first Back line shows one (`seller`); after a limit edit the
    // outbound is named as selected under the limits when read, never "within your limits"
    // why: 21.7 re-review N3: `returnsFit` false says no return of that outbound is within the limits, beside it
    headPairing: (
      which: 'cheapest' | 'next-cheapest',
      seller: boolean,
      ago: string,
      when: string | null,
      returnsFit = true,
    ) =>
      `Outbound flights, and the return flights for the ${which} outbound read within your limits${returnsFit ? '' : ' (none of its return flights is within your limits)'}${seller ? SELLER_SHOWN : ''} · read ${ago}${when === null ? '' : `, ${when}`} · prices from Google Flights, not checked with the airline`,
    headPairingOver: (seller: boolean, ago: string, when: string | null) =>
      `Outbound flights, and the return flights for the cheapest outbound read, which is over your limits${seller ? SELLER_SHOWN : ''} · read ${ago}${when === null ? '' : `, ${when}`} · prices from Google Flights, not checked with the airline`,
    headPairingWhenRead: (
      which: 'cheapest' | 'next-cheapest' | 'over',
      seller: boolean,
      ago: string,
      when: string | null,
    ) =>
      `Outbound flights, and the return flights for the ${which === 'over' ? 'cheapest outbound read, which was over your limits when read' : `${which} outbound read, selected under your limits when read`}, ${ago}${when === null ? '' : `, ${when}`}${seller ? SELLER_SHOWN : ''} · prices from Google Flights, not checked with the airline`,
    returnsNone: 'Google listed return flights, none this app could read for these airports and dates',
    otherPair: (origin: string, destination: string) =>
      `Flights read for ${origin} → ${destination}, not the priced airports`,
    // one flight: "depart 07:15, arrive 18:05 +1 · 10h 50m · 1 change · Virgin Atlantic · from £478 round trip"
    times: (departs: string, arrives: string, dayOffset: number) =>
      `depart ${departs}, arrive ${arrives}${dayOffset > 0 ? ` +${dayOffset}` : ''}`,
    changes: (n: number) => (n === 0 ? 'direct' : `${n} ${noun(n, 'change', 'changes')}`),
    operatedBy: (carriers: string, operator: string) => `${carriers}, operated by ${operator}`,
    separator: ' · ',
    from: 'from',
    roundTrip: 'round trip',
    // why: every flight amount's source name on the main path (spec rev 55 §3): the browser worker's flight list
    sourceLabel: `${mainPathSource('camoufox')}'s flight list`,
    // each flight against the search's limits (spec rev 55 §11; persona-010)
    within: (duration: string, limit: string) =>
      `outbound ${duration}, within your ${limit} limit; return not read`,
    overLimit: (duration: string, limit: string) => `outbound ${duration}: over your ${limit} limit`,
    // spec rev 56 §6.2, §11: both legs' marks (no window on a return: the definition has none)
    legs: { outbound: 'outbound', return: 'return' } satisfies Record<'outbound' | 'return', string>,
    withinLeg: (leg: string, duration: string, limit: string) =>
      `${leg} ${duration}, within your ${limit} limit`,
    overLimitLeg: (leg: string, duration: string, limit: string) =>
      `${leg} ${duration}: over your ${limit} limit`,
    stopsOver: (leg: string, n: number, max: number) =>
      `${leg} ${n === 0 ? 'direct' : `${n} ${noun(n, 'change', 'changes')}`}: over your ${max === 0 ? 'direct-only' : `${max}-change`} limit`,
    arrivesOutside: (time: string) => `arrives ${time}, outside your window`,
    departsOutside: (time: string) => `departs ${time}, outside your window`,
    markJoin: '; ',
    more: (n: number, outside: number) =>
      `${n} more read${outside > 0 ? `, ${outside} outside your limits` : ''}`,
    showAll: 'show all',
    // spec rev 56 §11: one line per list says which limits apply to the flights read
    settingsNotApplied: 'airline settings not applied to flights read',
    windowsOutboundOnly: 'windows apply to the outbound',
    returnNotRead: 'return leg not read',
    limitsWithReturns: (settings: string, windows: string) => `${settings} · ${windows}`,
    limitsOutboundOnly: (returnNotRead: string, settings: string) => `${returnNotRead}; ${settings}`,
    // --- spec rev 56 §11 "The pairing section" (WP21 Task 21.7) ---
    out: 'Out:',
    back: 'Back:',
    pairingHead: (which: 'cheapest' | 'next-cheapest') =>
      which === 'cheapest'
        ? 'With the cheapest outbound read within your limits:'
        : "With the next-cheapest outbound read within your limits (the cheapest one's returns were all over your limits):",
    pairingHeadOver: 'With the cheapest outbound read (over your limits):',
    pairingHeadWhenRead: (which: 'cheapest' | 'next-cheapest', ago: string) =>
      `With the ${which} outbound read, selected under your limits when read, ${ago}:`,
    // 21.7 code M13: after a limit edit of a read where no outbound fitted
    pairingHeadOverWhenRead: (ago: string) =>
      `With the cheapest outbound read, over your limits when read, ${ago}:`,
    // 21.7 code I3 (Ian's ruling 2 for returns): the outbound fits, none of its returns does; the cheapest pairing is
    // shown anyway, over the limits, and never leads
    pairingHeadNoReturnFits:
      'No return flight within your limits for this outbound; the cheapest pairing read is shown, over your limits:',
    limitsChanged: `${LIMITS_CHANGED}; they are read again at the next search`,
    noOutboundFits: (n: number) =>
      `none of the ${n} outbound ${noun(n, 'flight', 'flights')} read is within your limits; the cheapest one's returns are shown`,
    selectedMark: 'selected for the returns above',
    triedFirstMark: 'tried first: its returns were all over your limits',
    // a return's times: its arrival may be the day before its departure date's (−1, a date-line crossing)
    returnTimes: (departs: string, arrives: string, dayOffset: number) =>
      `depart ${departs}, arrive ${arrives}${dayOffset > 0 ? ` +${dayOffset}` : dayOffset < 0 ? ` −${-dayOffset}` : ''}`,
    sellerLine: (seller: string, fare: string | null, n: number) =>
      `${fare === null ? seller : `${seller}, ${fare}`} · cheapest of ${n} ${noun(n, 'offer', 'offers')} read`,
    sellersNotRead: 'sellers not read',
    offersIncomplete: 'a cheaper seller may not have been read',
    priceAppliesTo: 'this price is for the Out: and Back: flights shown',
    // 21.7 persona booking link: the link opens a search, not the flights shown
    bookOnGoogle:
      'to book, search these dates on Google Flights (the link below); this app opens no seller; Google may show different flights or prices when you search',
    // the mismatch line: both figures through PriceCell, nothing reconciled (spec rev 56 §6.9)
    mismatchOffer: 'the cheapest offer read is',
    mismatchFrom: "; Google's list showed",
    returnMore: (n: number, outside: number) =>
      `${n} more ${noun(n, 'return', 'returns')} read${outside > 0 ? `, ${outside} outside your limits` : ''}`,
    // 21.7 code M2 / ui-007: each toggle keeps one name; aria-expanded alone says whether it is open
    showAllReturns: 'show all return flights',
    showAllOutbound: 'show all outbound flights',
    returnsListName: 'return flights for the selected outbound',
    // what the section's live region says when its returns are expanded or folded (21.7 ui-007)
    returnsShown: (n: number, all: boolean) =>
      `${all ? 'all ' : ''}${n} return ${noun(n, 'flight', 'flights')} shown`,
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
    triedSome: (tried: number, within: number) =>
      `${tried} of the ${within} ${noun(within, 'outbound', 'outbounds')} within your limits were tried; other outbounds not tried`,
    // 21.7 prov-011: after a limit edit the line names the limits of the read only
    triedSomeWhenRead: (tried: number, within: number) =>
      `${tried} of the ${within} ${noun(within, 'outbound', 'outbounds')} within your limits when read were tried; other outbounds not tried`,
    // status notes, with what happens next (spec rev 56 §11 "Status notes")
    returnTransient: (readNow: boolean) => `return flights not read: ${NEXT_READ(readNow)}`,
    returnSkipped: (why: string) => `return flights not read: ${why}`,
    returnNotVerified:
      'return flights are not yet read on this kind of machine; see the recording session in docs/setup.md',
    bookingTransient: (readNow: boolean) => `sellers not read: ${NEXT_READ(readNow)}`,
    bookingExpandFailed: 'sellers read before the list could be expanded; the cheapest may be missing',
    bookingSkipped: (why: string) => `sellers not read: ${why}`,
    bookingNotVerified: 'sellers are not yet read on this kind of machine',
    bookingNoPairing: 'no return flight to read sellers for',
    // a skipped step's rule in words (the worker's bounded rule tokens; an unknown one is worded generally)
    skippedRule: {
      spacing: 'the wait between pages ran past its time',
      'not-cheapest-view': 'the list was not on its Cheapest view',
      'second-selection': 'the second outbound could not be selected',
      reload: 'the list could not be loaded again',
    },
    skippedOther: 'a step before them was not made',
    // a list that is not a list of flights
    // 21.7 ui-006: a failed list leads with the board's own words for it ("flights couldn't be read: …")
    notRead: (clause: string) => `Flights couldn't be read: ${clause}`,
    noFlightsWhen: (when: string) => `Google's list showed no flights for these dates when read ${when}`,
    noneForCell: (other: number, unread: number) => {
      const parts = [
        ...(other > 0 ? [`${other} for other airports or days`] : []),
        ...(unread > 0 ? [`${unread} unread`] : []),
      ];
      return `Google listed flights, none this app could read for these airports and dates${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
    },
    // no list yet, and the read on demand (spec rev 55 §8.1, §11)
    notReadYet: 'Flights not read yet',
    readButton: (pages: number) =>
      `Read flights for this date (free, ${pages === 1 ? '1 page' : `up to ${pages} pages`})`,
    reading: 'Reading flights…',
    // what the block's live region says when a read here ends (finding 3)
    readDone: (dates: string) => `Flights read for ${dates}`,
    readDoneReturns: (dates: string, n: number) =>
      `Flights read for ${dates}, ${n} return ${noun(n, 'flight', 'flights')}`,
    readNotDone: (dates: string) => `Flights not read for ${dates}`,
    // a refused read, worded from the api's code (and, for not_available, its reason; ruling A33), never its text
    busy: 'The browser worker is busy with a search; try again when it finishes',
    fresh: "Read within this search's refresh",
    outsideSpace: "These dates are no longer in this search's dates",
    noPrice: 'This date pair has no price, so there are no airports to read flights for',
    readFailed: "The flights couldn't be read just now; try again later",
    // one line under the list when flight lists cannot be read here
    unavailable: 'Flight times need the browser worker; set it up in Providers',
    unavailableCabin: 'Flight times are read for economy searches only',
    // a calendar price's source in words (spec rev 56 §6.9: the grid-price line beneath a pairing figure names it)
    dateGrid: 'the date grid',
    lowerFare: 'Google shows a lower fare it could not read (',
    lowerFareEnd: ')',
    // the search link (spec rev 55 §6.9, §11; prov-int-017): the page the worker reads, with its label beside it
    openLink: 'Open in Google Flights ↗',
    openLinkName: (dates: string) => `Open in Google Flights for ${dates}, opens in a new tab`,
    datesShort: (departure: string, back: string) => `${departure} → ${back}`,
    // a tie (spec rev 55 §11 Ties); the price is the estimate panel's cost formatter's, in whole pounds when it has no
    // pence (ruling R-pounds); a tie that runs past the shown rows also says how many of it are shown (R-tie-count)
    tie: (n: number, price: string, byFlights: boolean, shownHere: number | null) =>
      `${n} date pairs tie at ${price}, ${byFlights ? 'listed by shortest flight time' : 'in date order'}${shownHere === null ? '' : `; ${shownHere} shown here`}`,
  },
  // --- WP19: the Dates view (spec §11 Dates; revision 50) ---
  datesView: {
    title: 'Dates',
    scopeAirports: (inScope: number, total: number) =>
      `${inScope} of ${total} airport ${noun(total, 'pair', 'pairs')}`,
    scopeNights: (min: number, max: number) =>
      min === max ? `${min} ${noun(min, 'night', 'nights')}` : `${min}–${max} nights`,
    coverageCheckLink: 'Open the coverage check for this search',
    gapReference: 'reference across the whole search:',
    // filters
    filtersLabel: 'Filters',
    stayMin: 'Stay from (nights)',
    stayMax: 'Stay to (nights)',
    stayInvalid: 'a stay range is two whole numbers, the first no larger than the second',
    origins: 'Origins',
    destinations: 'Destinations',
    journeyLimit: 'Max journey time (minutes)',
    journeyBounds: (min: number, max: number) => `between ${min} and ${max} minutes`,
    weekSwitch: 'Best per departure week',
    /** The week switch's own flaps (decorative; the checkbox's state is the accessible one). */
    switchFlap: { on: 'On', off: 'Off' },
    /** A board row's state on its flaps (decorative; how far checked says it in full beside them). */
    stateFlap: { verified: 'verified', calendar: 'not checked', stale: 'stale', superseded: 'superseded' },
    loadingFiltered: 'Loading dates for these filters',
    // board
    boardCaption: 'Best dates',
    boardOrderNote: 'Prices a later search no longer found rank after current ones.',
    partial: 'partial: still searching',
    columns: {
      rank: 'Rank',
      depart: 'Depart',
      return: 'Return',
      nights: 'Nights',
      price: 'Price',
      howFar: 'How far checked',
      journey: 'Journey time',
      airports: 'Airports',
    },
    priceSortNote: 'current prices first, then by price',
    showMore: (n: number) => `Show ${n} more`,
    showing: (shown: number, total: number) =>
      `showing ${shown} of ${total} date ${noun(total, 'pair', 'pairs')} with a price`,
    bestPerWeek: (weeks: number) => `best per departure week: ${weeks} ${noun(weeks, 'week', 'weeks')}`,
    openDates: (dep: string, ret: string) => `Open ${dep} to ${ret}`,
    // why: spec §11 provenance: a phone face shows the provider's short mark and one-glyph marks, so the phone board
    // names each in full (the Calendar's phone legend did this before revision 48 retired that view)
    phoneKey: {
      providers:
        'Each price card shows its provider: TP Travelpayouts (Aviasales cache), SA SearchApi (Google Flights via SearchApi), CF Camoufox (Google Flights prices via Camoufox), syn Fixture (synthetic fixture data).',
      glyphs:
        'Marks beside a price: ≠ price not confirmed, ◷ stale, … cheapest of the rows read, ↺ superseded by a later search, ◌ not seen in latest search. Under the amount: its age ("5d old", or "age unknown") and "not checked" on a calendar price.',
    },
    journeyNotKnown: 'not known',
    journeyNotKnownFiltered: 'journey time not known',
    directionOut: 'out',
    directionBack: 'back',
    arrives: (time: string, dayOffset: number) =>
      dayOffset > 0 ? `arrives ${time} +${dayOffset}` : `arrives ${time}`,
    arrivesOn: (date: string) => `(arrives on ${date})`,
    airports: (origin: string, destination: string) => `${origin} → ${destination}`,
    cachedFrom: 'cached from',
    cachedFromPair: (origin: string, destination: string) => `(${origin} → ${destination})`,
    // --- spec rev 56 §6.9, §11 Board: the pairing figure and the flight read beneath a calendar figure (Task 21.7) ---
    pairingSource: `${mainPathSource('camoufox')}'s flight list, the cheapest of the sellers read for these two flights`,
    pairingWhich: {
      cheapest: 'cheapest outbound read within your limits',
      'next-cheapest':
        "next-cheapest outbound read within your limits (the cheapest one's returns were all over your limits)",
      'over-limit': 'cheapest outbound read, over your limits',
    } satisfies Record<'cheapest' | 'next-cheapest' | 'over-limit', string>,
    // 21.7 persona H2 / ui-005: the row stays short; the long words above are the group's accessible description
    secondOutboundTried: '2nd outbound tried',
    // 21.7 ui-008: "Out:" and "Back:" as the search's page block writes them
    pairingTimes: (out: string, back: string) => `Out: ${out} · Back: ${back}`,
    mismatchMark: 'Google listed from',
    // 21.7 prov-003: the grid price's own source leads its line ("the Aviasales cache showed £564"), never "date grid"
    gridShowed: (source: string) => `${source} showed`,
    gridShowedAt: (when: string) => `· ${when}`,
    fromPrice: 'from',
    pairingBeneath: (ago: string) => `return flights read ${ago}, older than this search's refresh:`,
    pairingOtherLimits: `${LIMITS_CHANGED}:`,
    pairingRead: {
      'not-read': 'flights not read',
      'outbound-only': 'return leg not read',
      'no-pairing-read': 'no return flight read',
      'over-limit': 'no pairing within your limits read',
    },
    // 21.7 ui-008: no trailing colon when no reason is known (the contract always sends one)
    listFailed: (reason: string | null) => `flights couldn't be read${reason === null ? '' : `: ${reason}`}`,
    // 21.7 prov-004: the flight-lists request pending, and failed
    loadingFlights: 'loading flights',
    flightsLoadFailed: "flights couldn't be loaded; prices shown without flights",
    // 21.7 persona coverage: how many shown date pairs carry a seller's price
    sellerCoverage: (n: number, m: number) =>
      `seller prices read for ${n} of the ${m} date ${noun(m, 'pair', 'pairs')} shown`,
    // spec rev 55 §3 word table: a verified basis reads "checked fares", a calendar one says where it came from
    howFar: {
      verified: 'checked fares, verified',
      calendar: (from: string) => `${from}, constraints not checked`,
      // spec rev 56 §6.9: a pairing figure's price is the cheapest of the sellers read from the browser worker's list
      pairing: `from ${mainPathSource('camoufox')}'s flight list, not checked with the airline`,
      calendarFrom: {
        searchapi: "from Google's date grid",
        camoufox: "from Google's date grid",
        travelpayouts: 'from the Aviasales cache',
        fixture: 'from the test source',
      } satisfies Record<ProviderId, string>,
      itinerarySearched: (k: number, of: number) =>
        `fares checked for ${k} of ${of} airport ${noun(of, 'pair', 'pairs')}`,
      notReached: (n: number) => `${n} selected but not reached`,
      selectedOther: (n: number) => `${n} selected, fares not checked (an error, or skipped)`,
      notSelected: 'not selected for checking fares',
      onDemand: (n: number) => `+${n} on demand`,
      partiallyVerified: (n: number) => `${n} partially verified`,
      unconfirmed: (n: number) => `${n} ${noun(n, 'price', 'prices')} not confirmed`,
      bucket: (n: number, words: string) => `${n} ${words}`,
      notSearched: (n: number, of: number) =>
        `${n} of ${of} airport ${noun(of, 'pair', 'pairs')} not searched`,
      earlierSearch: 'price from an earlier search',
      cutShort: 'read was cut short',
      noneWithin: (limit: string) => `none within ${limit}`,
    },
    // run updates (revision 50, Ian ruled)
    updateBoard: (n: number) => `${n} ${noun(n, 'change', 'changes')} · Update board`,
    updated: 'Best dates updated',
    pendingChanges: (n: number) =>
      `${n} ${noun(n, 'change', 'changes')} to Best dates; Update board to see them`,
    // states
    noSearch: 'No search yet.',
    noSearchLink: 'Plan one under Searches',
    onDemandOnly: (n: number) =>
      `Not searched yet: fares were checked for ${n} date ${noun(n, 'pair', 'pairs')} on their own so far, and the prices found are below.`,
    noPricesInRun: 'No prices in this run.',
    tooManyCells: (cells: number, bound: number) =>
      `This search asks about ${cells} date pairs on its airport pairs in scope, more than the ${bound} this page reads at once. Narrow the origins or destinations in the filters above to bring it under ${bound}.`,
    noPriceInFilters: 'No date pair in these filters has a price found so far.',
    // the overview (Task 19.5; spec §11 Overview)
    overview: {
      heading: 'Overview',
      monthsLabel: 'Months of the window',
      previousMonth: 'Previous month',
      nextMonth: 'Next month',
      stay: (from: number, to: number) =>
        from === to ? `${from} ${noun(from, 'night', 'nights')}` : `${from}–${to} nights`,
      closeBand: (stay: string, month: string) => `Close ${stay} in ${month}`,
      cellName: (dates: string, stay: string, what: string) => `${dates}, ${stay}: ${what}`,
      rank: (n: number) => `rank ${n}`,
      bandDates: (date: string) => `departing ${date}`,
      openBand: 'opens its stay lengths',
      noMark: 'no airport pair in scope',
      readoutLabel: 'Date pair readout',
      readoutEmpty: 'Point at or focus a dot to read its date pair here.',
      openThese: 'Open these dates',
      buckets: (breakdown: string) => `by airport pair: ${breakdown}`,
    },
    // spec rev 55 §3, §6.6, §11: the five marks of the month key (priced is a cell's shade), then the cell marks besides
    marks: {
      words: {
        priced: 'priced',
        'no-price-shown': 'no price shown',
        'couldnt-read': "couldn't be read",
        'not-reached': 'not reached',
        'not-searched': 'not searched',
        partly: 'partly not searched',
        notChecked: 'not checked',
        superseded: 'superseded by a later search',
        notSeen: 'not seen in latest search',
        noneWithin: 'none within the journey limit',
        unshown: 'priced, but no price can be shown here',
      },
      glyph: {
        'no-price-shown': '∅',
        'couldnt-read': '✕',
        'not-reached': '–',
        'not-searched': '○',
        partly: '▨',
        notChecked: '◫',
        superseded: '↺',
        notSeen: '◌',
        noneWithin: '⧗',
        unshown: '◑',
      },
    },
    legend: {
      title: 'Legend',
      scaleQuintile: (n: number) =>
        `Shade: ${n} current ${noun(n, 'price', 'prices')} in view, in five bands by rank; brighter is cheaper`,
      scaleFlatFew: (n: number, min: number) =>
        `One shade for ${n} current ${noun(n, 'price', 'prices')}: fewer than ${min} are too few for price bands`,
      scaleFlatNarrow: (n: number, min: string, max: string) =>
        `One shade for ${n} current prices: they span ${min}–${max}, less than 10%, too narrow for price bands`,
      scaleEmpty: 'No current price in view to shade',
      band: (band: number, min: string, max: string, n: number) =>
        `band ${band + 1}: ${min}–${max} (${n} date ${noun(n, 'pair', 'pairs')})`,
      flat: (n: number) => `one shade: ${n} date ${noun(n, 'pair', 'pairs')}`,
      offScale:
        'Prices a later search no longer found (superseded, not seen) are on a plain fill with their mark, never on the scale.',
      markCount: (words: string, n: number) => `${words}: ${n}`,
      // why: the parts of "no price shown", by date pair (spec rev 55 §11: "12 no fares, 3 no cached data")
      noPriceParts: (empty: number, noData: number) =>
        [
          ...(empty > 0 ? [`${empty} no fares`] : []),
          ...(noData > 0 ? [`${noData} no cached data`] : []),
        ].join(', '),
      marksLabel: 'Marks',
      dot: 'each dot is one stay length',
      striped: (n: number) => `striped: partly not searched (${n})`,
      notChecked:
        'not checked: a calendar price; its constraints (stops, journey time, arrival times) were not checked.',
      noAmount: 'The dots print no amount: point at or focus one to read its price beside the legend.',
      ring: 'outlined: on the board above',
    },
    // the coverage section (Task 19.5; what the Coverage view held)
    coverageToggle: 'Coverage of the latest run',
    coverageNotFiltered:
      'The filters above do not narrow this section: it covers the latest run over the whole search.',
  },
  // --- WP10 (spec §11 History; plan decisions 38, 44, 46, 48). WP19 retired View B (Calendar) and View C (Duration)
  // with their words; the two that outlived them are bucketBreakdown (the Dates readout) and panel.unconfirmedShort ---
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
  // --- WP19 Task 19.6: the per-airport-pair panel of the date pair detail (spec §11), the Calendar side panel's
  // outcome, price and verify sections moved here so they outlive the Calendar view ---
  panel: {
    heading: (origin: string, destination: string) => `${origin} → ${destination}`,
    regionLabel: 'Per airport pair',
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
      provider_unavailable: 'browser worker not reachable',
      // why: spec §3 rev 36 — the panel shows core's scheduledOnlyText for the stored detail; this is the word for a
      // row that has none, which names no run because it cannot know which one fetches it
      scheduled_only: 'left for a later run',
      departed: 'departure date has passed',
      'cabin-not-offered': "the provider does not offer this definition's cabin",
      auth: 'the provider refused the credentials',
      'rate-limit': 'the provider rate-limited the request',
      quota: "the provider's quota is used up",
      upstream: 'the provider failed',
      parse: "the provider's answer could not be read",
      network: 'network failure',
      'limiter-timeout': 'waited too long for a request slot',
      blocked: 'stopped: Google showed a page this app does not read, or a check (the detail says which)',
      'provider-unavailable': 'browser worker not reachable',
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
    // why: N2 (ruling 9): a 0-call definition is not out of headroom; it allows no billed call, and one setting fixes it.
    verifyZeroRunCap: (n: number) =>
      `This definition allows 0 billed calls, so this search cannot start. Raise the definition's call cap to at least ${n} in Searches → More options → Run budget (Max billed calls per run).`,
    verifyCostLoading: 'Loading what this search may spend…',
    verifyCapRefused: (message: string) => `Refused by a budget cap: ${message}`,
    verifyConfirmRefused: (message: string) => `Needs confirmation: ${message}`,
    verifyConflict: 'An itinerary search for this cell is already running.',
    unconfirmedShort: 'price not confirmed',
  },
  // --- WP19 Task 19.6: the date pair detail, what was Results (spec §11 Date pair detail) ---
  // WP19 Task 19.7 (spec §11 URLs): an old alert link whose row the whole-space read no longer holds lands on Dates
  landing: {
    rowGone: "That result is no longer in this search's results.",
    rowNotRead: (n: number) => `That result is not among the first ${n} results read for this search.`,
  },
  detailView: {
    title: (departure: string, back: string, nights: number) =>
      `${departure} to ${back} · ${nights} ${noun(nights, 'night', 'nights')}`,
    backToDates: 'Back to dates',
    boardPriceLead: 'Dates board price:',
    boardPriceRest: (airports: string, basis: string) => `· ${airports} · ${basis}`,
    // why: revision 50: the two figures differ because the board ranks by the newest search, then freshness
    boardDiffers:
      'It differs from the cheapest found here because the board prefers a price the latest search returned, then a fresh one.',
    // 21.7 prov-002: a pairing figure differs for what it is, never for its recency
    boardPairing: `It is a seller's offer read from ${mainPathSource('camoufox')}'s flight list for one outbound and one return, not one of the prices listed here.`,
    rowGone: "That result is no longer among this date pair's results.",
    noRows: 'No round trip found for these dates on this basis.',
    coverageSection: 'Open the coverage section',
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
    payloadInvalid: 'invalid record: it does not match the alert format',
    reasonWithheld: 'reason withheld: its record is invalid',
  },

  // Status (spec §10 `GET /status`, §11 Status and the status bar; brief WP18 Task 18.6)
  statusView: {
    heading: 'Status',
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
  /** The link in the status bar (the line itself, "Status: 2 failing", comes from core's barSummary). */
  statusLink: {
    label: 'Status report',
    stale: (checked: string) => `Status: stale, ${checked}`,
    notAnswering: 'Status: app not answering',
    signInRefused: 'Status: sign-in refused',
    reportFailed: 'Status: report failed, see the app log',
  },
} as const;
