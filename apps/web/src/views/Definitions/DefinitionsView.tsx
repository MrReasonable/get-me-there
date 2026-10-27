import { useDefinitions, useProviders } from '../../api/queries.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { PLAN_COPY } from '../../copy/plan.js';
import { hrefWith, navigateTo, useSearchParams } from '../../state/urlState.js';
import { DefinitionForm } from './DefinitionForm.js';

/**
 * Spec §11 Definitions, shown to the operator as "Searches": pick a search to edit or start a new one (`edit=new`, the default). It
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
  // why: an old link to a deleted or unknown definition must not look like a fresh create form (a duplicate waiting to happen).
  const missing = editing !== 'new' && existing === null;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{PLAN_COPY.viewHeading}</h2>
      {missing ? <p role="alert">{PLAN_COPY.notFound}</p> : null}
      <ul aria-label={PLAN_COPY.searchList} className="flex flex-wrap gap-2 text-sm">
        <li>
          <a
            href={hrefWith({ edit: 'new' })}
            onClick={navigateTo({ edit: 'new' })}
            aria-current={editing === 'new' ? 'page' : undefined}
            className="inline-flex min-h-11 items-center underline"
          >
            {PLAN_COPY.newSearch}
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
              {PLAN_COPY.editSearch(d.name)}
            </a>
          </li>
        ))}
      </ul>
      {/* why: keyed by the URL's edit value, so a create that stays on edit=new keeps its confirmation notice */}
      {missing ? null : <DefinitionForm key={editing} existing={existing} providers={providers.data} />}
    </div>
  );
}
