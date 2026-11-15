/** One line per alert rule for the Alerts view (spec §6.8, §11), built from catalogue strings only. */
import type { AlertRule } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';

const C = COPY.alertsView;

/**
 * "Price at or below £450 · Calendar basis (constraints not checked) · cooldown 336h"; a missing figure reads "not set".
 * `plain` words a drop as "Price drops by 10% or more", the basis without "basis" or "itinerary" ("calendar prices,
 * limits not checked", "flights read") and the cooldown in days, for the Search page's Alert fold, whose main path says
 * none of those terms.
 */
export function describeRule(r: AlertRule, plain = false): string {
  const pounds = r.thresholdPence === null ? null : formatPence(r.thresholdPence);
  const pct = r.pct === null ? null : `${r.pct}%`;
  const what =
    r.type === 'absolute'
      ? `${C.typeAbsolute} ${pounds ?? C.notSet}`
      : plain
        ? C.plainDrop(r.type === 'dropAbs' ? pounds : pct)
        : r.type === 'dropAbs'
          ? `${C.typeDropAbs} ${pounds ?? C.notSet}`
          : `${C.typeDropPct} ${pct ?? C.notSet}`;
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
  return `${what} · ${basis} · ${plain ? C.plainCooldown(r.cooldownHours) : C.cooldownText(r.cooldownHours)}`;
}
