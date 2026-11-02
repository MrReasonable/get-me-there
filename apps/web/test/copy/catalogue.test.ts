import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANNED_WORD_ALLOWLIST, findBannedWords, SOURCE_LABELS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';

/** Sample arguments for every function entry, keyed by dotted path. A missing key fails the test. */
const SAMPLES: Record<string, unknown[]> = {
  'statusView.checkedAgo': [90],
  'statusView.stale': ['checked 3 min ago'],
  'statusView.offLine.not-set-up': ['SearchApi, email'],
  'statusView.offLine.awaiting-verification': ['browser provider'],
  'statusView.offLine.not-visible': ['backups'],
  'statusView.offLine.disabled': ['London to New York'],
  'statusView.cardLabel': ['Provider', 'SearchApi'],
  'statusView.copyCommand': ['pnpm gmt start'],
  'statusView.selectedInstead': ['pnpm gmt start'],
  'statusView.testFailedCall': ['HTTP 500'],
  'statusLink.stale': ['checked 3 min ago'],
  scrollsRow: [3],
  'camoufox.coolingDown': ['2026-10-20T05:00:00.000Z'],
  'alertsView.notSaved': ['database is locked'],
  'alertsView.cooldownText': [336],
  'alertsView.classPartial': ['checked bag'],
  confirmedWas: ['154', '£1'],
  metroExpanded: ['LON', 'LHR, LGW'],
  progressSelected: [
    {
      provider: 'SearchApi',
      buckets: { priced: 8, empty: 0, no_data: 0, error: 1, skipped: 116, not_run: 2 },
      selected: 10,
    },
  ],
  childExecutionNotStarted: ['pending'],
  executionNotStarted: ['pending'],
  loadFailed: ['network error'],
  bandCheapest: [6],
  verifyCellFor: ['LHR → EWR 2 Apr 2027–16 Apr 2027 (14n)'],
  verifyStartedFor: ['LHR → EWR 2 Apr 2027–16 Apr 2027 (14n)'],
  actionFailed: ['409 conflict'],
  providersUnknown: ['HTTP 500'],
  fxSpoken: ['converted to GBP at the 2026-10-13 rate (frankfurter)'],
  fxTitle: ['2026-10-13', 'frankfurter'],
  notSeenInLatest: ['3d ago'],
  agoOf: ['unknown'],
  verdictLine: ['arrival time window', 'fail'],
  notApplied: ['arrival time window, maximum journey time'],
  unverifiedList: ['checked bag'],
  sortBy: ['Price', 'ascending'],
  sortOption: ['Travel time', 'descending'],
  orderNow: ['server ranking (class, then price)'],
  sortedWithin: ['Travel time', 1000, 4210],
  showDetails: ['JFK 14 Mar 2027 to 28 Mar 2027'],
  hideDetails: ['JFK 14 Mar 2027 to 28 Mar 2027'],
  detailsFor: ['JFK 14 Mar 2027 to 28 Mar 2027'],
  rowName: ['JFK', '14 Mar 2027', '28 Mar 2027'],
  stopsValue: [0, 1],
  nightsValue: [14],
  showingRows: [3, 10],
  staleHidden: [2],
  failedHidden: [1],
  headlineRest: [
    {
      destination: 'JFK',
      dates: '14 Mar 2027–28 Mar 2027 (14n)',
      basis: 'itinerary-search basis',
      cls: 'verified',
    },
  ],
  dateRange: ['14 Mar 2027', '28 Mar 2027', 14],
  coverageLine: [{ priced: 3, empty: 1, noData: 2, error: 0, skipped: 0, notRun: 4, total: 10, reused: 0 }],
  itineraryLine: [{ searched: 2, selected: 10, onDemand: 1 }],
  itineraryLineExpand: [{ searched: 2, selected: 10, expandTop: 2, onDemand: 1 }],
  truncated: [1000, 4210],
  excludedByCurrentSpace: [3],
  executionsShown: ['run started 14 Oct 2026 13:00 Europe/London (completed, 2h ago)'],
  executionItem: ['14 Oct 2026 13:00 Europe/London', 'completed', '2h ago'],
  childExecutionItem: ['14 Oct 2026 13:00 Europe/London', 'running', 'just now'],
  spanExecutions: [3, 1],
  notCompletedBanner: ['running'],
  // why: the bar passes its main-path stage words (COPY.barStageName) and source name (mainPathSource)
  progress: [
    {
      stage: 'the first pass across your dates',
      provider: 'the Aviasales cache',
      buckets: { priced: 60, empty: 10, no_data: 40, error: 6, skipped: 0, not_run: 10 },
      total: 126,
    },
  ],
  progressBuckets: [{ priced: 9, empty: 0, no_data: 99, error: 0, skipped: 0, not_run: 0 }],
  progressLabel: ['the first pass across your dates', 'the Aviasales cache'],
  spendRunCalls: [42, '2000'],
  spendRunFreeCalls: [14, '2000'],
  spendRunCost: ['£0', '£0'],
  spendMonth: ['£32', '£35'],
  spendProviderMonth: ['SearchApi', 615, '10000'],
  spendProviderLifetime: ['SearchApi', 7, '24'],
  requestRowTiles: [14, '14', 14, 0, '£0'],
  maxAgeAssumed: ['24h'],
  coverageOnDemandRunText: ['completed', '14 Oct 2026 13:41 Europe/London'],
  coverageOnDemandCalls: [3, 0, '£0'],
  scheduledOnlyRow: ['Google Flights (browser)', 'discovery', 12, "outside this run's browser window"],
  scheduledOnlyHeading: ['left for the next scheduled run'],
  firingNotStarted: ['19 Oct 2026 05:00', 'skipped: missed and not caught up'],
  skippedWhy: ['skipped: missed and not caught up', 'the next scheduled run was less than half the gap away'],
  resumesAt: ['1 Nov 2026 00:00 Europe/London'],
  scheduleBlocked: ['14 Oct 2026'],
  childRun: ['running'],
  filtersSummary: [2],
  carriersIgnored: ['BRITISH'],
  segment: ['ZZ', 117, 'LHR', '14 Mar 10:25', 'JFK', '14 Mar 13:20'],
  layover: ['BBB', '2h 05m'],
  checkedBags: [1],
  refundable: [true],
  changeable: [undefined],
  seller: ['Example Travel'],
  openOn: ['www.google.com'],
  continueOnForm: ['www.google.com'],
  hostShown: ['www.google.com'],
  calendarGapLead: [3],
  reusedNote: [4],
  cellLabel: ['LHR', 'JFK', '20 Mar 2027', '1 Apr 2027'],
  withPriceValue: [60, 126],
  sumMismatch: [9, 10],
  requestRow: [14, '14', 2, '£0'],
  errorRow: ['rate-limit', 3],
  lastError: ['HTTP 429'],
  plan: ['SearchApi $40 a month'],
  capability: ['Discovery', 'Aviasales cache', 'prices up to 2d old when fetched'],
  maxAge: ['2d'],
  usageWindow: [615, '10000', '1 Oct 2026', '1 Nov 2026'],
  usageLifetime: [9, '100'],
  usageNoWindow: [42, '2000'],
  editDefinition: ['Worked example'],
  removeAirport: ['LHR'],
  duplicateAirport: ['LHR'],
  airportOption: ['Heathrow', 'London', 'United Kingdom'],
  destinationNote: ['JFK'],
  onwardCost: ['JFK'],
  resolvedWindow: ['21 Oct 2026', '20 Apr 2027'],
  inPounds: ['maximum price'],
  minutesAsHours: ['25h 00m'],
  coverageCheckPair: ['LHR', 'JFK'],
  coverageCheckCalls: [14],
  cachedOf: [5, 372],
  importExample: ['the worked example'],
  fieldError: ['origins.0', 'LON is a city code'],
  budgetFitOk: [4],
  budgetFitWarn: [4],
  needsConfirmation: [{ calls: 154, cap: 2000, estimate: '£2', confirmed: '120 calls, £1' }],
  confirmNew: [154, 2000, '£2'],
  // WP19 (Task 19.4): the Dates view
  // WP20 (Task 20.3): the Searches view's cards
  // WP20 Task 20.5: the new-search form, the estimate sentence, a refused Search now, Edit and Repeat weekly
  'newSearch.estimateFailed': ['database is locked'],
  'newSearch.saveFailed': ['database is locked'],
  'editSearch.heading': ['Birmingham → Frankfurt'],
  'editSearch.startFailed': ['database is locked'],
  'repeatWeekly.repeats': ['Mondays', '05:00'],
  'repeatWeekly.repeatsDaily': ['05:00'],
  'searchesView.codes': ['BHX', 'FRA'],
  'searchesView.windowSpan': ['10 Jan', '31 Mar'],
  'searchesView.windowRolling': [182, 7],
  'searchesView.repeats': [[1, 4], '05:00'],
  'searchesView.repeatsDaily': ['05:00'],
  'searchesView.searching': [120, 405, 'about 1h 40m left'],
  'searchesView.readingFlights': [3, 10],
  'searchesView.left': ['1h 40m'],
  'searchesView.searchedAgo': ['2h ago'],
  barSearchName: ['Birmingham → Frankfurt'],
  'searchesView.neverSearched': [85, 405],
  'searchesView.trip': ['12', '23 Jan'],
  'searchesView.seeDatesOf': ['Birmingham → Frankfurt'],
  'searchAgain.startedUnread': ['HTTP 500'],
  'searchesView.searchAgainOf': ['Birmingham → Frankfurt'],
  'searchesView.editOf': ['Birmingham → Frankfurt'],
  'searchesView.removeOf': ['Birmingham → Frankfurt'],
  'searchesView.removeAsk': ['Birmingham → Frankfurt'],
  'searchesView.cancelAndRemoveAsk': ['Birmingham → Frankfurt'],
  'searchesView.removed': ['Birmingham → Frankfurt'],
  'searchesView.undoOf': ['Birmingham → Frankfurt'],
  'searchesView.removeFailedLine': ['HTTP 500'],
  'searchesView.restoreFailedLine': ['HTTP 500'],
  'datesView.scopeAirports': [2, 4],
  'datesView.scopeNights': [10, 14],
  'datesView.journeyBounds': [60, 6000],
  'datesView.showMore': [10],
  'datesView.showing': [10, 42],
  'datesView.bestPerWeek': [26],
  'datesView.openDates': ['14 Mar 2027', '28 Mar 2027'],
  'datesView.arrives': ['06:40', 1],
  'datesView.arrivesOn': ['Monday 15 March 2027'],
  'datesView.airports': ['LHR', 'JFK'],
  'datesView.cachedFromPair': ['LGW', 'EWR'],
  'datesView.howFar.itinerarySearched': [1, 4],
  'datesView.howFar.notReached': [2],
  'datesView.howFar.selectedOther': [1],
  'datesView.howFar.onDemand': [1],
  'datesView.howFar.partiallyVerified': [2],
  'datesView.howFar.unconfirmed': [1],
  'datesView.howFar.bucket': [3, 'no cached data'],
  'datesView.howFar.notSearched': [1, 2],
  'datesView.howFar.noneWithin': ['10h 00m'],
  'datesView.updateBoard': [3],
  'datesView.pendingChanges': [3],
  'datesView.onDemandOnly': [2],
  'datesView.tooManyCells': [100000, 50000],
  'datesView.howFar.calendar': ["from Google's date grid"],
  'datesView.legend.noPriceParts': [12, 3],
  'datesView.legend.striped': [4],
  // WP20 Task 20.6: a search's page (spec rev 55 §11)
  'searchPage.route': ['London → New York', 'LHR, LGW → JFK, EWR'],
  'searchPage.windowSpan': ['10 Jan 2027', '31 Mar 2027'],
  'searchPage.windowRolling': [182, 7, '21 Oct 2026 – 20 Apr 2027'],
  'searchPage.searched': ['today 09:12–11:41'],
  'searchPage.dayTime': ['yesterday', '11:44'],
  'searchPage.span': ['09:12', '11:41'],
  'searchPage.fromOnly': ['09:12'],
  'searchPage.pricedOf': [300, 405],
  'searchPage.noPriceShown': [20],
  'searchPage.notSearched': [60],
  'searchPage.notReached': [20],
  'searchPage.couldntRead': [5],
  'searchPage.reused': [120],
  'searchPage.readingFlights': [3, 10, 'about 8m left'],
  'searchPage.flightsReadFor': [4, 10],
  'searchPage.flightsFailed': [2],
  'searchPage.noneSearched': [405],
  'searchPage.staleAll': ["older than this search's refresh"],
  'searchPage.gapLead': [3],
  // WP20 Task 20.10: the flights on a search's page
  'flights.outcomeAt': ['11:44'],
  'flights.head': ['3d ago', '12 Mar 11:44'],
  'flights.otherPair': ['LGW', 'EWR'],
  'flights.times': ['07:15', '18:05', 1],
  'flights.changes': [1],
  'flights.operatedBy': ['Virgin Atlantic', 'Delta'],
  'flights.within': ['10h 50m', '25h'],
  'flights.overLimit': ['26h', '25h'],
  'flights.arrivesOutside': ['03:10'],
  'flights.departsOutside': ['06:10'],
  'flights.more': [3, 1],
  'flights.notRead': ['its monthly limit is used up'],
  'flights.noFlightsWhen': ['11:44'],
  'flights.noneForCell': [2, 1],
  'flights.readButton': [2, '90'],
  // WP21 Task 21.7: the return leg on a search's page (spec rev 56 §11)
  'flights.headPairing': ['next-cheapest', true, '3d ago', '12 Mar 11:44'],
  'flights.headPairingOver': [true, '3d ago', null],
  'flights.headPairingWhenRead': ['next-cheapest', true, '3d ago', '12 Mar 11:44'],
  'flights.pairingHeadOverWhenRead': ['3d ago'],
  'flights.triedSomeWhenRead': [1, 3],
  'flights.returnsShown': [5, true],
  'flights.withinLeg': ['return', '12h 05m', '25h'],
  'flights.overLimitLeg': ['return', '26h', '25h'],
  'flights.stopsOver': ['return', 2, 1],
  'flights.limitsWithReturns': [
    'airline settings not applied to flights read',
    'windows apply to the outbound',
  ],
  'flights.limitsOutboundOnly': ['return leg not read', 'airline settings not applied to flights read'],
  'flights.pairingHead': ['next-cheapest'],
  'flights.pairingHeadWhenRead': ['cheapest', '3d ago'],
  'flights.noOutboundFits': [4],
  'flights.returnTimes': ['14:20', '06:25', -1],
  'flights.sellerLine': ['QQ Fares', 'Economy Basic', 3],
  'flights.returnMore': [2, 1],
  'flights.returnCounts': [2, 1],
  'flights.moreListed': [12, 10],
  'flights.triedSome': [1, 5],
  'flights.returnSkipped': ['fewer than 2 browser pages left this month'],
  'flights.returnTransient': [false],
  'flights.bookingTransient': [true],
  'flights.bookingSkipped': ['the list was not on its Cheapest view'],
  'flights.readOutboundOnly': [2],
  'flights.readDoneReturns': ['14 → 24 Mar', 2],
  'datesView.pairingTimes': ['07:15', '14:20'],
  'datesView.gridShowed': ['the date grid'],
  'datesView.gridShowedAt': ['10 Mar 09:30'],
  'datesView.sellerCoverage': [1, 2],
  'datesView.pairingBeneath': ['9d ago'],
  'datesView.listFailed': ["the browser worker's monthly limit is used up"],
  'flights.openLinkName': ['14 → 24 Mar'],
  'flights.datesShort': ['14', '24 Mar'],
  'flights.tie': [6, '£86', true, 4],
  'flights.readDone': ['14 → 24 Mar'],
  'flights.readNotDone': ['14 → 24 Mar'],
  // WP19 (Task 19.5): the overview, its legend and readout
  'datesView.overview.stay': [10, 13],
  'datesView.overview.closeBand': ['10–13 nights', 'Mar 2027'],
  'datesView.overview.cellName': ['14 Mar 2027–24 Mar 2027 (10n)', '10 nights', 'rank 3'],
  'datesView.overview.rank': [3],
  'datesView.overview.bandDates': ['14 Mar 2027'],
  'datesView.overview.buckets': ['3 no cached data, 1 not searched'],
  'datesView.legend.scaleQuintile': [42],
  'datesView.legend.scaleFlatFew': [4, 10],
  'datesView.legend.scaleFlatNarrow': [20, '£400', '£430'],
  'datesView.legend.band': [0, '£300', '£320', 9],
  'datesView.legend.flat': [4],
  'datesView.legend.markCount': ['no cached data', 12],
  bucketBreakdown: [{ priced: 3, empty: 0, no_data: 9, error: 0, skipped: 0, not_run: 0 }],
  'panel.run': ['14 Oct 2026'],
  'panel.heading': ['LHR', 'JFK'],
  'detailView.title': ['14 Mar 2027', '28 Mar 2027', 14],
  'landing.rowNotRead': [1000],
  'detailView.boardPriceRest': ['LHR → JFK', 'itinerary-search basis'],
  'panel.offersDropped': [3],
  'panel.reasonRaw': ['something-new'],
  'panel.reusedFrom': ['run 7 Oct 2026'],
  'panel.calendarPriceRun': ['run 7 Oct 2026'],
  'panel.observation': ['Example Air', 'verified'],
  'panel.verifyCost': [6, 1840],
  'panel.verifyCapRefused': ['budget cap: provider-month:searchapi 10000 of 10000 calls'],
  'panel.verifyZeroRunCap': [6],
  'panel.verifyConfirmRefused': ['the estimate is above the confirmation threshold'],
  'historyView.calendarSeries': ['Aviasales cache', 'economy'],
  'historyView.routeSeries': ['Google', '5–15 Nov', 'economy'],
  'historyView.coloursRepeat': [8, 6],
  'historyView.catchUpRun': ['14 Oct 2026 08:02', '14 Oct 2026 07:00'],
  'historyView.offerSeries': ['Google Flights via SearchApi', 'Example Air', 'economy'],
  'historyView.offerUnconfirmedSeries': ['Google Flights via SearchApi', 'Example Air', 'economy'],
  'historyView.pairPrefix': ['LHR-JFK', "Google's price history for 5–15 Nov · economy, indicative"],
  'historyView.cheapestCell': ['LHR', 'JFK', 'Sun 14 Mar', 'Sun 28 Mar'],
  'historyView.pairOption': ['LHR', 'JFK'],
  'historyView.allPairs': [4, 4],
  'historyView.itineraryHeading': ['LHR→JFK', 'Sun 14 Mar 2027', 'Sun 28 Mar 2027', 'BA'],
  'historyView.itineraryHash': ['abc123'],
  'historyView.spanLine': [3, 0, '23 Sep 2026', '14 Oct 2026'],
  'historyView.chartScroll': ['Price by fetch date'],
  'historyView.tableScroll': ["Google's price history for 5–15 Nov · economy, indicative"],
  'historyView.tableCaption': ["Google's price history for 5–15 Nov · economy, indicative"],
  'historyView.routeProvenance': [
    'Google Flights via SearchApi',
    '5–15 Nov',
    'cabin not stated',
    'fetched 2h ago · provider age unknown',
  ],
};

interface Collected {
  strings: Array<{ path: string; text: string }>;
  fns: string[];
  problems: string[];
}

/** Every string the catalogue can produce, with its dotted path; problems are reported, never thrown. */
function collect(value: unknown, path: string, out: Collected): void {
  if (typeof value === 'string') {
    out.strings.push({ path, text: value });
    return;
  }
  if (typeof value === 'function') {
    out.fns.push(path);
    const args = SAMPLES[path];
    if (args === undefined) {
      out.problems.push(`COPY.${path} is a function with no entry in SAMPLES`);
      return;
    }
    const produced: unknown = Reflect.apply(value, undefined, args);
    if (typeof produced !== 'string') out.problems.push(`COPY.${path} did not return a string`);
    else out.strings.push({ path, text: produced });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, path === '' ? k : `${path}.${k}`, out);
  }
}

describe('COPY catalogue (spec §11 banned words)', () => {
  const collected: Collected = { strings: [], fns: [], problems: [] };
  collect(COPY, '', collected);
  const strings = collected.strings;

  it('every function entry has sample arguments and every sample names a real entry', () => {
    expect(collected.problems).toEqual([]);
    expect(Object.keys(SAMPLES).filter((k) => !collected.fns.includes(k))).toEqual([]);
  });

  it('no string contains a banned word (word boundaries, small allowlist)', () => {
    const hits = strings.flatMap(({ path, text }) =>
      findBannedWords(text, BANNED_WORD_ALLOWLIST).map((h) => `${path}: "${h.word}" in "${text}"`),
    );
    expect(hits).toEqual([]);
  });

  it('"verified" as a whole word appears only in class labels and beside class-verified values', () => {
    const allowed = new Set([
      // WP11: each names the class or sits beside a class-verified value (spec §6.8, §11)
      'alertsView.basisVerified',
      'alertsView.requireAll',
      'alertsView.classVerified',
      'alertsView.classPartial',
      'classLabel.verified',
      'classLabel.partially-verified',
      'calendarGapLead',
      // WP20 Task 20.6: the same banner on a search's page, its reference a class-verified price
      'searchPage.gapLead',
      'headlineRest',
      // WP19: "verified" beside a class-verified figure; the class label "partially verified" with its count
      'datesView.howFar.verified',
      'datesView.howFar.partiallyVerified',
      // the departure board: a row's state word on its flaps, shown only on a row whose figure is class verified
      'datesView.stateFlap.verified',
      // WP10: names the class beside a class-verified value (the panel's offer line)
      'panel.observation',
    ]);
    // why: the exemption list must not outlive its strings: a renamed or removed key would otherwise leave a stale
    // entry, and a new string later added at that path would inherit the exemption unreviewed.
    const paths = new Set(strings.map((s) => s.path));
    expect([...allowed].filter((p) => !paths.has(p))).toEqual([]);
    // the guard's own planted cases: it matches the whole word and not "unverified", so it cannot pass by matching nothing
    const VERIFIED = /(?<![\p{L}])verified(?![\p{L}])/u;
    expect(VERIFIED.test('verified fares')).toBe(true);
    expect(VERIFIED.test('unverified')).toBe(false);
    const offenders = strings.filter(({ path, text }) => VERIFIED.test(text) && !allowed.has(path));
    expect(offenders).toEqual([]);
  });

  it('the itinerary line pluralises, and a run that selected nothing names its on-demand searches plainly (pft-008, po-008)', () => {
    expect(COPY.itineraryLineExpand({ searched: 1, selected: 4, expandTop: 1, onDemand: 0 })).toBe(
      ' · itinerary-searched 1 of 4 selected (1 outbound each) +0 on demand',
    );
    expect(COPY.itineraryLineExpand({ searched: 3, selected: 4, expandTop: 2, onDemand: 0 })).toContain(
      '(2 outbounds each)',
    );
    // why: "0 of 0 selected (1 outbounds each) +1 on demand" read as if nothing happened beside a real search.
    expect(COPY.itineraryLineExpand({ searched: 0, selected: 0, expandTop: 1, onDemand: 1 })).toBe(
      ' · itinerary-searched 1 cell on demand; none selected by the run',
    );
    expect(COPY.itineraryLine({ searched: 0, selected: 0, onDemand: 2 })).toBe(
      ' · itinerary-searched 2 cells on demand; none selected by the run',
    );
    expect(COPY.itineraryLine({ searched: 0, selected: 0, onDemand: 0 })).toBe(
      ' · itinerary-searched 0 of 0 selected +0 on demand',
    );
  });

  it('stage counts say itinerary-searched', () => {
    expect(COPY.itineraryLine({ searched: 2, selected: 10, onDemand: 1 })).toBe(
      ' · itinerary-searched 2 of 10 selected +1 on demand',
    );
    // why: ruling 4: the status bar shows the bucket breakdown; no umbrella ("attempted" or "searched") on any view but D.
    expect(
      COPY.progress({
        stage: 'discovery',
        provider: 'Travelpayouts',
        buckets: { priced: 9, empty: 0, no_data: 99, error: 0, skipped: 0, not_run: 0 },
        total: 108,
      }),
    ).toBe(
      "discovery · Travelpayouts: 9 priced · 99 no price shown · 0 couldn't be read · 0 not reached · 0 not searched of 108 date and airport pairs",
    );
    // why: spec rev 55 §11 — the six buckets under the count, in the coverage section's own terms
    expect(COPY.progressBuckets({ priced: 9, empty: 0, no_data: 99, error: 0, skipped: 0, not_run: 0 })).toBe(
      '9 priced · 0 no fares · 99 no cached data · 0 error · 0 skipped · 0 not searched',
    );
  });

  it('a reconfirmation states the estimated calls with the limit they stop at, and pounds (decisions 36, 44; spec rev 55 §3)', () => {
    expect(COPY.confirmNew(154, 2000, '£2')).toBe('Confirm about 154 calls (stops at 2000), £2 per run');
    expect([COPY.confirmNew(1, 2, '£0')].filter((c) => /\bup to\b/.test(c))).toEqual([]);
  });

  it('every COPY key the main path’s files reach speaks in main-path words: no set-up term (spec rev 55 §11; minor 8)', () => {
    const SET_UP =
      /\b(definitions?|cells?|discovery|hard stop|verdict|tiles?|retry factor|calendar basis|itinerar(y|ies)|camoufox)\b/i;
    const reached = mainPathKeys();
    // the walk must find the main path's own blocks, so it cannot pass by reaching nothing
    for (const p of [
      'searchPage',
      'searchesView.searching',
      'datesView.marks',
      'datesView.howFar',
      'repeatWeekly',
    ])
      expect(
        [...reached].some((r) => r === p || r.startsWith(`${p}.`) || p.startsWith(`${r}.`)),
        p,
      ).toBe(true);
    const under = (path: string) => [...reached].some((r) => path === r || path.startsWith(`${r}.`));
    const hits = strings
      .filter(
        ({ path }) => under(path) && !PROVENANCE_KEYS.some((k) => path === k || path.startsWith(`${k}.`)),
      )
      .filter(({ text }) => SET_UP.test(text) || /\bSTALE\b/.test(text))
      .map(({ path, text }) => `${path}: ${text}`);
    expect(hits).toEqual([]);
  });

  it('the status bar names a stage and a stopped run in main-path words, never "paused: error"', () => {
    expect(COPY.barStageName).toEqual({
      discovery: 'the first pass across your dates',
      verification: 'checking fares',
    });
    expect(Object.values(COPY.barStatusName).filter((w) => /^paused/.test(w))).toEqual([]);
  });

  it('the guard itself works: a planted banned word is found', () => {
    expect(findBannedWords('Live fares', BANNED_WORD_ALLOWLIST)).toHaveLength(1);
  });
});

describe('glyph set (review ui I2)', () => {
  // why: WP19 retired the Calendar's glyphs and phone legend; the marks now drawn are the Dates overview's and
  // PriceCell's, and a glyph both draw must mean the same thing in each
  it('every symbol means one thing: a glyph in both the Dates marks and the price marks names the same mark', () => {
    const dates = COPY.datesView.marks.glyph;
    const price = COPY.priceMarkGlyph;
    expect(new Set(Object.values(dates)).size).toBe(Object.keys(dates).length);
    expect(new Set(Object.values(price)).size).toBe(Object.keys(price).length);
    for (const [mark, glyph] of Object.entries(price)) {
      const shared = Object.entries(dates).filter(([, g]) => g === glyph);
      for (const [other] of shared) expect(other, glyph).toBe(mark);
    }
  });
  it('the provider marks are four distinct short names', () => {
    expect(new Set(Object.values(COPY.providerMark)).size).toBe(4);
  });
  // why: the phone face prints a provider mark and one-glyph marks (spec §11 provenance); the Dates view's phone key
  // names each in full, as the Calendar's phone legend did before revision 48 retired it
  it('the Dates phone key names every provider mark with its full name, and the fixture as synthetic', () => {
    const line = COPY.datesView.phoneKey.providers;
    for (const id of ['travelpayouts', 'searchapi', 'camoufox', 'fixture'] as const) {
      expect(line).toContain(`${COPY.providerMark[id]} `);
      expect(line).toContain(COPY.provider[id]);
    }
    expect(line).toContain(SOURCE_LABELS.synthetic);
  });
  it('the Dates phone key names every price-mark glyph a face can show', () => {
    for (const g of Object.values(COPY.priceMarkGlyph)) expect(COPY.datesView.phoneKey.glyphs).toContain(g);
  });
});

describe('a search’s page in words (WP20 Task 20.6, spec rev 55 §3, §11)', () => {
  it('the five marks and the key read as the spec words them; no mark reads "no flights"', () => {
    const W = COPY.datesView.marks.words;
    expect([W.priced, W['no-price-shown'], W['couldnt-read'], W['not-reached'], W['not-searched']]).toEqual([
      'priced',
      'no price shown',
      "couldn't be read",
      'not reached',
      'not searched',
    ]);
    expect(Object.values(W).filter((w) => /no flights/i.test(w))).toEqual([]);
    expect(COPY.datesView.legend.noPriceParts(12, 3)).toBe('12 no fares, 3 no cached data');
    // a part at zero is left out (minor 7)
    expect(COPY.datesView.legend.noPriceParts(0, 3)).toBe('3 no cached data');
    expect(COPY.datesView.legend.noPriceParts(12, 0)).toBe('12 no fares');
    expect(COPY.datesView.legend.striped(4)).toBe('striped: partly not searched (4)');
    expect(COPY.datesView.legend.dot).toBe('each dot is one stay length');
  });
  it('the header line’s clauses and the flights clauses', () => {
    const P = COPY.searchPage;
    expect(P.pricedOf(1, 1)).toBe('1 of 1 date pair priced');
    expect(P.reused(120)).toBe('(120 reused from earlier runs)');
    expect(P.readingFlights(3, 10, null)).toBe('Reading flights · 3 of 10 date pairs');
    expect(P.flightsReadFor(4, 10)).toBe('flights read for 4 of 10 date pairs');
    expect(P.noneSearched(405)).toBe('0 of 405 searched');
  });
});

// --- the main path's reach (minor 8): every COPY path its source files name, directly or through an alias ---

const SRC = join(import.meta.dirname, '..', '..', 'src');
/** The main path's files (spec rev 55 §11): the first screen, a search's page, the Edit page and More options, the bar. */
const MAIN_PATH_DIRS = ['views/Searches', 'views/Dates', 'views/Definitions'];
const MAIN_PATH_FILES = [
  'components/StatusBar.tsx',
  'components/StopWords.tsx',
  'components/Nav.tsx',
  'lib/leftWords.ts',
];
/** The coverage section keeps the set-up terms by spec (§11), each with its line; it is not on the main path. */
const SET_UP_FILES = new Set(['views/Dates/CoverageSection.tsx']);
/** Provenance notes keep §2's source names on every view (spec rev 55 §11: "no Camoufox outside provenance notes"). */
const PROVENANCE_KEYS = ['provider', 'providerShort', 'providerMark', 'datesView.phoneKey.providers'];

function mainPathFiles(): string[] {
  const out = MAIN_PATH_FILES.map((f) => join(SRC, f));
  for (const d of MAIN_PATH_DIRS)
    for (const f of readdirSync(join(SRC, d)))
      if (/\.tsx?$/.test(f) && !SET_UP_FILES.has(`${d}/${f}`)) out.push(join(SRC, d, f));
  return out;
}

/** The deepest prefix of `segments` that names an entry of COPY, as a dotted path ('' when the first does not). */
function resolve(segments: readonly string[]): string {
  let node: unknown = COPY;
  const kept: string[] = [];
  for (const seg of segments) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, seg)) break;
    node = Reflect.get(node, seg);
    kept.push(seg);
  }
  return kept.join('.');
}

/** Every COPY path the main path's files name: `COPY.a.b`, and `X.c` where `const X = COPY.a` (or the page's `c`). */
function mainPathKeys(): Set<string> {
  const out = new Set<string>();
  for (const file of mainPathFiles()) {
    const src = readFileSync(file, 'utf8');
    const aliases = new Map<string, string[]>([['COPY', []]]);
    // why: stateLines.ts takes the catalogue as `c` (PageCopy, which is COPY), as `d.c` inside its line builders
    if (/\bPageCopy\b/.test(src)) {
      aliases.set('c', []);
      aliases.set('d.c', []);
    }
    for (const m of src.matchAll(/const (\w+)(?::[^=]+)? = ((?:d\.)?c|COPY)((?:\.\w+)*);/g)) {
      const root = aliases.get(m[2] ?? '');
      if (root !== undefined) aliases.set(m[1] ?? '', [...root, ...(m[3] ?? '').split('.').filter(Boolean)]);
    }
    for (const [alias, base] of aliases) {
      const re = new RegExp(`(?<![\\w.])${alias.replace('.', '\\.')}((?:\\.\\w+)+)`, 'g');
      for (const m of src.matchAll(re)) {
        const path = resolve([...base, ...(m[1] ?? '').split('.').filter(Boolean)]);
        if (path !== '') out.add(path);
      }
      // a bare alias passed whole (`c: COPY`) reaches nothing by itself; its uses are found where it is read
    }
  }
  return out;
}

describe('the return leg in words (spec rev 56 §11, §1 "What a price is"; WP21 Task 21.7)', () => {
  const F = COPY.flights;
  const D = COPY.datesView;
  // why: 21.7 code M5: the "never" checks read every string the catalogue can produce, each template's sample output
  // included (JSON.stringify drops functions, so it never saw a template)
  const collected: Collected = { strings: [], fns: [], problems: [] };
  collect(COPY, '', collected);
  const texts = collected.strings.map((x) => x.text);
  it('the head names a seller\'s stated price only when one is shown (21.7 prov-001); an offer is never "from"', () => {
    const seller = "; the first Back price is a seller's stated price";
    expect(F.headPairing('cheapest', true, '3d ago', null)).toContain(seller);
    expect(F.headPairing('cheapest', false, '3d ago', null)).not.toContain('seller');
    expect(F.headPairingOver(true, '3d ago', null)).toContain(seller);
    expect(F.headPairingOver(false, '3d ago', null)).not.toContain('seller');
    expect(F.headPairingWhenRead('over', false, '3d ago', null)).toContain(
      'for the cheapest outbound read, which was over your limits when read, 3d ago',
    );
    // the mismatch line: "from" before the return's price only
    expect(`${F.mismatchOffer} £1,195${F.mismatchFrom} ${F.from} £1,180`).toBe(
      "the cheapest offer read is £1,195; Google's list showed from £1,180",
    );
    expect(F.mismatchOffer).not.toMatch(/\bfrom\b/);
    expect(D.mismatchMark).toMatch(/from$/);
    expect(D.fromPrice).toBe('from');
    // an offer's line names its seller and count, never "from"
    expect(F.sellerLine('QQ Travel', null, 3)).toBe('QQ Travel · cheapest of 3 offers read');
    expect(F.sellerLine('QQ Fares', 'Economy Basic', 1)).toBe(
      'QQ Fares, Economy Basic · cheapest of 1 offer read',
    );
    expect(F.sellerLine('QQ Travel', null, 3)).not.toMatch(/\bfrom\b/);
  });
  it('never "each seller" or "every seller", nor "lowest seller price" (21.7 persona H1), in any string or template', () => {
    expect(texts.filter((t) => /each seller|every seller|lowest seller price/i.test(t))).toEqual([]);
    expect(COPY.basisName.pairing).toBe('cheapest of the sellers read, not checked with the airline');
  });
  it('"round trip" is spelt one way on Out, Back and the board: never "round-trip total" or "roundtrip"', () => {
    expect(F.roundTrip).toBe('round trip');
    expect(texts.filter((t) => /round[- ]trip total|roundtrip/i.test(t))).toEqual([]);
  });
  it("the read button's pages from the response, the outbound-only read, the limits lines", () => {
    expect(F.readButton(2, null)).toBe('Read flights for this date (free, up to 2 pages)');
    expect(F.readButton(1, '90')).toBe('Read flights for this date (free, 1 page; 90 pages left this month)');
    expect(F.readOutboundOnly(2)).toBe(
      'Read flights for this date (free, 1 page; return leg not read: fewer than 2 pages left)',
    );
    expect(F.limitsWithReturns(F.settingsNotApplied, F.windowsOutboundOnly)).toBe(
      'airline settings not applied to flights read · windows apply to the outbound',
    );
    expect(F.limitsOutboundOnly(F.returnNotRead, F.settingsNotApplied)).toBe(
      'return leg not read; airline settings not applied to flights read',
    );
  });
  it('the counts clause and the marks', () => {
    expect(F.returnCounts(2, 1)).toBe('2 return options unread, 1 for other airports or days');
    expect(F.returnCounts(1, 0)).toBe('1 return option unread');
    expect(F.returnCounts(0, 3)).toBe('3 return options for other airports or days');
    expect(F.stopsOver('return', 2, 1)).toBe('return 2 changes: over your 1-change limit');
    expect(F.stopsOver('outbound', 1, 0)).toBe('outbound 1 change: over your direct-only limit');
    expect(F.returnTimes('14:20', '06:25', 1)).toBe('depart 14:20, arrive 06:25 +1');
    expect(F.returnTimes('22:00', '23:50', -1)).toBe('depart 22:00, arrive 23:50 −1');
    expect(F.returnTimes('09:00', '11:00', 0)).toBe('depart 09:00, arrive 11:00');
  });
});
