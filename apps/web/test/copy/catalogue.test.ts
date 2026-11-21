import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
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
  childExecutionNotStarted: ['pending'],
  executionNotStarted: ['pending'],
  loadFailed: ['network error'],
  actionFailed: ['409 conflict'],
  providersUnknown: ['HTTP 500'],
  fxSpoken: ['converted to GBP at the 2026-10-13 rate (frankfurter)'],
  fxTitle: ['2026-10-13', 'frankfurter'],
  notSeenInLatest: ['3d ago'],
  agoOf: ['unknown'],
  dateRange: ['14 Mar 2027', '28 Mar 2027', 14],
  executionsShown: ['run started 14 Oct 2026 13:00 Europe/London (completed, 2h ago)'],
  executionItem: ['14 Oct 2026 13:00 Europe/London', 'completed', '2h ago'],
  childExecutionItem: ['14 Oct 2026 13:00 Europe/London', 'running', 'just now'],
  spanExecutions: [3, 1],
  notCompletedBanner: ['running'],
  'topBar.needsAttention': ['backups'],
  'topBar.failing': ['schedule'],
  'topBar.severalNeedYou': [3],
  'topBar.creditsLeft': [51, 100],
  'settingsView.switchLabel': ['SearchApi'],
  'settingsView.browserState': ['failing', 'not answering'],
  'settingsView.consentSaved': ['18 Nov 2027'],
  'settingsView.consentEnding': ['18 Nov 2027'],
  'settingsView.consentEnded': ['18 Nov 2027'],
  'settingsView.pagesAtOnce': [2],
  'settingsView.patienceAfter': [5],
  'settingsView.credits': [51, 100],
  'settingsView.callsThisMonth': [64, 50_000],
  'settingsView.secretEnds': ['3f2a'],
  'settingsView.confirmRemove': ['SearchApi key'],
  'settingsView.appliesAfter': [['London → New York']],
  'settingsView.envLine': [['SEARCHAPI_MONTHLY_CALL_CAP']],
  'settingsView.listSetAside': ['Calendar sources for new searches'],
  'settingsView.listChoose': ['Calendar sources for new searches'],
  'settingsView.limits.spent': ['£0'],
  'settingsView.email.testSent': ['alerts@example.com'],
  'settingsView.alerts.lastSent': ['14 Oct 2026 13:00'],
  'settingsView.alerts.confirmDelete': ['London → New York'],
  'topBar.creditsResets': ['1 Dec'],
  'topBar.creditsAsOf': ['14:05'],
  'topBar.spent': ['£32', '£35'],
  'topBar.spentNoCap': ['£32'],
  'topBar.searching': ['London → New York'],
  'runProgress.calendar': [1203, 2184, 'about 14 min left'],
  'runProgress.calendarUncounted': ['about 14 min left'],
  'runProgress.minutesLeft': [14],
  'runProgress.flights': [9],
  'runProgress.checking': [{ done: 3, total: 10 }, 'about 2 min left'],
  'runProgress.resumesAt': ['1 Nov 2026 00:00 Europe/London'],
  'runProgress.childRun': ['stopped'],
  requestRowTiles: [14, '14', 14, 0, '£0'],
  maxAgeAssumed: ['24h'],
  coverageOnDemandRunText: ['completed', '14 Oct 2026 13:41 Europe/London'],
  coverageOnDemandCalls: [3, 0, '£0'],
  scheduledOnlyRow: ['Google Flights (browser)', 'discovery', 12, "outside this run's browser window"],
  scheduledOnlyHeading: ['left for the next scheduled run'],
  firingNotStarted: ['19 Oct 2026 05:00', 'skipped: missed and not caught up'],
  skippedWhy: ['skipped: missed and not caught up', 'the next scheduled run was less than half the gap away'],
  carriersIgnored: ['BRITISH'],
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
  // Trips and Search Task 7 (Rulings 13–14): Where to look and Repeat
  'newSearch.searchapiNote': [9385, "(this app's count)"],
  'newSearch.notSetUp': [['the browser', 'SearchApi']],
  'newSearch.repeatOther': ['Every day at 06:30 (Europe/London)'],
  'editSearch.heading': ['Birmingham → Frankfurt'],
  'editSearch.startFailed': ['database is locked'],
  'repeatWeekly.repeats': ['Mondays', '05:00'],
  'repeatWeekly.repeatsDaily': ['05:00'],
  'searchesView.codes': ['BHX', 'FRA'],
  'searchesView.windowSpan': ['10 Jan', '31 Mar'],
  'searchesView.windowRolling': [182, 7],
  'searchesView.repeats': [[1, 4], '05:00'],
  'searchesView.repeatsDaily': ['05:00'],
  'searchesView.searchedMeta': ['2h ago'],
  'searchesView.tripsLabel': ['London → New York'],
  'searchesView.leaveWindow': ['10 Jan – 31 Mar'],
  'searchesView.allTripsAndDatesOf': ['London → New York'],
  'searchesView.datesWithFlightsRead': [23],
  'searchesView.datesWithFlightsReadNoTrip': [23],
  'searchesView.lowerLink': [155],
  'searchesView.calendarOnlyLink': [2146],
  'searchesView.nothingFound.stoppedBefore': [105],
  'searchesView.nothingFound.browserUnavailable': [30],
  'searchesView.nothingFound.couldntRead': [12],
  'searchesView.turnOnBrowserOf': ['London → New York'],
  'searchesView.turnOnBrowserFailed': ['HTTP 500'],
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
  'datesView.scopeNights': [10, 14],
  'datesView.onDemandOnly': [2],
  'datesView.tooManyCells': [100000, 50000],
  // WP20 Task 20.6: a search's page (spec rev 55 §11)
  'searchPage.leaveRolling': ['14 Mar – 13 Apr'],
  'searchPage.eachWayUnder': ['25h'],
  'searchPage.searched': ['today 09:12–11:41'],
  'searchPage.dayTime': ['yesterday', '11:44'],
  'searchPage.span': ['09:12', '11:41'],
  'searchPage.fromOnly': ['09:12'],
  'searchPage.calendarPrices': [2146, 2184],
  'searchPage.datesWithFlightsRead': [23],
  'searchPage.journeyChip': ['20h'],
  'searchPage.journeyChipRemove': ['20h'],
  'searchPage.overLimit': [2, '25h'],
  'searchPage.outsideLimits': [2, 'your 25h limit each way and your 1-change limit'],
  'searchPage.showMore': [10],
  'searchPage.inAll': [155],
  'searchPage.folds.count': [2146],
  'searchPage.folds.searchedSummary': [2146, 2184],
  'searchPage.folds.flightsReadValue': [23],
  'searchPage.folds.alertOn': [2],
  'alertsView.plainCooldown': [336],
  'alertsView.plainDrop': ['10%'],
  // WP20 Task 20.10: the flights on a search's page
  'flights.changes': [1],
  'flights.operatedBy': ['Virgin Atlantic', 'Delta'],
  // WP21 Task 21.7: the return leg on a search's page (spec rev 56 §11)
  'flights.sellerLine': ['QQ Fares', 'Economy Basic', 3],
  'flights.returnCounts': [2, 1],
  'flights.moreListed': [12, 10],
  'flights.returnSkipped': ['the wait between pages ran past its time'],
  'flights.returnTransient': [false],
  'flights.readDoneReturns': ['14 → 24 Mar', 2],
  'datesView.pairingTimes': ['07:15', '14:20'],
  'datesView.confirm.dates': [18],
  'datesView.confirm.trips': [7],
  'datesView.confirm.unread': [2],
  'datesView.confirm.checked': ['18 dates', "2 couldn't be read"],
  'datesView.confirm.checkedEvery': [null],
  'datesView.confirm.cheaperUnchecked': [31],
  'datesView.confirm.cheaperStopped': [31],
  'datesView.confirm.unchecked': [120],
  'datesView.confirm.stopped': ['9 dates', "the browser's time ran out"],
  'datesView.confirm.running': [9, '3 trips with flights read'],
  'datesView.confirm.patience': [12, 'these five'],
  'datesView.confirm.theseTrips': [5],
  'datesView.confirm.cheapestTrips': [5],
  'datesView.pairingBeneath': ['9d ago'],
  'datesView.listFailed': ["the browser worker's monthly limit is used up"],
  'flights.datesShort': ['14', '24 Mar'],
  'flights.readDone': ['14 → 24 Mar'],
  'flights.readNotDone': ['14 → 24 Mar'],
  // Task 9 (Ruling 18): the calendar, its day names and the day panel
  'calendar.lead': [10, 21],
  'calendar.dayPrice': ['Wed 11 Nov', '£372', 'Calendar · 3h', false],
  'calendar.dayMark': ['Wed 11 Nov', 'not searched'],
  'calendar.panelHeading': ['Wed 11 Nov', 12],
  'calendar.showMore': [7],
  'calendar.stayLine.over-limit': ['25h'],
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
  // Trips and Search plan Task 5: the shared trip and calendar rows
  'rows.nightsInline': [17],
  'rows.pair': ['LHR', 'JFK'],
  'rows.detailsFor': ['Wed 11 Nov → Sat 28 Nov', 'LHR → JFK'],
  'rows.readFlightsFor': ['Wed 11 Nov → Sat 28 Nov', null],
  'rows.legTimes': ['07:15', '17:55'],
  'rows.changes': [2],
  'trip.calendarFailed': ["Flights couldn't be read: the connection to it failed"],
  'readState.failed': ['the connection to it failed'],
  // trip-page plan Task 7: the Trip page (design 2026-11-08 §5, §6.1)
  'trip.heading': ['Wed 11 Nov', 'Sat 28 Nov'],
  'trip.nights': [17],
  'trip.labelText': ['Seller', '3h'],
  'trip.labelStale': ['Calendar · 3h', "older than this search's refresh"],
  'trip.labelDetail.seller': ['Kiwi.com', 16],
  'trip.labelDetail.sellerNamed': ['Kiwi.com'],
  'trip.labelSource': ['the browser worker'],
  'trip.sellerLine': ['Kiwi.com', 16],
  'trip.bookOn': ['www.google.com'],
  'trip.nameContext': ['Back 21:10 JFK → 09:15 LHR'],
  'trip.lands': ['Sun 29 Nov'],
  'trip.legDay': ['Sat 28 Nov', 'lands Sun 29 Nov'],
  'trip.legName': ['Back', '21:10', 'JFK', '09:15', 'LHR'],
  'trip.readFlights': [true, 2],
  'trip.tryAgain': [2],
  'trip.reading': [2],
  'trip.noneWithin': ['3h ago', 'your 25h limit each way'],
  'trip.cheapestReadLeg': ['27h 10m'],
  'trip.otherLimits': ['3h ago'],
  'trip.outboundOnly': ['3h ago'],
  'trip.noReturn': ['3h ago'],
  'trip.calendarWithTrip': ['9d ago'],
  'trip.readWithoutCalendar': ['2h ago'],
  'trip.listFailed': ['16:42', 'the connection to it failed'],
  'trip.limitJourney': ['25h'],
  'trip.limitStops': [1],
  'trip.folded': [9, 'outbound', '6 over your 25h limit, 3 dearer'],
  'trip.foldedOver': [6, '25h'],
  'trip.foldedDearer': [3],
  'trip.about.market': ['UK market'],
  'trip.about.forTheseDatesOn': ['LHR', 'JFK'],
  'trip.about.seller': ['Kiwi.com', 'today at 16:42'],
  'trip.about.sellerSearchApi': ['today at 16:42'],
  'trip.about.google-price': ['today at 16:42'],
  'trip.about.google-incomplete': ['today at 16:42'],
  'trip.about.calendar': ['today at 16:42'],
  'trip.about.cached': ['on 12 Oct at 09:10'],
  'trip.about.not-seen-again': ['on 9 Oct at 09:10'],
  'trip.about.checkedJourney': ['25h'],
  'trip.about.otherPair': ['LGW', 'JFK', 'no price listed in the latest search'],
  'trip.logCount': [18, '26 Oct'],
  'trip.logToday': ['16:40'],
  'trip.logFailed': ['the connection to it failed'],
  'trip.logShowAll': [18],
  'trip.logSourceOf': ['the browser worker'],
  'trip.dayOffset': [1],
  'trip.aboutWhen.today': ['16:42'],
  'trip.aboutWhen.yesterday': ['09:10'],
  'trip.aboutWhen.day': ['12 Oct', '11:44'],
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

  it('run progress says dates and flights in the plan’s own words, with a thousands separator and no umbrella', () => {
    const R = COPY.runProgress;
    expect(R.calendar(1203, 2184, 'about 14 min left')).toBe(
      'Reading the calendar, 1,203 of 2,184 dates · about 14 min left',
    );
    expect(R.calendar(0, 1, null)).toBe('Reading the calendar, 0 of 1 date');
    expect(R.flights(9)).toBe('Reading flights for the cheapest dates, 9 read so far');
    // why: ruling 4 (decision 67) still holds: no "attempted" or "searched" umbrella outside the Search log
    expect([R.calendar(5, 9, null), R.flights(1)].filter((t) => /attempted|searched/.test(t))).toEqual([]);
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
      'searchesView.datesChanged',
      'calendar',
      'datesView.confirm',
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

  it('run progress names a stopped run in main-path words, never "paused: error"', () => {
    expect(Object.values(COPY.barStatusName).filter((w) => /^paused/.test(w))).toEqual([]);
  });

  it('the guard itself works: a planted banned word is found', () => {
    expect(findBannedWords('Live fares', BANNED_WORD_ALLOWLIST)).toHaveLength(1);
  });
});

describe('glyph set (review ui I2)', () => {
  // why: Task 9 retired the overview's mark glyphs; the calendar draws two (the trip's dot and the cross of a day that
  // couldn't be read) beside PriceCell's, and a glyph both draw must mean the same thing in each
  it('every symbol means one thing: the calendar’s glyphs are not the price marks’ glyphs', () => {
    const price = COPY.priceMarkGlyph;
    const calendar = [COPY.calendar.tripGlyph, COPY.calendar.couldntReadGlyph];
    expect(new Set(Object.values(price)).size).toBe(Object.keys(price).length);
    expect(new Set(calendar).size).toBe(2);
    for (const g of calendar) expect(Object.values(price), g).not.toContain(g);
  });
  it('the provider marks are four distinct short names', () => {
    expect(new Set(Object.values(COPY.providerMark)).size).toBe(4);
  });
});

describe('a search’s page in words (WP20 Task 20.6, spec rev 55 §3, §11)', () => {
  // Ruling 18: the key's five items as the ruling words them; a day's words never say "no flights"
  it('the calendar’s key and a day’s words read as the ruling words them; no mark reads "no flights"', () => {
    const K = COPY.calendar.key;
    expect([K.trip, K.couldntRead, K.noPrice, K.hatched]).toEqual([
      'a trip with flights read; other prices are calendar prices, not fares',
      "couldn't read",
      "no price (not 'no flights')",
      'hatched: not searched or not reached',
    ]);
    const W = COPY.calendar.markWords;
    expect([W['no-price-shown'], W['couldnt-read'], W['not-reached'], W['not-searched']]).toEqual([
      'no price',
      "couldn't read",
      'not reached',
      'not searched',
    ]);
    expect(Object.values(W).filter((w) => /no flights/i.test(w))).toEqual([]);
    expect(Object.values(COPY.calendar.stayName).filter((w) => /no flights/i.test(w))).toEqual([]);
    expect(COPY.calendar.dayPrice('Wed 11 Nov', '£412', 'Seller · 3h', true)).toBe(
      'Wed 11 Nov, £412, Seller · 3h, trip with flights read',
    );
    expect(COPY.calendar.panelHeading('Wed 11 Nov', 12)).toBe('Wed 11 Nov: 12 stays');
    expect(COPY.calendar.panelHeading('Wed 11 Nov', 1)).toBe('Wed 11 Nov: 1 stay');
    expect(COPY.calendar.showMore(7)).toBe('Show 7 more stays');
    expect(COPY.calendar.showMore(1)).toBe('Show 1 more stay');
    expect(COPY.calendar.stayLine['over-limit'](null)).toBe(
      'Every price found for these dates is over the journey limit.',
    );
  });
  it('the run line’s clauses and the sections’ counts, in dates (design 2026-11-08, mockup 02)', () => {
    const P = COPY.searchPage;
    expect(P.calendarPrices(2146, 2184)).toBe('calendar prices for 2,146 of 2,184 dates');
    expect(P.calendarPrices(1, 1)).toBe('calendar prices for 1 of 1 date');
    expect(P.datesWithFlightsRead(23)).toBe('23 dates with flights read');
    expect(P.datesWithFlightsRead(1)).toBe('1 date with flights read');
    expect(P.overLimit(1, '25h')).toBe("1 date's trips are over 25h each way.");
    expect(P.overLimit(2, '25h')).toBe("2 dates' trips are over 25h each way.");
    expect(P.inAll(155)).toBe('155 dates in all.');
    expect(P.leaveRolling('9 Nov – 9 May')).toBe('leave 9 Nov – 9 May (moves forward each day)');
    expect(COPY.datesView.confirm.theseTrips(5)).toBe('these five');
    expect(COPY.datesView.confirm.cheapestTrips(12)).toBe('the 12 cheapest');
  });
});

// --- the main path's reach (minor 8): every COPY path its source files name, directly or through an alias ---

const SRC = join(import.meta.dirname, '..', '..', 'src');
/** The main path's files (spec rev 55 §11): the first screen, a search's page, the Edit page and More options, the top bar, run progress, breadcrumbs and Settings. */
const MAIN_PATH_DIRS = ['views/Searches', 'views/Dates', 'views/Definitions', 'views/Settings'];
const MAIN_PATH_FILES = [
  'components/TopBar.tsx',
  'components/RunProgress.tsx',
  'components/Crumbs.tsx',
  'components/StopWords.tsx',
  'components/Nav.tsx',
];
/** The coverage section keeps the set-up terms by spec (§11), each with its line; it is not on the main path. */
const SET_UP_FILES = new Set(['views/Dates/CoverageSection.tsx']);
/** Provenance notes keep §2's source names on every view (spec rev 55 §11: "no Camoufox outside provenance notes"). */
const PROVENANCE_KEYS = ['provider', 'providerShort', 'providerMark'];

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
  it('an offer is never "from" (21.7 prov-001): only the mismatch mark and a "from" price say it', () => {
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
    // why: design 2026-11-08 §4.1 (operator ruling): "not every seller read" is the one allowed use, a negation that
    // claims nothing complete
    const claims = (t: string) => t.replace(/not every seller read/gi, '');
    expect(texts.filter((t) => /each seller|every seller|lowest seller price/i.test(claims(t)))).toEqual([]);
    expect(COPY.basisKindName.seller).toBe('cheapest of the sellers read, not checked with the airline');
  });
  it('"round trip" is spelt one way: never "round-trip total" or "roundtrip"', () => {
    expect(texts.filter((t) => /round[- ]trip total|roundtrip/i.test(t))).toEqual([]);
  });
  it('the counts clause', () => {
    expect(F.returnCounts(2, 1)).toBe('2 return options unread, 1 for other airports or days');
    expect(F.returnCounts(1, 0)).toBe('1 return option unread');
    expect(F.returnCounts(0, 3)).toBe('3 return options for other airports or days');
  });
});
