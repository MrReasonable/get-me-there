import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';

/** Sample arguments for every function entry, keyed by dotted path. A missing key fails the test. */
const SAMPLES: Record<string, unknown[]> = {
  confirmedWas: ['154', '£1'],
  metroExpanded: ['LON', 'LHR, LGW'],
  progressSelected: [{ provider: 'SearchApi', done: 8, selected: 10, error: 1, skipped: 116, notRun: 2 }],
  childExecutionNotStarted: ['pending'],
  executionNotStarted: ['pending'],
  loadFailed: ['network error'],
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
  executionsShown: ['run started 14 Oct 2026 12:00 UTC (completed, 2h ago)'],
  executionItem: ['14 Oct 2026 12:00 UTC', 'completed', '2h ago'],
  childExecutionItem: ['14 Oct 2026 12:00 UTC', 'running', 'just now'],
  spanExecutions: [3],
  notCompletedBanner: ['running'],
  progress: [
    {
      stage: 'discovery',
      provider: 'Travelpayouts',
      verb: 'searched',
      done: 116,
      total: 126,
      error: 6,
      skipped: 0,
      notRun: 10,
    },
  ],
  progressLabel: ['discovery', 'Travelpayouts'],
  spendRunCalls: [42, '2000'],
  spendRunFreeCalls: [14, '2000'],
  spendRunCost: ['£0', '£0'],
  spendMonth: ['£32', '£35'],
  spendProviderMonth: ['SearchApi', 615, '10000'],
  paused: ['budget'],
  resumesAt: ['1 Nov 2026 00:00 UTC'],
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
      'classLabel.verified',
      'classLabel.partially-verified',
      'calendarGapLead',
      'headlineRest',
    ]);
    const offenders = strings.filter(
      ({ path, text }) => /(?<![\p{L}])verified(?![\p{L}])/u.test(text) && !allowed.has(path),
    );
    expect(offenders).toEqual([]);
  });

  it('stage counts say itinerary-searched', () => {
    expect(COPY.itineraryLine({ searched: 2, selected: 10, onDemand: 1 })).toBe(
      ' · itinerary-searched 2 of 10 selected +1 on demand',
    );
    expect(COPY.progressVerb.verification).toBe('itinerary-searched');
  });

  it('confirmations state the estimated calls with the hard stop, and pounds (decisions 36, 44)', () => {
    expect(COPY.createConfirm(154, 2000, '£0')).toBe(
      'Create and confirm about 154 calls (hard stop 2000), £0 per run',
    );
    expect(COPY.confirmNew(154, 2000, '£2')).toBe('Confirm about 154 calls (hard stop 2000), £2 per run');
    expect(COPY.runNow(154, 2000, '£0')).toBe('Run now (about 154 calls (hard stop 2000), £0)');
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
