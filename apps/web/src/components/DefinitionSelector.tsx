import type { DefinitionResponse } from '../api/types.js';
import { COPY } from '../copy.js';
import { updateSearchParams } from '../state/urlState.js';

/** Spec §11 definition selector; writes `def=` so every view and the status bar follow it. */
export function DefinitionSelector({
  definitions,
  selectedId,
}: {
  definitions: readonly DefinitionResponse[];
  selectedId: string | null;
}) {
  if (definitions.length === 0) return <p className="text-sm text-fg-2">{COPY.noDefinitions}</p>;
  return (
    // why: at 375 px a long search name must shrink inside the header rather than widen the page (critique).
    <span className="flex min-w-0 max-w-full items-center gap-2 text-sm">
      <label htmlFor="definition-select" className="label-caps">
        {COPY.definitionSelectorLabel}
      </label>
      <select
        id="definition-select"
        value={selectedId ?? ''}
        onChange={(e) => updateSearchParams({ def: e.target.value }, 'push')}
        className="input min-h-11 min-w-0 max-w-full"
      >
        {definitions.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </span>
  );
}
