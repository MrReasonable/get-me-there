// The pure decisions of the Status facts (review V10): how a ledger row reads, the newest backup, which runs a card is
// about, behind-schedule, and when the browser provider can price.
import { asIsoDateTime, type ExecutionStatus, isoDateTimeOfEpochMs } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  browserUsable,
  callResult,
  isBehindSchedule,
  newestBackupAt,
  pickRuns,
} from '../../src/read/statusPure.js';
import { okWorkerStatus } from '../helpers/statusFacts.js';

describe('callResult: the adapters’ class, never an HTTP status (V3, V4)', () => {
  it.each([
    [{ outcome: 'error', errorKind: 'auth' }, 'auth'],
    [{ outcome: 'error', errorKind: 'quota' }, 'quota'],
    [{ outcome: 'error', errorKind: 'rate-limit' }, 'other'],
    [{ outcome: 'error', errorKind: 'upstream' }, 'other'],
    [{ outcome: 'error', errorKind: 'network' }, 'other'],
    [{ outcome: 'error', errorKind: null }, 'other'],
    [{ outcome: 'ok', errorKind: null }, 'ok'],
    [{ outcome: 'ok', errorKind: 'parse' }, 'other'],
    [{ outcome: 'ok', errorKind: 'quota' }, 'quota'],
  ] as const)('%j is %s', (call, want) => {
    expect(callResult(call)).toBe(want);
  });
});

describe('newestBackupAt', () => {
  it('is the newest named backup, ignoring anything else, or null', () => {
    expect(
      newestBackupAt([
        'get-me-there-2026-10-24T03-30-01-000Z.db',
        'get-me-there-2026-10-25T03-30-01-000Z.db',
        'get-me-there-2026-10-23T03-30-01-000Z.db',
        'notes.txt',
        'get-me-there-2026-10-26T03-30-01-000Z.db.tmp',
      ]),
    ).toBe('2026-10-25T03:30:01.000Z');
    expect(newestBackupAt(['notes.txt'])).toBeNull();
    expect(newestBackupAt([])).toBeNull();
  });
});

describe('pickRuns', () => {
  const r = (status: ExecutionStatus): { status: ExecutionStatus } => ({ status });
  it('finds the run in flight, the newest row that is over and the newest that ran', () => {
    const runs = [r('running'), r('skipped_budget'), r('completed'), r('cancelled')];
    const p = pickRuns(runs);
    expect(p.active).toBe(runs[0]);
    expect(p.latest).toBe(runs[1]);
    expect(p.lastRun).toBe(runs[2]);
  });
  it('is all null for no rows, and a pending row is in flight', () => {
    expect(pickRuns([])).toEqual({ active: null, latest: null, lastRun: null });
    const only = [r('pending')];
    expect(pickRuns(only)).toEqual({ active: only[0], latest: null, lastRun: null });
  });
  it('a paused or skipped row is over; only skipped rows never ran', () => {
    const runs = [r('paused_error'), r('skipped_window')];
    const p = pickRuns(runs);
    expect(p.lastRun).toBe(runs[0]);
    expect(pickRuns([r('skipped_confirm')]).lastRun).toBeNull();
  });
});

describe('isBehindSchedule', () => {
  const at = asIsoDateTime('2026-10-14T09:00:00.000Z');
  const prev = Date.parse(at);
  it('is true only when the newest row is older than the previous firing by more than the grace', () => {
    expect(
      isBehindSchedule({
        newestCreatedAt: isoDateTimeOfEpochMs(prev - 121_000),
        previousFiringMs: prev,
        graceMs: 120_000,
      }),
    ).toBe(true);
    expect(
      isBehindSchedule({
        newestCreatedAt: isoDateTimeOfEpochMs(prev - 120_000),
        previousFiringMs: prev,
        graceMs: 120_000,
      }),
    ).toBe(false);
    expect(isBehindSchedule({ newestCreatedAt: at, previousFiringMs: prev, graceMs: 120_000 })).toBe(false);
    expect(isBehindSchedule({ newestCreatedAt: null, previousFiringMs: prev, graceMs: 120_000 })).toBe(false);
    expect(isBehindSchedule({ newestCreatedAt: at, previousFiringMs: null, graceMs: 120_000 })).toBe(false);
  });
});

describe('browserUsable', () => {
  it('only a worker that answers, is verified and refuses nothing', () => {
    expect(browserUsable({ kind: 'ok', status: okWorkerStatus() })).toBe(true);
    expect(browserUsable({ kind: 'ok', status: okWorkerStatus({ formVerified: false }) })).toBe(false);
    expect(browserUsable({ kind: 'ok', status: okWorkerStatus({ finding: { kind: 'signed-in' } }) })).toBe(
      false,
    );
    for (const kind of ['unreachable', 'keys-differ', 'unreadable', 'disabled'] as const)
      expect(browserUsable({ kind })).toBe(false);
  });
});
