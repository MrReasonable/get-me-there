import {
  apiContract,
  type DecodedDatePairs,
  flightLimitsOf,
  IN_FLIGHT_STATUSES,
  type IsoDate,
  type IsoDateTime,
  londonDateOf,
  type StartRefusalCode,
} from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import {
  DATES_DRAWN_MARK,
  qk,
  useCards,
  useDatePairs,
  useLatestRun,
  useProvidersWatch,
} from '../../api/queries.js';
import type { DefinitionResponse, ExecutionResponse, SearchCard } from '../../api/types.js';
import { LoadError } from '../../components/LoadState.js';
import { SyntheticBanner } from '../../components/SyntheticBanner.js';
import { COPY } from '../../copy.js';
import { isSyntheticRead, syntheticProvenance } from '../../lib/bookingTarget.js';
import { useNow } from '../../now.js';
import {
  DATES_PARAMS,
  type DatesUiState,
  type FoldId,
  filtersActive,
  foldOf,
  parseDatesState,
  scopeQuery,
} from '../../state/datesState.js';
import { writeLastSearch } from '../../state/lastSearch.js';
import { updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { nothingFound, nothingFoundText } from '../Searches/cardWords.js';
import { type BoardModel, boardModel, type FigurePair, shownCount } from './board.js';
import { CheapestTrips, type NoTrip } from './CheapestTrips.js';
import { DatesHeader } from './DatesHeader.js';
import { Filters, isOwnStay } from './Filters.js';
import { AlertFold } from './folds/AlertFold.js';
import { PriceOverTime, usePriceHistory } from './folds/PriceOverTime.js';
import { WhatWasSearched } from './folds/WhatWasSearched.js';
import { CALENDAR_ID, LowerOnCalendar, ReadSaid, usePageFlights } from './LowerOnCalendar.js';
import { Calendar } from './OverviewGrid.js';
import { staysByDay } from './overview.js';
import { IDLE, onProgress, onTerminal, onTimer, type Reread } from './refresh.js';
import { NoSearch, TooManyCells } from './States.js';
import { stayRange } from './stayScope.js';
import './dates.css';

const D = COPY.datesView;
const P = COPY.searchPage;
const RUNNING: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);
const NO_ROWS: readonly FigurePair[] = [];

/** A clock and a timer the run re-reads go through; tests inject both (WP19 §0: no fixed waits, injected clocks). */
export interface RereadClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => () => void;
}
const browserClock: RereadClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export interface DatesViewProps {
  definition: DefinitionResponse | null;
  clock?: RereadClock;
}

/**
 * Design 2026-11-08 §5 (mockup 02): a search's page (`?view=dates&def=`). It reads `GET /definitions/:id/date-pairs`
 * through core's decoder, applies the stay range, ranks with core's `rankDatePairs` and splits the ranking by core's
 * shared rules, then renders the header (crumbs, name, meta line, actions, run line and the run's progress), the filter
 * row, Cheapest trips and Lower on the calendar, then the calendar with its day panel (Ruling 18) and the three folds
 * (Ruling 19: Price over time, What was searched with the full search log inside it, Alert).
 */
export function DatesView({ definition, clock = browserClock }: DatesViewProps) {
  if (definition === null) return <NoSearch />;
  // why: a new search starts with its own reads and shown rows
  return <DatesOf key={definition.id} definition={definition} clock={clock} />;
}

/** A read and the instant it was shown at: ranks use one instant per read, so they never drift between re-reads. */
interface Shown {
  data: DecodedDatePairs;
  now: IsoDateTime;
}

function DatesOf({ definition, clock }: { definition: DefinitionResponse; clock: RereadClock }) {
  const params = useSearchParams();
  // why: spec rev 55 §11 — opening a search's page remembers it as the search last opened
  useEffect(() => writeLastSearch(definition.id), [definition.id]);
  // why: fix round 1 (A): a stay equal to the search's own range (an old link) is no filter
  const state = useMemo(() => {
    const parsed = parseDatesState(params, definition);
    const n = parsed.nights;
    return n !== null && isOwnStay(n, { min: definition.minNights, max: definition.maxNights })
      ? { ...parsed, nights: null }
      : parsed;
  }, [params, definition]);
  // why: spec rev 55 §11 URLs — a refused Search now opens the new search's page with `refused=<code>`; a value that is
  // no refusal code is ignored, never an error
  const refused = refusalOf(params.get('refused'));
  const query = useDatePairs(definition.id, scopeQuery(state));
  const providers = useProvidersWatch();
  const now = useNow();
  // why: "Show 10 more" presses; a filter change shows the first five of its own trips again
  const [presses, setPresses] = useState(0);
  // why: Ruling 18: the day whose panel is open; the page owns it, so its stays' flight lists are asked with the page's
  const [openDay, setOpenDay] = useState<IsoDate | null>(null);
  // why: each read is placed with the instant it arrived (React's "adjust state when a prop changes"); a filter's new
  // scope has no data until its own read answers, so another scope's figures are never shown (WP19 §6)
  const [shown, setShown] = useState<Shown | null>(null);
  if ((query.data ?? null) !== (shown?.data ?? null))
    setShown(query.data === undefined ? null : { data: query.data, now });
  const options = useMemo(
    () => ({ nights: state.nights, bestPerWeek: state.bestPerWeek }),
    [state.nights, state.bestPerWeek],
  );
  const filterKey = `${JSON.stringify(scopeQuery(state))}|${JSON.stringify(options)}`;
  const [seenFilters, setSeenFilters] = useState(filterKey);
  if (seenFilters !== filterKey) {
    setSeenFilters(filterKey);
    setPresses(0);
  }

  const data = shown?.data ?? null;
  const executionId = data?.executionId ?? null;
  // why: Ruling 19: the route history of this search's runs, read here so the page's synthetic check covers its points
  const history = usePriceHistory(definition, data);
  // why: spec rev 55 §11 — the latest run, polled while it is going (the top bar's poll of the same run is one query)
  const watch = useLatestRun(executionId);
  const run: ExecutionResponse | undefined = watch.data?.id === executionId ? watch.data : undefined;
  const latest = data?.executions.find((e) => !e.isChild);
  const status = run?.status ?? latest?.status;
  const runActive = status !== undefined && RUNNING.has(status);
  // why: the card answers what the page's scoped read cannot (Ruling 7: the run's counts over its whole space, whether
  // its dates changed since, and Ruling 8's reason for finding nothing), re-read only while its run is going
  const cards = useCards({ poll: runActive });
  const card: SearchCard | null = cards.data?.cards.find((c) => c.id === definition.id) ?? null;

  // why: Price over time reads the route history, which the run's end changes: it is re-read with the page's own read;
  // the run's end also re-reads the card (final review M5), whose whole-space counts the run line takes once the card
  // describes the run as it now stands, so the page never depends on the top bar's own cards poll to get them
  const qc = useQueryClient();
  useRunRereads(
    run,
    () => {
      void query.refetch();
      history.refetch();
    },
    clock,
    () => void qc.invalidateQueries({ queryKey: qk.cards }),
  );

  // why: Ruling 19: a link that asks for a fold (the run line's, `d.fold=`) or lands on the full search log
  // (`d.coverage=open`: `?view=coverage`, the status card) opens it once, scrolls to it and focuses it; the asking is
  // then consumed (replaced out of the URL), so the same link asks again, a later filter change never pulls the page
  // back, and the asking never travels to another search (final review I2). The log, once open, stays open as the
  // page's own state until its button closes it.
  const urlFold = foldOf(params);
  const urlLog = state.coverageOpen;
  const [logOpen, setLogOpen] = useState(urlLog);
  if (urlLog && !logOpen) setLogOpen(true);
  const asked = (id: FoldId) => urlFold === id || (id === 'searched' && urlLog);
  const foldHandled = useCallback(() => {
    updateSearchParams({ [DATES_PARAMS.fold]: null, [DATES_PARAMS.coverage]: null }, 'replace');
  }, []);

  const model: BoardModel | null = useMemo(
    () => (shown === null ? null : boardModel(shown.data.pairs, options, shown.now)),
    [shown, options],
  );
  const tripsShown = model === null ? 0 : shownCount(model.trips.length, presses);
  const byDay = useMemo(() => staysByDay(model?.inView ?? NO_ROWS), [model]);
  const pageFlights = usePageFlights(
    definition,
    model?.lower ?? NO_ROWS,
    openDay === null ? NO_ROWS : (byDay.get(openDay) ?? NO_ROWS),
  );
  // why: fix round 1 (Minor 1 ruling): the no-trip lead offers a read only once the flight lists say one can be made
  // here (a search that reads no flight lists, or before they answer, keeps its first sentence alone)
  const canRead = pageFlights.meta?.available === true;
  useEffect(() => {
    // why: WP19 §6: the performance test measures from the response mark to this one, after the header, both sections
    // and the calendar commit, and again after a filter change, "Show 10 more" or a day's panel opening (Task 9)
    if (model !== null) performance.mark(DATES_DRAWN_MARK);
  }, [model, tripsShown, openDay]);
  // why: Task 6's carried note: a link to the calendar (a Trips card's counts) opens the page at its anchor, which is
  // drawn only once the read answers, so the page scrolls to it then, once; the landing is then consumed like `d.fold`
  // (final review I1), the URL replaced without the fragment, so the anchor never travels to another page
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || model === null) return;
    landed.current = true;
    if (window.location.hash !== `#${CALENDAR_ID}`) return;
    document.getElementById(CALENDAR_ID)?.scrollIntoView();
    updateSearchParams({}, 'replace', '');
  }, [model]);
  const today = londonDateOf(now);
  // why: Ruling 4 (CodeRabbit CR43): the over-limit line's limits are the search's, the journey limit the page's filter
  // applies (`d.journey`, the scope the read was judged by) in place of the search's own
  const ownLimits = flightLimitsOf(definition.constraints);
  const overLimits = { ...ownLimits, maxJourneyMinutes: state.journey ?? ownLimits.maxJourneyMinutes };
  return (
    <div className="dates-view search-page token-page">
      {/* why: the shell already shows the banner when /providers says synthetic (spec §5.5: one banner, WP19 Task 19.7) */}
      {data !== null &&
      providers.data?.synthetic !== true &&
      (isSyntheticRead(data, run) || history.points.some((p) => syntheticProvenance(p.provenance))) ? (
        <SyntheticBanner />
      ) : null}
      <DatesHeader
        definition={definition}
        data={data}
        model={model}
        run={run}
        now={now}
        refused={refused}
        card={card}
        scoped={Object.values(scopeQuery(state)).some((v) => v !== undefined)}
      />
      <Filters definition={definition} state={state} />
      {/* why: a re-read that fails over a read already shown keeps its error and Retry whatever that read held, a
      search never run included (CodeRabbit CR5); with no read yet, Pending says the error */}
      {data !== null && model !== null && query.error !== null ? (
        <LoadError error={query.error} retry={() => void query.refetch()} />
      ) : null}
      {data === null || model === null ? (
        <Pending query={query} />
      ) : data.executions.length === 0 ? null : (
        <>
          {data.executionId === null ? (
            <p className="search-section-sub">
              {D.onDemandOnly(data.executions.filter((e) => e.isChild).length)}
            </p>
          ) : null}
          <CheapestTrips
            definition={definition}
            data={data}
            trips={model.trips}
            shown={tripsShown}
            onShowMore={() => setPresses((n) => n + 1)}
            overLimit={model.overLimit}
            limits={overLimits}
            run={run}
            runActive={runActive}
            filtered={filtersActive(state)}
            noTrip={noTripOf(model, state, runActive, card, canRead)}
          />
          <LowerOnCalendar
            definition={definition}
            data={data}
            lower={model.lower}
            hasTrip={model.trips.length > 0}
            flights={pageFlights}
          />
        </>
      )}
      {/* why: one place, mounted whatever the sections show, so a read's words are announced (a landed read may take
      Lower on the calendar away) */}
      <ReadSaid flights={pageFlights} />
      {data !== null && model !== null ? (
        <div id={CALENDAR_ID} className="search-calendar">
          <Calendar
            definition={definition}
            data={data}
            byDay={byDay}
            stay={stayRange(data.space, state.nights)}
            today={today}
            openDay={openDay}
            onOpenDay={setOpenDay}
            flights={pageFlights}
            runActive={runActive}
            limit={state.journey ?? definition.constraints.maxJourneyMinutes ?? null}
          />
        </div>
      ) : null}
      {/* why: Ruling 19 and Task 10 review I1: the folds, and so the full search log, show whatever the date-pairs read does */}
      {
        <section className="search-folds" data-testid="search-folds" aria-label={P.folds.groupLabel}>
          <PriceOverTime
            definition={definition}
            history={history}
            requested={asked('price')}
            onHandled={foldHandled}
          />
          <WhatWasSearched
            definition={definition}
            card={card}
            cardRead={
              cards.data !== undefined ? null : { error: cards.error, retry: () => void cards.refetch() }
            }
            logOpen={logOpen}
            onLogToggle={() => setLogOpen((o) => !o)}
            requested={asked('searched')}
            onHandled={foldHandled}
          />
          <AlertFold definition={definition} requested={asked('alert')} onHandled={foldHandled} />
        </section>
      }
    </div>
  );
}

/** The `refused=` value as a start refusal code, or null when it is absent or names none (spec rev 55 §11 URLs). */
function refusalOf(v: string | null): StartRefusalCode | null {
  return apiContract.startRefusalCodes.find((c) => c === v) ?? null;
}

/**
 * What "Cheapest trips" says with no trip (Review Focus 3, Ruling 8), the first that applies: calendar prices below, so
 * "No flights read yet for these dates…" (its first sentence alone where flight lists can't be read here); the filters
 * leave no price; the search is still going; else the card's reason the search found nothing ("No prices were found.
 * That isn't the same as no flights." when it names none).
 */
function noTripOf(
  model: BoardModel,
  state: DatesUiState,
  runActive: boolean,
  card: SearchCard | null,
  canRead: boolean,
): NoTrip | null {
  if (model.trips.length > 0) return null;
  if (model.lower.length > 0) return { text: canRead ? P.noTrip : P.noTripLead, clear: false };
  if (filtersActive(state)) return { text: P.noPriceInFilters, clear: true };
  if (runActive) return { text: P.stillSearching, clear: false };
  const found = card === null ? null : nothingFound(card);
  return {
    text: found === null ? COPY.searchesView.nothingFound.nothing : nothingFoundText(found),
    clear: false,
  };
}

/** The page's read while it loads or fails: the route's 422 `too_many_cells`, a load error with Retry, or loading. */
function Pending({ query }: { query: ReturnType<typeof useDatePairs> }) {
  const e = query.error;
  if (e instanceof ApiError && e.code === 'too_many_cells') {
    const cells = e.detailNumber('cells');
    const bound = e.detailNumber('bound');
    if (cells !== null && bound !== null) return <TooManyCells cells={cells} bound={bound} />;
  }
  if (e !== null) return <LoadError error={e} retry={() => void query.refetch()} />;
  return (
    <p role="status" className="loading-line">
      {D.loadingFiltered}
    </p>
  );
}

/**
 * Spec §11 Run landing, Ruling 17: while the latest parent run is pending or running, a progress change from its poll
 * re-reads the route at most once every 30 s (a trailing read keeps the last change), and the run leaving pending or
 * running is read at once, when `ended` is called too. Each read shows as it lands; rows carry their ages. The state
 * machine is refresh.ts; this hook feeds it and keeps its timer.
 */
function useRunRereads(
  run: ExecutionResponse | undefined,
  reread: () => void,
  clock: RereadClock,
  ended: () => void,
): void {
  const machine = useRef<Reread>(IDLE);
  const seen = useRef<{ signature: string; active: boolean } | null>(null);
  const timer = useRef<(() => void) | null>(null);
  const latestReread = useRef(reread);
  latestReread.current = reread;
  const latestEnded = useRef(ended);
  latestEnded.current = ended;
  const signature = run === undefined ? null : `${run.id}|${run.status}|${JSON.stringify(run.progress)}`;
  const active = run !== undefined && RUNNING.has(run.status);
  useEffect(() => {
    if (signature === null) return;
    const before = seen.current;
    seen.current = { signature, active };
    // why: the first answer is the run as the view's own read saw it; the throttle counts from there
    if (before === null) {
      machine.current = { lastReadAt: clock.now(), trailingAt: null };
      return;
    }
    if (before.signature === signature) return;
    const at = clock.now();
    const terminal = before.active && !active;
    const step = terminal ? onTerminal(machine.current, at) : active ? onProgress(machine.current, at) : null;
    if (step === null) return;
    machine.current = step.state;
    if (step.read) latestReread.current();
    if (terminal) latestEnded.current();
    const due = step.state.trailingAt;
    if (due !== null && timer.current === null) {
      timer.current = clock.setTimer(() => {
        timer.current = null;
        const fired = onTimer(machine.current, clock.now());
        machine.current = fired.state;
        if (fired.read) latestReread.current();
      }, due - at);
    }
  }, [signature, active, clock]);
  useEffect(
    () => () => {
      timer.current?.();
    },
    [],
  );
}
