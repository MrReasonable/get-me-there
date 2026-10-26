import { apiContract } from '@gmt/core';
import type { z } from 'zod';
import type { Deps } from './deps.js';

/**
 * The CLI's reads of a running app (spec §10), always on 127.0.0.1 with basic auth from a settings file. The password
 * travels only in the Authorization header of an in-process request: never in an argv, a log line or an error.
 */
export interface AppCreds {
  port: number;
  /** The loopback host the app answers on, as a URL host: `127.0.0.1` (the default) or `[::1]`. */
  host?: string;
  user: string;
  pass: string;
}
export type ActiveExecution = NonNullable<
  z.infer<typeof apiContract.activeExecutionResponseSchema>['execution']
>;
export type ActiveRead =
  | { kind: 'none' }
  | { kind: 'active'; execution: ActiveExecution }
  | { kind: 'failed'; reason: string };

/** The credentials and port a settings record holds, or null when it has no auth lines. */
export function credsFrom(
  r: Readonly<Record<string, string | undefined>>,
  portDefault = 3000,
): AppCreds | null {
  const user = r.APP_BASIC_AUTH_USER;
  const pass = r.APP_BASIC_AUTH_PASS;
  if (user === undefined || pass === undefined || user === '' || pass === '') return null;
  const port = r.PORT !== undefined && /^\d+$/.test(r.PORT) ? Number(r.PORT) : portDefault;
  return { port, user, pass };
}

export const authHeaders = (c: AppCreds): Record<string, string> => ({
  Authorization: `Basic ${Buffer.from(`${c.user}:${c.pass}`).toString('base64')}`,
});
export const appUrl = (port: number, path: string, host = '127.0.0.1'): string =>
  `http://${host}:${port}${path}`;

/** A path on the app these credentials belong to: on its port and the loopback family it answers on. */
export const credsUrl = (c: AppCreds, path: string): string => appUrl(c.port, path, c.host);

/** `GET /api/executions/active` (WP16a): none, the active execution, or why it could not be read. */
export async function readActive(deps: Deps, c: AppCreds): Promise<ActiveRead> {
  const r = await deps.http({
    method: 'GET',
    url: credsUrl(c, '/api/executions/active'),
    headers: authHeaders(c),
    timeoutMs: 10_000,
  });
  if ('error' in r) return { kind: 'failed', reason: `no answer from the app on port ${c.port}` };
  if (r.status !== 200) return { kind: 'failed', reason: `the app answered ${r.status}` };
  let json: unknown;
  try {
    json = JSON.parse(r.body);
  } catch {
    return { kind: 'failed', reason: 'the app’s answer was not JSON' };
  }
  const parsed = apiContract.activeExecutionResponseSchema.safeParse(json);
  if (!parsed.success) return { kind: 'failed', reason: 'the app’s answer was not the active-run report' };
  return parsed.data.execution === null
    ? { kind: 'none' }
    : { kind: 'active', execution: parsed.data.execution };
}

/** One line naming the active execution, its start and its estimated finish (or "unknown"). */
export function activeLine(e: ActiveExecution): string {
  const what = e.kind === 'run' ? '' : ' (a single-cell verification)';
  return `a search is running: ${e.definitionName}${what}, started ${e.startedAt}, estimated to finish ${e.estimatedFinishAt ?? 'unknown'}`;
}
