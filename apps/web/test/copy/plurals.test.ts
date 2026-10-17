import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';

// why: every user-facing count agrees with its noun at 1 and at more than 1 (CodeRabbit finding on copy.ts).
const buckets = { priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0 };
const cases: ReadonlyArray<[string, string, string]> = [
  ['showingRows', COPY.showingRows(1, 1), COPY.showingRows(1, 3)],
  ['excludedByCurrentSpace', COPY.excludedByCurrentSpace(1), COPY.excludedByCurrentSpace(2)],
  [
    'progress',
    COPY.progress({ stage: 's', provider: 'p', buckets, total: 1 }),
    COPY.progress({ stage: 's', provider: 'p', buckets, total: 2 }),
  ],
  ['spendRunCalls', COPY.spendRunCalls(0, '1'), COPY.spendRunCalls(0, '2000')],
  ['spendRunFreeCalls', COPY.spendRunFreeCalls(0, '1'), COPY.spendRunFreeCalls(0, '2000')],
  ['spendProviderMonth', COPY.spendProviderMonth('P', 0, '1'), COPY.spendProviderMonth('P', 0, '10')],
  [
    'spendProviderLifetime',
    COPY.spendProviderLifetime('P', 0, '1'),
    COPY.spendProviderLifetime('P', 0, '10'),
  ],
  ['runNow', COPY.runNow(1, 5, '£1'), COPY.runNow(2, 5, '£1')],
  ['requestRow', COPY.requestRow(1, '1', 1, '£1'), COPY.requestRow(2, '2', 2, '£1')],
  ['requestRowTiles', COPY.requestRowTiles(1, '1', 1, 1, '£1'), COPY.requestRowTiles(2, '2', 2, 2, '£1')],
  ['usageWindow', COPY.usageWindow(0, '1', 'a', 'b'), COPY.usageWindow(0, '5', 'a', 'b')],
  ['usageLifetime', COPY.usageLifetime(0, '1'), COPY.usageLifetime(0, '5')],
  ['usageNoWindow', COPY.usageNoWindow(0, '1'), COPY.usageNoWindow(0, '5')],
  ['coverageCheckCalls', COPY.coverageCheckCalls(1), COPY.coverageCheckCalls(14)],
  ['createConfirm', COPY.createConfirm(1, 5, '£1'), COPY.createConfirm(2, 5, '£1')],
  ['estimateCells', COPY.estimateCells(1), COPY.estimateCells(126)],
  ['estimateRow', COPY.estimateRow('P', 's', 1, '£1', '1m'), COPY.estimateRow('P', 's', 2, '£1', '1m')],
  ['estimateTotal', COPY.estimateTotal(1, 5, '£1', '1m'), COPY.estimateTotal(2, 5, '£1', '1m')],
  ['budgetFitOk', COPY.budgetFitOk(1), COPY.budgetFitOk(4)],
  ['budgetFitWarn', COPY.budgetFitWarn(1), COPY.budgetFitWarn(4)],
  [
    'needsConfirmation',
    COPY.needsConfirmation({ calls: 1, cap: 5, estimate: '£1', confirmed: '£0' }),
    COPY.needsConfirmation({ calls: 2, cap: 5, estimate: '£1', confirmed: '£0' }),
  ],
  ['confirmedWas', COPY.confirmedWas('1', '£1'), COPY.confirmedWas('2', '£1')],
  ['confirmNew', COPY.confirmNew(1, 5, '£1'), COPY.confirmNew(2, 5, '£1')],
  ['calendar staleLine', COPY.calendarView.staleLine(0, 1, 'x'), COPY.calendarView.staleLine(0, 2, 'x')],
  [
    'scaleQuintile',
    COPY.calendarView.legend.scaleQuintile('b', 1),
    COPY.calendarView.legend.scaleQuintile('b', 5),
  ],
  [
    'scaleFlatNarrow',
    COPY.calendarView.legend.scaleFlatNarrow('b', 1, '£1', '£2'),
    COPY.calendarView.legend.scaleFlatNarrow('b', 3, '£1', '£2'),
  ],
  ['dayCell', COPY.calendarView.panel.dayCell(1, 'x'), COPY.calendarView.panel.dayCell(14, 'x')],
  [
    'cellOption',
    COPY.calendarView.panel.cellOption('A', 'B', 1, 'x'),
    COPY.calendarView.panel.cellOption('A', 'B', 14, 'x'),
  ],
  ['nightsLabel', COPY.durationView.nightsLabel(1), COPY.durationView.nightsLabel(14)],
  ['nightsLink', COPY.durationView.nightsLink(1), COPY.durationView.nightsLink(14)],
  [
    'partlyItinerarySearchedNoPrice',
    COPY.durationView.partlyItinerarySearchedNoPrice(0, 1),
    COPY.durationView.partlyItinerarySearchedNoPrice(1, 3),
  ],
  ['duration staleLine', COPY.durationView.staleLine(0, 1), COPY.durationView.staleLine(0, 2)],
  ['coloursRepeat', COPY.historyView.coloursRepeat(2, 1), COPY.historyView.coloursRepeat(3, 2)],
];

describe('user-facing counts agree with their noun', () => {
  it.each(cases)('%s: a count of one never takes a plural noun', (_name, one, many) => {
    expect(one).not.toMatch(
      /(^|[^\d.])1 (?:[a-z-]+ )?(calls|rows|cells|days|nights|runs|tiles|hits|requests|colours|prices)\b/,
    );
    expect(many).not.toBe(one);
  });

  it.each([
    [
      'showingRows',
      COPY.showingRows(1, 1),
      'showing 1 of 1 row (filters active)',
      COPY.showingRows(1, 3),
      'showing 1 of 3 rows (filters active)',
    ],
    [
      'excludedByCurrentSpace',
      COPY.excludedByCurrentSpace(1),
      '1 row outside the current window and nights range is not shown',
      COPY.excludedByCurrentSpace(2),
      '2 rows outside the current window and nights range are not shown',
    ],
    [
      'coverageCheckCalls',
      COPY.coverageCheckCalls(1),
      '1 free tile request used',
      COPY.coverageCheckCalls(14),
      '14 free tile requests used',
    ],
    ['estimateCells', COPY.estimateCells(1), '1 cell', COPY.estimateCells(126), '126 cells'],
    [
      'requestRow',
      COPY.requestRow(1, '1', 1, '£1'),
      '1 of 1 planned call · 1 cache hit · ledger cost £1, from configured rates',
      COPY.requestRow(2, '5', 2, '£1'),
      '2 of 5 planned calls · 2 cache hits · ledger cost £1, from configured rates',
    ],
    [
      'requestRowTiles',
      COPY.requestRowTiles(1, '1', 1, 1, '£1'),
      '1 of 1 planned tile (1 call) · 1 cache hit · ledger cost £1, from configured rates',
      COPY.requestRowTiles(2, '5', 3, 2, '£1'),
      '2 of 5 planned tiles (3 calls) · 2 cache hits · ledger cost £1, from configured rates',
    ],
    [
      'nightsLabel',
      COPY.durationView.nightsLabel(1),
      '1 night',
      COPY.durationView.nightsLabel(14),
      '14 nights',
    ],
    [
      'duration staleLine',
      COPY.durationView.staleLine(0, 1),
      '0 of 1 shown price is stale (older than one refresh cycle by fetch age plus any known vendor age)',
      COPY.durationView.staleLine(1, 2),
      '1 of 2 shown prices are stale (older than one refresh cycle by fetch age plus any known vendor age)',
    ],
    [
      'estimateTotal',
      COPY.estimateTotal(1, 5, '£1', '1m'),
      'about 1 call (hard stop 5), £1 per run · about 1m',
      COPY.estimateTotal(2, 5, '£1', '1m'),
      'about 2 calls (hard stop 5), £1 per run · about 1m',
    ],
    [
      'budgetFitOk',
      COPY.budgetFitOk(1),
      'Fits every cap at 1 run a month:',
      COPY.budgetFitOk(4),
      'Fits every cap at 4 runs a month:',
    ],
  ])('%s reads exactly', (_name, one, oneText, many, manyText) => {
    expect(one).toBe(oneText);
    expect(many).toBe(manyText);
  });
});
