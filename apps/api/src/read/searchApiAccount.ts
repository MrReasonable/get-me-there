/**
 * The api's view of SearchApi's own balance (settings plan ruling 10). `GET /api/searchapi/account` reads it through
 * this cache: a balance read is kept ten minutes on the injected clock, dropped when a run that called SearchApi ends
 * (the engine's run watch), and shared between reads made while one is out. A failure (no answer, a refused key, an
 * answer that cannot be read) is kept a minute and answered with the last good read, its own `fetchedAt` telling the
 * page how old it is ("as of 14:05"), for up to 24 hours after that read; with no good read in that window it is
 * `null`, so a page polling the route never queues a question per poll against a SearchApi that is down. No key set:
 * `null`, nothing asked.
 *
 * The cache lives in the pass of the app that built it: a save restarts the app in place (settings plan ruling 6), so a
 * new key or plan starts with an empty one.
 */
import type { Clock, SearchApiAccount } from '@gmt/core';
import { searchApiAccount } from '@gmt/providers';
import type { Ports } from '../wiring.js';
import { providerScopes } from './usage.js';

/** How long a balance read is served (plan ruling 10). */
export const ACCOUNT_TTL_MS = 10 * 60 * 1000;
/** How long a failed read is served as `null` before SearchApi is asked again. */
export const ACCOUNT_FAILURE_TTL_MS = 60 * 1000;
/** How long after its read the last good balance is still served when a refresh fails (controller ruling R10). */
export const ACCOUNT_STALE_MAX_MS = 24 * 60 * 60 * 1000;

export interface SearchApiAccountPort {
  /** The balance, or null with no key or no answer. Never rejects. */
  read(): Promise<SearchApiAccount | null>;
  /** A run (or flight read) ended: the cache is dropped when it called SearchApi since the balance was read. */
  runEnded(): void;
  /** Ends a question in flight and answers null from now on (the pass is closing). */
  close(): void;
}

export function createSearchApiAccount(o: {
  /** Asks SearchApi, or null when no key is set. */
  fetch: ((signal: AbortSignal) => Promise<SearchApiAccount | null>) | null;
  clock: Clock;
  /** SearchApi's calls in the ledger's window now; a change since the last read means a run billed calls. */
  callsMade: () => number;
}): SearchApiAccountPort {
  const stop = new AbortController();
  const now = (): number => Date.parse(o.clock.now());
  let kept: { value: SearchApiAccount | null; until: number; callsAtRead: number } | null = null;
  // why: kept apart from `kept`, which a run's end drops: the last good read is what a failed refresh falls back on
  let lastGood: SearchApiAccount | null = null;
  let inFlight: Promise<SearchApiAccount | null> | null = null;
  // why: the question in flight's ledger count, and whether a run that billed calls ended while it was out: its
  // answer may predate those calls, so it is answered to the reads waiting on it but never kept
  let pending: { callsAtRead: number; dropped: boolean } | null = null;

  async function ask(fetchBalance: NonNullable<typeof o.fetch>): Promise<SearchApiAccount | null> {
    const callsAtRead = o.callsMade();
    const mine = { callsAtRead, dropped: false };
    pending = mine;
    let value: SearchApiAccount | null = null;
    try {
      value = await fetchBalance(stop.signal);
    } catch {
      // why: a balance is a courtesy; the answer's reason is already in the provider's own log line
      value = null;
    } finally {
      pending = null;
    }
    // why: close() promises null to a question it ended, never the last good read a failure would fall back on
    if (stop.signal.aborted) return null;
    if (value !== null) lastGood = value;
    const failed = value === null;
    // why: controller ruling R10 — a failed refresh serves the last good read with its own fetchedAt, for up to 24
    // hours after that read and no longer: the kept answer ends at that deadline too
    const staleUntil = lastGood === null ? 0 : Date.parse(lastGood.fetchedAt) + ACCOUNT_STALE_MAX_MS;
    const fallback = failed && lastGood !== null && now() <= staleUntil;
    const served = fallback ? lastGood : value;
    const until = failed
      ? fallback
        ? Math.min(now() + ACCOUNT_FAILURE_TTL_MS, staleUntil)
        : now() + ACCOUNT_FAILURE_TTL_MS
      : now() + ACCOUNT_TTL_MS;
    kept = mine.dropped && !failed ? null : { value: served, until, callsAtRead };
    return served;
  }

  return {
    read: () => {
      const fetchBalance = o.fetch;
      if (fetchBalance === null || stop.signal.aborted) return Promise.resolve(null);
      if (kept !== null && now() < kept.until) return Promise.resolve(kept.value);
      inFlight ??= ask(fetchBalance).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    runEnded: () => {
      const calls = o.callsMade();
      if (kept !== null && calls !== kept.callsAtRead) kept = null;
      // why: a run that billed calls while a read was out: that read's answer is not kept (ask)
      if (pending !== null && calls !== pending.callsAtRead) pending.dropped = true;
    },
    close: () => stop.abort(),
  };
}

/** The balance cache over a pass's ports: SearchApi's key and the operator's zone, its calls counted in the ledger. */
export function searchApiAccountFor(
  ports: Pick<Ports, 'config' | 'http' | 'clock' | 'log' | 'budget'>,
): SearchApiAccountPort {
  const searchapi = ports.config.providers.searchapi;
  if (searchapi === null)
    return createSearchApiAccount({ fetch: null, clock: ports.clock, callsMade: () => 0 });
  const scope = providerScopes(ports.config, 'searchapi')[0];
  return createSearchApiAccount({
    fetch: (signal) =>
      searchApiAccount(ports.http, searchapi.key, {
        timezone: ports.config.schedulerTimezone,
        log: ports.log,
        signal,
      }),
    clock: ports.clock,
    callsMade: () => (scope === undefined ? 0 : ports.budget.usage(scope).calls),
  });
}
