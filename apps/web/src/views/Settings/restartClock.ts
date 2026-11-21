import { createContext } from 'react';

/**
 * The timer the restart's watch runs on (settings plan ruling 14): `after(ms, run)` calls `run` once, `ms` from now,
 * and returns its cancel. The page uses the platform's timers; a test provides its own and steps it, so no global timer
 * is faked.
 */
export interface RestartClock {
  after(ms: number, run: () => void): () => void;
}

export const systemRestartClock: RestartClock = {
  after(ms, run) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

/** The clock the Settings page's save watches the restart on; the platform's unless a test provides one. */
export const RestartClockContext = createContext<RestartClock>(systemRestartClock);
