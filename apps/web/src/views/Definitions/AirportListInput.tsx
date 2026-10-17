import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/endpoints.js';
import { qk, useAirportSearch } from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { normaliseIata } from './draft.js';

/** Waits `ms` after the last keystroke before the autocomplete query runs. */
export const AIRPORT_DEBOUNCE_MS = 200;

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface AirportListInputProps {
  id: 'origins' | 'destinations';
  label: string;
  addLabel: string;
  codes: readonly string[];
  onChange: (codes: string[]) => void;
  /** Messages from the API's 422 `details.fields` for this field, e.g. the metro-code message. */
  errors: readonly string[];
}

/**
 * Operator-entered airports with airport-table autocomplete; no preset airports (spec §1, §11).
 * A metro code the airports table maps (its rows carry `metro`) expands to its member airports on Enter
 * or Add, the same as picking them from the list, instead of failing only after "Show estimate"
 * (decision 44, reviews PFT-07, tsr2-005); the table is asked directly when the autocomplete has not
 * answered yet. A code the table does not know is left to the API, the validator. Errors are tied to the input with
 * aria-describedby and aria-invalid. The native datalist is the accepted autocomplete for now.
 */
export function AirportListInput({ id, label, addLabel, codes, onChange, errors }: AirportListInputProps) {
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const query = useDebounced(text.trim(), AIRPORT_DEBOUNCE_MS);
  const suggestions = useAirportSearch(query);
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);
  const add = (list: readonly string[]) => {
    const fresh = list.filter((c) => !codes.includes(c));
    if (fresh.length === 0) {
      setLocalError(COPY.duplicateAirport(list.join(', ')));
      return;
    }
    setLocalError(null);
    onChange([...codes, ...fresh]);
    setText('');
  };
  const addTyped = async () => {
    const code = normaliseIata(text);
    setText(code);
    setExpanded(null);
    if (!/^[A-Z]{3}$/.test(code)) {
      setLocalError(COPY.iataFormat);
      return;
    }
    // why: the same cached query the autocomplete uses; a failed lookup adds the code and leaves it to the API.
    const rows = await qc
      .fetchQuery({ queryKey: qk.airports(code), queryFn: () => api.airports(code), staleTime: 60_000 })
      .catch(() => []);
    const members = rows.filter((a) => a.metro === code && a.iata !== code).map((a) => a.iata);
    if (members.length === 0) {
      add([code]);
      return;
    }
    add(members);
    setExpanded(COPY.metroExpanded(code, members.join(', ')));
  };
  const messages = [...(localError === null ? [] : [localError]), ...errors];
  const errorId = `${id}-errors`;
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-semibold">{label}</legend>
      {/* why: the chip list has no label of its own, so getByLabelText(label) finds only the input */}
      <ul className="flex flex-wrap gap-1">
        {codes.map((c) => (
          <li key={c} className="flex items-center gap-1 rounded bg-slate-200 px-1">
            <span>{c}</span>
            <button
              type="button"
              aria-label={COPY.removeAirport(c)}
              className="min-h-11 min-w-11"
              onClick={() => onChange(codes.filter((x) => x !== c))}
            >
              {'×'}
            </button>
          </li>
        ))}
      </ul>
      <span className="flex gap-1">
        <label htmlFor={`${id}-input`} className="sr-only">
          {label}
        </label>
        <input
          id={`${id}-input`}
          list={`${id}-options`}
          value={text}
          aria-invalid={messages.length > 0}
          aria-describedby={messages.length > 0 ? `${id}-help ${errorId}` : `${id}-help`}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setText((t) => normaliseIata(t))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void addTyped();
            }
          }}
          className="min-h-11 rounded border border-slate-400 px-1"
        />
        <button
          type="button"
          aria-label={addLabel}
          onClick={() => void addTyped()}
          className="min-h-11 rounded border border-slate-500 px-3"
        >
          {COPY.addAirport}
        </button>
      </span>
      {expanded !== null ? (
        <p role="status" className="text-sm">
          {expanded}
        </p>
      ) : null}
      <datalist id={`${id}-options`}>
        {(suggestions.data ?? []).map((a) => (
          <option key={a.iata} value={a.iata}>
            {COPY.airportOption(a.name, a.city, a.country)}
          </option>
        ))}
      </datalist>
      <span id={`${id}-help`} className="text-xs text-slate-700">
        {COPY.airportInputHelp}
      </span>
      {messages.length > 0 ? (
        <div id={errorId} role="alert" className="text-red-800">
          {messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
