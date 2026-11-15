import { describe, expect, it } from 'vitest';
import {
  IDLE,
  onProgress,
  onTerminal,
  onTimer,
  REREAD_MS,
  type Reread,
} from '../../../../src/views/Dates/refresh.js';

// Spec §11 Run landing, design 2026-11-08 Ruling 17: while the latest parent run is pending or running, a progress
// change re-reads the route at most once every 30 s with a trailing read, and at once when the run leaves pending or
// running; nothing is held (rows carry their ages). Pure, over an injected clock; Stryker runs it.

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
