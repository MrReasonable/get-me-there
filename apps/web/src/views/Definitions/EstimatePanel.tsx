import type { BudgetFit, Estimate } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp, formatSeconds } from '../../format.js';

/** Spec §11: the estimate shown before the operator confirms (POST /api/definitions/estimate for an unsaved body). */
/** `hardStop` is the run budget's call cap, the runtime limit beside the estimate (decision 44). */
export function EstimatePanel({ estimate, hardStop }: { estimate: Estimate; hardStop: number }) {
  const e = estimate;
  return (
    <section
      data-cost=""
      aria-label={COPY.estimateHeading}
      className="space-y-1 rounded border border-slate-300 p-2 text-sm"
    >
      <h3 className="font-semibold">{COPY.estimateHeading}</h3>
      <p>{COPY.estimateCells(e.cells)}</p>
      <ul>
        {e.perProvider.map((p) => (
          <li key={`${p.providerId}-${p.stage}`}>
            {COPY.estimateRow(
              COPY.provider[p.providerId],
              COPY.stageName[p.stage],
              p.calls,
              formatMicroGbp(p.costMicroGbp),
              formatSeconds(p.seconds),
            )}
            {p.blocked !== null ? (
              <span className="ml-1 font-semibold">{COPY.estimateBlocked(p.blocked)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="font-medium">
        {COPY.estimateTotal(
          e.totalCalls,
          hardStop,
          formatMicroGbp(e.totalCostMicroGbp),
          formatSeconds(e.seconds),
        )}
      </p>
      {e.windowClamped ? <p>{COPY.windowClamped}</p> : null}
      {e.assumptions.length > 0 ? (
        <div>
          <p>{COPY.assumptions}</p>
          <ul className="list-disc pl-5">
            {e.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Spec §8.2 budgetFit: runs per month × estimate against every cap, every scope listed whether it
 * fits or not, so the calls a month commits against each provider-month cap are visible before the
 * click (review po-010); a miss is an alert.
 */
export function BudgetFitPanel({ fit }: { fit: BudgetFit }) {
  return (
    <div role={fit.fits ? undefined : 'alert'} className="text-sm">
      <p className={fit.fits ? '' : 'font-semibold'}>
        {fit.fits ? COPY.budgetFitOk(fit.runsPerMonth) : COPY.budgetFitWarn(fit.runsPerMonth)}
      </p>
      <ul>
        {fit.perScope.map((s) => (
          <li key={s.scope}>
            {COPY.budgetScope(s.scope, s.estimated, s.cap === null ? COPY.noCap : String(s.cap))}
            {s.fits ? null : <span className="ml-1 font-semibold">{COPY.overCap}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
