/**
 * The pure decisions of the Status facts (brief WP18 §6, review V10), apart from the reads that feed them, so they carry
 * a Stryker scope of their own: how a ledger row reads, which backup is newest, which runs a definition's card is about,
 * and whether the browser provider can price a scheduled search.
 */
import { backupTimeOf, type Execution, type IsoDateTime, isoDateTimeOfEpochMs } from '@gmt/core';
import type { WorkerRead } from './statusFacts.js';

/** How a provider's newest completed call ended, from the ledger row alone (V3, V4). */
export function callResult(call: {
  outcome: 'ok' | 'error';
  errorKind: string | null;
}): 'ok' | 'auth' | 'quota' | 'other' {
  // why: the class is the adapters' own (migration 0008), never re-derived from an HTTP status; an `ok` row an adapter
  // rejected carries `parse`, and a row with no class at all is only a success when it ended ok
  if (call.errorKind === 'auth') return 'auth';
  if (call.errorKind === 'quota') return 'quota';
  return call.outcome === 'ok' && call.errorKind === null ? 'ok' : 'other';
}

/** The newest daily backup's instant among the names in the directory, or null. */
export function newestBackupAt(names: readonly string[]): IsoDateTime | null {
  const times = names.flatMap((n) => {
    const t = backupTimeOf(n);
    return t === null ? [] : [Date.parse(t)];
  });
  return times.length === 0 ? null : isoDateTimeOfEpochMs(Math.max(...times));
}

const inFlight = (e: Pick<Execution, 'status'>) => e.status === 'pending' || e.status === 'running';

/** From a definition's parent runs, newest first: the run in flight, the newest row that is over, and the newest that ran. */
export function pickRuns<E extends Pick<Execution, 'status'>>(
  runs: readonly E[],
): { active: E | null; latest: E | null; lastRun: E | null } {
  return {
    active: runs.find(inFlight) ?? null,
    latest: runs.find((e) => !inFlight(e)) ?? null,
    lastRun: runs.find((e) => !inFlight(e) && !e.status.startsWith('skipped_')) ?? null,
  };
}

/** Whether the browser provider can price a scheduled search now: the worker answers, is verified and refuses nothing. */
export function browserUsable(read: WorkerRead): boolean {
  return read.kind === 'ok' && read.status.formVerified && read.status.finding === null;
}

/** True when the newest row of any kind is older than the schedule's previous firing by more than the grace. */
export function isBehindSchedule(o: {
  newestCreatedAt: IsoDateTime | null;
  previousFiringMs: number | null;
  graceMs: number;
}): boolean {
  return (
    o.previousFiringMs !== null &&
    o.newestCreatedAt !== null &&
    Date.parse(o.newestCreatedAt) < o.previousFiringMs - o.graceMs
  );
}
