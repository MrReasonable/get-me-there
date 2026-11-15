/** One line per alert rule for the Alerts view (spec §6.8, §11), built from catalogue strings only. */
import type { AlertRule } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';

const C = COPY.alertsView;

/**
 * "Price at or below £450 · Calendar basis (constraints not checked) · cooldown 336h"; a missing figure reads "not set".
 * `plain` words the basis without "basis" or "itinerary" ("calendar prices (constraints not checked)", "flights read"),
 * for the Search page's Alert fold, whose main path says neither.
 */
export function describeRule(r: AlertRule, plain = false): string {
  const pounds = r.thresholdPence === null ? C.notSet : formatPence(r.thresholdPence);
  const what =
    r.type === 'absolute'
      ? `${C.typeAbsolute} ${pounds}`
      : r.type === 'dropAbs'
        ? `${C.typeDropAbs} ${pounds}`
        : `${C.typeDropPct} ${r.pct === null ? C.notSet : `${r.pct}%`}`;
  const basis = plain
    ? r.basis === 'calendar'
      ? C.plainBasis.calendar
      : r.requireAllVerified === true
        ? C.plainBasis.requireAll
        : C.plainBasis.verified
    : r.basis === 'calendar'
      ? C.basisCalendar
      : r.requireAllVerified === true
        ? C.requireAll
        : C.basisVerified;
  return `${what} · ${basis} · ${C.cooldownText(r.cooldownHours)}`;
}
