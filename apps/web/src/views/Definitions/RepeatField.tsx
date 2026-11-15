import { DEFAULT_CRON } from '@gmt/core';
import { useState } from 'react';
import { COPY } from '../../copy.js';
import { ScheduleField } from './ScheduleField.js';
import { describeSchedule, type RepeatKind, repeatKind } from './schedule.js';

const N = COPY.newSearch;
const KINDS: readonly RepeatKind[] = ['never', 'weekly', 'other'];
/** A select's value narrowed by lookup (no casts); the options are the only values it can hold. */
const kindOf = (v: string): RepeatKind => KINDS.find((k) => k === v) ?? 'other';

/**
 * Repeat (design 2026-11-08 Ruling 14): one control over the schedule, Never / Weekly / Other. Weekly is `DEFAULT_CRON`
 * (Mondays 05:00) in the search's time zone, which a new search takes from `SCHEDULER_TIMEZONE`; Never stores no cron. A
 * stored cron that is neither shows "Other: <its words>" with Change, which opens the schedule picker
 * (`ScheduleField`); picking Other opens it too. `onChange` gets the cron to store (null for Never).
 */
export function RepeatField({
  cron,
  tz,
  onChange,
  onIncomplete,
}: {
  cron: string | null;
  tz: string;
  onChange: (cron: string | null) => void;
  onIncomplete?: (id: string, incomplete: boolean) => void;
}) {
  const [picking, setPicking] = useState(false);
  const kind = picking ? 'other' : repeatKind(cron);
  return (
    <div className="repeat-field flex flex-col gap-1">
      <label htmlFor="d-repeat" className="field-label">
        {N.repeat}
      </label>
      <select
        id="d-repeat"
        className="input min-h-11"
        value={kind}
        onChange={(e) => {
          const next = kindOf(e.target.value);
          setPicking(next === 'other');
          if (next === 'never') onChange(null);
          if (next === 'weekly') onChange(DEFAULT_CRON);
        }}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {N.repeatMode[k]}
          </option>
        ))}
      </select>
      {kind === 'other' && !picking ? (
        <p className="repeat-other">
          {N.repeatOther(describeSchedule(cron, tz))}{' '}
          <button
            type="button"
            className="btn-text min-h-11"
            aria-label={N.repeatChangeName}
            onClick={() => setPicking(true)}
          >
            {N.repeatChange}
          </button>
        </p>
      ) : null}
      {picking ? (
        <ScheduleField
          cron={cron}
          tz={tz}
          enabled
          onChange={onChange}
          {...(onIncomplete ? { onIncomplete } : {})}
        />
      ) : null}
    </div>
  );
}
