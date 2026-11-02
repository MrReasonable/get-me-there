import { useDefinitions, useProviders } from '../../api/queries.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { PLAN_COPY } from '../../copy/plan.js';
import { COPY } from '../../copy.js';
import { hrefWith, navigateTo, useSearchParams } from '../../state/urlState.js';
import { NewSearchForm } from '../Searches/NewSearchForm.js';
import { DefinitionForm } from './DefinitionForm.js';
import './definitions.css';

/**
 * Spec rev 55 §11 Edit (`?view=definitions&edit=<id>`; WP20 Task 20.5): the search's fields as the new-search form shows
 * them, ending with Save and search again and Save. It edits configuration, not a run, so it has no run header; the
 * status bar names the run here too. The new-search form lives on Searches, the first screen; an old `edit=new` link
 * still shows it here rather than an error.
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
  if (editing === 'new')
    return (
      <div className="space-y-5 pt-6">
        <h2 className="h-view">{COPY.searchesView.sideHeading}</h2>
        <NewSearchForm providers={providers.data} />
      </div>
    );
  const existing = definitions.data.find((d) => d.id === editing && d.deletedAt === null) ?? null;
  return (
    <div className="space-y-5 pt-6">
      <h2 className="h-view">
        {existing === null ? PLAN_COPY.viewHeading : COPY.editSearch.heading(existing.name)}
      </h2>
      {/* why: an old link to a deleted or unknown search must not look like a fresh form (a duplicate waiting to happen) */}
      {existing === null ? (
        <p role="alert" className="plate notice font-semibold text-bad">
          {PLAN_COPY.notFound}{' '}
          <a
            href={hrefWith({ view: 'searches', edit: null })}
            onClick={navigateTo({ view: 'searches', edit: null })}
          >
            {PLAN_COPY.viewHeading}
          </a>
        </p>
      ) : (
        // why: keyed by the search, so opening another one starts from its own fields
        <DefinitionForm key={existing.id} existing={existing} providers={providers.data} />
      )}
    </div>
  );
}
