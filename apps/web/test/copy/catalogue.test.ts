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
  progress: [
    {
      stage: 'discovery',
      provider: 'Travelpayouts',
      buckets: { priced: 60, empty: 10, no_data: 40, error: 6, skipped: 0, not_run: 10 },
      total: 126,
    },
  ],
  progressLabel: ['discovery', 'Travelpayouts'],
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
  paused: ['budget'],
  resumesAt: ['1 Nov 2026 00:00 Europe/London'],
  scheduleBlocked: ['14 Oct 2026'],
  childRun: ['running'],
  runNow: [154, 2000, '£0'],
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
  refreshHours: ['Travelpayouts'],
  coverageCheckPair: ['LHR', 'JFK'],
  coverageCheckCalls: [14],
  cachedOf: [5, 372],
  importExample: ['the worked example'],
  createConfirm: [154, 2000, '£0'],
  fieldError: ['origins.0', 'LON is a city code'],
  estimateCells: [126],
  estimateRow: ['SearchApi', 'discovery', 92, '£0', '30m'],
  estimateTotal: [154, 2000, '£0', '45m'],
  estimateBlocked: ['searchapi provider-month cap 10000, estimated 12000'],
  budgetFitOk: [4],
  budgetFitWarn: [4],
  budgetScope: ['provider-month:searchapi', 616, '10000'],
  needsConfirmation: [{ calls: 154, cap: 2000, estimate: '£2', confirmed: '120 calls, £1' }],
  confirmNew: [154, 2000, '£2'],
  // WP19 (Task 19.4): the Dates view
  'datesView.runFinished': ['2h ago'],
  'datesView.runInProgress': ['40 min ago'],
  'datesView.runPaused': ['3h ago', 'searchapi provider-month cap reached'],
  'datesView.runEnded': ['cancelled', '2h ago'],
  'datesView.runNotStarted': ['pending'],
  'datesView.minutesAgo': [40],
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
  'datesView.notSearchedCount': [368],
  'datesView.tooManyCells': [100000, 50000],
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
      'discovery · Travelpayouts: 9 priced · 0 no fares · 99 no cached data · 0 error · 0 skipped · 0 not searched of 108 cells',
    );
  });

  it('confirmations state the estimated calls with the hard stop, and pounds (decisions 36, 44)', () => {
    expect(COPY.createConfirm(154, 2000, '£0')).toBe(
      'Create and confirm about 154 calls (hard stop 2000), £0 per run',
    );
    expect(COPY.confirmNew(154, 2000, '£2')).toBe('Confirm about 154 calls (hard stop 2000), £2 per run');
    expect(COPY.runNow(154, 2000, '£0')).toBe('Run now: about 154 calls, hard stop 2000 · £0');
    const copy = [
      COPY.createConfirm(1, 2, '£0'),
      COPY.confirmNew(1, 2, '£0'),
      COPY.runNow(1, 2, '£0'),
      COPY.estimateTotal(1, 2, '£0', '1m'),
    ];
    expect(copy.filter((c) => /\bup to\b/.test(c))).toEqual([]);
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
