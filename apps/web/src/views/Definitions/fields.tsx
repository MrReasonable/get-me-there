import { useEffect, useState } from 'react';
import { SETUP_COPY } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import { formatMinutes, parsePoundsToPence, penceToPoundsInput, poundsText } from '../../format.js';
import { useSynced } from '../../hooks/useSynced.js';
import { carriersText, parseCarriers } from '../../state/carriers.js';
import { joinHoursMinutes, splitMinutes } from './hoursMinutes.js';

// The Definitions form's field primitives (review arch-r2-008): the form and its advanced fold both use them.

const input = 'input min-h-11';

/** Error messages under a field, tied to its input by id (review tsr-013). */
export function FieldErrors({ id, messages }: { id: string; messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} role="alert" className="bad-text text-sm">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

/** The ids an input is described by: its hint, then its errors; undefined when it has neither. */
function describedBy(...ids: Array<string | null>): string | undefined {
  const list = ids.filter((x) => x !== null);
  return list.length > 0 ? list.join(' ') : undefined;
}

/** A short hint under a field, tied to its input by id so a screen reader hears it with the label. */
function Hint({ id, text }: { id: string; text: string | undefined }) {
  if (text === undefined) return null;
  return (
    <span id={id} className="hint">
      {text}
    </span>
  );
}

/**
 * A labelled non-negative integer input; blank means "not set". `hint` is shown beside the box (a unit or a
 * conversion); `description` is a plain sentence under it, read with the label; `errors` are the API's messages for
 * this field, announced and linked with aria-describedby.
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  description,
  errors = [],
  labelClassName,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  hint?: string;
  description?: string;
  errors?: readonly string[];
  /** Classes for the label, e.g. `sr-only` where a visible group label already says what the box is. */
  labelClassName?: string;
}) {
  const errorId = `${id}-errors`;
  const hintId = `${id}-hint`;
  return (
    <span className="flex max-w-xs flex-col gap-1">
      <label htmlFor={id} className={labelClassName ?? 'field-label'}>
        {label}
      </label>
      <span className="flex items-center gap-1">
        <input
          id={id}
          inputMode="numeric"
          value={value === undefined ? '' : String(value)}
          aria-invalid={errors.length > 0}
          aria-describedby={describedBy(
            description !== undefined ? hintId : null,
            errors.length > 0 ? errorId : null,
          )}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === '') onChange(undefined);
            else if (/^\d+$/.test(t)) onChange(Number(t));
          }}
          className={`w-28 ${input}`}
        />
        {hint !== undefined ? <span className="text-fg-2">{hint}</span> : null}
      </span>
      <Hint id={hintId} text={description} />
      <FieldErrors id={errorId} messages={errors} />
    </span>
  );
}

/**
 * A duration stored in whole minutes, entered as hours and minutes (journey time). Blank in both boxes is "not set";
 * only digits are taken. Minutes above 59 still count as minutes, and the total is then shown beside the boxes.
 */
export function HoursMinutesField({
  id,
  label,
  value,
  onChange,
  description,
  legendClassName,
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (minutes: number | undefined) => void;
  description?: string;
  legendClassName?: string;
}) {
  const [text, setText] = useState(() => splitMinutes(value));
  const hintId = `${id}-hint`;
  const describedById = description !== undefined ? hintId : undefined;
  // why: the boxes follow the value when it changes elsewhere (Import example), and keep what was typed while it
  // already means the value ("20" and "75" for 1275).
  useEffect(() => {
    setText((t) => {
      const j = joinHoursMinutes(t.hours, t.minutes);
      return (j.kind === 'value' ? j.minutes : undefined) === value ? t : splitMinutes(value);
    });
  }, [value]);
  const update = (next: { hours: string; minutes: string }) => {
    const j = joinHoursMinutes(next.hours, next.minutes);
    if (j.kind === 'invalid') return;
    setText(next);
    onChange(j.kind === 'value' ? j.minutes : undefined);
  };
  const D = SETUP_COPY.definitions;
  const total = joinHoursMinutes(text.hours, text.minutes);
  // why: "20 hours 75 minutes" is accepted as minutes; the total says what that comes to.
  const shownTotal = total.kind === 'value' && Number(text.minutes) > 59 ? total.minutes : null;
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className={legendClassName}>{label}</legend>
      <span className="flex flex-wrap items-center gap-1.5">
        <input
          id={`${id}-h`}
          inputMode="numeric"
          aria-label={D.journeyPart(label, D.journeyHours)}
          aria-describedby={describedById}
          value={text.hours}
          onChange={(e) => update({ ...text, hours: e.target.value })}
          className={`w-16 ${input}`}
        />
        <span aria-hidden="true">{D.journeyHours}</span>
        <input
          id={`${id}-m`}
          inputMode="numeric"
          aria-label={D.journeyPart(label, D.journeyMinutes)}
          aria-describedby={describedById}
          value={text.minutes}
          onChange={(e) => update({ ...text, minutes: e.target.value })}
          className={`ml-2 w-16 ${input}`}
        />
        <span aria-hidden="true">{D.journeyMinutes}</span>
        {shownTotal === null ? null : (
          <span className="hint">{COPY.minutesAsHours(formatMinutes(shownTotal))}</span>
        )}
      </span>
      <Hint id={hintId} text={description} />
    </fieldset>
  );
}

/**
 * Money is entered in pounds everywhere and held as integer pence (review po-012): the text the
 * operator types stays as typed while it is being edited, and follows the value when it changes elsewhere.
 */
export function PoundsField({
  id,
  label,
  pence,
  onChange,
  description,
}: {
  id: string;
  label: string;
  pence: number | undefined;
  onChange: (p: number | undefined) => void;
  description?: string;
}) {
  const [text, setText] = useSynced(penceToPoundsInput(pence), poundsText);
  // why: text that does not parse is shown as an error rather than silently leaving the old value in force (UI-8).
  const invalid = text.trim() !== '' && parsePoundsToPence(text) === undefined;
  const errorId = `${id}-errors`;
  const hintId = `${id}-hint`;
  return (
    <span className="flex max-w-xs flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        aria-invalid={invalid}
        aria-describedby={describedBy(description !== undefined ? hintId : null, invalid ? errorId : null)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const p = parsePoundsToPence(e.target.value);
          if (p !== undefined || e.target.value.trim() === '') onChange(p);
        }}
        className={`w-28 ${input}`}
      />
      <Hint id={hintId} text={description} />
      <FieldErrors id={errorId} messages={invalid ? [COPY.invalidPounds] : []} />
    </span>
  );
}

/** A local time window; the constraint exists only once both ends are set. */
export function TimeWindowField({
  id,
  name,
  value,
  onChange,
  onIncomplete,
}: {
  id: string;
  name: string;
  value: { from: string; to: string } | undefined;
  onChange: (v: { from: string; to: string } | undefined) => void;
  /** Told whenever the window is half-filled, so the form can refuse to save or estimate it. */
  onIncomplete?: (id: string, incomplete: boolean) => void;
}) {
  const [from, setFrom] = useState(value?.from ?? '');
  const [to, setTo] = useState(value?.to ?? '');
  // why: the boxes follow the draft when it changes elsewhere (Import example), so the form never holds a
  // window it does not show (review arch-r3-004); one end typed alone leaves the value, and so the boxes, as they are.
  useEffect(() => {
    setFrom(value?.from ?? '');
    setTo(value?.to ?? '');
  }, [value?.from, value?.to]);
  // why: the constraint exists only with both ends; one end alone stays local until the other is filled or cleared.
  const sync = (f: string, t: string) => {
    if (f !== '' && t !== '') onChange({ from: f, to: t });
    else if (f === '' && t === '') onChange(undefined);
  };
  // why: a half-filled window is an error the operator sees, not a constraint that vanishes (controller-directed).
  const half = (from === '') !== (to === '');
  const errorId = `${id}-errors`;
  useEffect(() => {
    onIncomplete?.(id, half);
    return () => onIncomplete?.(id, false);
  }, [half, id, onIncomplete]);
  return (
    <span className="flex flex-col gap-1">
      <span className="flex gap-2">
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-from`} className="field-label">{`${name} ${COPY.timeFrom}`}</label>
          <input
            id={`${id}-from`}
            type="time"
            aria-invalid={half}
            aria-describedby={half ? errorId : undefined}
            className={input}
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              sync(e.target.value, to);
            }}
          />
        </span>
        <span className="flex flex-col gap-1">
          <label htmlFor={`${id}-to`} className="field-label">{`${name} ${COPY.timeTo}`}</label>
          <input
            id={`${id}-to`}
            type="time"
            aria-invalid={half}
            aria-describedby={half ? errorId : undefined}
            className={input}
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              sync(from, e.target.value);
            }}
          />
        </span>
      </span>
      <FieldErrors id={errorId} messages={half ? [COPY.bothEndsNeeded] : []} />
    </span>
  );
}

/**
 * Comma-separated carrier codes, parsed like the Results carriers filter: two-character codes only,
 * other entries shown as ignored rather than stored (review arch-r2-009).
 */
export function AirlinesField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string[] | undefined;
  onChange: (v: string[] | undefined) => void;
}) {
  const [text, setText] = useSynced((value ?? []).join(','), carriersText);
  const ignored = parseCarriers(text).ignored;
  return (
    <span className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        value={text}
        aria-describedby={ignored.length > 0 ? `${id}-help ${id}-ignored` : `${id}-help`}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const codes = parseCarriers(text).codes;
          onChange(codes.length > 0 ? codes : undefined);
        }}
        className={input}
      />
      <span id={`${id}-help`} className="hint">
        {COPY.airlinesHelp}
      </span>
      {ignored.length > 0 ? (
        <span id={`${id}-ignored`} className="bad-text text-sm">
          {COPY.carriersIgnored(ignored.join(', '))}
        </span>
      ) : null}
    </span>
  );
}

/** A labelled checkbox with a 44 px row. */
export function Check({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled === true}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="flex min-h-11 items-center">
        {label}
      </label>
    </span>
  );
}
