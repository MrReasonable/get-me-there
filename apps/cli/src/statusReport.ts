/**
 * `gmt status`'s app report (spec §10 `GET /status`, brief WP18 Task 18.5): the same checks the Status view shows, read
 * from the running app on 127.0.0.1 with the basic auth in app.env (never in an argv), printed beside WP16b's local
 * facts. A fix is the `pnpm gmt` command when the app names one, else its words. The password travels only in the
 * Authorization header of one in-process request.
 */
import { apiContract } from '@gmt/core';
import { type AppCreds, appUrl, authHeaders, credsFrom } from './appClient.js';
import type { Flags } from './args.js';
import { type Deps, EXIT } from './deps.js';
import { appEnvPath } from './services/specs.js';
import { readEnvText } from './setup/appEnv.js';

export type StatusReport = apiContract.StatusResponse;
export type StatusCheck = apiContract.StatusCheck;
export type ReportRead = { kind: 'ok'; report: StatusReport } | { kind: 'down'; reason: string };

/** The areas `--only` accepts. */
export const STATUS_AREAS: readonly string[] = apiContract.statusAreaSchema.options;

/** The port and, when app.env has them, the credentials; null when there is no app.env to read. */
function access(deps: Deps): { port: number; creds: AppCreds | null } | null {
  let text: string | null;
  try {
    text = deps.files.read(appEnvPath(deps.platform.paths));
  } catch {
    return null;
  }
  if (text === null) return null;
  const record = readEnvText(text);
  const creds = credsFrom(record);
  const port =
    creds?.port ?? (record.PORT !== undefined && /^\d+$/.test(record.PORT) ? Number(record.PORT) : 3000);
  return { port, creds };
}

/** `GET /api/status`: the report, or why there is none (no settings file, no answer, an answer that is not the report). */
export async function readReport(deps: Deps): Promise<ReportRead> {
  const a = access(deps);
  if (a === null) return { kind: 'down', reason: 'there is no app.env yet: run pnpm gmt setup' };
  const r = await deps.http({
    method: 'GET',
    url: appUrl(a.port, '/api/status'),
    headers: a.creds === null ? {} : authHeaders(a.creds),
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

/**
 * Prints the app's report (or why there is none) and answers whether it makes `gmt status` fail: any `fail` check, or no
 * report at all. `--only <area>` shows one area's rows, `--json` the response as the app sent it.
 */
export async function printAppReport(deps: Deps, flags: Flags): Promise<number> {
  const only = typeof flags.only === 'string' ? flags.only : null;
  const read = await readReport(deps);
  if (read.kind === 'down') {
    // why: the local facts and the worker's refusal reason are printed by the caller; this says the app is silent
    deps.io.err(`the app is not answering: ${read.reason}\n`);
    return EXIT.failed;
  }
  const checks = only === null ? read.report.checks : read.report.checks.filter((c) => c.area === only);
  if (flags.json === true) deps.io.out(`${JSON.stringify({ ...read.report, checks })}\n`);
  else {
    deps.io.out(`\n${describeReport(checks)}`);
    deps.io.out(
      `${apiContract.barSummary(checks).text} (app ${read.report.version}, ${read.report.mode} mode)\n`,
    );
  }
  return checks.some((c) => c.state === 'fail') ? EXIT.failed : EXIT.ok;
}
