/** Assessment and the human report of a recording run (spec §9 item 7; brief WP4b Task 12b reads these lines). */
import { existsSync, readFileSync } from 'node:fs';
import { formatPence } from '@gmt/core';
import type { PlannedCall, RecordArgs } from './recordPlan.js';
import { bookingOptions, calendarIsEmpty, dataRowCount, isRecord } from './recordRequests.js';
import type { RecordedCall, RecordSummary } from './types.js';

export interface RunAssessment {
  requiredOk: boolean;
  /** Ids of required calls that did not answer as planned (empty when requiredOk). */
  notAsExpected: string[];
  chainComplete: boolean;
  /**
   * `'no-answer'` when the call got no HTTP status (skipped, aborted, no response): nothing is then said about what the
   * vendor would have answered (prov-wp04b-r3-002).
   */
  emptyEnvelope: 'yes' | 'no' | 'no-answer';
  overLimit: 'http-400' | 'empty-200' | 'other' | 'no-answer';
}

/** The parsed recorded file, or undefined when it is missing (e.g. never written). */
export function readRecorded(file: string | null): Record<string, unknown> | undefined {
  if (file === null || !existsSync(file)) return undefined;
  const v: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return isRecord(v) ? v : undefined;
}

/** The recorder session a recorded file carries. */
export function sessionOf(file: string): string | null {
  const s = readRecorded(file)?.session;
  return typeof s === 'string' ? s : null;
}

/** The session of the first file any call wrote, or null. */
export function sessionOfCalls(calls: readonly RecordedCall[]): string | null {
  const first = calls.find((c) => c.file !== null)?.file ?? null;
  return first === null ? null : sessionOf(first);
}

/** Derived verdicts over a summary: required calls as planned, the chain, the empty envelope, the over-limit behaviour. */
export function assessRun(plan: readonly PlannedCall[], s: Pick<RecordSummary, 'calls'>): RunAssessment {
  const byId = new Map(s.calls.map((c) => [c.id, c] as const));
  const callOf = (kind: PlannedCall['spec']['kind'], purpose?: string): RecordedCall | undefined => {
    const p = plan.find(
      (x) =>
        x.spec.kind === kind &&
        (purpose === undefined || ('purpose' in x.spec && x.spec.purpose === purpose)),
    );
    return p === undefined ? undefined : byId.get(p.id);
  };
  const step3 = callOf('sa-step3');
  const probe = callOf('tp-tile', 'empty-probe');
  const over = callOf('sa-over-limit');
  const chainComplete = step3?.status === 200 && bookingOptions(readRecorded(step3.file)?.body).length > 0;
  const answered = (c: RecordedCall | undefined): c is RecordedCall & { status: number } =>
    typeof c?.status === 'number';
  const emptyEnvelope = !answered(probe)
    ? 'no-answer'
    : probe.status === 200 && dataRowCount(readRecorded(probe.file)?.body) === 0
      ? 'yes'
      : 'no';
  const overLimit = !answered(over)
    ? 'no-answer'
    : over.status === 400
      ? 'http-400'
      : over.status === 200 && calendarIsEmpty(readRecorded(over.file)?.body)
        ? 'empty-200'
        : 'other';
  const notAsExpected = plan
    .filter((p) => {
      if (!p.required) return false;
      if (p.spec.kind === 'sa-over-limit') return overLimit === 'other' || overLimit === 'no-answer';
      const c = byId.get(p.id);
      return c === undefined || typeof c.status !== 'number' || !p.expect.includes(c.status);
    })
    .map((p) => p.id);
  return {
    requiredOk: notAsExpected.length === 0 && chainComplete,
    notAsExpected,
    chainComplete,
    emptyEnvelope,
    overLimit,
  };
}

/** The ledger line, printed on every path that opened an execution (cost-wp4b-006). */
export function ledgerLine(s: { creditsUsed: number; freeCalls: number }, a: RecordArgs): string {
  return `ledger: SearchApi ${s.creditsUsed} credit(s) of budget ${a.budget}; Travelpayouts ${s.freeCalls} free call(s)`;
}

/**
 * Files of calls that were retried: every attempt before the last answered with an error and was not billed, so each
 * may be deleted whole before commit (prov-wp04b-r2-005); the operator never edits a file.
 */
export function retryAttemptLines(calls: readonly RecordedCall[]): string[] {
  return calls
    .filter((c) => c.files.length > 1)
    .map((c) =>
      // why: only a call whose final attempt answered 200 has deletable failed attempts; any other multi-file call is a
      // failure the operator keeps for review (prov-wp04b-r3-005)
      c.status === 200
        ? `${c.id}: non-final attempt file(s), unbilled, delete before commit (Task 12b step 4): ${c.files.slice(0, -1).join(', ')}`
        : `${c.id}: ${c.files.length} failed attempts, keep for review; the session cannot be committed as is`,
    );
}

/** The call a verdict line is about, by plan kind, for its status and detail. */
function callLine(
  s: RecordSummary,
  plan: readonly PlannedCall[],
  kind: PlannedCall['spec']['kind'],
  purpose?: string,
): string {
  const p = plan.find(
    (x) =>
      x.spec.kind === kind && (purpose === undefined || ('purpose' in x.spec && x.spec.purpose === purpose)),
  );
  const c = p === undefined ? undefined : s.calls.find((x) => x.id === p.id);
  return c === undefined
    ? 'not in the plan'
    : `${c.id} ${String(c.status)}${c.detail === null ? '' : ` (${c.detail})`}`;
}

// why: ca-004: core's formatPence is the one money formatter for operator-facing text (plan, Core domain functions).
const pounds = (pence: number | null): string => (pence === null ? '—' : formatPence(pence));

/** Human summary printed after a run. */
export function formatSummary(
  s: RecordSummary,
  v: RunAssessment,
  a: RecordArgs,
  plan: readonly PlannedCall[],
): string[] {
  const c = s.chain;
  const step3 = c.step3Options.map((o) => `${o.bookWith} ${pounds(o.pricePence)}`).join(', ');
  return [
    ...s.calls.map(
      (x) =>
        `${x.id} ${String(x.status)}${x.detail === null ? '' : ` (${x.detail})`}${x.files.length === 0 ? '' : ` → ${x.files.join(', ')}`}`,
    ),
    `required calls: ${v.requiredOk ? 'all as expected' : `NOT all as expected: ${v.notAsExpected.join(', ') || 'the chain is incomplete'}`}`,
    `chain step 1 → 2 → 3: ${v.chainComplete ? 'complete' : 'incomplete'}`,
    `chain prices (${c.currency}, diagnostics only): step 1 ${pounds(c.step1PricePence)}, step 2 ${pounds(c.step2PricePence)} (step 1 = step 2: ${c.step1PricePence !== null && c.step1PricePence === c.step2PricePence ? 'yes' : 'no'}); step 3 ${step3 === '' ? '—' : step3}`,
    `over-limit calendar (SA-03): ${v.overLimit === 'http-400' ? 'HTTP 400, as spike fact 2' : v.overLimit === 'empty-200' ? 'an empty HTTP 200, as the docs say (billed)' : v.overLimit === 'no-answer' ? `no vendor answer recorded: ${callLine(s, plan, 'sa-over-limit')}` : 'neither 400 nor an empty 200: raise a finding for WP5'}`,
    `empty envelope recorded: ${v.emptyEnvelope === 'yes' ? 'yes' : v.emptyEnvelope === 'no-answer' ? `no vendor answer recorded: ${callLine(s, plan, 'tp-tile', 'empty-probe')}` : 'no (best-effort; WP6 then needs a synthetic one: raise a finding)'}`,
    '429: not attempted; WP5 maps rate limits from a labelled synthetic fixture (plan decision 20)',
    ...retryAttemptLines(s.calls),
    `session: ${s.session ?? 'none (nothing recorded)'}`,
    ledgerLine(s, a),
    'next: read the SearchApi dashboard credits; run the manual review checklist (Task 12b) before git add',
  ];
}
