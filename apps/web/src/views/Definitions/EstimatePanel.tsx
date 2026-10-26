import type { BudgetFit, Estimate } from '../../api/types.js';
import { SETUP_COPY } from '../../copy/setup.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp, formatSeconds } from '../../format.js';

/** Spec §11: the estimate shown before the operator confirms (POST /api/definitions/estimate for an unsaved body). */
/** `hardStop` is the run budget's call cap, the runtime limit beside the estimate (decision 44). */
export function EstimatePanel({ estimate, hardStop }: { estimate: Estimate; hardStop: number }) {
  const e = estimate;
  // why: with a 0 call cap the billed source's estimated calls never run; say how many, and the number to raise it to.
  const billed = e.perProvider.filter((p) => p.providerId === 'searchapi').reduce((a, p) => a + p.calls, 0);
  return (
    <section
      data-cost=""
      aria-label={COPY.estimateHeading}
      className="space-y-1 rounded border border-slate-300 p-2 text-sm"
    >
      <h3 className="font-semibold">{COPY.estimateHeading}</h3>
      {/* why: a run whose every line a cap blocks estimates 0 s; "takes about 0s" would read as a real duration */}
      {e.seconds > 0 ? (
        <p className="font-medium">{SETUP_COPY.definitions.runTakes(formatSeconds(e.seconds))}</p>
      ) : null}
      <p>
        <span>{COPY.estimateCells(e.cells)}</span>{' '}
        <span className="text-slate-700">{SETUP_COPY.definitions.estimateCellsHint}</span>
      </p>
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
      {hardStop === 0 && billed > 0 ? (
        <p className="rounded border border-amber-600 bg-amber-50 p-2">
          {SETUP_COPY.definitions.hardStopZero(billed)}
        </p>
      ) : null}
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
  // why: a weekly cron runs 4.33… times a month; one decimal reads, sixteen do not (seen at 1440 px).
  const runs = Math.round(fit.runsPerMonth * 10) / 10;
  return (
    <div role={fit.fits ? undefined : 'alert'} className="text-sm">
      <p className={fit.fits ? '' : 'font-semibold'}>
        {fit.fits ? COPY.budgetFitOk(runs) : COPY.budgetFitWarn(runs)}
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
