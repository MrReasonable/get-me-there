import { type IsoDate, londonDateOf } from '@gmt/core';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, type FieldError } from '../../api/client.js';
import { type DraftEstimate, useEstimateDraft } from '../../api/queries.js';
import type { AirportsResponse } from '../../api/types.js';
import { SETUP_COPY } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import { useNow } from '../../now.js';
import { suggestedName, useAirportDetails } from './airports.js';
import { DEFAULT_RELATIVE, type Draft, type DraftWindow, draftToRequest, EMPTY_ABSOLUTE } from './draft.js';
import { SCHEDULE_FIELD_ID } from './ScheduleField.js';

/** The two ends of Leave between. */
export type DateEnd = 'from' | 'to';

/** Ids of the number boxes whose "required" mark is the stay's own reason ("Enter the stay"). */
const STAY_BOXES: readonly string[] = ['n-min', 'n-max'];
/** Fields that live inside the collapsed More options fold (a 422 naming one opens it, UI-11). */
const ADVANCED_FIELDS =
  /^(name|cabin|constraints|verification|budget|providers|schedule|enabled|destinationNotes|onwardCostPence|window\.(startOffsetDays|lengthDays))/;

/** Field errors whose path is `field` or starts with `field.` (422 `details.fields`). */
const errorsIn = (errors: readonly FieldError[], field: string) =>
  errors.filter((e) => e.field === field || e.field.startsWith(`${field}.`)).map((e) => e.message);

/** A list with `id` in it or out of it, unchanged (the same array) when it already is. */
const toggled = (list: readonly string[], id: string, on: boolean): readonly string[] =>
  on ? (list.includes(id) ? list : [...list, id]) : list.includes(id) ? list.filter((x) => x !== id) : list;

/** The search form's state and what it derives (see `useSearchForm`). */
export interface SearchForm {
  draft: Draft;
  setDraft: (d: Draft) => void;
  /** The other window mode's values, kept so switching back loses nothing (review PFT-08). */
  otherWindow: DraftWindow;
  setOtherWindow: (w: DraftWindow) => void;
  /** Rolling dates on or off: the other mode's values come back. */
  setRolling: (on: boolean) => void;
  details: ReadonlyMap<string, AirportsResponse[number]>;
  setNameTouched: (touched: boolean) => void;
  /** Sets one end of Leave between to the date its picker holds ("2027-01-10"), or '' while it holds none. */
  setDate: (end: DateEnd, value: string) => void;
  today: IsoDate;
  /** The API's field errors (the estimate's or a save's 422), and the ones under one field. */
  fieldErrors: readonly FieldError[];
  setSaveErrors: (e: readonly FieldError[]) => void;
  errorsFor: (field: string) => string[];
  blank: readonly string[];
  markBlank: (id: string, on: boolean) => void;
  markIncomplete: (id: string, on: boolean) => void;
  /** The first reason the form cannot be estimated or pressed, in words; null when it is complete. */
  reason: string | null;
  /** The body to estimate and save: the draft as sent, or null while `reason` is set. */
  body: Draft | null;
  /** The estimate of exactly the current body, asked `debounceMs` after it last changed (spec rev 55 §11). */
  estimate: DraftEstimate & { refetch: () => void };
  /** Why the press is not ready, in words: `reason`, or the estimate failing, or still being worked out; else null. */
  wait: string | null;
  advancedOpen: boolean;
  setAdvancedOpen: (open: boolean) => void;
  summaryRef: RefObject<HTMLDivElement | null>;
}

/**
 * Spec rev 55 §11 (WP20 Task 20.5): the one model behind the new-search form and the Edit page. It holds the draft,
 * the name suggested from the airports until the operator types one, the two dates (each from its browser date picker,
 * so a date is always a whole calendar date or none), the blank number boxes and half-filled time windows, and derives the first reason the form is not complete ("Enter From and To", "Enter the
 * dates", …) and, when it is, the body to estimate, whose estimate it asks for after the debounce. A failed estimate's
 * 422 fields (or a save's) are shown beside the fields they name.
 */
export function useSearchForm(
  initial: Draft,
  opts: { nameTouched: boolean; debounceMs?: number | undefined; definitionId?: string | null },
): SearchForm {
  const today = londonDateOf(useNow());
  const [stored, setDraft] = useState<Draft>(initial);
  const [otherWindow, setOtherWindow] = useState<DraftWindow>(() =>
    initial.window.kind === 'relative' ? EMPTY_ABSOLUTE : DEFAULT_RELATIVE,
  );
  // why: the name follows the airports ("<from> → <to>") until the operator types one, imports the example or edits a
  // saved search; a name blurred empty follows them again
  const [nameTouched, setNameTouched] = useState(opts.nameTouched);
  const lookups = useAirportDetails([...stored.origins, ...stored.destinations]);
  const details = lookups.rows;
  // why: the name waits until every airport's lookup has answered, so it never shows a half-named route first
  const suggestion = lookups.settled ? suggestedName(stored.origins, stored.destinations, details) : null;
  // why: derived, not written back by an effect, so no edit built on an older render can drop the suggested name
  const draft: Draft = nameTouched || suggestion === null ? stored : { ...stored, name: suggestion };

  const w = draft.window;
  const relative = w.kind === 'relative';
  // why: a date field's value is the wire form or '' (a part-typed date reads as ''), so it goes into the draft as is
  const setDate = (end: DateEnd, value: string) => {
    const base = draft.window.kind === 'absolute' ? draft.window : EMPTY_ABSOLUTE;
    setDraft({ ...draft, window: { ...base, [end]: value } });
  };

  const setRolling = (on: boolean) => {
    if (on === relative) return;
    setOtherWindow(draft.window);
    setDraft({ ...draft, window: otherWindow });
  };

  const [incomplete, setIncomplete] = useState<readonly string[]>([]);
  const markIncomplete = useCallback(
    (id: string, on: boolean) => setIncomplete((prev) => toggled(prev, id, on)),
    [],
  );
  const [blank, setBlank] = useState<readonly string[]>([]);
  const markBlank = useCallback((id: string, on: boolean) => setBlank((prev) => toggled(prev, id, on)), []);

  const R = COPY.newSearch.reasons;
  const reasons = [
    ...(draft.origins.length === 0 || draft.destinations.length === 0 ? [R.airports] : []),
    ...(w.kind === 'absolute' && (w.from === '' || w.to === '') ? [R.dates] : []),
    ...(w.kind === 'absolute' && w.from !== '' && w.to !== '' && w.to < w.from ? [R.dateOrder] : []),
    ...(blank.some((id) => STAY_BOXES.includes(id)) ? [R.stay] : []),
    ...(draft.minNights > draft.maxNights ? [R.stayOrder] : []),
    ...(incomplete.some((id) => id !== SCHEDULE_FIELD_ID) ? [COPY.blockedByTimeWindow] : []),
    ...(incomplete.includes(SCHEDULE_FIELD_ID) ? [SETUP_COPY.schedule.blocked] : []),
    ...(blank.some((id) => !STAY_BOXES.includes(id)) ? [COPY.blockedByRequired] : []),
  ];
  const reason = reasons[0] ?? null;
  const body = reason === null ? draftToRequest(draft) : null;
  // why: ruling R2 — a saved search's draft is estimated as that search, by its id
  const estimate = useEstimateDraft(body, {
    ...(opts.debounceMs === undefined ? {} : { debounceMs: opts.debounceMs }),
    definitionId: opts.definitionId ?? null,
  });
  const failed = estimate.error;
  const refusedFields = failed instanceof ApiError && failed.status === 422;
  const wait =
    reason ??
    (failed !== null
      ? refusedFields
        ? R.fields
        : COPY.newSearch.estimateFailed(failed.message)
      : estimate.estimate === null
        ? COPY.newSearch.working
        : null);

  const [saveErrors, setSaveErrors] = useState<readonly FieldError[]>([]);
  const fieldErrors = saveErrors.length > 0 ? saveErrors : refusedFields ? failed.fieldErrors() : [];

  // why: the API's field errors move focus to their summary, and open the fold when one names an advanced field (UI-11)
  const summaryRef = useRef<HTMLDivElement>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const errorKey = fieldErrors.map((e) => `${e.field}:${e.message}`).join('|');
  useEffect(() => {
    if (errorKey === '') return;
    if (errorKey.split('|').some((e) => ADVANCED_FIELDS.test(e))) setAdvancedOpen(true);
    summaryRef.current?.focus();
  }, [errorKey]);

  return {
    draft,
    setDraft,
    otherWindow,
    setOtherWindow,
    setRolling,
    details,
    setNameTouched,
    setDate,
    today,
    fieldErrors,
    setSaveErrors,
    errorsFor: (field) => errorsIn(fieldErrors, field),
    blank,
    markBlank,
    markIncomplete,
    reason,
    body,
    estimate,
    wait,
    advancedOpen,
    setAdvancedOpen,
    summaryRef,
  };
}
