import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDefinitions, useProviders } from './api/queries.js';
import { AppBoundary } from './components/AppBoundary.js';
import { LoadError, Loading } from './components/LoadState.js';
import { Nav } from './components/Nav.js';
import { StatusBar } from './components/StatusBar.js';
import { SyntheticBanner } from './components/SyntheticBanner.js';
import { COPY } from './copy.js';
import { Flaps } from './flaps/Flaps.js';
import { type Landing, land } from './state/landing.js';
import { useLastSearch } from './state/lastSearch.js';
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
import { SearchesView } from './views/Searches/SearchesView.js';
import { StatusView } from './views/Status.js';

/** The views that need no definition (spec §11: the Set up views other than Alerts). */
const NO_DEFINITION: ReadonlySet<ViewId> = new Set(['searches', 'definitions', 'providers', 'status']);

/**
 * Spec rev 55 §11 layout: synthetic banner, header with the nav (no search selector: every action lives on the search it
 * acts on), status bar on every view. When /providers fails, the page says provider status is unknown instead of silently showing
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
  const lastId = useLastSearch();
  // why: `def=` names the page's search; with none, a view that needs one (History, Alerts) takes the search last
  // opened, else the first, and a search's page without `def=` lands on Searches (below)
  const selectedId = requested ?? (list.some((d) => d.id === lastId) ? lastId : null) ?? list[0]?.id ?? null;
  const selected = list.find((d) => d.id === selectedId) ?? null;
  // why: the nav names the search last opened (spec rev 55 §11); it is absent until one has been, or once it is gone
  const lastOpened = list.find((d) => d.id === lastId) ?? null;
  // why: spec §11 URLs (WP20 Task 20.3): an absent or unknown view, a search's page without def= and an Edit page without
  // edit= land on Searches; the retired views and a Results URL without a date pair land on a search's page, which with
  // no def= is Searches too. The view drawn follows the landing at once, and the URL is rewritten to it
  const landing: Landing = useMemo(() => land(params, selected), [params, selected]);
  const view: ViewId = landing.kind === 'view' ? landing.view : 'results';
  // why: Results is the date pair detail (spec §11, WP19 Task 19.6): it renders only for a well-formed date pair
  const datePair = parseDetailPair(params);
  // why: the rewrite waits for the definitions, so a Calendar link's cal.dest is judged against the selected one
  const definitionsKnown = definitions.data !== undefined || definitions.error !== null;
  // why: a landing on Searches needs no definition to be judged, so it is written at once
  const rewriteReady = definitionsKnown || (landing.kind === 'view' && landing.view === 'searches');
  useEffect(() => {
    if (rewriteReady && landing.kind === 'view' && Object.keys(landing.patch).length > 0)
      updateSearchParams(landing.patch, 'replace');
  }, [rewriteReady, landing]);
  // why: a row lookup that found nothing lands on Dates with a line saying why; it stays while the URL is the one the
  // lookup wrote, and goes with the operator's next change
  const [notice, setNotice] = useState<{ search: string; text: string } | null>(null);
  const onLand = useCallback((patch: Record<string, string | null>, text: string | null) => {
    updateSearchParams(patch, 'replace');
    setNotice(
      text === null ? null : { search: new URLSearchParams(window.location.search).toString(), text },
    );
  }, []);
  const editing = params.get('edit');
  const barSearch =
    view === 'dates' || view === 'results'
      ? selected
      : view === 'definitions'
        ? (list.find((d) => d.id === editing) ?? null)
        : null;
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
  // why: two boundaries. The outer one wraps the whole shell, so a render error in the banners, the header (Nav) or the status bar shows a message instead of a blank page (CodeRabbit batch 3); the inner one
  // keeps a failing view from taking the nav and status bar with it.
  return (
    <AppBoundary>
      <div className="min-h-screen">
        {providers.data?.synthetic === true ? <SyntheticBanner /> : null}
        {providers.error ? (
          <p role="alert" className="alarm px-[var(--gutter)] py-2">
            {COPY.providersUnknown(providers.error.message)}
          </p>
        ) : null}
        <a href="#main" className="skip-link">
          {COPY.skipToContent}
        </a>
        <div className="steel-strip topbar">
          <header className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <h1 className="brand">
              {/* why: the name is the heading's words; on a phone, where flap cells would be too small to read, the
              words are shown in painted caps and the cells hidden */}
              <span className="brand-words">{COPY.appTitle}</span>
              <Flaps text={COPY.appTitle} className="brand-flaps" />
            </h1>
            <Nav
              current={view}
              search={lastOpened === null ? null : { id: lastOpened.id, name: lastOpened.name }}
            />
          </header>
          <div className="statusbar-row">
            {/* why: ruling R-bar — the bar follows the search the view shows (its page and detail by `def=`, the Edit page by
            `edit=`), with Cancel and Resume; on every other view it follows any search's run, named, with no controls */}
            <StatusBar definition={barSearch} />
          </div>
        </div>
        <main id="main" tabIndex={-1} className="view-main pt-5">
          <AppBoundary>
            {noProviders ? <p className="plate notice mb-4">{COPY.emptyNoProviders}</p> : null}
            {definitions.error ? (
              <LoadError error={definitions.error} retry={() => void definitions.refetch()} />
            ) : null}
            {/* why: PR #3 review — until the definitions answer, the selector is hidden and nothing is selected, so the
            region says it is loading rather than staying blank */}
            {needsDefinition && definitions.isPending ? <Loading /> : null}
            {needsDefinition && definitions.data !== undefined && selected === null && !datesWithoutSearch ? (
              <p className="plate notice">
                {requested !== null ? COPY.definitionNotFound : COPY.noDefinitions}
              </p>
            ) : null}
            {(needsDefinition && selected !== null && !providerStatusKnown) ||
            (show('searches') && !providerStatusKnown) ? (
              <Loading />
            ) : null}
            {!landed && definitionsKnown ? <Loading /> : null}
            {show('searches') && providerStatusKnown ? <SearchesView /> : null}
            {datesWithoutSearch ? <DatesView definition={null} /> : null}
            {show('dates') && notice !== null && notice.search === params.toString() ? (
              <p role="status" className="plate notice mb-4">
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
