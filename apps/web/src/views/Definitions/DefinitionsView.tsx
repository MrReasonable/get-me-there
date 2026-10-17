import { useDefinitions, useProviders } from '../../api/queries.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { hrefWith, navigateTo, useSearchParams } from '../../state/urlState.js';
import { DefinitionForm } from './DefinitionForm.js';

/**
 * Spec §11 Definitions: pick a definition to edit or start a new one (`edit=new`, the default). It
 * edits configuration, not a run, so it has no run header; the status bar names the run here too.
 */
export function DefinitionsView() {
  const providers = useProviders();
  const definitions = useDefinitions();
  const params = useSearchParams();
  const editing = params.get('edit') ?? 'new';
  if (providers.error) return <LoadError error={providers.error} retry={() => void providers.refetch()} />;
  if (definitions.error)
    return <LoadError error={definitions.error} retry={() => void definitions.refetch()} />;
  if (providers.data === undefined || definitions.data === undefined) return <Loading />;
  const current = definitions.data.filter((d) => d.deletedAt === null);
  const existing = editing === 'new' ? null : (current.find((d) => d.id === editing) ?? null);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">{COPY.definitionsHeading}</h2>
      <ul aria-label={COPY.definitionsList} className="flex flex-wrap gap-2 text-sm">
        <li>
          <a
            href={hrefWith({ edit: 'new' })}
            onClick={navigateTo({ edit: 'new' })}
            aria-current={editing === 'new' ? 'page' : undefined}
            className="inline-flex min-h-11 items-center underline"
          >
            {COPY.newDefinition}
          </a>
        </li>
        {current.map((d) => (
          <li key={d.id}>
            <a
              href={hrefWith({ edit: d.id })}
              onClick={navigateTo({ edit: d.id })}
              aria-current={editing === d.id ? 'page' : undefined}
              className="inline-flex min-h-11 items-center underline"
            >
              {COPY.editDefinition(d.name)}
            </a>
          </li>
        ))}
      </ul>
      {/* why: keyed by the URL's edit value, so a create that stays on edit=new keeps its confirmation notice */}
      <DefinitionForm key={editing} existing={existing} providers={providers.data} />
    </div>
  );
}
