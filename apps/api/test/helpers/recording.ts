// Runs record:fixtures against the stand-ins into a temporary recorded tree, with a test signature (prov-wp04b-006).
import { asIsoDateTime, fixedClock } from '@gmt/core';
import { AIRPORTS_DATA_DIR, loadAirportsDataset, MIGRATIONS_DIR, seedAirports } from '@gmt/db';
import { vi } from 'vitest';
import { type RecordArgs, recordFixtures } from '../../src/tools/record.js';
import { type PlannedCall, parseRecordArgs, planCalls } from '../../src/tools/recordPlan.js';
import type { RecordSummary } from '../../src/tools/types.js';
import { buildPorts, loadConfigFromEnv, type Ports } from '../../src/wiring.js';
import { silentLog, testEnv } from './env.js';
import { onCleanup, tempRecordedRoot } from './tmp.js';
import { stubVendors, type VendorLog, type VendorOptions } from './vendors.js';

/**
 * The signature test recordings carry. WP4's verifier accepts any non-blank signature; the recorded-tree check
 * (checkWorkedExampleTree) requires RECORDED_BY, so a test tree can never pass as a vendor one (prov-wp04b-006).
 */
export const TEST_RECORDED_BY = '@gmt/api record:fixtures (test)';

/** A temporary recorded tree and the test signature, for runTool's `recording` option. */
export function testRecording(): {
  repo: string;
  root: string;
  recording: { root: string; recordedBy: string };
} {
  const { repo, root } = tempRecordedRoot();
  return { repo, root, recording: { root, recordedBy: TEST_RECORDED_BY } };
}
export const AT = asIsoDateTime('2026-10-20T09:00:00.000Z');

/** The worked example's arguments, parsed (so the codes are branded Iata values). */
export const WORKED_EXAMPLE: RecordArgs = (() => {
  const r = parseRecordArgs(['--budget', '5', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03']);
  if (!r.ok) throw new Error(r.message);
  return r.value.args;
})();

/** Ports over a migrated in-memory DB with the airports table seeded (so LON is the shared metro). */
export function seededPorts(env: Record<string, string> = {}, clock = fixedClock(AT)): Ports {
  const ports = buildPorts(loadConfigFromEnv(testEnv(env)), {
    log: silentLog,
    clock,
    migrationsDir: MIGRATIONS_DIR,
  });
  onCleanup(() => ports.db.close());
  seedAirports(ports.db, loadAirportsDataset(AIRPORTS_DATA_DIR));
  return ports;
}

export interface Recording {
  summary: RecordSummary;
  seen: VendorLog;
  repo: string;
  root: string;
  ports: Ports;
  plan: PlannedCall[];
}

/** A prepared run: the tree exists before the recording starts, so a failed run's files can still be inspected (ts-008). */
export interface RecordingSetup {
  seen: VendorLog;
  repo: string;
  root: string;
  ports: Ports;
  args: RecordArgs;
  plan: PlannedCall[];
  run(signal?: AbortSignal): Promise<RecordSummary>;
}

export function recordingSetup(
  o: { args?: RecordArgs; vendors?: VendorOptions; env?: Record<string, string>; ports?: Ports } = {},
): RecordingSetup {
  const args = o.args ?? WORKED_EXAMPLE;
  const ports = o.ports ?? seededPorts(o.env);
  const seen = stubVendors(o.vendors);
  const { repo, root } = tempRecordedRoot();
  return {
    seen,
    repo,
    root,
    ports,
    args,
    plan: planCalls(args, ports.repos.airports.sharedMetro(args.origins)),
    run: (signal) =>
      recordFixtures(ports, args, {
        signal: signal ?? new AbortController().signal,
        recordedRoot: root,
        recordedBy: TEST_RECORDED_BY,
      }),
  };
}

/** Runs the whole recording; `ports` lets a test reuse one database across runs. */
export async function runRecording(
  o: {
    args?: RecordArgs;
    vendors?: VendorOptions;
    env?: Record<string, string>;
    ports?: Ports;
    signal?: AbortSignal;
  } = {},
): Promise<Recording> {
  const s = recordingSetup(o);
  const summary = await s.run(o.signal);
  return { summary, seen: s.seen, repo: s.repo, root: s.root, ports: s.ports, plan: s.plan };
}

/**
 * Runs a recording whose vendor fails and retries under fake timers, so http-kit's backoff and request timeout pass
 * in fake time (r2-ts-003): deterministic and fast. Restores real timers afterwards.
 */
export async function runRecordingInFakeTime(o: Parameters<typeof runRecording>[0] = {}): Promise<Recording> {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const p = runRecording(o);
    let done = false;
    p.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    while (!done) await vi.advanceTimersByTimeAsync(500);
    return await p;
  } finally {
    vi.useRealTimers();
  }
}
