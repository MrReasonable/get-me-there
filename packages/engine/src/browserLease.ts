/**
 * Spec revision 55 §8.1 "Reading one date pair's flights": the browser lease, one in-flight slot for the browser worker.
 * Only the on-demand flight read holds it; every browser page of a pass (the grid or list lane and the flight-list step
 * alike) awaits `whenFree` before it is sent, so a run that went pending while a read was in flight waits for that read.
 * The read's busy query and `hold` run in one synchronous turn (flightRead.ts), so a start admitted in the same turn
 * already sees the lease held.
 */
import { AbortedError } from '@gmt/core';

export interface BrowserLease {
  /** Takes the slot for as long as `done` is pending; false (and nothing changes) while it is already held. */
  hold(done: Promise<void>): boolean;
  /** Resolves once nothing holds the slot (at once when free); rejects with AbortedError when `signal` aborts first. */
  whenFree(signal: AbortSignal): Promise<void>;
  /** Whether the slot is held now. */
  inFlight(): boolean;
}

/** A fresh lease, one per engine (EngineContext.lease). */
export function createBrowserLease(): BrowserLease {
  let held: Promise<void> | null = null;
  return {
    hold: (done) => {
      if (held !== null) return false;
      // why: a read that throws still frees the slot; its rejection is the read's own to report, never the lease's
      const settled = done.then(
        () => undefined,
        () => undefined,
      );
      held = settled;
      void settled.then(() => {
        if (held === settled) held = null;
      });
      return true;
    },
    whenFree: (signal) => {
      if (signal.aborted) return Promise.reject(new AbortedError());
      const current = held;
      if (current === null) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const onAbort = (): void => reject(new AbortedError());
        signal.addEventListener('abort', onAbort, { once: true });
        void current.then(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        });
      });
    },
    inFlight: () => held !== null,
  };
}
