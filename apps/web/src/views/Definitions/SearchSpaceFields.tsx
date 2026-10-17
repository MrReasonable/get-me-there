import { apiContract, londonDateOf, resolveWindow } from '@gmt/core';
import type { Dispatch, SetStateAction } from 'react';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { useNow } from '../../now.js';
import type { Draft, DraftWindow } from './draft.js';
import { NumberField } from './fields.js';

const input = 'min-h-11 rounded border border-slate-400 px-1';

/** "departures from 21 Oct 2026 to 20 Apr 2027, as resolved today" under the relative fields (review PFT-08). */
function ResolvedWindow({ window: w }: { window: DraftWindow }) {
  const now = useNow();
  if (w.kind !== 'relative' || w.startOffsetDays < 1 || w.lengthDays < 1) return null;
  const r = resolveWindow(
    { kind: 'relative', startOffsetDays: w.startOffsetDays, lengthDays: w.lengthDays },
    londonDateOf(now),
  );
  return (
    <p className="w-full text-xs">
      {COPY.resolvedWindow(formatIsoDate(r.departureFrom), formatIsoDate(r.departureTo))}
    </p>
  );
}

/**
 * The search space: window (relative or absolute), nights and cabin. A number box left blank is a "required"
 * error that blocks estimating and saving (UI-10); it is never coerced to 0.
 */
export function SearchSpaceFields({
  draft,
  setDraft,
  otherWindow,
  setOtherWindow,
  errorsFor,
  blank,
  markBlank,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  otherWindow: DraftWindow;
  setOtherWindow: Dispatch<SetStateAction<DraftWindow>>;
  errorsFor: (field: string) => string[];
  blank: readonly string[];
  markBlank: (id: string, blank: boolean) => void;
}) {
  const w = draft.window;
  // why: switching the window mode keeps the other mode's values, so toggling back loses nothing (review PFT-08).
  const switchWindow = () => {
    setOtherWindow(w);
    setDraft({ ...draft, window: otherWindow });
    for (const id of ['w-offset', 'w-length']) markBlank(id, false);
  };
  return (
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="font-semibold">{COPY.windowHeading}</legend>
      <span className="flex min-h-11 items-center gap-1">
        <input
          id="w-relative"
          type="radio"
          name="window"
          checked={w.kind === 'relative'}
          onChange={switchWindow}
        />
        <label htmlFor="w-relative">{COPY.windowRelative}</label>
      </span>
      <span className="flex min-h-11 items-center gap-1">
        <input
          id="w-absolute"
          type="radio"
          name="window"
          checked={w.kind === 'absolute'}
          onChange={switchWindow}
        />
        <label htmlFor="w-absolute">{COPY.windowAbsolute}</label>
      </span>
      {w.kind === 'relative' ? (
        <>
          <NumberField
            id="w-offset"
            label={COPY.startOffsetDays}
            value={blank.includes('w-offset') ? undefined : w.startOffsetDays}
            errors={[
              ...errorsFor('window.startOffsetDays'),
              ...(blank.includes('w-offset') ? [COPY.required] : []),
            ]}
            onChange={(v) => {
              markBlank('w-offset', v === undefined);
              if (v !== undefined) setDraft({ ...draft, window: { ...w, startOffsetDays: v } });
            }}
          />
          <NumberField
            id="w-length"
            label={COPY.lengthDays}
            value={blank.includes('w-length') ? undefined : w.lengthDays}
            errors={[
              ...errorsFor('window.lengthDays'),
              ...(blank.includes('w-length') ? [COPY.required] : []),
            ]}
            onChange={(v) => {
              markBlank('w-length', v === undefined);
              if (v !== undefined) setDraft({ ...draft, window: { ...w, lengthDays: v } });
            }}
          />
          <ResolvedWindow window={w} />
        </>
      ) : (
        <>
          <span className="flex flex-col">
            <label htmlFor="w-from">{COPY.windowFrom}</label>
            <input
              id="w-from"
              type="date"
              className={input}
              value={w.from}
              onChange={(e) => setDraft({ ...draft, window: { ...w, from: e.target.value } })}
            />
          </span>
          <span className="flex flex-col">
            <label htmlFor="w-to">{COPY.windowTo}</label>
            <input
              id="w-to"
              type="date"
              className={input}
              value={w.to}
              onChange={(e) => setDraft({ ...draft, window: { ...w, to: e.target.value } })}
            />
          </span>
        </>
      )}
      <NumberField
        id="n-min"
        label={COPY.minNights}
        value={blank.includes('n-min') ? undefined : draft.minNights}
        errors={[...errorsFor('minNights'), ...(blank.includes('n-min') ? [COPY.required] : [])]}
        onChange={(v) => {
          markBlank('n-min', v === undefined);
          if (v !== undefined) setDraft({ ...draft, minNights: v });
        }}
      />
      <NumberField
        id="n-max"
        label={COPY.maxNights}
        value={blank.includes('n-max') ? undefined : draft.maxNights}
        errors={[...errorsFor('maxNights'), ...(blank.includes('n-max') ? [COPY.required] : [])]}
        onChange={(v) => {
          markBlank('n-max', v === undefined);
          if (v !== undefined) setDraft({ ...draft, maxNights: v });
        }}
      />
      <span className="flex flex-col">
        <label htmlFor="d-cabin">{COPY.cabin}</label>
        <select
          id="d-cabin"
          className={input}
          value={draft.cabin}
          onChange={(e) => {
            const cabin = apiContract.cabinSchema.safeParse(e.target.value);
            if (cabin.success) setDraft({ ...draft, cabin: cabin.data });
          }}
        >
          {apiContract.cabinSchema.options.map((c) => (
            <option key={c} value={c}>
              {COPY.cabinName[c]}
            </option>
          ))}
        </select>
      </span>
    </fieldset>
  );
}
