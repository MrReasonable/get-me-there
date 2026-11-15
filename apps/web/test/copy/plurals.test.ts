import { describe, expect, it } from 'vitest';
import { COPY } from '../../src/copy.js';

// why: every user-facing count agrees with its noun at 1 and at more than 1 (CodeRabbit finding on copy.ts).
const cases: ReadonlyArray<[string, string, string]> = [
  ['runProgress.calendar', COPY.runProgress.calendar(0, 1, null), COPY.runProgress.calendar(0, 2, null)],
  ['topBar.callsLeftMonth', COPY.topBar.callsLeftMonth(0, 1), COPY.topBar.callsLeftMonth(0, 100)],
  ['topBar.callsLeftTrial', COPY.topBar.callsLeftTrial(0, 1), COPY.topBar.callsLeftTrial(0, 24)],
  ['requestRow', COPY.requestRow(1, '1', 1, '£1'), COPY.requestRow(2, '2', 2, '£1')],
  ['requestRowTiles', COPY.requestRowTiles(1, '1', 1, 1, '£1'), COPY.requestRowTiles(2, '2', 2, 2, '£1')],
  ['usageWindow', COPY.usageWindow(0, '1', 'a', 'b'), COPY.usageWindow(0, '5', 'a', 'b')],
  ['usageLifetime', COPY.usageLifetime(0, '1'), COPY.usageLifetime(0, '5')],
  ['usageNoWindow', COPY.usageNoWindow(0, '1'), COPY.usageNoWindow(0, '5')],
  ['coverageCheckCalls', COPY.coverageCheckCalls(1), COPY.coverageCheckCalls(14)],
  ['budgetFitOk', COPY.budgetFitOk(1), COPY.budgetFitOk(4)],
  ['budgetFitWarn', COPY.budgetFitWarn(1), COPY.budgetFitWarn(4)],
  [
    'needsConfirmation',
    COPY.needsConfirmation({ calls: 1, cap: 5, estimate: '£1', confirmed: '£0' }),
    COPY.needsConfirmation({ calls: 2, cap: 5, estimate: '£1', confirmed: '£0' }),
  ],
  ['confirmedWas', COPY.confirmedWas('1', '£1'), COPY.confirmedWas('2', '£1')],
  ['confirmNew', COPY.confirmNew(1, 5, '£1'), COPY.confirmNew(2, 5, '£1')],
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
      'coverageCheckCalls',
      COPY.coverageCheckCalls(1),
      '1 free request used',
      COPY.coverageCheckCalls(14),
      '14 free requests used',
    ],
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
