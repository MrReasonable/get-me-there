import { apiContract } from '@gmt/core';
import type { Basis } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { updateSearchParams } from '../../state/urlState.js';

/** Spec §6.9: the basis in use, why (the API's basisReason), and a one-click switch. */
export function BasisSwitch({ basis, reason }: { basis: Basis; reason: string }) {
  return (
    // why: segmented flap tiles over real radios: the chosen tile is inverted with a bar under its label, never colour
    // alone, and the radio keeps the group's keyboard and its name
    <fieldset className="flex flex-wrap items-center gap-2 text-sm">
      <legend className="label-caps float-left mr-3 mb-0 flex min-h-11 items-center">
        {COPY.basisSwitchLabel}
      </legend>
      {apiContract.resultBasisSchema.options.map((b) => (
        <label key={b} className="seg-tile">
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
      <span className="basis-why text-fg-2">{reason}</span>
    </fieldset>
  );
}
