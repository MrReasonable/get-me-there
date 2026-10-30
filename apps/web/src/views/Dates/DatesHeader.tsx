import { cellKeyString, type DecodedDatePairs, formatAgo, type IsoDateTime } from '@gmt/core';
import { useCalendarGap } from '../../api/queries.js';
import type { DefinitionResponse, ExecutionResponse } from '../../api/types.js';
import { LoadError } from '../../components/LoadState.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { Flaps } from '../../flaps/Flaps.js';
import { formatIsoDate } from '../../format.js';
import { coverageLineText } from '../../lib/coverageLine.js';
import { isThinCoverage } from '../../lib/thinCoverage.js';
import { instantMs } from '../../lib/time.js';
import { type DatesUiState, datesPatch, detailPatchOf } from '../../state/datesState.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import type { BoardModel } from './board.js';
import { countsOf, isFullStay, stayRange } from './stayScope.js';

const D = COPY.datesView;
const RUNNING: ReadonlySet<string> = new Set(['pending', 'running']);
const PAUSED: ReadonlySet<string> = new Set(['paused_budget', 'paused_error']);

/** "40 min ago" under an hour (the run line of spec §11), else core's "2h ago" / "3d ago". */
export function runAgo(at: IsoDateTime, now: IsoDateTime): string {
  const minutes = Math.max(0, Math.floor((instantMs(now) - instantMs(at)) / 60_000));
  if (minutes < 1) return formatAgo(0);
  return minutes < 60 ? D.minutesAgo(minutes) : formatAgo(Math.floor(minutes / 60));
}

/**
 * The run the view shows (the latest parent run) with its status and age (spec §11 Header line): "run finished 2h ago",
 * "run in progress, started 40 min ago", "run paused 3h ago: <reason>". The reason is the run's own, from the status
 * bar's execution query when it has answered.
 */
export function runLine(
  latest: DecodedDatePairs['executions'][number] | undefined,
  run: ExecutionResponse | undefined,
  now: IsoDateTime,
): string {
  if (latest === undefined) return D.noRunYet;
  const status = run?.id === latest.id ? run.status : latest.status;
  const at = latest.finishedAt ?? latest.startedAt;
  if (latest.startedAt === null || at === null) return D.runNotStarted(COPY.statusName[status]);
  if (RUNNING.has(status)) return D.runInProgress(runAgo(latest.startedAt, now));
  if (PAUSED.has(status))
    return D.runPaused(
      runAgo(at, now),
      (run?.id === latest.id ? run.reason : null) ?? COPY.statusName[status],
    );
  if (status === 'completed') return D.runFinished(runAgo(at, now));
  return D.runEnded(COPY.statusName[status], runAgo(at, now));
}

export interface DatesHeaderProps {
  definition: DefinitionResponse;
  /** The shown read, or null while the first read of this scope loads (the header stays mounted). */
  data: DecodedDatePairs | null;
  model: BoardModel | null;
  state: DatesUiState;
  run: ExecutionResponse | undefined;
  now: IsoDateTime;
}

/**
 * Spec §11 Dates "Header line": the search's name; the run it shows with its status and age; the stale label when
 * every figure is stale; the coverage line over the cells in view, linking to the coverage section; the scope when a
 * filter narrows it; the next-move line on thin coverage; and the calendar-gap banner, kept to the scope.
 */
export function DatesHeader({ definition, data, model, state, run, now }: DatesHeaderProps) {
  const openCoverage = datesPatch({ coverageOpen: true });
  const allPairs = definition.origins.length * definition.destinations.length;
  const counts = model === null ? null : countsOf(model.inView);
  const latest = data?.executions.find((e) => !e.isChild);
  const figures = model?.ranked ?? [];
  const stale = figures.length > 0 && figures.every((p) => p.figure?.price.stale === true);
  const range = data === null ? null : stayRange(data.space, state.nights);
  const scope = [
    ...(data !== null && data.scope.airportPairs < allPairs
      ? [D.scopeAirports(data.scope.airportPairs, allPairs)]
      : []),
    ...(data !== null && !isFullStay(data.space, state.nights) && range !== null
      ? [D.scopeNights(range.min, range.max)]
      : []),
  ];
  return (
    <div className="dates-head space-y-2">
      <h2 className="name-board">
        <span className="sr-only">{definition.name}</span>
        {/* why: the search's name in large flaps, a word to a group so a long name wraps between words */}
        <span aria-hidden="true" className="flap-strip">
          {definition.name.split(/\s+/).map((word, i) => (
            <Flaps key={i} text={word} />
          ))}
        </span>
      </h2>
      {data !== null ? (
        <p className="run-line" data-testid="dates-run">
          {runLine(latest, run, now)}
        </p>
      ) : null}
      {stale ? (
        <p className="text-sm">
          <span className="tag tag-warn mr-2">{COPY.stale}</span>
          {D.staleAll}
        </p>
      ) : null}
      {data !== null && counts !== null ? (
        <p className="text-[15px] text-fg-2">
          <a href={hrefWith(openCoverage)} onClick={navigateTo(openCoverage)} className="underline">
            {coverageLineText(counts, data.verificationProviderConfigured, latest)}
          </a>
          {scope.length > 0 ? (
            <span className="ml-1 font-bold text-fg">{` · ${scope.join(' · ')}`}</span>
          ) : null}
        </p>
      ) : null}
      {counts !== null && isThinCoverage(counts.buckets.no_data, counts.total) ? (
        <p className="text-sm">
          {COPY.thinCoverage}{' '}
          <a
            href={hrefWith({ view: 'definitions', def: definition.id })}
            onClick={navigateTo({ view: 'definitions', def: definition.id })}
            className="underline"
          >
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
    <section aria-label={COPY.calendarGapList} className="plate notice gap-plate text-sm">
      {/* why: the list can run to dozens of cells; it folds under its lead line so the board stays near the top */}
      <details className="fold gap-fold">
        <summary className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span aria-hidden="true" className="tag tag-warn">
            ▲
          </span>
          <span className="gap-lead">{COPY.calendarGapLead(cells.length)}</span>
          <span className="gap-ref">{D.gapReference}</span>
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
