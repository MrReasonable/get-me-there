import { apiContract, type ConstraintName, type Verdict, type Verdicts } from '@gmt/core';
import { COPY } from '../copy.js';

const STYLE: Record<Verdict, string> = {
  pass: 'text-green-900',
  fail: 'font-semibold text-red-900',
  unverified: 'italic text-slate-700',
};

/**
 * Every verdict with a distinct glyph and word (spec §9 item 6), in core's constraint order. A
 * constraint the row lists as unverified but whose verdict is absent is shown as unverified, never
 * dropped, so a missing verdict can never read as satisfied (review tsr-014). `priceConfirmed` shows its
 * label alone ("price not confirmed by the final step"), never "…: unverified".
 */
export function VerdictList({
  verdicts,
  unverified,
}: {
  verdicts: Verdicts;
  unverified: readonly ConstraintName[];
}) {
  const entries = apiContract.constraintNameSchema.options.flatMap(
    (name): Array<[ConstraintName, Verdict]> => {
      const v = verdicts[name] ?? (unverified.includes(name) ? 'unverified' : undefined);
      // why: "price not confirmed by the final step" is itself the unverified statement; under any other verdict it
      // would read as a pass beside a contradicting label, so it appears only as unverified (ruling 4).
      if (name === 'priceConfirmed' && v !== 'unverified') return [];
      return v === undefined ? [] : [[name, v]];
    },
  );
  if (entries.length === 0) return <p>{COPY.noVerdicts}</p>;
  return (
    <ul aria-label={COPY.verdictsHeading} className="space-y-0.5">
      {entries.map(([name, v]) => (
        <li key={name} data-verdict={v} className={STYLE[v]}>
          <span aria-hidden="true">{COPY.verdictGlyph[v]}</span>{' '}
          {/* why: this label already says the price was not confirmed; ": unverified" after it would be a double negative (decision 44). */}
          {name === 'priceConfirmed'
            ? COPY.constraint[name]
            : COPY.verdictLine(COPY.constraint[name], COPY.verdictWord[v])}
        </li>
      ))}
    </ul>
  );
}
