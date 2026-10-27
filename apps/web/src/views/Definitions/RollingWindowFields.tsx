import { londonDateOf, resolveWindow } from '@gmt/core';
import { PLAN_COPY } from '../../copy/plan.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { useNow } from '../../now.js';
import type { DraftWindow } from './draft.js';
import { NumberField } from './fields.js';

/** "departures from 21 Oct 2026 to 20 Apr 2027, as resolved today" under the rolling numbers (review PFT-08). */
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
 * More options: the rolling window's own numbers (spec §11 relative window), for a start or length the quick choices
 * do not offer. Shown only while the window rolls; fixed dates are set above. A number box left blank is a
 * "required" error that blocks estimating and saving (UI-10); it is never coerced to 0.
 */
export function RollingWindowFields({
  window: w,
  setWindow,
  errorsFor,
  blank,
  markBlank,
}: {
  window: DraftWindow;
  setWindow: (w: DraftWindow) => void;
  errorsFor: (field: string) => string[];
  blank: readonly string[];
  markBlank: (id: string, blank: boolean) => void;
}) {
  if (w.kind !== 'relative') return null;
  return (
    <fieldset className="flex flex-wrap items-end gap-3">
      <legend className="font-semibold">{PLAN_COPY.rollingHeading}</legend>
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
          if (v !== undefined) setWindow({ ...w, startOffsetDays: v });
        }}
      />
      <NumberField
        id="w-length"
        label={COPY.lengthDays}
        value={blank.includes('w-length') ? undefined : w.lengthDays}
        errors={[...errorsFor('window.lengthDays'), ...(blank.includes('w-length') ? [COPY.required] : [])]}
        onChange={(v) => {
          markBlank('w-length', v === undefined);
          if (v !== undefined) setWindow({ ...w, lengthDays: v });
        }}
      />
      <ResolvedWindow window={w} />
    </fieldset>
  );
}
