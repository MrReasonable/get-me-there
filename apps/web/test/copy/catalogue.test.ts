import { BANNED_WORD_ALLOWLIST, findBannedWords, SOURCE_LABELS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';

/** Sample arguments for every function entry, keyed by dotted path. A missing key fails the test. */
const SAMPLES: Record<string, unknown[]> = {
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
  // WP10 (Task 10.3)
  'calendarView.discoveryMarker': [{ priced: 1, empty: 2, no_data: 3, error: 4, skipped: 5, not_run: 6 }, 21],
  'calendarView.verificationMarker': [1, 10, 2],
  'calendarView.markerSource': [
    'Aviasales cache',
    '1 priced · 0 no fares · 0 no cached data · 0 error · 0 skipped · 0 not searched of 1',
  ],
  'calendarView.partlyVerified': [2],
  'calendarView.bandAria': [0],
  'calendarView.providerNotSearched': ['Google date grid via SearchApi'],
  'calendarView.glyphCount': [47, 'not searched'],
  'calendarView.unconfirmedCellsFor': [1, 'JFK'],
  'calendarView.stay': [14, '28 Mar'],
  'calendarView.phoneNights': [12],
  'calendarView.bucketBreakdown': [{ priced: 3, empty: 0, no_data: 9, error: 0, skipped: 0, not_run: 0 }],
  'calendarView.staleLine': [3, 40, '8d'],
  'calendarView.unconfirmedCells': [2],
  'calendarView.legend.scaleQuintile': ['itinerary-search basis', 12],
  'calendarView.legend.scaleFlatFew': ['calendar basis', 4, 10],
  'calendarView.legend.scaleFlatNarrow': ['calendar basis', 20, '£400', '£430'],
  'calendarView.legend.scaleEmpty': ['calendar basis'],
  'calendarView.legend.band': [0, '£400', '£450', 2],
  'calendarView.legend.flatSwatch': [4],
  'calendarView.legend.hatched': ['verified', 1],
  'calendarView.panel.title': ['Sun 14 Mar 2027'],
  'calendarView.panel.dayCell': [14, 'Sun 28 Mar'],
  'calendarView.panel.cellOption': ['LHR', 'JFK', 14, 'Sun 28 Mar'],
  'calendarView.panel.run': ['14 Oct 2026'],
  'calendarView.panel.offersDropped': [3],
  'calendarView.panel.reasonRaw': ['something-new'],
  'calendarView.panel.reusedFrom': ['run 7 Oct 2026'],
  'calendarView.panel.calendarPriceRun': ['run 7 Oct 2026'],
  'calendarView.panel.observation': ['Example Air', 'verified'],
  'calendarView.panel.verifyCost': [6, 1840],
  'calendarView.panel.verifyCapRefused': ['budget cap: provider-month:searchapi 10000 of 10000 calls'],
  'calendarView.panel.verifyZeroRunCap': [6],
  'calendarView.panel.verifyConfirmRefused': ['the estimate is above the confirmation threshold'],
  'durationView.tickNotSearched': [13],
  'durationView.verifiedSeries': [3],
  'durationView.calendarSeries': ['Aviasales cache', 9],
  'durationView.calendarShort': ['Aviasales cache'],
  'durationView.nightsLabel': [14],
  'durationView.nightsLink': [14],
  'durationView.tooltipDetail': [5, 'Sun 14 Mar'],
  'durationView.seriesLine': ['calendar, Aviasales cache', 'not searched'],
  'durationView.partlySearchedNoPrice': [3, 48],
  'durationView.partlyItinerarySearchedNoPrice': [1, 4],
  'durationView.cellDetail': [5, 'Sun 14 Mar'],
  'durationView.staleLine': [1, 4],
  'historyView.calendarSeries': ['Aviasales cache', 'economy'],
  'historyView.routeSeries': ['Google', '5–15 Nov', 'economy'],
  'historyView.coloursRepeat': [8, 6],
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
      // WP10: each names the class or sits beside a class-verified value (spec §11 View B, View C wording)
      'calendarView.partlyVerified',
      'calendarView.legend.hatched',
      'calendarView.panel.dayVerified',
      'calendarView.panel.dayPartlyVerified',
      'calendarView.panel.observation',
      'durationView.verifiedSeries',
      'durationView.verifiedShort',
      'durationView.chartNote',
      'durationView.itinerarySearchedNoPrice',
      'durationView.partlyItinerarySearchedNoPrice',
    ]);
    const offenders = strings.filter(
      ({ path, text }) => /(?<![\p{L}])verified(?![\p{L}])/u.test(text) && !allowed.has(path),
    );
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
  it('every symbol in the legend means one thing: no glyph appears twice', () => {
    const all = [
      ...Object.values(COPY.calendarView.glyphSymbol),
      ...Object.values(COPY.calendarView.phoneMark),
      ...Object.values(COPY.priceMarkGlyph),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
  it('the phone provider-marks line names every provider mark with its full name, and the fixture as synthetic', () => {
    const line = COPY.calendarView.legend.phoneProviders;
    for (const id of ['travelpayouts', 'searchapi', 'fixture'] as const) {
      expect(line).toContain(`${COPY.providerMark[id]} `);
      expect(line).toContain(COPY.provider[id]);
    }
    expect(line).toContain(SOURCE_LABELS.synthetic);
    expect(new Set(Object.values(COPY.providerMark)).size).toBe(3);
  });
  it('the phone legend line names every mark glyph', () => {
    for (const g of [...Object.values(COPY.priceMarkGlyph), ...Object.values(COPY.calendarView.phoneMark)])
      expect(COPY.calendarView.legend.phone).toContain(g);
  });
});
