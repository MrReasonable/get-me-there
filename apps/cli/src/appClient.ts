import { apiContract } from '@gmt/core';
import type { z } from 'zod';
import type { Deps } from './deps.js';

/**
 * The CLI's reads of a running app (spec §10), always on 127.0.0.1, with basic auth from a settings file when the app
 * has a password. The password travels only in the Authorization header of an in-process request: never in an argv, a
 * log line or an error.
 */
export interface AppAuth {
  user: string;
  pass: string;
}
/**
 * Where this machine's app answers, and how the CLI signs in to it. `auth` is null when the settings have no password
 * (spec §4: the app runs without one while only this machine can reach it); a request then carries no Authorization.
 */
export interface AppTarget {
  port: number;
  /** The loopback host the app answers on, as a URL host: `127.0.0.1` (the default) or `[::1]`. */
  host?: string;
  auth: AppAuth | null;
}
export type ActiveExecution = NonNullable<
  z.infer<typeof apiContract.activeExecutionResponseSchema>['execution']
>;
export type ActiveRead =
  | { kind: 'none' }
  | { kind: 'active'; execution: ActiveExecution }
  | { kind: 'failed'; reason: string };

/** The basic auth a settings record holds, or null when it has no auth lines. */
export function authFrom(r: Readonly<Record<string, string | undefined>>): AppAuth | null {
  const user = r.APP_BASIC_AUTH_USER;
  const pass = r.APP_BASIC_AUTH_PASS;
  if (user === undefined || pass === undefined || user === '' || pass === '') return null;
  return { user, pass };
}

/**
 * The app a settings record describes: its PORT (else `portDefault`) and its basic auth, if any. PORT is read by the
 * app's own rule (core's parseConfig: `Number` coercion, an integer from 1 to 65535, empty = unset), so `3917.0` is
 * 3917 here as it is in the app.
 */
export function targetFrom(r: Readonly<Record<string, string | undefined>>, portDefault = 3000): AppTarget {
  const n = r.PORT === undefined || r.PORT === '' ? Number.NaN : Number(r.PORT);
  const port = Number.isInteger(n) && n >= 1 && n <= 65535 ? n : portDefault;
  return { port, auth: authFrom(r) };
}

/** The Authorization header for this app, or none when it has no password. */
export const authHeaders = (t: AppTarget): Record<string, string> =>
  t.auth === null
    ? {}
    : { Authorization: `Basic ${Buffer.from(`${t.auth.user}:${t.auth.pass}`).toString('base64')}` };
export const appUrl = (port: number, path: string, host = '127.0.0.1'): string =>
  `http://${host}:${port}${path}`;

/** A path on this app: on its port and the loopback family it answers on. */
export const targetUrl = (t: AppTarget, path: string): string => appUrl(t.port, path, t.host);

/** `GET /api/executions/active` (WP16a): none, the active execution, or why it could not be read. */
export async function readActive(deps: Deps, c: AppTarget): Promise<ActiveRead> {
  const r = await deps.http({
    method: 'GET',
    url: targetUrl(c, '/api/executions/active'),
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

/** A Settings section's `section=` value (settings plan rulings 13 and 14). */
export type SettingsSection = z.infer<typeof apiContract.statusFixSectionSchema>;

/** The path of a Settings section on the app, which the CLI prints after the app's address. */
export const settingsPath = (section: SettingsSection): string => `/?view=settings&section=${section}`;

/**
 * Settings plan ruling 15: what a command that no longer changes a setting prints instead, with the section's address.
 */
export const changeInSettings = (t: AppTarget, section: SettingsSection): string =>
  `Change this in Settings: ${targetUrl(t, settingsPath(section))}`;

/**
 * Settings plan ruling 15: whether this app holds its own settings, which it does from its first start on: `GET
 * /api/settings` answers with the Settings read. No answer, another status (an app from before the Settings page) or
 * another body is not holding them, and the caller goes on as before.
 */
export async function holdsSettings(deps: Deps, c: AppTarget): Promise<boolean> {
  const r = await deps.http({
    method: 'GET',
    url: targetUrl(c, '/api/settings'),
    headers: authHeaders(c),
    timeoutMs: 10_000,
  });
  if ('error' in r || r.status !== 200) return false;
  try {
    return apiContract.settingsViewSchema.safeParse(JSON.parse(r.body)).success;
  } catch {
    return false;
  }
}

/** One line naming the active execution, its start and its estimated finish (or "unknown"). */
export function activeLine(e: ActiveExecution): string {
  const what = e.kind === 'run' ? '' : ' (a single-cell verification)';
  return `a search is running: ${e.definitionName}${what}, started ${e.startedAt}, estimated to finish ${e.estimatedFinishAt ?? 'unknown'}`;
}
