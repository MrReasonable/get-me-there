import { resolveWindow } from '@gmt/core';
import { PLAN_COPY } from '../../copy/plan.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { Check, NumberField } from './fields.js';
import type { SearchForm } from './useSearchForm.js';

/**
 * More options: rolling dates instead of fixed ones (spec rev 55 §11; spec §6.1 relative window), "starts in N days,
 * lasts M days", with the dates it covers today. Switching keeps the other mode's values, so switching back loses
 * nothing (review PFT-08). A number box left blank is a "required" error that blocks estimating and saving (UI-10);
 * it is never coerced to 0.
 */
export function RollingWindowFields({ form }: { form: SearchForm }) {
  const w = form.draft.window;
  const { blank, markBlank } = form;
  return (
    <fieldset className="def-fold-group flex flex-wrap items-end gap-4">
      <legend className="def-fold-legend">{PLAN_COPY.rollingHeading}</legend>
      <span className="w-full">
        <Check
          id="w-rolling"
          label={PLAN_COPY.rollingSwitch}
          checked={w.kind === 'relative'}
          onChange={(on) => {
            for (const id of ['w-offset', 'w-length']) markBlank(id, false);
            form.setRolling(on);
          }}
        />
      </span>
      {w.kind === 'relative' ? (
        <>
          <NumberField
            id="w-offset"
            label={COPY.startOffsetDays}
            value={blank.includes('w-offset') ? undefined : w.startOffsetDays}
            errors={[
              ...form.errorsFor('window.startOffsetDays'),
              ...(blank.includes('w-offset') ? [COPY.required] : []),
            ]}
            onChange={(v) => {
              markBlank('w-offset', v === undefined);
              if (v !== undefined) form.setDraft({ ...form.draft, window: { ...w, startOffsetDays: v } });
            }}
          />
          <NumberField
            id="w-length"
            label={COPY.lengthDays}
            value={blank.includes('w-length') ? undefined : w.lengthDays}
            errors={[
              ...form.errorsFor('window.lengthDays'),
              ...(blank.includes('w-length') ? [COPY.required] : []),
            ]}
            onChange={(v) => {
              markBlank('w-length', v === undefined);
              if (v !== undefined) form.setDraft({ ...form.draft, window: { ...w, lengthDays: v } });
            }}
          />
          <ResolvedWindow form={form} />
        </>
      ) : null}
    </fieldset>
  );
}

/** "starts in 7 days, lasts 182 days: departures from 21 Oct 2026 to 20 Apr 2027, as resolved today" (PFT-08). */
function ResolvedWindow({ form }: { form: SearchForm }) {
  const w = form.draft.window;
  if (w.kind !== 'relative' || w.startOffsetDays < 1 || w.lengthDays < 1) return null;
  const r = resolveWindow(
    { kind: 'relative', startOffsetDays: w.startOffsetDays, lengthDays: w.lengthDays },
    form.today,
  );
  return (
    <p className="hint w-full">
      {PLAN_COPY.rollingResolved(
        PLAN_COPY.rollingLine(w.startOffsetDays, w.lengthDays),
        COPY.resolvedWindow(formatIsoDate(r.departureFrom), formatIsoDate(r.departureTo)),
      )}
    </p>
  );
}
