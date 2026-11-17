// Spec §11 "Run landing" as a pure state machine over an injected clock (milliseconds): the page feeds it the run's
// progress changes, the run leaving pending or running, and its own timer, and re-reads the route when it says so.
// Design 2026-11-08 Ruling 17: every re-read is shown as it lands (rows carry their ages); nothing is held.

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
