import { apiContract } from '@gmt/core';
import type { Basis } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { updateSearchParams } from '../../state/urlState.js';

/** Spec §6.9: the basis in use, why (the API's basisReason), and a one-click switch. */
export function BasisSwitch({ basis, reason }: { basis: Basis; reason: string }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-sm">
      <legend className="font-semibold">{COPY.basisSwitchLabel}</legend>
      {apiContract.resultBasisSchema.options.map((b) => (
        <label key={b} className="flex min-h-11 items-center gap-1">
          <input
            type="radio"
            name="basis"
            value={b}
            checked={basis === b}
            onChange={() => updateSearchParams({ basis: b }, 'push')}
          />
          {COPY.basisName[b]}
        </label>
      ))}
      <span className="text-slate-700">{reason}</span>
    </fieldset>
  );
}
