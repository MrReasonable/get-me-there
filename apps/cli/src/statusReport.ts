/**
 * `gmt status`'s app report (spec §10 `GET /status`, brief WP18 Task 18.5): the same checks the Status view shows, read
 * from this machine's app on 127.0.0.1 through `appEndpoint` (the native app with app.env's basic auth, or with no
 * native install the app in Docker with the checkout's .env's; never in an argv), printed beside WP16b's local facts. A
 * fix is the `pnpm gmt` command when the app names one, else its words. The password travels only in the Authorization
 * header of one in-process request.
 */
import { apiContract } from '@gmt/core';
import { type AppEndpoint, nativeEndpoint } from './appEndpoint.js';
import type { Flags } from './args.js';
import { type Deps, EXIT } from './deps.js';
import { type Check, describeChecks } from './services/checks.js';

export type StatusReport = apiContract.StatusResponse;
export type StatusCheck = apiContract.StatusCheck;
export type ReportRead = { kind: 'ok'; report: StatusReport } | { kind: 'down'; reason: string };

/** The areas `--only` accepts. */
export const STATUS_AREAS: readonly string[] = apiContract.statusAreaSchema.options;

/** `GET /api/status`: the report, or why there is none (no settings to read, no answer, an answer that is not the report). */
export async function readReport(deps: Deps, a: AppEndpoint = nativeEndpoint(deps)): Promise<ReportRead> {
  if (a.kind === 'none') return { kind: 'down', reason: a.reason };
  const r = await deps.http({
    method: 'GET',
    url: `${a.baseUrl}/api/status`,
    headers: a.headers,
    // why: the app's own worker read is bounded at 2 s; the rest is local reads
    timeoutMs: 15_000,
  });
  if ('error' in r) return { kind: 'down', reason: `no answer from the app on port ${a.port}` };
  if (r.status !== 200) return { kind: 'down', reason: `the app answered ${r.status}` };
  let json: unknown;
  try {
    json = JSON.parse(r.body);
  } catch {
    return { kind: 'down', reason: 'the app’s answer was not JSON' };
  }
  const parsed = apiContract.statusResponseSchema.safeParse(json);
  return parsed.success
    ? { kind: 'ok', report: parsed.data }
    : { kind: 'down', reason: 'the app’s answer was not the status report' };
}

/** One row per check: state as text, area, summary; then its note and its fix. */
export function describeReport(checks: readonly StatusCheck[]): string {
  const width = Math.max(10, ...checks.map((c) => c.area.length));
  const pad = ' '.repeat(width + 8);
  return `${checks
    .map((c) => {
      const lines = [`${c.area.padEnd(width)}  ${c.state.padEnd(4)}  ${c.summary}`];
      if (c.note !== null) lines.push(`${pad}note: ${c.note}`);
      if (c.fix !== null)
        lines.push(`${pad}fix: ${c.fix.command === null ? c.fix.text : `${c.fix.command} (${c.fix.text})`}`);
      return lines.join('\n');
    })
    .join('\n')}\n`;
}

/** `gmt status`'s flags: one area for `--only` (checked against the report's areas) and `--json`; or a usage error. */
export type ReportFlags = { ok: true; only: string | null; json: boolean } | { ok: false; message: string };
export function reportFlags(flags: Flags): ReportFlags {
  const only = typeof flags.only === 'string' ? flags.only : null;
  if (only !== null && !STATUS_AREAS.includes(only))
    return { ok: false, message: `unknown area for --only: ${only} (one of ${STATUS_AREAS.join(', ')})\n` };
  return { ok: true, only, json: flags.json === true };
}

/** What to do when the app does not answer: the service state decides (V9; a running service that is silent is hung). */
function nativeNextStep(local: readonly Check[], port: number | null): string {
  const running = local.some((c) => c.name === 'service app' && c.detail === 'running');
  return running
    ? `the service is running but the app does not answer${port === null ? '' : ` on port ${port}`}: pnpm gmt logs shows why; pnpm gmt restart tries again`
    : 'the app is not running: pnpm gmt start';
}

/** Which app `gmt status` reads, and what it says to do when that app does not answer. */
export interface StatusTarget {
  endpoint: AppEndpoint;
  nextStep: (local: readonly Check[], port: number | null) => string;
}

/** The native app: app.env's port and basic auth, and the service manager's next steps. */
export const nativeTarget = (deps: Deps): StatusTarget => ({
  endpoint: nativeEndpoint(deps),
  nextStep: nativeNextStep,
});

/**
 * Everything `gmt status` prints after the local facts are read, and its exit code (Task 18.5, review V9): the app's report
 * beside them, or, when the app does not answer, the local facts and the worker's refusal line (whatever the flags), the
 * reason and the next step. `--only <area>` and `--json` show the report alone while it is there; with it down, `--json`
 * prints `{ "appAnswering": false, … }` with the local facts on stdout, so a script never reads an empty pipe. Exit 1 on a
 * failing check, here or locally, or an app that does not answer.
 */
export async function finishStatus(
  deps: Deps,
  rf: Extract<ReportFlags, { ok: true }>,
  local: readonly Check[],
  target: StatusTarget = nativeTarget(deps),
): Promise<number> {
  const read = await readReport(deps, target.endpoint);
  const reportOnly = rf.only !== null || rf.json;
  if (read.kind === 'down') {
    const step = target.nextStep(local, target.endpoint.kind === 'none' ? null : target.endpoint.port);
    if (rf.json)
      deps.io.out(
        `${JSON.stringify({ appAnswering: false, reason: read.reason, nextStep: step, checks: local })}\n`,
      );
    else {
      deps.io.out(describeChecks(local));
      deps.io.err(`the app is not answering: ${read.reason}\n${step}\n`);
    }
    return EXIT.failed;
  }
  if (!reportOnly) deps.io.out(describeChecks(local));
  const checks = rf.only === null ? read.report.checks : read.report.checks.filter((c) => c.area === rf.only);
  if (rf.json) deps.io.out(`${JSON.stringify({ ...read.report, checks })}\n`);
  else {
    deps.io.out(`\n${describeReport(checks)}`);
    deps.io.out(
      `${apiContract.barSummary(checks).text} (app ${read.report.version}, ${read.report.mode} mode)\n`,
    );
  }
  // why: CodeRabbit on PR #14 — the exit code never depends on what was printed: a failing check anywhere, local or in
  // any area of the report, fails the command, whatever `--only` or `--json` filtered out of the output
  const failing = read.report.checks.some((c) => c.state === 'fail') || local.some((c) => c.level === 'fail');
  return failing ? EXIT.failed : EXIT.ok;
}
