import { useEffect, useState } from 'react';
import { COPY } from '../../copy.js';
import { parsePoundsToPence, penceToPoundsInput, poundsText } from '../../format.js';
import { useSynced } from '../../hooks/useSynced.js';
import { carriersText, parseCarriers } from '../../state/carriers.js';

// The Definitions form's field primitives (review arch-r2-008): the form and its advanced fold both use them.

const input = 'min-h-11 rounded border border-slate-400 px-1';

/** Error messages under a field, tied to its input by id (review tsr-013). */
export function FieldErrors({ id, messages }: { id: string; messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <div id={id} role="alert" className="text-red-800">
      {messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

/**
 * A labelled non-negative integer input; blank means "not set". `hint` is shown beside it (minutes as
 * hours); `errors` are the API's messages for this field, announced and linked with aria-describedby.
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  errors = [],
}: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  hint?: string;
  errors?: readonly string[];
}) {
  const errorId = `${id}-errors`;
  return (
    <span className="flex flex-col">
      <label htmlFor={id}>{label}</label>
      <span className="flex items-center gap-1">
        <input
          id={id}
          inputMode="numeric"
          value={value === undefined ? '' : String(value)}
          aria-invalid={errors.length > 0}
          aria-describedby={errors.length > 0 ? errorId : undefined}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === '') onChange(undefined);
            else if (/^\d+$/.test(t)) onChange(Number(t));
          }}
          className={`w-28 ${input}`}
        />
        {hint !== undefined ? <span className="text-xs">{hint}</span> : null}
      </span>
      <FieldErrors id={errorId} messages={errors} />
    </span>
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
}: {
  id: string;
  label: string;
  pence: number | undefined;
  onChange: (p: number | undefined) => void;
}) {
  const [text, setText] = useSynced(penceToPoundsInput(pence), poundsText);
  // why: text that does not parse is shown as an error rather than silently leaving the old value in force (UI-8).
  const invalid = text.trim() !== '' && parsePoundsToPence(text) === undefined;
  const errorId = `${id}-errors`;
  return (
    <span className="flex flex-col">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="decimal"
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const p = parsePoundsToPence(e.target.value);
          if (p !== undefined || e.target.value.trim() === '') onChange(p);
        }}
        className={`w-28 ${input}`}
      />
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
        <span className="flex flex-col">
          <label htmlFor={`${id}-from`}>{`${name} ${COPY.timeFrom}`}</label>
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
        <span className="flex flex-col">
          <label htmlFor={`${id}-to`}>{`${name} ${COPY.timeTo}`}</label>
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
    <span className="flex flex-col">
      <label htmlFor={id}>{label}</label>
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
      <span id={`${id}-help`} className="text-xs">
        {COPY.airlinesHelp}
      </span>
      {ignored.length > 0 ? (
        <span id={`${id}-ignored`} className="text-xs text-red-800">
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
    <span className="flex items-center gap-1">
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
