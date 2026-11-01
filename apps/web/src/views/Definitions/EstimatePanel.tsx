import { mainPathSource, providerIdSchema } from '@gmt/core';
import type { BudgetFit } from '../../api/types.js';
import { SETUP_COPY } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp, formatPence } from '../../format.js';

const F = SETUP_COPY.definitions;
const FIT_SCOPE: Readonly<Record<string, string | undefined>> = F.fitScope;
/** The scopes counted in micro-GBP, worded as money; every other scope counts calls, pages or scrolls. */
const MONEY_SCOPES: ReadonlySet<string> = new Set(['execution-cost', 'global-month']);

/**
 * A budget-fit scope's wire label in words (spec rev 55 §11: no variable names on the main path, where Repeat weekly
 * and More options show the fit): "the Aviasales cache this month", "billed calls a run", "this month's spending". A
 * label this list does not know is shown as it came, so a new scope is never hidden.
 */
export function scopeWords(label: string): string {
  const fixed = FIT_SCOPE[label];
  if (fixed !== undefined) return fixed;
  const [kind = '', id = ''] = label.split(':');
  const provider = providerIdSchema.safeParse(id);
  if (!provider.success) return label;
  const source = mainPathSource(provider.data);
  switch (kind) {
    case 'provider-month':
      return F.fitProviderMonth(source);
    case 'provider-lifetime':
      return F.fitProviderLifetime(source);
    case 'scrolls-per-month':
      return F.fitScrolls(source);
    case 'cells-per-refresh':
      return F.fitCellsPerRefresh(source);
    default:
      return label;
  }
}

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
            {/* why: data-cost marks a cost or cap figure, never a fare (the rendered sweep's rule for "£") */}
            <span data-cost="">
              {MONEY_SCOPES.has(s.scope)
                ? F.fitLine(
                    scopeWords(s.scope),
                    formatMicroGbp(s.estimated),
                    s.cap === null ? COPY.noCap : formatMicroGbp(s.cap),
                  )
                : F.fitLine(
                    scopeWords(s.scope),
                    String(s.estimated),
                    s.cap === null ? COPY.noCap : String(s.cap),
                  )}
            </span>
            {s.fits ? null : <span className="tag tag-bad ml-1">{COPY.overCap}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
