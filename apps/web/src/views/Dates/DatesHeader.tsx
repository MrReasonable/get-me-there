import {
  type DecodedDatePairs,
  IN_FLIGHT_STATUSES,
  type IsoDateTime,
  type StartRefusalCode,
  windowSpanWords,
} from '@gmt/core';
import type { DefinitionResponse, ExecutionResponse, SearchCard } from '../../api/types.js';
import { Crumbs, tripsCrumb } from '../../components/Crumbs.js';
import { COPY } from '../../copy.js';
import { hoursText } from '../../lib/flightLines.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { useAirportDetails } from '../Definitions/airports.js';
import { airportLabel } from '../Searches/cardWords.js';
import type { BoardModel } from './board.js';
import { PageState } from './PageState.js';
import { RepeatWeekly } from './RepeatWeekly.js';
import { SearchAgainButton } from './SearchAgainButton.js';
import { SearchedLine } from './SearchedLine.js';
import {
  pricedCount,
  runLine,
  runProgressFor,
  type StateLine,
  stateLine,
  type WholeCount,
  wholeOf,
} from './stateLines.js';

const D = COPY.datesView;
const P = COPY.searchPage;
const S = COPY.searchesView;
const IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);

/** The latest parent run as the date-pairs read summarises it. */
type RunSummary = DecodedDatePairs['executions'][number];

/** "10 Jan – 31 Mar", or "10 Dec 2026 – 31 Mar 2027" when the dates cross a year (the cards' form, core's words). */
const span = (from: string, to: string): string => windowSpanWords(from, to);

/**
 * The window in mockup 02's words: a fixed window's own dates ("leave 10 Jan – 31 Mar"); a rolling one's dates now with
 * "(moves forward each day)" (Ruling 18: `currentSpace` resolves daily), its offset and length until the read answers.
 */
function windowWords(definition: DefinitionResponse, data: DecodedDatePairs | null): string {
  const w = definition.window;
  if (w.kind === 'absolute') return S.leaveWindow(span(w.from, w.to));
  if (data === null)
    return w.kind === 'months'
      ? S.windowRollingMonths(w.lengthMonths, w.startOffsetDays)
      : S.windowRolling(w.lengthDays, w.startOffsetDays);
  return P.leaveRolling(span(data.space.departureFrom, data.space.departureTo));
}

/**
 * Mockup 02's meta line: the airports by name ("Heathrow, Gatwick → JFK, Newark"), the window, the stay and the search's
 * own journey limit ("each way under 25h", Ruling 16), each part joined by " · ".
 */
function metaLine(
  definition: DefinitionResponse,
  data: DecodedDatePairs | null,
  airports: ReturnType<typeof useAirportDetails>['rows'],
): string {
  const limit = definition.constraints.maxJourneyMinutes;
  return [
    S.codes(
      definition.origins.map((c) => airportLabel(c, airports.get(c))).join(', '),
      definition.destinations.map((c) => airportLabel(c, airports.get(c))).join(', '),
    ),
    windowWords(definition, data),
    D.scopeNights(definition.minNights, definition.maxNights),
    ...(limit === undefined ? [] : [P.eachWayUnder(hoursText(limit))]),
  ].join(' · ');
}

export interface DatesHeaderProps {
  definition: DefinitionResponse;
  /** The shown read, or null while the first read of this scope loads (the header stays mounted). */
  data: DecodedDatePairs | null;
  model: BoardModel | null;
  /** The latest parent run's own read (its status, progress, stop, flights and finish), once it has answered. */
  run: ExecutionResponse | undefined;
  now: IsoDateTime;
  /** A refused Search now (`refused=<code>`), worded while the search has no run. */
  refused: StartRefusalCode | null;
  /** The search's card (`/cards`), for what the page's scoped read cannot say: Ruling 7's whole-search counts. */
  card: SearchCard | null;
  /** The read is narrowed (From, To or a journey limit applied), so its counts are not the whole search's. */
  scoped: boolean;
}

/**
 * Design 2026-11-08 §5 (mockup 02), Rulings 6, 7, 11, 12 and 16: a search's page's header, top to bottom. The
 * breadcrumb "Trips › <name>"; the name as a plain h1 and the meta line (airports by name, the window, the stay, the
 * journey limit), with the actions beside them: Search again (once the search has a run: a never-searched one offers
 * Search now in its state), Edit and Repeat; then the run line ("Searched today 16:40–17:02 · calendar prices for 2,146
 * of 2,184 dates · 23 dates with flights read · what was searched") once a run has started and is not going; then the
 * state under it (`PageState`: `RunProgress` while a run goes or once it stopped).
 */
export function DatesHeader({ definition, data, model, run, now, refused, card, scoped }: DatesHeaderProps) {
  const airports = useAirportDetails([...definition.origins, ...definition.destinations]);
  const latest: RunSummary | undefined = data?.executions.find((e) => !e.isChild);
  const own = run !== undefined && latest !== undefined && run.id === latest.id ? run : undefined;
  const status = own?.status ?? latest?.status;
  // why: the card's counts only while it describes this run as it now stands (a card read before the run moved is not);
  // they count the run's whole space (Ruling 7), which a read narrowed by From or To cannot. Right after a run ends the
  // run's poll says so before the card does, so for a moment the line counts the read in view (one origin, say), until
  // the card's own re-read lands: the page asks for it itself at the run's end (`useRunRereads`' `ended`, final review
  // M5), never waiting on the top bar's cards poll. A narrowed read's counts are part of the search, so the run line
  // leaves its calendar count out until the card's arrive (CodeRabbit CR6); an unnarrowed read is the whole search.
  const cardRun = card?.latestRun ?? null;
  const sameRun =
    cardRun !== null && latest !== undefined && cardRun.id === latest.id && cardRun.status === status;
  const pairs = data?.pairs ?? [];
  // why: concern 3 of the CodeRabbit round, as CR6 below: RunProgress counts the whole search, never a narrowed read
  const whole: WholeCount | null = sameRun
    ? { searched: cardRun.datePairsSearched, total: cardRun.datePairs }
    : scoped
      ? null
      : wholeOf(pairs);
  const calendar = sameRun
    ? { priced: cardRun.marks.priced, total: cardRun.datePairs }
    : scoped
      ? null
      : { priced: pricedCount(pairs), total: pairs.length };
  // why: the line is known once the read and (for a run) the run's own read are in: until then nothing is guessed
  const line: StateLine | null =
    data === null || model === null
      ? null
      : latest === undefined
        ? stateLine({
            latest: null,
            spaceChanged: false,
            noSource:
              definition.providers.discovery.length === 0 && definition.providers.verification.length === 0,
            c: COPY,
          })
        : own === undefined
          ? null
          : stateLine({
              latest: own,
              spaceChanged: sameRun && card?.spaceChangedSince === true,
              noSource: false,
              c: COPY,
            });
  const child = data?.executions.find((e) => e.isChild && IN_FLIGHT.has(e.status))?.status ?? null;
  const progress = own === undefined ? null : runProgressFor(own, whole, child);
  const searched =
    model !== null &&
    latest !== undefined &&
    latest.startedAt !== null &&
    status !== undefined &&
    !IN_FLIGHT.has(status)
      ? // why: the times come from the same summary as the status (the run's own poll when it has answered), so a run
        // the poll says finished never reads "from HH:MM" off an older read (CodeRabbit CR7)
        runLine({ run: own ?? latest, calendar, readDates: model.readDates, now, c: COPY })
      : null;
  const edit = { view: 'definitions', edit: definition.id, def: null };
  return (
    <div className="search-head" data-testid="dates-head">
      <Crumbs items={[tripsCrumb(), { label: definition.name }]} />
      <div className="token-page-head search-head-top">
        <div className="search-head-title">
          <h1 className="token-page-title">{definition.name}</h1>
          <p className="search-meta" data-testid="dates-meta">
            {metaLine(definition, data, airports.rows)}
          </p>
        </div>
        <fieldset className="search-actions">
          <legend className="sr-only">{P.actionsLabel}</legend>
          {latest !== undefined ? <SearchAgainButton definitionId={definition.id} primary /> : null}
          <a href={hrefWith(edit)} onClick={navigateTo(edit)} className="btn btn-sm min-h-11">
            {S.edit}
          </a>
          <RepeatWeekly definition={definition} />
        </fieldset>
      </div>
      {searched !== null ? <SearchedLine text={searched} /> : null}
      <PageState
        definition={definition}
        line={line}
        refused={latest === undefined ? refused : null}
        progress={progress}
      />
    </div>
  );
}
