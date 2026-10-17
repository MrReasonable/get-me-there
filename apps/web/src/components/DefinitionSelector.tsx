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
  if (definitions.length === 0) return <p className="text-sm">{COPY.noDefinitions}</p>;
  return (
    <span className="flex items-center gap-2 text-sm">
      <label htmlFor="definition-select">{COPY.definitionSelectorLabel}</label>
      <select
        id="definition-select"
        value={selectedId ?? ''}
        onChange={(e) => updateSearchParams({ def: e.target.value }, 'push')}
        className="min-h-11 rounded border border-slate-400 px-1"
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
