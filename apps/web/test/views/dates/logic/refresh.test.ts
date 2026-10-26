import { decodeDatePairs } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { boardModel } from '../../../../src/views/Dates/board.js';
import {
  changeCount,
  IDLE,
  onProgress,
  onTerminal,
  onTimer,
  REREAD_MS,
  type Reread,
  readDecision,
} from '../../../../src/views/Dates/refresh.js';
import { at, type DatesOptions, datesResponse, priced, pricedPair } from '../../../fixtures.dates.js';
import { NOW } from '../../../render.js';

// Spec §11 Run landing and re-ranking: while the latest parent run is pending or running, a progress change re-reads
// the route at most once every 30 s with a trailing read, and at once when the run leaves pending or running; a read
// that changes the board is held while the pointer or the focus is in it (revision 50, Ian ruled). Pure, over an
// injected clock; Stryker runs it.

const S = 1_000;

describe('the 30 s re-read throttle', () => {
  it('the first progress change is read at once', () => {
    expect(REREAD_MS).toBe(30 * S);
    expect(onProgress(IDLE, 0)).toEqual({ state: { lastReadAt: 0, trailingAt: null }, read: true });
  });

  it('a change 10 s after a read waits for a trailing read at 30 s, and only one is scheduled', () => {
    const read: Reread = { lastReadAt: 0, trailingAt: null };
    const a = onProgress(read, 10 * S);
    expect(a).toEqual({ state: { lastReadAt: 0, trailingAt: 30 * S }, read: false });
    const b = onProgress(a.state, 20 * S);
    expect(b).toEqual({ state: { lastReadAt: 0, trailingAt: 30 * S }, read: false });
    expect(onTimer(b.state, 29_999)).toEqual({ state: b.state, read: false });
    expect(onTimer(b.state, 30 * S)).toEqual({ state: { lastReadAt: 30 * S, trailingAt: null }, read: true });
  });

  it('a change exactly 30 s after a read is read at once', () => {
    expect(onProgress({ lastReadAt: 0, trailingAt: null }, 30 * S).read).toBe(true);
    expect(onProgress({ lastReadAt: 0, trailingAt: null }, 29_999).read).toBe(false);
  });

  it('the throttle counts from the last read, wherever it was', () => {
    const read: Reread = { lastReadAt: 100 * S, trailingAt: null };
    expect(onProgress(read, 110 * S)).toEqual({
      state: { lastReadAt: 100 * S, trailingAt: 130 * S },
      read: false,
    });
    expect(onProgress(read, 130 * S).read).toBe(true);
  });

  it('a timer with no trailing read due does nothing', () => {
    expect(onTimer(IDLE, 99 * S)).toEqual({ state: IDLE, read: false });
  });

  it('the run leaving pending or running is read at once, 5 s after a read, and cancels the trailing read', () => {
    const waiting: Reread = { lastReadAt: 0, trailingAt: 30 * S };
    expect(onTerminal(waiting, 5 * S)).toEqual({
      state: { lastReadAt: 5 * S, trailingAt: null },
      read: true,
    });
  });
});

describe('holding a read while the operator is in the board (revision 50)', () => {
  it('holds only a read that changes the board, for the same scope, during a run, with the pointer or focus inside', () => {
    const base = { runActive: true, held: true, sameScope: true, changes: 2 };
    expect(readDecision(base)).toBe('hold');
    expect(readDecision({ ...base, held: false })).toBe('apply');
    expect(readDecision({ ...base, runActive: false })).toBe('apply');
    expect(readDecision({ ...base, sameScope: false })).toBe('apply');
    expect(readDecision({ ...base, changes: 0 })).toBe('apply');
  });
});

describe('changeCount: N date pairs whose rank or figure differs, among the rows either read would show', () => {
  const model = (o: DatesOptions) =>
    boardModel(
      decodeDatePairs(datesResponse(o)).pairs,
      { nights: null, bestPerWeek: false, sort: { key: 'price', dir: 'asc' } },
      NOW,
    );
  const before: DatesOptions = {
    pairs: {
      [at('2027-03-14', 10)]: pricedPair(priced(30_000)),
      [at('2027-03-15', 10)]: pricedPair(priced(31_000)),
      [at('2027-03-16', 10)]: pricedPair(priced(32_000)),
      [at('2027-03-17', 10)]: pricedPair(priced(33_000)),
    },
  };

  it('an identical read has no changes', () => {
    expect(changeCount(model(before), model(before), 10)).toBe(0);
  });

  it('two date pairs swapping ranks are two changes', () => {
    const swapped: DatesOptions = {
      pairs: { ...before.pairs, [at('2027-03-14', 10)]: pricedPair(priced(31_500)) },
    };
    expect(changeCount(model(before), model(swapped), 10)).toBe(2);
  });

  it('a figure that changes without moving is one change (a new age, a new price at the same rank)', () => {
    const repriced: DatesOptions = {
      pairs: { ...before.pairs, [at('2027-03-17', 10)]: pricedPair(priced(33_500)) },
    };
    expect(changeCount(model(before), model(repriced), 10)).toBe(1);
  });

  it('a new date pair entering the board is a change, and so is each one it pushes down', () => {
    const added: DatesOptions = {
      pairs: { ...before.pairs, [at('2027-03-18', 10)]: pricedPair(priced(29_000)) },
    };
    expect(changeCount(model(before), model(added), 10)).toBe(5);
  });

  it('only rows either read would show count: a change past the shown rows is not counted', () => {
    const tail: DatesOptions = {
      pairs: { ...before.pairs, [at('2027-03-17', 10)]: pricedPair(priced(33_500)) },
    };
    expect(changeCount(model(before), model(tail), 3)).toBe(0);
    const leaving: DatesOptions = {
      pairs: { ...before.pairs, [at('2027-03-14', 10)]: pricedPair(priced(40_000)) },
    };
    // the old first row leaves the top 3 (counted), and the 4th moves into it (counted), the 2nd and 3rd move up
    expect(changeCount(model(before), model(leaving), 3)).toBe(4);
  });
});
