import { useDefinitions, useProviders } from './api/queries.js';
import { AppBoundary } from './components/AppBoundary.js';
import { DefinitionSelector } from './components/DefinitionSelector.js';
import { LoadError } from './components/LoadState.js';
import { Nav } from './components/Nav.js';
import { SyntheticBanner } from './components/SyntheticBanner.js';
import { COPY } from './copy.js';
import { useSearchParams } from './state/urlState.js';
import { parseView } from './state/view.js';
import { Placeholder } from './views/Placeholder.js';

/**
 * Spec §11 layout: synthetic banner, header with nav and definition selector. When /providers fails,
 * the page says provider status is unknown instead of silently showing no banner (decision 36); the
 * views stay inside a boundary so a render error never blanks the page. This task's version shows a
 * placeholder for every view; Task 9.13 gives the final file, with the status bar and the views.
 */
export function App() {
  const params = useSearchParams();
  const view = parseView(params.get('view'));
  const providers = useProviders();
  const definitions = useDefinitions();
  const list = (definitions.data ?? []).filter((d) => d.deletedAt === null);
  const requested = params.get('def');
  const selectedId = requested ?? list[0]?.id ?? null;
  const selected = list.find((d) => d.id === selectedId) ?? null;
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  const needsDefinition = view === 'results' || view === 'coverage';
  return (
    <div className="min-h-screen bg-white text-slate-900">
      {providers.data?.synthetic === true ? <SyntheticBanner /> : null}
      {providers.error ? (
        <p role="alert" className="bg-red-100 px-4 py-2 font-semibold text-red-900">
          {COPY.providersUnknown(providers.error.message)}
        </p>
      ) : null}
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-300 px-4 py-2">
        <h1 className="text-lg font-bold">{COPY.appTitle}</h1>
        <Nav current={view} />
        <DefinitionSelector definitions={list} selectedId={selectedId} />
      </header>
      <main className="px-4 py-3">
        <AppBoundary>
          {noProviders ? (
            <p className="mb-3 rounded border border-slate-400 p-3">{COPY.emptyNoProviders}</p>
          ) : null}
          {definitions.error ? (
            <LoadError error={definitions.error} retry={() => void definitions.refetch()} />
          ) : null}
          {needsDefinition && definitions.data !== undefined && selected === null ? (
            <p>{requested !== null ? COPY.definitionNotFound : COPY.noDefinitions}</p>
          ) : null}
          {needsDefinition && selected === null ? null : (
            <Placeholder hint={view === 'calendar' ? COPY.calendarPlaceholderHint : null} />
          )}
        </AppBoundary>
      </main>
    </div>
  );
}
