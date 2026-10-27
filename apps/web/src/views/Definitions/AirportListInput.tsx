import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { api } from '../../api/endpoints.js';
import { qk, useAirportSearch } from '../../api/queries.js';
import { PLAN_COPY } from '../../copy/plan.js';
import { COPY } from '../../copy.js';
import {
  type AirportChoice,
  type AirportRow,
  airportChoices,
  airportOptionText,
  shortAirportName,
} from './airports.js';
import { normaliseIata } from './draft.js';

/** Waits `ms` after the last keystroke before the autocomplete query runs. */
export const AIRPORT_DEBOUNCE_MS = 200;
/** The autocomplete asks the airports table from this many characters (useAirportSearch's minimum). */
const MIN_QUERY = 2;

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
  placeholder: string;
  codes: readonly string[];
  onChange: (codes: string[]) => void;
  /** What the airports table says about each listed code, for the chips; a code it does not know shows alone. */
  details: ReadonlyMap<string, AirportRow>;
  /** Messages from the API's 422 `details.fields` for this field, e.g. the metro-code message. */
  errors: readonly string[];
}

const choiceText = (c: AirportChoice) =>
  c.kind === 'metro' ? PLAN_COPY.metroOption(c.city, c.codes) : airportOptionText(c.row);

/**
 * An airport picker (WAI-ARIA 1.2 combobox, list autocomplete with automatic selection): typing searches the
 * airports table by city, airport name or code (`GET /api/airports?q=`, debounced) and lists the answers in a
 * listbox; the first option is highlighted, the arrow keys move the highlight, Enter or a click or tap picks it,
 * Escape closes the list (or clears the box when it is closed) and Tab leaves without picking. When two or more
 * answers share a metro, the first option adds all of that metro's airports. A picked airport becomes a removable
 * chip and the box clears; a duplicate is refused with a message.
 *
 * A bare three-letter code typed before the list answers still adds on Enter, and a metro code expands to its member
 * airports (decision 44, reviews PFT-07, tsr2-005); the table is asked directly when the autocomplete has not
 * answered yet. A code the table does not know is left to the API, the validator. No airport is preset (spec §1).
 */
export function AirportListInput({
  id,
  label,
  placeholder,
  codes,
  onChange,
  details,
  errors,
}: AirportListInputProps) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const trimmed = text.trim();
  const query = useDebounced(trimmed, AIRPORT_DEBOUNCE_MS);
  const search = useAirportSearch(query);
  const qc = useQueryClient();
  // why: the highlight belongs to one answer; a new answer starts again at its first option (automatic selection).
  const [nav, setNav] = useState<{ query: string; index: number }>({ query: '', index: 0 });
  // why: addTyped awaits a lookup, so `add` must read the list and the change handler of the render that is current
  // when the answer arrives, not those of the render that started it (a second add in between would be overwritten).
  const latest = useRef({ codes, onChange });
  // why: written after commit, not during render, so a render React discards can never leave its props here.
  useEffect(() => {
    latest.current = { codes, onChange };
  });

  const answered = trimmed.length >= MIN_QUERY && query === trimmed;
  const choices = answered && search.data !== undefined ? airportChoices(search.data) : [];
  const popup = open && trimmed.length >= MIN_QUERY;
  const listShown = popup && choices.length > 0;
  const active = nav.query === query ? Math.min(nav.index, Math.max(choices.length - 1, 0)) : 0;
  const optionId = (i: number) => `${id}-option-${i}`;
  const listboxId = `${id}-listbox`;

  // why: the highlighted option stays visible while the arrow keys move through a list taller than its box; a pointer
  // moving over the options must not scroll the list under it, so only an arrow key asks for the scroll.
  const scrollToActive = useRef(false);
  useEffect(() => {
    if (!listShown) {
      scrollToActive.current = false;
      return;
    }
    if (!scrollToActive.current) return;
    scrollToActive.current = false;
    document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [listShown, active, id]);

  /** Adds the codes not already listed; false (with the duplicate error) when there were none to add. */
  const add = (list: readonly string[]): boolean => {
    const current = latest.current.codes;
    const fresh = list.filter((c) => !current.includes(c));
    if (fresh.length === 0) {
      setLocalError(COPY.duplicateAirport(list.join(', ')));
      return false;
    }
    setLocalError(null);
    const next = [...current, ...fresh];
    // why: a further add before the parent re-renders must build on this list, not the previous render's
    latest.current = { codes: next, onChange: latest.current.onChange };
    latest.current.onChange(next);
    setText('');
    return true;
  };
  /** The member airports of a metro code, from the same cached query the autocomplete uses; [] when unknown. */
  const membersOf = async (code: string): Promise<string[]> => {
    // why: a failed lookup leaves the code to the API, the validator.
    const rows = await qc
      .fetchQuery({ queryKey: qk.airports(code), queryFn: () => api.airports(code), staleTime: 60_000 })
      .catch(() => []);
    return rows.filter((a) => a.metro === code && a.iata !== code).map((a) => a.iata);
  };
  const addTyped = async () => {
    const code = normaliseIata(text);
    setText(code);
    setStatus(null);
    setOpen(false);
    if (!/^[A-Z]{3}$/.test(code)) {
      setLocalError(PLAN_COPY.pickOrCode);
      return;
    }
    const members = await membersOf(code);
    if (members.length === 0) {
      add([code]);
      return;
    }
    // why: the status says the metro code expanded only when it added something; a duplicate error says the opposite
    if (add(members)) setStatus(COPY.metroExpanded(code, members.join(', ')));
  };
  const pick = async (choice: AirportChoice) => {
    setOpen(false);
    setStatus(null);
    if (choice.kind === 'airport') {
      if (add([choice.row.iata])) setStatus(PLAN_COPY.added(airportOptionText(choice.row)));
      return;
    }
    setText('');
    // why: the option lists the metro's airports in this answer; the table's full list is asked, as a typed code is.
    const members = await membersOf(choice.metro);
    const list = members.length > 0 ? members : [...choice.codes];
    if (add(list)) setStatus(PLAN_COPY.added(PLAN_COPY.metroOption(choice.city, list)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = choices.length;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!popup) {
          setOpen(true);
          return;
        }
        if (n === 0) return;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        scrollToActive.current = true;
        setNav({ query, index: (active + step + n) % n });
        return;
      }
      case 'Enter': {
        // why: Enter never submits the form from here; it picks or adds.
        e.preventDefault();
        const choice = listShown ? choices[active] : undefined;
        if (choice !== undefined) void pick(choice);
        else if (trimmed !== '') void addTyped();
        return;
      }
      case 'Escape':
        if (popup) {
          e.preventDefault();
          setOpen(false);
        } else if (text !== '') {
          e.preventDefault();
          setText('');
          setLocalError(null);
        }
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
  };

  const messages = [...(localError === null ? [] : [localError]), ...errors];
  const errorId = `${id}-errors`;
  const helpId = `${id}-help`;
  const popupMessage = !popup
    ? null
    : !answered || search.isPending
      ? PLAN_COPY.searching
      : search.isError
        ? PLAN_COPY.lookupFailed
        : choices.length === 0
          ? /^[A-Za-z]{3}$/.test(trimmed)
            ? PLAN_COPY.noMatchCode(trimmed)
            : PLAN_COPY.noMatch(trimmed)
          : null;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1 text-base font-semibold text-slate-900">{label}</legend>
      {/* why: the chip list has no label of its own, so getByLabelText(label) finds only the input */}
      <ul className="flex flex-wrap gap-1.5 empty:hidden">
        {codes.map((c) => {
          const row = details.get(c);
          return (
            <li
              key={c}
              className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-100 py-0 pl-3"
            >
              <span className="font-mono text-sm font-semibold">{c}</span>
              {row !== undefined ? (
                <span className="text-sm text-slate-700">{shortAirportName(row.name)}</span>
              ) : null}
              <button
                type="button"
                aria-label={PLAN_COPY.remove(c)}
                className="min-h-11 min-w-11 rounded-full text-lg leading-none text-slate-700 hover:bg-slate-200 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-slate-900"
                onClick={() => {
                  setLocalError(null);
                  setStatus(null);
                  onChange(codes.filter((x) => x !== c));
                }}
              >
                {'×'}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="relative">
        <label htmlFor={`${id}-input`} className="sr-only">
          {label}
        </label>
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="enter"
          placeholder={placeholder}
          value={text}
          aria-expanded={listShown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={listShown ? optionId(active) : undefined}
          aria-invalid={messages.length > 0}
          aria-describedby={messages.length > 0 ? `${helpId} ${errorId}` : helpId}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setLocalError(null);
          }}
          onFocus={() => {
            if (trimmed.length >= MIN_QUERY) setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
            setText((t) => normaliseIata(t));
          }}
          onKeyDown={onKeyDown}
          className="min-h-11 w-full rounded-md border border-slate-400 bg-white px-3 text-base placeholder:text-slate-500 focus-visible:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-900 aria-invalid:border-red-700"
        />
        <div
          id={listboxId}
          role="listbox"
          aria-label={PLAN_COPY.listbox(label)}
          hidden={!listShown}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-slate-300 bg-white py-1 shadow-[0_8px_24px_-6px_rgb(15_23_42/0.25)]"
        >
          {choices.map((choice, i) => (
            // why: the input keeps focus (aria-activedescendant); a mousedown here must not move it, or the list would
            // close before the click lands. tabIndex -1 keeps the option out of the tab order; its own Enter is a pick.
            <div
              key={choice.kind === 'metro' ? `metro-${choice.metro}` : choice.row.iata}
              id={optionId(i)}
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              aria-label={choiceText(choice)}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => {
                if (i !== active) setNav({ query, index: i });
              }}
              onClick={() => void pick(choice)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void pick(choice);
              }}
              className={`flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 ${
                i === active ? 'bg-slate-900 text-white' : 'text-slate-900'
              } ${choice.kind === 'metro' ? 'border-b border-slate-200' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`w-12 shrink-0 font-mono text-sm font-semibold ${i === active ? '' : 'text-slate-700'}`}
              >
                {choice.kind === 'metro' ? choice.metro : choice.row.iata}
              </span>
              <span aria-hidden="true" className="min-w-0">
                {choice.kind === 'metro' ? (
                  <span className="font-semibold">{PLAN_COPY.metroOption(choice.city, choice.codes)}</span>
                ) : (
                  <>
                    <span className="font-medium">{shortAirportName(choice.row.name)}</span>
                    <span className={i === active ? 'text-slate-200' : 'text-slate-600'}>
                      {PLAN_COPY.placeLine(choice.row.city, choice.row.country)}
                    </span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
        {/* why: the live region is always mounted, so the searching and no-match messages put into it are announced */}
        <div aria-live="polite">
          {popupMessage !== null ? (
            <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-[0_8px_24px_-6px_rgb(15_23_42/0.25)]">
              {popupMessage}
            </div>
          ) : null}
        </div>
      </div>
      <span id={helpId} className="sr-only">
        {PLAN_COPY.airportHelp}
      </span>
      {status !== null ? (
        <p role="status" className="text-sm text-slate-700">
          {status}
        </p>
      ) : null}
      {messages.length > 0 ? (
        <div id={errorId} role="alert" className="text-sm text-red-800">
          {messages.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      ) : null}
    </fieldset>
  );
}
