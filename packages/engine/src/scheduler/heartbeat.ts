import { type IsoDateTime, isoDateTimeOfEpochMs, type Logger } from '@gmt/core';

/** Spec §8.2 (decision 83): the heartbeat's period. */
export const HEARTBEAT_MS = 30_000;
/** A beat (or a page start) more than this after the last beat means the process was suspended (the machine slept). */
export const SUSPENSION_GAP_MS = 120_000;

/** One detected suspension: the last beat before it and the moment it was noticed. */
export interface Suspension {
  suspendedAt: IsoDateTime;
  resumedAt: IsoDateTime;
}

/**
 * Spec §8.2 (decision 83): sleep is detected, never inferred from page timing. One timer beats every 30 s, unreferenced
 * so it never keeps the process alive, and records the last wall-clock beat; a beat more than 120 s after the previous
 * one means the process was suspended. Before each browser page, `checkBeforePage` treats a last beat older than 120 s
 * the same way, which closes the up to 30 s after a wake before the next beat. A suspension logs one line and tells
 * every listener (the orchestrator marks its runs in flight as needing a window check). No file, network or database
 * I/O: the wall clock, the log line and the listeners only.
 */
export interface Heartbeat {
  start(): void;
  stop(): void;
  /** Before a browser page starts: a last beat older than SUSPENSION_GAP_MS is a suspension detected now. */
  checkBeforePage(): void;
  onSuspension(listener: (s: Suspension) => void): void;
}

export function createHeartbeat(log: Logger, wallClock: () => number = Date.now): Heartbeat {
  let last: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners: Array<(s: Suspension) => void> = [];
  /** Records a suspension found at `now` when the last beat is too old, then makes `now` the last beat. */
  const observe = (now: number): void => {
    // why: the timer runs only after start() set the last beat, and checkBeforePage observes only with one set
    const prev = last ?? now;
    if (now - prev > SUSPENSION_GAP_MS) {
      const s = { suspendedAt: isoDateTimeOfEpochMs(prev), resumedAt: isoDateTimeOfEpochMs(now) };
      log.warn(s, 'heartbeat: the process was suspended; runs in flight check their browser window');
      for (const l of listeners) l(s);
    }
    last = now;
  };
  return {
    start() {
      if (timer !== null) return;
      last = wallClock();
      timer = setInterval(() => observe(wallClock()), HEARTBEAT_MS);
      // why: decision 83 — the heartbeat never keeps the process alive (a test or a SIGTERM exits without it)
      timer.unref();
    },
    stop() {
      clearInterval(timer ?? undefined);
      timer = null;
      last = null;
    },
    checkBeforePage() {
      // why: with no heartbeat running (a bare orchestrator, a tool run) nothing is ever detected; a recent beat stays
      // the last beat, so only the timer moves it
      const now = wallClock();
      if (last !== null && now - last > SUSPENSION_GAP_MS) observe(now);
    },
    onSuspension(listener) {
      listeners.push(listener);
    },
  };
}
