import type { DatePair } from '@gmt/core';
import type { BoardModel } from './board.js';

// Spec §11 "Run landing and re-ranking" as a pure state machine over an injected clock (milliseconds): the component
// feeds it the status bar's progress changes, the run leaving pending or running, and its own timer, and re-reads the
// route when it says so. Revision 50 (Ian ruled 2026-10-26): a read that changes the board is held while the pointer
// is over the board or focus is inside it.

/** Spec §11: during a run the view re-reads the route at most once every 30 s (a starting default the build may tune). */
export const REREAD_MS = 30_000;

export interface Reread {
  /** When the route was last re-read for a progress change, or null before the first. */
  lastReadAt: number | null;
  /** When the trailing read is due, or null when none is waiting. */
  trailingAt: number | null;
}

export const IDLE: Reread = { lastReadAt: null, trailingAt: null };

export interface Step {
  state: Reread;
  /** True when the route should be re-read now. */
  read: boolean;
}

const readAt = (now: number): Step => ({ state: { lastReadAt: now, trailingAt: null }, read: true });

/**
 * The run's progress changed: read now when the last read is 30 s old (or there was none), else make sure a trailing
 * read is due 30 s after the last one, so the final change of a burst is never lost.
 */
export function onProgress(s: Reread, now: number): Step {
  if (s.lastReadAt === null || now - s.lastReadAt >= REREAD_MS) return readAt(now);
  return { state: { ...s, trailingAt: s.lastReadAt + REREAD_MS }, read: false };
}

/** The run left pending or running: its last prices are read at once, and a waiting trailing read is dropped. */
export function onTerminal(_s: Reread, now: number): Step {
  return readAt(now);
}

/** The component's timer fired: the trailing read happens when it is due. */
export function onTimer(s: Reread, now: number): Step {
  return s.trailingAt !== null && now >= s.trailingAt ? readAt(now) : { state: s, read: false };
}

/**
 * Whether a new read replaces the shown one now or waits (revision 50): it waits only during a run, for the scope
 * already shown (a filter change always shows its own read), when it changes the board, and while the pointer is over
 * the board or the focus is inside it.
 */
export function readDecision(p: {
  runActive: boolean;
  held: boolean;
  sameScope: boolean;
  changes: number;
}): 'apply' | 'hold' {
  return p.runActive && p.held && p.sameScope && p.changes > 0 ? 'hold' : 'apply';
}

/** Two figures are the same when every field is (price, provenance, marks, airports, times). */
function sameFigure(a: DatePair | undefined, b: DatePair | undefined): boolean {
  return JSON.stringify(a?.figure ?? null) === JSON.stringify(b?.figure ?? null);
}

/**
 * "N changes · Update board" (revision 50): the date pairs whose rank or figure differs between the shown read and the
 * pending one, among the rows either would show (each board's first `visible` rows in its own order).
 */
export function changeCount(shown: BoardModel, pending: BoardModel, visible: number): number {
  const byIndex = (m: BoardModel) => new Map(m.ranked.map((p) => [p.index, p]));
  const a = byIndex(shown);
  const b = byIndex(pending);
  const either = new Set([
    ...shown.rows.slice(0, visible).map((p) => p.index),
    ...pending.rows.slice(0, visible).map((p) => p.index),
  ]);
  let n = 0;
  for (const i of either) {
    if (shown.rankOf.get(i) !== pending.rankOf.get(i) || !sameFigure(a.get(i), b.get(i))) n += 1;
  }
  return n;
}
