import { AWAKE_LEASE_SECONDS, AWAKE_RENEW_SECONDS, type KeepAwakeCapability, type Logger } from '@gmt/core';
import { errorText } from './errors.js';

/** Spec §2 "The keep-awake lease": the engine renews the lease this often while any run is in progress. */
export const AWAKE_RENEW_MS = AWAKE_RENEW_SECONDS * 1000;

/**
 * Spec §2 "The keep-awake lease", §8.2: while any run is in progress the engine holds the machine awake through each
 * provider that can (the camoufox provider, when it is configured): a lease of AWAKE_LEASE_SECONDS at the first run's
 * start, renewed every AWAKE_RENEW_SECONDS, released when the last run ends. It is a lease, never a latch: an app that
 * dies or is suspended stops renewing, and the worker lets the machine sleep once the lease runs out. Every request
 * is sent in order (a release never overtakes a hold still in flight). A hold or release that fails is logged at warn
 * and never fails a run. With no provider that can hold it, nothing is sent and no timer runs, so a long run then needs
 * the machine kept awake by hand.
 */
export interface AwakeKeeper {
  /** A run began. */
  started(): void;
  /** A run ended. */
  ended(): void;
  /** Resolves once every request sent so far has settled (the engine's shutdown waits for the last release). */
  settled(): Promise<void>;
}

export function createAwakeKeeper(o: {
  holds: readonly KeepAwakeCapability[];
  log: Logger;
  /** Aborted when the engine hands the database back; a request still in flight then ends quietly. */
  signal: AbortSignal;
  /** Runs `fn` every `ms`; returns its cancel. The default is an unreferenced setInterval. */
  every?: (fn: () => void, ms: number) => () => void;
}): AwakeKeeper {
  const every =
    o.every ??
    ((fn: () => void, ms: number) => {
      const t = setInterval(fn, ms);
      // why: like the heartbeat, the renewal never keeps the process alive
      t.unref();
      return () => clearInterval(t);
    });
  let runs = 0;
  let cancel: (() => void) | null = null;
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  const send = (what: (c: KeepAwakeCapability) => Promise<void>): void => {
    for (const c of o.holds) {
      const go = async (): Promise<void> => {
        try {
          await what(c);
        } catch (e) {
          // why: the capability never throws by contract; a broken one still never fails a run
          o.log.warn({ err: errorText(e) }, 'keep-awake: the lease could not be renewed or released');
        }
      };
      // why: with nothing in flight the request is sent at once (the first hold goes out as the run starts); otherwise
      // it waits its turn, so a release never overtakes a hold
      pending += 1;
      queue = (pending === 1 ? go() : queue.then(go)).finally(() => {
        pending -= 1;
      });
    }
  };
  const hold = (): void => send((c) => c.hold(AWAKE_LEASE_SECONDS, o.signal));
  return {
    started() {
      runs += 1;
      if (runs !== 1 || o.holds.length === 0) return;
      hold();
      cancel = every(hold, AWAKE_RENEW_MS);
    },
    ended() {
      if (runs === 0) return;
      runs -= 1;
      if (runs !== 0 || o.holds.length === 0) return;
      cancel?.();
      cancel = null;
      send((c) => c.release(o.signal));
    },
    settled: () => queue,
  };
}
