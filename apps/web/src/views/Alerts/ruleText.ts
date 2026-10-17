/** One line per alert rule for the Alerts view (spec §6.8, §11), built from catalogue strings only. */
import type { AlertRule } from '@gmt/core';
import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';

const C = COPY.alertsView;

/** "Price at or below £450 · Calendar basis (constraints not checked) · cooldown 336h"; a missing figure reads "not set". */
export function describeRule(r: AlertRule): string {
  const pounds = r.thresholdPence === null ? C.notSet : formatPence(r.thresholdPence);
  const what =
    r.type === 'absolute'
      ? `${C.typeAbsolute} ${pounds}`
      : r.type === 'dropAbs'
        ? `${C.typeDropAbs} ${pounds}`
        : `${C.typeDropPct} ${r.pct === null ? C.notSet : `${r.pct}%`}`;
  const basis =
    r.basis === 'calendar' ? C.basisCalendar : r.requireAllVerified === true ? C.requireAll : C.basisVerified;
  return `${what} · ${basis} · ${C.cooldownText(r.cooldownHours)}`;
}
