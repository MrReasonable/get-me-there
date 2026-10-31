import type { BudgetFit } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatPence } from '../../format.js';

/**
 * The estimate panel's one cost formatter (spec rev 55 §11): the estimate sentence beside Search now, its notes and the
 * press's label format money through this alone (`sourceGuard.test.ts`). Pounds and pence always ("about £1.20",
 * "your £1.00 check"), so an amount beside another with pence reads alike.
 */
export const estimateMoney = (pence: number): string => formatPence(pence, { showPence: true });

/**
 * Spec §8.2 budgetFit: runs per month × estimate against every cap, every scope listed whether it
 * fits or not, so the calls a month commits against each provider-month cap are visible before the
 * click (review po-010); a miss is an alert.
 */
export function BudgetFitPanel({ fit }: { fit: BudgetFit }) {
  // why: a weekly cron runs 4.33… times a month; one decimal reads, sixteen do not (seen at 1440 px).
  const runs = Math.round(fit.runsPerMonth * 10) / 10;
  return (
    <div role={fit.fits ? undefined : 'alert'} className="space-y-1 text-sm">
      <p className={fit.fits ? 'font-semibold' : 'bad-text'}>
        {fit.fits ? COPY.budgetFitOk(runs) : COPY.budgetFitWarn(runs)}
      </p>
      <ul>
        {fit.perScope.map((s) => (
          <li key={s.scope}>
            {COPY.budgetScope(s.scope, s.estimated, s.cap === null ? COPY.noCap : String(s.cap))}
            {s.fits ? null : <span className="tag tag-bad ml-1">{COPY.overCap}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
