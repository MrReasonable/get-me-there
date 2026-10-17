import { useDefinitions, useProviders } from './api/queries.js';
import { AppBoundary } from './components/AppBoundary.js';
import { DefinitionSelector } from './components/DefinitionSelector.js';
import { LoadError, Loading } from './components/LoadState.js';
import { Nav } from './components/Nav.js';
import { StatusBar } from './components/StatusBar.js';
import { SyntheticBanner } from './components/SyntheticBanner.js';
import { COPY } from './copy.js';
import { useSearchParams } from './state/urlState.js';
import { parseView } from './state/view.js';
import { AlertsView } from './views/Alerts/index.js';
import { CalendarView } from './views/Calendar/CalendarView.js';
import { CoverageView } from './views/Coverage/CoverageView.js';
import { DefinitionsView } from './views/Definitions/DefinitionsView.js';
import { DurationView } from './views/Duration/DurationView.js';
import { HistoryView } from './views/History/HistoryView.js';
import { ProvidersView } from './views/Providers/ProvidersView.js';
import { ResultsView } from './views/Results/ResultsView.js';

/**
 * Spec §11 layout: synthetic banner, header with nav and definition selector, status bar on every
 * view. When /providers fails, the page says provider status is unknown instead of silently showing
 * no banner (decision 36); the shell and the views each sit inside a boundary, so a render error never blanks the page.
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
  // why: until /providers answers (or fails, which the page then says), the page cannot tell whether its prices are
  // synthetic, so no price view renders: a fixture price must never look real for the moment before the banner.
  const providerStatusKnown = providers.data !== undefined || providers.error !== null;
  const needsDefinition =
    view === 'results' ||
    view === 'coverage' ||
    view === 'calendar' ||
    view === 'duration' ||
    view === 'history' ||
    view === 'alerts';
  // why: two boundaries. The outer one wraps the whole shell, so a render error in the banners, the header (Nav, the
  // definition selector) or the status bar shows a message instead of a blank page (CodeRabbit batch 3); the inner one
  // keeps a failing view from taking the nav and status bar with it.
  return (
    <AppBoundary>
      <div className="min-h-screen bg-white text-slate-900">
        {providers.data?.synthetic === true ? <SyntheticBanner /> : null}
        {providers.error ? (
          <p role="alert" className="bg-red-100 px-4 py-2 font-semibold text-red-900">
            {COPY.providersUnknown(providers.error.message)}
          </p>
        ) : null}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-white focus:p-2 focus:underline"
        >
          {COPY.skipToContent}
        </a>
        <header className="flex flex-wrap items-center gap-4 border-b border-slate-300 px-4 py-2">
          <h1 className="text-lg font-bold">{COPY.appTitle}</h1>
          <Nav current={view} />
          <DefinitionSelector definitions={list} selectedId={selectedId} />
        </header>
        <StatusBar definition={selected} showRunNow={view === 'results' || view === 'definitions'} />
        <main id="main" tabIndex={-1} className="px-4 py-3">
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
            {needsDefinition && selected !== null && !providerStatusKnown ? <Loading /> : null}
            {view === 'results' && selected !== null && providerStatusKnown ? (
              <ResultsView definition={selected} />
            ) : null}
            {view === 'coverage' && selected !== null && providerStatusKnown ? (
              <CoverageView definition={selected} />
            ) : null}
            {view === 'calendar' && selected !== null && providerStatusKnown ? (
              // why: a new definition starts with no panel open and its own filter defaults.
              <CalendarView key={selected.id} definition={selected} />
            ) : null}
            {view === 'duration' && selected !== null && providerStatusKnown ? (
              <DurationView definition={selected} />
            ) : null}
            {view === 'history' && selected !== null && providerStatusKnown ? (
              <HistoryView definition={selected} />
            ) : null}
            {view === 'alerts' && selected !== null && providerStatusKnown ? (
              <AlertsView definitionId={selected.id} />
            ) : null}
            {view === 'definitions' ? <DefinitionsView /> : null}
            {view === 'providers' ? <ProvidersView /> : null}
          </AppBoundary>
        </main>
      </div>
    </AppBoundary>
  );
}
