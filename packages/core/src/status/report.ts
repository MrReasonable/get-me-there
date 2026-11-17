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
      a.id.localeCompare(b.id, 'en'),
  );
}

/** What the one concerned check is about, for the caller to word: its label as typed, else its provider, else its area. */
export type BarSubject =
  | { kind: 'label'; text: string }
  | { kind: 'provider'; providerId: NonNullable<StatusCheck['providerId']> }
  | { kind: 'area'; area: StatusCheck['area'] };

/**
 * What the status bar and `gmt status` word: how bad it is (`fail` outranks `warn`), how many checks are concerned
 * (every `fail` and `warn`; `off` checks and notes never count) and, when exactly one is, what it is about (`subject`:
 * its label, else its provider, else its area). The words are the caller's (the web's COPY, the CLI's own line), never
 * this function's.
 */
export function barSummary(checks: readonly StatusCheck[]): {
  kind: 'clean' | 'warn' | 'fail';
  count: number;
  subject: BarSubject | null;
} {
  const concerned = checks.filter((c) => c.state === 'fail' || c.state === 'warn');
  const kind = checks.some((c) => c.state === 'fail') ? 'fail' : concerned.length > 0 ? 'warn' : 'clean';
  const [only] = concerned;
  return {
    kind,
    count: concerned.length,
    subject: concerned.length === 1 && only !== undefined ? subjectOf(only) : null,
  };
}

function subjectOf(c: StatusCheck): BarSubject {
  if (c.label !== null) return { kind: 'label', text: c.label };
  if (c.providerId !== null) return { kind: 'provider', providerId: c.providerId };
  return { kind: 'area', area: c.area };
}
