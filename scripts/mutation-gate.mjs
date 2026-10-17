#!/usr/bin/env node
// Ruling 10 (plan decision 67): Stryker counts a timed-out mutant as detected, so a machine under load after the dry run
// turns surviving mutants into "Timeout" and lifts the score towards 100%. None of the mutated modules can loop forever,
// so a timeout is noise, not detection: `pnpm mutate` fails when timed-out mutants exceed 5% of those tested, and when
// the report holds no tested mutant at all.
// Usage: node scripts/mutation-gate.mjs <stryker json report>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_TIMEOUT_SHARE = 0.05;
/** The statuses of mutants that ran against the tests; ignored, pending and compile/runtime errors did not. */
const TESTED = new Set(['Killed', 'Survived', 'Timeout', 'NoCoverage']);

/** Timed-out mutants over tested mutants, from a mutation-testing-report-schema JSON report. */
export function timeoutShare(report) {
  let timedOut = 0;
  let tested = 0;
  for (const file of Object.values(report.files ?? {}))
    for (const m of file.mutants ?? []) {
      if (!TESTED.has(m.status)) continue;
      tested += 1;
      if (m.status === 'Timeout') timedOut += 1;
    }
  return { timedOut, tested, share: tested === 0 ? 0 : timedOut / tested };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  let report;
  try {
    report = JSON.parse(readFileSync(path ?? '', 'utf8'));
  } catch (e) {
    console.error(
      `mutation gate: cannot read the Stryker report ${path}: ${e instanceof Error ? e.message : e}`,
    );
    process.exit(1);
  }
  const { timedOut, tested, share } = timeoutShare(report);
  // why: an empty, truncated or all-error report (or a changed schema without files[*].mutants) has share 0 and
  // would read as "within 5%"; a run that tested nothing proves nothing, so it fails (CodeRabbit batch 3).
  if (tested === 0) {
    console.error(`mutation gate: the report at ${path} holds no tested mutant; refusing to pass`);
    process.exit(1);
  }
  if (share > MAX_TIMEOUT_SHARE) {
    console.error(
      `mutation gate: ${timedOut} of ${tested} tested mutants timed out (${(share * 100).toFixed(1)}%, above ${MAX_TIMEOUT_SHARE * 100}%); the score is not trustworthy. Rerun with no other suite or build in flight.`,
    );
    process.exit(1);
  }
  console.log(
    `mutation gate: ${timedOut} of ${tested} tested mutants timed out; within ${MAX_TIMEOUT_SHARE * 100}%`,
  );
}
