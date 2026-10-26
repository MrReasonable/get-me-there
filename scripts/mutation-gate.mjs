#!/usr/bin/env node
// Ruling 10 (plan decision 67): Stryker counts a timed-out mutant as detected, so a machine under load after the dry run
// turns surviving mutants into "Timeout" and lifts the score towards 100%. None of the mutated modules can loop forever,
// so a timeout is noise, not detection: `pnpm mutate` fails when timed-out mutants exceed 5% of those tested, and when
// the report holds no tested mutant at all.
// A package whose mutate files run in shards (.github/workflows/mutation.yml) is gated once over all of them: the
// shards' reports are merged, and the merged score must reach the package's break threshold (read from its
// stryker.config.json; each shard runs with no break of its own) and its timeouts stay within 5%, as one unsharded run
// would be judged. `--expect` is the shard count, so a shard that never reported fails the gate.
// Usage: node scripts/mutation-gate.mjs <stryker json report>
//        node scripts/mutation-gate.mjs --config <stryker.config.json> --expect <shards> <report>...
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_TIMEOUT_SHARE = 0.05;
/** The statuses of mutants that ran against the tests; ignored, pending and compile/runtime errors did not. */
const TESTED = new Set(['Killed', 'Survived', 'Timeout', 'NoCoverage']);

const DETECTED = new Set(['Killed', 'Timeout']);

/** Stryker's mutation score: detected (killed, timed out) over valid (those and survived, no coverage), in percent. */
export function mutationScore(report) {
  let detected = 0;
  let valid = 0;
  for (const file of Object.values(report.files ?? {}))
    for (const m of file.mutants ?? []) {
      if (!TESTED.has(m.status)) continue;
      valid += 1;
      if (DETECTED.has(m.status)) detected += 1;
    }
  return valid === 0 ? 0 : (detected / valid) * 100;
}

/** The shards' reports as one: every file once; a file in two reports is an error (the shards overlap). */
export function mergeReports(reports) {
  const files = {};
  for (const r of reports)
    for (const [name, file] of Object.entries(r.files ?? {})) {
      if (name in files) throw new Error(`${name} is in two reports`);
      files[name] = file;
    }
  return { files };
}

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
  const fail = (message) => {
    console.error(`mutation gate: ${message}`);
    process.exit(1);
  };
  const args = process.argv.slice(2);
  const option = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v ?? fail(`${name} needs a value`);
  };
  const configPath = option('--config');
  const expectRaw = option('--expect');
  const paths = args;
  if (paths.length === 0)
    fail('usage: node scripts/mutation-gate.mjs [--config <file> --expect <n>] <report>...');
  const reports = paths.map((path) => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      return fail(`cannot read the Stryker report ${path}: ${e instanceof Error ? e.message : e}`);
    }
  });
  if (expectRaw !== null && reports.length !== Number(expectRaw))
    fail(
      `${reports.length} report${reports.length === 1 ? '' : 's'} for ${expectRaw} shards: a shard did not finish`,
    );
  let report;
  try {
    report = mergeReports(reports);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  const { timedOut, tested, share } = timeoutShare(report);
  // why: an empty, truncated or all-error report (or a changed schema without files[*].mutants) has share 0 and
  // would read as "within 5%"; a run that tested nothing proves nothing, so it fails (CodeRabbit batch 3).
  if (tested === 0) fail(`the report at ${paths.join(', ')} holds no tested mutant; refusing to pass`);
  if (share > MAX_TIMEOUT_SHARE)
    fail(
      `${timedOut} of ${tested} tested mutants timed out (${(share * 100).toFixed(1)}%, above ${MAX_TIMEOUT_SHARE * 100}%); the score is not trustworthy. Rerun with no other suite or build in flight.`,
    );
  if (configPath !== null) {
    let brk;
    try {
      brk = JSON.parse(readFileSync(configPath, 'utf8')).thresholds?.break;
    } catch (e) {
      fail(`cannot read ${configPath}: ${e instanceof Error ? e.message : e}`);
    }
    if (typeof brk !== 'number') fail(`${configPath} has no numeric thresholds.break`);
    const score = mutationScore(report);
    if (score < brk) fail(`mutation score ${score.toFixed(2)} is below the break threshold ${brk}`);
    console.log(
      `mutation gate: mutation score ${score.toFixed(2)} over ${reports.length} report(s), break ${brk}`,
    );
  }
  console.log(
    `mutation gate: ${timedOut} of ${tested} tested mutants timed out; within ${MAX_TIMEOUT_SHARE * 100}%`,
  );
}
