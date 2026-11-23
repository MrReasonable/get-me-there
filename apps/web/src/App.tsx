import { useEffect, useMemo } from 'react';
import { useDefinitions, useProviders } from './api/queries.js';
import { AppBoundary } from './components/AppBoundary.js';
import { LoadError, Loading } from './components/LoadState.js';
import { Nav } from './components/Nav.js';
import { SyntheticBanner } from './components/SyntheticBanner.js';
import { TopBar } from './components/TopBar.js';
import { COPY } from './copy.js';
import { Flaps } from './flaps/Flaps.js';
import { type Landing, land } from './state/landing.js';
import { useLastSearch } from './state/lastSearch.js';
import { parseTripState } from './state/tripState.js';
import { hrefWith, navigateTo, updateSearchParams, useSearchParams } from './state/urlState.js';
import { navItemOf, navPatch, type ViewId } from './state/view.js';
import { AlertsView } from './views/Alerts/index.js';
import { DatesView } from './views/Dates/DatesView.js';
import { DefinitionsView } from './views/Definitions/DefinitionsView.js';
import { HistoryView } from './views/History/HistoryView.js';
import { SearchesView } from './views/Searches/SearchesView.js';
import { SettingsView } from './views/Settings/SettingsView.js';
import { StatusView } from './views/Status.js';
import { TripView } from './views/Trip/TripView.js';

/** The views that need no definition (spec §11: the Set up views other than Alerts). */
const NO_DEFINITION: ReadonlySet<ViewId> = new Set(['searches', 'definitions', 'settings', 'status']);

/** The Trips link (the logo's and the nav's): Searches, which names no search (ruling R-bar). */
const TRIPS = { ...navPatch('searches'), def: null };

/**
 * Spec rev 55 §11 layout (design 2026-11-08 Rulings 9 and 10): synthetic banner, header with the logo and the nav (no search selector: every action lives on the search it
 * acts on), the top bar (health line and limits) on every view. When /providers fails, the page says provider status is unknown instead of silently showing
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
  // why: spec §11 URLs (WP20 Task 20.3): an absent or unknown view, a search's page without def= and an Edit page without
  // edit= land on Searches; the retired views and a Results URL without a date pair land on a search's page, which with
  // no def= is Searches too. The view drawn follows the landing at once, and the URL is rewritten to it
  const landing: Landing = useMemo(() => land(params, selected), [params, selected]);
  const view: ViewId = landing.view;
  // why: the Trip page (design 2026-11-08 §6.1) renders only for a well-formed pair of dates of the search shown, with
  // the search page's airport and journey filters it was opened under
  const tripState = useMemo(
    () => (selected === null ? null : parseTripState(params, selected)),
    [params, selected],
  );
  // why: the rewrite waits for the definitions, so a Calendar link's cal.dest is judged against the selected one
  const definitionsKnown = definitions.data !== undefined || definitions.error !== null;
  // why: a landing on Searches needs no definition to be judged, so it is written at once
  const rewriteReady = definitionsKnown || landing.view === 'searches';
  useEffect(() => {
    if (rewriteReady && Object.keys(landing.patch).length > 0) updateSearchParams(landing.patch, 'replace');
  }, [rewriteReady, landing]);
  const noProviders = providers.data !== undefined && !providers.data.providers.some((p) => p.enabled);
  // why: until /providers answers (or fails, which the page then says), the page cannot tell whether its prices are
  // synthetic, so no price view renders: a fixture price must never look real for the moment before the banner.
  const providerStatusKnown = providers.data !== undefined || providers.error !== null;
  // why: a view is drawn once the URL says what it shows, so a retired link never reads the unfiltered Dates first
  const landed = Object.keys(landing.patch).length === 0;
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
        <div className="topbar">
          <header className="topbar-in">
            <div className="brand">
              {/* why: the logo links to Trips (Ruling 9). The name is the link's words; on a phone, where flap cells
              would be too small to read, the words are shown in painted caps and the cells hidden */}
              <a
                href={hrefWith(TRIPS)}
                onClick={navigateTo(TRIPS)}
                aria-label={COPY.logoLink}
                className="brand-link"
              >
                <span className="brand-words">{COPY.appTitle}</span>
                <Flaps text={COPY.appTitle} className="brand-flaps" />
              </a>
            </div>
            <Nav current={navItemOf(view)} />
            {/* why: Ruling 10 — one health line and the limits on every view; a run's progress is the page's own
            (RunProgress), not the bar's */}
            <TopBar />
          </header>
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
            {show('dates') && selected !== null && providerStatusKnown ? (
              <DatesView definition={selected} />
            ) : null}
            {show('trip') && selected !== null && providerStatusKnown && tripState !== null ? (
              <TripView
                key={`${selected.id}|${tripState.departureDate}|${tripState.returnDate}`}
                definition={selected}
                state={tripState}
              />
            ) : null}
            {show('history') && selected !== null && providerStatusKnown ? (
              <HistoryView definition={selected} />
            ) : null}
            {show('alerts') && selected !== null && providerStatusKnown ? (
              <AlertsView definitionId={selected.id} />
            ) : null}
            {show('definitions') ? <DefinitionsView /> : null}
            {show('settings') ? <SettingsView /> : null}
            {show('status') ? <StatusView /> : null}
          </AppBoundary>
        </main>
      </div>
    </AppBoundary>
  );
}
