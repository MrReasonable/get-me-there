import { microGbpToPence } from '@gmt/core';
import type { DefinitionResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp, formatPence } from '../../format.js';

const button = 'btn btn-primary min-h-11';

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
    <div role="alert" data-cost="" className="def-warn space-y-2">
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
