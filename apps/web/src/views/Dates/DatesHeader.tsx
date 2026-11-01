import {
  cellKeyString,
  type DecodedDatePairs,
  IN_FLIGHT_STATUSES,
  type IsoDateTime,
  RESUMABLE_ACTIVE_STATUSES,
  type StartRefusalCode,
  staleWords,
} from '@gmt/core';
import { useCalendarGap } from '../../api/queries.js';
import type { DefinitionResponse, ExecutionResponse } from '../../api/types.js';
import { LoadError } from '../../components/LoadState.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { Flaps } from '../../flaps/Flaps.js';
import { formatIsoDate } from '../../format.js';
import { isThinCoverage } from '../../lib/thinCoverage.js';
import { type DatesUiState, detailPatchOf } from '../../state/datesState.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { suggestedName, useAirportDetails } from '../Definitions/airports.js';
import type { BoardModel } from './board.js';
import { PageState } from './PageState.js';
import { RepeatWeekly } from './RepeatWeekly.js';
import { SearchAgainButton } from './SearchAgainButton.js';
import { SearchedLine } from './SearchedLine.js';
import {
  bucketsUnder,
  reusedDatePairs,
  runSources,
  type StateLine,
  searchedLine,
  stateLine,
  type WholeCount,
  wholeOf,
} from './stateLines.js';
import { countsOf, isFullStay, stayRange } from './stayScope.js';

const D = COPY.datesView;
const P = COPY.searchPage;
const IN_FLIGHT: ReadonlySet<string> = new Set(IN_FLIGHT_STATUSES);
/** The stopped statuses the api resumes: core's one set, the status bar's too (Resume also needs the fix to name it). */
const RESUMABLE: ReadonlySet<string> = new Set(RESUMABLE_ACTIVE_STATUSES);

/** The latest parent run as the date-pairs read summarises it. */
type RunSummary = DecodedDatePairs['executions'][number];

/**
 * The window in words (spec rev 55 §11 "Header": dates as "10 Jan 2027"): a fixed window's own dates, a rolling one's
 * offset and length with the dates it covers now (the read's space; until that answers, the offset and length alone).
 */
function windowWords(definition: DefinitionResponse, data: DecodedDatePairs | null): string {
  const w = definition.window;
  const span = (from: string, to: string) => P.windowSpan(formatIsoDate(from), formatIsoDate(to));
  if (w.kind === 'absolute') return span(w.from, w.to);
  const now = data === null ? null : span(data.space.departureFrom, data.space.departureTo);
  return now === null
    ? COPY.searchesView.windowRolling(w.lengthDays, w.startOffsetDays)
    : P.windowRolling(w.lengthDays, w.startOffsetDays, now);
}

export interface DatesHeaderProps {
  definition: DefinitionResponse;
  /** The shown read, or null while the first read of this scope loads (the header stays mounted). */
  data: DecodedDatePairs | null;
  model: BoardModel | null;
  state: DatesUiState;
  /** The latest parent run's own read (its status, progress, stop, flights and finish), once it has answered. */
  run: ExecutionResponse | undefined;
  now: IsoDateTime;
  /** A refused Search now (`refused=<code>`), worded while the search has no run. */
  refused: StartRefusalCode | null;
  /** The api's own judgement that the search's space changed after its latest run started (its card). */
  spaceChanged: boolean;
  /** The whole search's counts from its card, when the card describes the latest run as it stands; else null. */
  cardWhole: WholeCount | null;
}

/**
 * Spec rev 55 §11 "A search's page", top to bottom (WP20 Task 20.6): the search's name; the route, window and stay in
 * words; the header line from the latest parent run (`searchedLine`, linking to the coverage section, with the scope a
 * filter narrows it to and the stale mark's words when every figure is stale); the actions Search again (once the search
 * has a run: a never-searched search offers Search now in its state line), Edit and Repeat weekly… (or the schedule in
 * words with Change); the state line in a polite status region; the next-move line on thin coverage; and the
 * calendar-gap banner, kept to the scope.
 */
export function DatesHeader({
  definition,
  data,
  model,
  state,
  run,
  now,
  refused,
  spaceChanged,
  cardWhole,
}: DatesHeaderProps) {
  const details = useAirportDetails([...definition.origins, ...definition.destinations]);
  const allPairs = definition.origins.length * definition.destinations.length;
  const counts = model === null ? null : countsOf(model.inView);
  const latest: RunSummary | undefined = data?.executions.find((e) => !e.isChild);
  const own = run !== undefined && latest !== undefined && run.id === latest.id ? run : undefined;
  const figures = model?.ranked ?? [];
  const marks = figures.map((p) => p.figure?.price.stale ?? false);
  const stale = marks.length > 0 && marks.every((m) => m !== false);
  const range = data === null ? null : stayRange(data.space, state.nights);
  const scope = [
    ...(data !== null && data.scope.airportPairs < allPairs
      ? [D.scopeAirports(data.scope.airportPairs, allPairs)]
      : []),
    ...(data !== null && !isFullStay(data.space, state.nights) && range !== null
      ? [D.scopeNights(range.min, range.max)]
      : []),
  ];
  const pairs = model?.inView ?? [];
  const providers = runSources(own);
  const reused = reusedDatePairs(pairs);
  const buckets = bucketsUnder(pairs, COPY);
  // why: ruling R-scope — the running, reading and stopped lines count the whole search: the card's counts, else every
  // stay of the read (the stay filter is the page's own); their buckets only when the read covers every airport pair
  const whole = cardWhole ?? wholeOf(data?.pairs ?? []);
  const wholeBuckets =
    data !== null && data.scope.airportPairs === allPairs ? bucketsUnder(data.pairs, COPY) : null;
  // why: the line is known once the read and (for a run) the run's own read are in: until then nothing is guessed
  const line: StateLine | null =
    data === null || model === null
      ? null
      : latest === undefined
        ? stateLine({
            latest: null,
            pairs,
            whole,
            providers,
            reused,
            spaceChanged: false,
            noSource:
              definition.providers.discovery.length === 0 && definition.providers.verification.length === 0,
            now,
            c: COPY,
          })
        : own === undefined
          ? null
          : stateLine({
              latest: own,
              pairs,
              whole,
              providers,
              reused,
              spaceChanged,
              noSource: false,
              now,
              c: COPY,
            });
  // why: the header line has one place (so a link in it is never swapped for another under the pointer): for a searched
  // run it is the state line's own words, flights clause included; for a stopped one the state line below says why
  const status = own?.status ?? latest?.status;
  const header =
    line?.kind === 'searched'
      ? line.text
      : latest !== undefined && latest.startedAt !== null && status !== undefined && !IN_FLIGHT.has(status)
        ? searchedLine({ run: latest, pairs, providers, reused, now, c: COPY })
        : null;
  // why: the stale mark's words by the kind the api gives each figure (ruling 20.6-2), each kind said once
  const stateMarks = [...new Set(marks.flatMap((m) => (m === false ? [] : [staleWords(m)])))];
  const cities = suggestedName(definition.origins, definition.destinations, details.rows);
  const codes = COPY.searchesView.codes(definition.origins.join(', '), definition.destinations.join(', '));
  // why: minor 6 — until the airports' names are in (or when that read failed) the cities are only the codes again, so
  // the route says the codes once
  const route = cities === codes || cities === '' ? codes : P.route(cities, codes);
  const edit = { view: 'definitions', edit: definition.id, def: null };
  return (
    <div className="dates-head space-y-2" data-testid="dates-head">
      <h2 className="name-board">
        <span className="sr-only">{definition.name}</span>
        {/* why: the search's name in large flaps, a word to a group so a long name wraps between words */}
        <span aria-hidden="true" className="flap-strip">
          {definition.name.split(/\s+/).map((word, i) => (
            <Flaps key={i} text={word} />
          ))}
        </span>
      </h2>
      <p className="search-route" data-testid="dates-route">
        {route}
      </p>
      <p className="search-facts text-fg-2">
        {[windowWords(definition, data), D.scopeNights(definition.minNights, definition.maxNights)].join(
          ' · ',
        )}
      </p>
      {header !== null ? <SearchedLine text={header} scope={scope} buckets={buckets} /> : null}
      {stale ? (
        <p className="text-sm">
          <span aria-hidden="true" className="tag tag-warn mr-2">
            {COPY.priceMarkGlyph.stale}
          </span>
          {P.staleAll(stateMarks.join(P.or))}
        </p>
      ) : null}
      <fieldset className="dates-actions flex flex-wrap items-center gap-2">
        <legend className="sr-only">{P.actionsLabel}</legend>
        {latest !== undefined ? <SearchAgainButton definitionId={definition.id} /> : null}
        <a href={hrefWith(edit)} onClick={navigateTo(edit)} className="btn btn-sm min-h-11">
          {COPY.searchesView.edit}
        </a>
        <RepeatWeekly definition={definition} />
      </fieldset>
      <PageState
        definition={definition}
        line={line}
        refused={latest === undefined ? refused : null}
        executionId={latest?.id ?? null}
        resumable={own !== undefined && RESUMABLE.has(own.status)}
        buckets={wholeBuckets}
      />
      {counts !== null && isThinCoverage(counts.buckets.no_data, counts.total) ? (
        <p className="text-sm">
          {P.thinCoverage}{' '}
          <a href={hrefWith(edit)} onClick={navigateTo(edit)} className="underline">
            {D.coverageCheckLink}
          </a>
        </p>
      ) : null}
      {data?.verificationProviderConfigured === true ? (
        <DatesGap definition={definition} data={data} nights={range} />
      ) : null}
    </div>
  );
}

/**
 * Spec §11 calendar-gap banner on Dates: only the gap cells inside the airport scope and the stay filter (each gap
 * cell carries its nights, so this is done here), the reference price named as across the whole search (no filter
 * narrows it), each cell a link to its date pair's detail, where the verify action runs.
 */
function DatesGap({
  definition,
  data,
  nights,
}: {
  definition: DefinitionResponse;
  data: DecodedDatePairs;
  nights: { min: number; max: number } | null;
}) {
  const gap = useCalendarGap(definition.id, true);
  if (gap.error) return <LoadError error={gap.error} retry={() => void gap.refetch()} />;
  const g = gap.data;
  if (g === undefined || g.cheapestVerified === null) return null;
  const cells = g.cells.filter(
    (c) =>
      data.scope.origins.includes(c.cell.origin) &&
      data.scope.destinations.includes(c.cell.destination) &&
      nights !== null &&
      c.cell.nights >= nights.min &&
      c.cell.nights <= nights.max,
  );
  if (cells.length === 0) return null;
  const cv = g.cheapestVerified;
  return (
    <section aria-label={P.gapList} className="plate notice gap-plate text-sm">
      {/* why: the list can run to dozens of date pairs; it folds under its lead line so the board stays near the top */}
      <details className="fold gap-fold">
        <summary className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden="true" className="tag tag-warn">
            ▲
          </span>
          <span className="gap-lead">{P.gapLead(cells.length)}</span>
          {/* why: the reference's label and its price stay together on one line */}
          <span className="gap-ref inline-flex flex-wrap items-baseline gap-x-2">
            <span>{D.gapReference}</span>
            <PriceBoundary>
              <PriceCell
                pricePence={cv.pricePence}
                provenance={cv.provenance}
                calendar={false}
                stale={cv.stale}
                truncated={cv.truncated}
                destination={cv.cell.destination}
                destinationNote={definition.destinationNotes[cv.cell.destination] ?? null}
                notSeenInLatestHours={cv.notSeenInLatest?.ageHours ?? null}
              />
            </PriceBoundary>
          </span>
        </summary>
        <ul className="mt-2 space-y-1">
          {cells.map((c) => {
            const { nights: n, ...key } = c.cell;
            const patch = detailPatchOf(c.cell, 'calendar');
            const label = `${COPY.coverageCheckPair(c.cell.origin, c.cell.destination)} ${COPY.dateRange(
              formatIsoDate(c.cell.departureDate),
              formatIsoDate(c.cell.returnDate),
              n,
            )}`;
            return (
              <li key={cellKeyString(key)} className="flex flex-wrap items-center gap-2">
                <a href={hrefWith(patch)} onClick={navigateTo(patch)} className="underline">
                  {label}
                </a>
                <PriceBoundary>
                  <PriceCell
                    pricePence={c.calendar.pricePence}
                    provenance={c.calendar.provenance}
                    calendar
                    stale={c.calendar.stale}
                    truncated={c.calendar.truncated}
                    destination={c.cell.destination}
                    destinationNote={definition.destinationNotes[c.cell.destination] ?? null}
                  />
                </PriceBoundary>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
