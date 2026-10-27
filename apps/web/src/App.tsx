import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDefinitions, useProviders } from './api/queries.js';
import { AppBoundary } from './components/AppBoundary.js';
import { DefinitionSelector } from './components/DefinitionSelector.js';
import { LoadError, Loading } from './components/LoadState.js';
import { Nav } from './components/Nav.js';
import { StatusBar } from './components/StatusBar.js';
import { SyntheticBanner } from './components/SyntheticBanner.js';
import { COPY } from './copy.js';
import { land } from './state/landing.js';
import { parseDetailPair } from './state/resultsState.js';
import { updateSearchParams, useSearchParams } from './state/urlState.js';
import type { ViewId } from './state/view.js';
import { AlertsView } from './views/Alerts/index.js';
import { DatesView } from './views/Dates/DatesView.js';
import { DefinitionsView } from './views/Definitions/DefinitionsView.js';
import { HistoryView } from './views/History/HistoryView.js';
import { ProvidersView } from './views/Providers/ProvidersView.js';
import { ResultsView } from './views/Results/ResultsView.js';
import { RowLanding } from './views/Results/RowLanding.js';
import { StatusView } from './views/Status.js';

/** The views that need no definition (spec §11: the Set up views other than Alerts). */
const NO_DEFINITION: ReadonlySet<ViewId> = new Set(['definitions', 'providers', 'status']);

/**
 * Spec §11 layout: synthetic banner, header with nav and definition selector, status bar on every
 * view. When /providers fails, the page says provider status is unknown instead of silently showing
 * no banner (decision 36); the shell and the views each sit inside a boundary, so a render error never blanks the page.
 */
export function App() {
  const params = useSearchParams();
  const providers = useProviders();
  const definitions = useDefinitions();
  const list = useMemo(
    () => (definitions.data ?? []).filter((d) => d.deletedAt === null),
    [definitions.data],
  );
  const requested = params.get('def');
  const selectedId = requested ?? list[0]?.id ?? null;
  const selected = list.find((d) => d.id === selectedId) ?? null;
  // why: spec §11 URLs (WP19 Task 19.7): the retired views and a Results URL without a date pair land on Dates, an old
  // alert link's row= is looked up; the view drawn follows the landing at once, and the URL is rewritten to it
  const landing = useMemo(() => land(params, selected), [params, selected]);
  const view: ViewId = landing.kind === 'view' ? landing.view : 'results';
  // why: Results is the date pair detail (spec §11, WP19 Task 19.6): it renders only for a well-formed date pair
  const datePair = parseDetailPair(params);
  // why: the rewrite waits for the definitions, so a Calendar link's cal.dest is judged against the selected one
  const definitionsKnown = definitions.data !== undefined || definitions.error !== null;
  useEffect(() => {
    if (definitionsKnown && landing.kind === 'view' && Object.keys(landing.patch).length > 0)
      updateSearchParams(landing.patch, 'replace');
  }, [definitionsKnown, landing]);
  // why: a row lookup that found nothing lands on Dates with a line saying why; it stays while the URL is the one the
  // lookup wrote, and goes with the operator's next change
  const [notice, setNotice] = useState<{ search: string; text: string } | null>(null);
  const onLand = useCallback((patch: Record<string, string | null>, text: string | null) => {
    updateSearchParams(patch, 'replace');
    setNotice(
      text === null ? null : { search: new URLSearchParams(window.location.search).toString(), text },
    );
  }, []);
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  // why: until /providers answers (or fails, which the page then says), the page cannot tell whether its prices are
  // synthetic, so no price view renders: a fixture price must never look real for the moment before the banner.
  const providerStatusKnown = providers.data !== undefined || providers.error !== null;
  // why: a view is drawn once the URL says what it shows, so a retired link never reads the unfiltered Dates first
  const landed = landing.kind === 'row-lookup' || Object.keys(landing.patch).length === 0;
  const show = (v: ViewId) => landed && view === v;
  const needsDefinition = !NO_DEFINITION.has(view);
  // why: spec §11 Dates "No search yet": with no definition at all the Dates view says so itself, linking to Definitions
  const datesWithoutSearch = show('dates') && definitions.data !== undefined && list.length === 0;
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
          {/* why: only a successful load can say there are no definitions; while loading or after a failure (shown with
          a retry in the main region) the selector waits (CodeRabbit batch 3) */}
          {definitions.data !== undefined ? (
            <DefinitionSelector definitions={list} selectedId={selectedId} />
          ) : null}
        </header>
        <StatusBar
          definition={selected}
          showRunNow={view === 'dates' || view === 'definitions'}
          viewOwnsFirstRun={view === 'dates'}
        />
        <main id="main" tabIndex={-1} className="px-4 py-3">
          <AppBoundary>
            {noProviders ? (
              <p className="mb-3 rounded border border-slate-400 p-3">{COPY.emptyNoProviders}</p>
            ) : null}
            {definitions.error ? (
              <LoadError error={definitions.error} retry={() => void definitions.refetch()} />
            ) : null}
            {/* why: PR #3 review — until the definitions answer, the selector is hidden and nothing is selected, so the
            region says it is loading rather than staying blank */}
            {needsDefinition && definitions.isPending ? <Loading /> : null}
            {needsDefinition && definitions.data !== undefined && selected === null && !datesWithoutSearch ? (
              <p>{requested !== null ? COPY.definitionNotFound : COPY.noDefinitions}</p>
            ) : null}
            {needsDefinition && selected !== null && !providerStatusKnown ? <Loading /> : null}
            {!landed && definitionsKnown ? <Loading /> : null}
            {datesWithoutSearch ? <DatesView definition={null} /> : null}
            {show('dates') && notice !== null && notice.search === params.toString() ? (
              <p role="status" className="mb-3 rounded border border-slate-400 p-2">
                {notice.text}
              </p>
            ) : null}
            {show('dates') && selected !== null && providerStatusKnown ? (
              <DatesView definition={selected} />
            ) : null}
            {landing.kind === 'row-lookup' && selected !== null && providerStatusKnown ? (
              <RowLanding definition={selected} row={landing.row} basis={landing.basis} onLand={onLand} />
            ) : null}
            {show('results') &&
            landing.kind === 'view' &&
            selected !== null &&
            providerStatusKnown &&
            datePair !== null ? (
              <ResultsView
                key={`${selected.id}|${datePair.departureDate}|${datePair.returnDate}`}
                definition={selected}
                datePair={datePair}
              />
            ) : null}
            {show('history') && selected !== null && providerStatusKnown ? (
              <HistoryView definition={selected} />
            ) : null}
            {show('alerts') && selected !== null && providerStatusKnown ? (
              <AlertsView definitionId={selected.id} />
            ) : null}
            {show('definitions') ? <DefinitionsView /> : null}
            {show('providers') ? <ProvidersView /> : null}
            {show('status') ? <StatusView /> : null}
          </AppBoundary>
        </main>
      </div>
    </AppBoundary>
  );
}
