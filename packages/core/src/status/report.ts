/**
 * The status report's order and its one bar line (spec §10 `GET /status`, §11 status bar): shared by the api, the web and
 * `gmt status`. Pure; whole-file mutation scope.
 */
import { type StatusCheck, statusAreaSchema } from '../api-contract/system.js';

/** Worst first. */
export const STATE_ORDER = { fail: 0, warn: 1, ok: 2, off: 3 } as const;
const AREA_ORDER = statusAreaSchema.options;

/** Worst first: state, then area (the schema's order), then id. Does not change its argument. */
export function sortChecks(checks: readonly StatusCheck[]): StatusCheck[] {
  return [...checks].sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * The one line the status bar and `gmt status` share: any `fail` is "Status: n failing", else any `warn` the quieter
 * "Status: n to check", each naming the area when exactly one check is concerned. `off` checks and notes never count.
 */
export function barSummary(checks: readonly StatusCheck[]): {
  kind: 'clean' | 'warn' | 'fail';
  text: string;
} {
  const failing = checks.filter((c) => c.state === 'fail');
  const toCheck = checks.filter((c) => c.state === 'warn');
  const concerned = failing.length > 0 ? failing : toCheck;
  const kind = failing.length > 0 ? 'fail' : toCheck.length > 0 ? 'warn' : 'clean';
  if (kind === 'clean') return { kind, text: 'Status: nothing to check' };
  // why: one concerned check is named by its area, several by their count
  const what = concerned.length === 1 ? concerned.map((c) => c.area).join('') : String(concerned.length);
  return { kind, text: `Status: ${what} ${kind === 'fail' ? 'failing' : 'to check'}` };
}
