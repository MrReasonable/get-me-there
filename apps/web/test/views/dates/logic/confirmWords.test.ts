import type { ConfirmSummary, StopDetail } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../../../../src/copy.js';
import {
  type ConfirmLineInput,
  confirmLineText,
  confirmStepGoing,
} from '../../../../src/views/Dates/confirmWords.js';

// Design 2026-11-08 §5.5: the line under the board that says how checking flights ended. Exact copy; the operator reads
// "trips with flights read", never "confirmed".

const summary = (over: Partial<ConfirmSummary> = {}): ConfirmSummary => ({
  mode: 'confirm',
  confirmed: 7,
  unread: 0,
  uncheckedCheaper: 31,
  stop: 'patience',
  ...over,
});
const line = (
  confirm: ConfirmSummary | null,
  over: Partial<Omit<ConfirmLineInput, 'confirm'>> = {},
): string | null =>
  confirmLineText({ confirm, ended: null, stopCause: null, running: false, planned: 18, ...over }, COPY);

describe('confirmLineText, rule A (patience)', () => {
  it('5 or more trips: counts the dates that look cheaper on the calendar', () => {
    expect(line(summary())).toBe(
      "Checked 18 dates; 7 trips with flights read. 31 dates look cheaper on the calendar but weren't checked.",
    );
  });

  it('adds how many could not be read to the checked count', () => {
    expect(line(summary({ unread: 2 }))).toBe(
      "Checked 18 dates, 2 couldn't be read; 7 trips with flights read. 31 dates look cheaper on the calendar but weren't checked.",
    );
  });

  it('says nothing more with none left unchecked', () => {
    expect(line(summary({ uncheckedCheaper: 0 }))).toBe('Checked 18 dates; 7 trips with flights read.');
  });

  it('fewer than 5 trips: why the other dates gave none, and the dates not checked', () => {
    expect(line(summary({ confirmed: 2, uncheckedCheaper: 288 }), { planned: 12 })).toBe(
      "Checked 12 dates; 2 trips with flights read: the other dates' flights didn't fit your limits or couldn't be read. 288 dates weren't checked.",
    );
  });

  it('the singulars: 1 date, 1 trip, 1 left', () => {
    expect(line(summary({ confirmed: 1, uncheckedCheaper: 1 }), { planned: 1 })).toBe(
      "Checked 1 date; 1 trip with flights read: the other dates' flights didn't fit your limits or couldn't be read. 1 date wasn't checked.",
    );
    expect(line(summary({ confirmed: 5, uncheckedCheaper: 1 }), { planned: 1 })).toBe(
      "Checked 1 date; 5 trips with flights read. 1 date looks cheaper on the calendar but wasn't checked.",
    );
  });
});

describe('confirmLineText, queue empty', () => {
  it('every date with a calendar price', () => {
    expect(line(summary({ confirmed: 5, stop: 'queue-empty', uncheckedCheaper: 0 }))).toBe(
      'Checked every date with a calendar price; 5 trips with flights read.',
    );
  });

  it('with some not read', () => {
    expect(line(summary({ confirmed: 5, stop: 'queue-empty', uncheckedCheaper: 0, unread: 2 }))).toBe(
      "Checked every date with a calendar price, 2 couldn't be read; 5 trips with flights read.",
    );
  });
});

describe('confirmLineText, a stop before the rule ended the step', () => {
  const few = summary({ confirmed: 3, uncheckedCheaper: 120, stop: 'returns-stopped' });

  it.each([
    ['return flights could not be read', few, {}, "return flights couldn't be read"],
    [
      'the browser window closed',
      summary({ confirmed: 3, uncheckedCheaper: 120, stop: null }),
      { ended: 'window' as const },
      "the browser's time ran out",
    ],
    [
      'the search was cancelled',
      summary({ confirmed: 3, uncheckedCheaper: 120, stop: null }),
      { stopCause: { kind: 'cancelled' as const } },
      'the search was cancelled',
    ],
  ])('fewer than 5 trips, %s', (_name, confirm, over, because) => {
    expect(line(confirm, { planned: 9, ...over })).toBe(
      `Stopped checking flights after 9 dates because ${because}; 3 trips with flights read. 120 dates weren't checked.`,
    );
  });

  it('5 or more trips counts the dates that look cheaper on the calendar', () => {
    expect(line(summary({ stop: 'returns-stopped' }), { planned: 9 })).toBe(
      "Stopped checking flights after 9 dates because return flights couldn't be read; 7 trips with flights read. 31 dates that look cheaper on the calendar weren't checked.",
    );
  });

  it('says nothing of dates left when none were', () => {
    expect(line(summary({ stop: 'returns-stopped', uncheckedCheaper: 0 }), { planned: 9 })).toBe(
      "Stopped checking flights after 9 dates because return flights couldn't be read; 7 trips with flights read.",
    );
  });

  it.each([
    ['cancelled', 'the search was cancelled'],
    ['budget', 'a spending limit was reached'],
    ['fatal', 'the app hit an error'],
    ['other', 'the search stopped'],
  ] as const)('an abort with a %s cause', (kind, because) => {
    expect(
      line(summary({ confirmed: 1, uncheckedCheaper: 120, stop: null }), { planned: 3, stopCause: { kind } }),
    ).toBe(
      `Stopped checking flights after 3 dates because ${because}; 1 trip with flights read. 120 dates weren't checked.`,
    );
  });

  it('an abort that holds no cause reads "because the search stopped"', () => {
    expect(line(summary({ confirmed: 1, uncheckedCheaper: 120, stop: null }), { planned: 3 })).toContain(
      'because the search stopped;',
    );
  });

  // every detail an ending page or a cap can end the step with (the engine's error table: blocked, provider-unavailable,
  // auth, quota, limiter-timeout, and the free-call and run caps) reads its own existing stopText wording
  const ENDING: ReadonlyArray<[StopDetail, string]> = [
    ['blocked', 'the browser worker stopped at a page it will not go past'],
    ['provider-unavailable', "the browser worker isn't answering"],
    ['auth', "the browser worker's key was refused"],
    ['quota', "the browser worker's plan has no calls left"],
    ['limiter-timeout', 'the browser worker was limiting how fast it answers'],
    ['free-call-cap', "this search's limit of free calls is used up"],
    ['execution-cap', "this search's limit for one run is used up"],
  ];
  it.each(ENDING)('an ending %s reads its stop wording', (detail, because) => {
    const text = line(summary({ confirmed: 1, uncheckedCheaper: 120, stop: null }), {
      planned: 3,
      ended: 'stopped',
      stopCause: { kind: 'detail', detail },
    });
    expect(text).toContain(`because ${because}`);
  });

  it('each ending detail reads differently from the cancel line and from every other', () => {
    const lines = ENDING.map(([detail]) =>
      line(summary({ stop: null }), { ended: 'stopped', stopCause: { kind: 'detail', detail } }),
    );
    lines.push(line(summary({ stop: null }), { stopCause: { kind: 'cancelled' } }));
    expect(new Set(lines).size).toBe(lines.length);
  });

  it("an ending page with no reason known reads 'the search stopped'", () => {
    expect(line(summary({ stop: null }), { ended: 'stopped' })).toContain('because the search stopped;');
  });
});

describe('confirmLineText, the other cases', () => {
  it('outbound-only mode', () => {
    expect(line(summary({ mode: 'outbound-only' }))).toBe(
      "Trips couldn't be checked on this machine: it can't read return flights.",
    );
  });

  it('flags-unread mode', () => {
    expect(line(summary({ mode: 'flags-unread' }))).toBe(
      "Trips couldn't be checked this run: the browser hadn't yet said what it can read.",
    );
  });

  it('while the step runs', () => {
    expect(line(summary({ confirmed: 3, stop: null }), { running: true, planned: 9 })).toBe(
      'Checking flights: 9 dates so far; 3 trips with flights read.',
    );
    expect(line(summary({ confirmed: 1, stop: null }), { running: true, planned: 1 })).toBe(
      'Checking flights: 1 date so far; 1 trip with flights read.',
    );
  });

  it('a run with no summary has no line', () => {
    expect(line(null)).toBeNull();
    expect(line(null, { running: true })).toBeNull();
  });

  it('never says "confirmed"', () => {
    for (const c of [summary(), summary({ stop: 'queue-empty' }), summary({ stop: 'returns-stopped' })])
      expect(line(c)).not.toMatch(/confirm/i);
  });
});

describe('confirmStepGoing', () => {
  const flights = (over: Partial<{ ended: 'window' | null; confirm: ConfirmSummary | null }> = {}) => ({
    planned: 4,
    read: 2,
    reused: 0,
    failed: 0,
    ended: null,
    confirm: summary({ stop: null }),
    stopCause: null,
    ...over,
  });
  it('is true in confirm mode with no end and no stop of its own', () => {
    expect(confirmStepGoing(flights())).toBe(true);
  });
  it.each([
    ['no plan', null],
    ['a run before the change', flights({ confirm: null })],
    ['outbound-only mode', flights({ confirm: summary({ mode: 'outbound-only', stop: null }) })],
    ['its own stop', flights({ confirm: summary({ stop: 'patience' }) })],
    ['an early end', flights({ ended: 'window' })],
  ])('is false for %s', (_n, f) => {
    expect(confirmStepGoing(f)).toBe(false);
  });
});
