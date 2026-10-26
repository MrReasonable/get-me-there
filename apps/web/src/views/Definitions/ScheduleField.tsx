import { useEffect, useState } from 'react';
import { SETUP_COPY } from '../../copy/setup.js';
import { Check } from './fields.js';
import {
  describeSchedule,
  parseSchedule,
  SCHEDULE_KINDS,
  type Schedule,
  type ScheduleKind,
  scheduleToCron,
  switchSchedule,
  WEEK_ORDER,
} from './schedule.js';

const S = SETUP_COPY.schedule;
const input = 'min-h-11 rounded border border-slate-400 px-1';
/** The id the form's "incomplete" list knows this field by. */
export const SCHEDULE_FIELD_ID = 's-schedule';

/** A select's value narrowed by lookup (no casts); the options are the only values it can hold. */
const kindOf = (v: string): ScheduleKind => SCHEDULE_KINDS.find((k) => k === v) ?? 'custom';

/**
 * Spec §11 schedule (cron in the definition's time zone) as a picker: none, every day, weekly on chosen days, or a
 * custom cron, with a plain reading of what will run ("Mondays at 05:00 (Europe/London)"). The definition still stores
 * cron; a stored cron the picker cannot show as a day-and-time schedule opens as custom, unchanged.
 */
export function ScheduleField({
  cron,
  tz,
  enabled,
  onChange,
  onIncomplete,
}: {
  cron: string | null;
  tz: string;
  enabled: boolean;
  onChange: (cron: string | null) => void;
  onIncomplete?: (id: string, incomplete: boolean) => void;
}) {
  const [schedule, setSchedule] = useState<Schedule>(() => parseSchedule(cron));
  const next = scheduleToCron(schedule);
  const incomplete = next === undefined;
  useEffect(() => {
    onIncomplete?.(SCHEDULE_FIELD_ID, incomplete);
    return () => onIncomplete?.(SCHEDULE_FIELD_ID, false);
  }, [incomplete, onIncomplete]);
  const pick = (s: Schedule) => {
    setSchedule(s);
    const c = scheduleToCron(s);
    if (c !== undefined) onChange(c);
  };
  const timed = schedule.kind === 'daily' || schedule.kind === 'weekly' ? schedule : null;
  const missing =
    schedule.kind === 'weekly' && schedule.days.length === 0 ? S.noDays : incomplete ? S.noTime : null;
  return (
    <div className="flex w-full flex-col gap-2">
      <span className="flex flex-wrap items-end gap-3">
        <span className="flex flex-col">
          <label htmlFor="s-mode">{S.repeat}</label>
          <select
            id="s-mode"
            className={input}
            value={schedule.kind}
            onChange={(e) => pick(switchSchedule(schedule, kindOf(e.target.value), cron))}
          >
            {SCHEDULE_KINDS.map((k) => (
              <option key={k} value={k}>
                {S.mode[k]}
              </option>
            ))}
          </select>
        </span>
        {timed !== null ? (
          <span className="flex flex-col">
            <label htmlFor="s-time">{S.time}</label>
            <input
              id="s-time"
              type="time"
              className={input}
              value={timed.time}
              onChange={(e) => pick({ ...timed, time: e.target.value })}
            />
          </span>
        ) : null}
        {schedule.kind === 'custom' ? (
          <span className="flex max-w-xs flex-col gap-0.5">
            <label htmlFor="s-cron">{S.cron}</label>
            <input
              id="s-cron"
              className={`font-mono ${input}`}
              aria-describedby="s-cron-hint"
              value={schedule.cron}
              onChange={(e) => pick({ kind: 'custom', cron: e.target.value })}
            />
            <span id="s-cron-hint" className="text-xs text-slate-700">
              {S.cronHint}
            </span>
          </span>
        ) : null}
      </span>
      {schedule.kind === 'weekly' ? (
        <fieldset className="flex flex-wrap gap-x-3">
          <legend>{S.days}</legend>
          {WEEK_ORDER.map((d) => (
            <Check
              key={d}
              id={`s-day-${d}`}
              label={S.dayShort[d] ?? String(d)}
              checked={schedule.days.includes(d)}
              onChange={(on) =>
                pick({
                  ...schedule,
                  days: WEEK_ORDER.filter((x) => (x === d ? on : schedule.days.includes(x))),
                })
              }
            />
          ))}
        </fieldset>
      ) : null}
      {missing !== null ? (
        <p role="alert" className="text-red-800">
          {missing}
        </p>
      ) : (
        <p aria-live="polite">
          <span className="font-medium">{S.reads}</span> {describeSchedule(next ?? null, tz)}
        </p>
      )}
      {!enabled && next !== null && next !== undefined ? (
        <p className="text-slate-700">{S.disabled}</p>
      ) : null}
    </div>
  );
}
