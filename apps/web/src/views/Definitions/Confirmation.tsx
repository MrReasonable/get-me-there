import { microGbpToPence } from '@gmt/core';
import type { DefinitionResponse, EstimateResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp, formatPence } from '../../format.js';
import { BudgetFitPanel, EstimatePanel } from './EstimatePanel.js';

const button = 'min-h-11 rounded border border-slate-700 px-3';

/**
 * Spec §11 / §8.1, a new definition: the estimate and every budget scope, then the create click, which is
 * the explicit confirmation of the calls and the pounds it names (decisions 42–44). An estimate made for
 * an earlier draft offers no button, only "show the estimate again" (review UI-11).
 */
export function CreateConfirmation({
  estimate,
  fresh,
  blocked,
  pending,
  hardStop,
  onCreate,
}: {
  estimate: EstimateResponse;
  fresh: boolean;
  /** A field error is open: the create click is refused exactly like Show estimate and Save (ruling 6). */
  blocked: boolean;
  pending: boolean;
  /** The run budget's call cap, the runtime limit beside the estimate. */
  hardStop: number;
  onCreate: () => void;
}) {
  return (
    <>
      <EstimatePanel estimate={estimate.estimate} hardStop={hardStop} />
      <BudgetFitPanel fit={estimate.budgetFit} />
      {fresh ? (
        <button
          type="button"
          data-cost=""
          className="min-h-11 rounded bg-slate-900 px-3 text-white disabled:opacity-60"
          disabled={blocked || pending}
          aria-busy={pending ? true : undefined}
          aria-describedby={blocked ? 'd-blocked' : undefined}
          onClick={onCreate}
        >
          {pending
            ? COPY.working
            : COPY.createConfirm(
                estimate.estimate.totalCalls,
                hardStop,
                formatPence(microGbpToPence(estimate.estimate.totalCostMicroGbp)),
              )}
        </button>
      ) : (
        <p role="status" className="font-medium">
          {COPY.estimateStale}
        </p>
      )}
    </>
  );
}

/**
 * A saved definition whose estimate rose above what was confirmed (`needsConfirmation`): the new calls
 * and pounds against the old, and one click that confirms both (decisions 42, 43).
 */
export function Reconfirmation({
  definition,
  pending,
  onConfirm,
}: {
  definition: DefinitionResponse;
  pending: boolean;
  onConfirm: (v: { pence: number; calls: number }) => void;
}) {
  const n = definition.needsConfirmation;
  if (n === null) return null;
  const pence = microGbpToPence(n.estimateMicroGbp);
  return (
    <div role="alert" data-cost="" className="rounded border border-amber-700 bg-amber-50 p-2">
      <p>
        {COPY.needsConfirmation({
          calls: n.totalCalls,
          cap: definition.budget.maxCalls,
          estimate: formatMicroGbp(n.estimateMicroGbp),
          confirmed:
            n.confirmedCostPence === null
              ? COPY.none
              : COPY.confirmedWas(
                  n.confirmedCalls === null ? COPY.none : String(n.confirmedCalls),
                  formatPence(n.confirmedCostPence),
                ),
        })}
      </p>
      <button
        type="button"
        className={button}
        disabled={pending}
        aria-busy={pending ? true : undefined}
        onClick={() => onConfirm({ pence, calls: n.totalCalls })}
      >
        {pending
          ? COPY.working
          : COPY.confirmNew(n.totalCalls, definition.budget.maxCalls, formatPence(pence))}
      </button>
    </div>
  );
}
