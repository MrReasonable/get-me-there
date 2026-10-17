import type { Iata } from '@gmt/core';
import { useId } from 'react';
import { useItineraryHistory, useResults, useRouteHistories } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { formatInstantDateLondon } from '../../format.js';
import { instantMs } from '../../lib/time.js';
import { useNow } from '../../now.js';
import { HISTORY_PARAMS } from '../../state/links.js';
import { BASIS_PARAM, parseBasis } from '../../state/resultsState.js';
import { hrefWith, navigateTo, updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { HistoryChart, HistoryTable, RouteChart } from './HistoryChart.js';
import {
  historySpan,
  itineraryHeading,
  linesForPairs,
  linesFromItinerary,
  newestAllStale,
  type Pair,
  type PlotLine,
  pairKey,
  type RouteLine,
  runOrder,
} from './lines.js';
import { RouteTable } from './RouteTable.js';

const H = COPY.historyView;
/** The overlay of every pair draws at most this many pairs, one palette colour each (review ui-r2-009). */
export const MAX_OVERLAY_PAIRS = 6;
const ALL = 'all';

/**
 * History (spec §11 History, §10 history routes; plan decisions 38, 52): route history by pair (or every pair
 * overlaid), itinerary history with ?hash=. Fetch-time series and the indicative route-level series get separate
 * charts; every point is tabled with its provenance; the header names the definition's runs, read from the executions
 * list the status bar uses (the same query, so no second fetch), which also orders the runs lines join across.
 */
export function HistoryView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const params = useSearchParams();
  const tablesId = useId();
  const routeTablesId = useId();
  const raw = params.get(HISTORY_PARAMS.hash);
  const hash = raw === null || raw === '' ? null : raw;
  const pairs: Pair[] = definition.origins.flatMap((origin) =>
    definition.destinations.map((destination) => ({ origin, destination })),
  );
  const pairParam = params.get(HISTORY_PARAMS.pair);
  const overlay = pairParam === ALL;
  const chosen = pairs.find((p) => pairKey(p) === pairParam) ?? pairs[0];
  const shownPairs = overlay ? pairs.slice(0, MAX_OVERLAY_PAIRS) : chosen === undefined ? [] : [chosen];
  const routes = useRouteHistories(shownPairs, definition.cabin, hash === null);
  const itinerary = useItineraryHistory(hash);
  const runs = useResults(definition.id, parseBasis(params.get(BASIS_PARAM)));
  const executions = runs.data?.executions ?? [];
  const order = runOrder(executions);

  let fetchLines: PlotLine[] = [];
  let routeLines: RouteLine[] = [];
  let pending: boolean;
  let error: Error | null;
  let destination: Iata | undefined;
  let heading: string | null = null;
  if (hash !== null) {
    pending = itinerary.isPending || runs.isPending;
    error = itinerary.error ?? runs.error;
    if (itinerary.data !== undefined) {
      fetchLines = linesFromItinerary(itinerary.data, order);
      // why: decision 52, review prov-005: destination and heading come from the api, on a bookmark too.
      destination = itinerary.data.cell.destination;
      heading = itineraryHeading(itinerary.data);
    }
  } else {
    pending = routes.some((r) => r.isPending) || runs.isPending;
    error = routes.find((r) => r.error !== null)?.error ?? runs.error;
    const lines = linesForPairs(
      routes.map((r) => r.data),
      shownPairs,
      order,
      overlay,
    );
    fetchLines = lines.fetch;
    routeLines = lines.route;
  }
  const span = historySpan(fetchLines, new Set(executions.filter((e) => e.isChild).map((e) => e.id)));
  const notes = definition.destinationNotes;

  return (
    <section aria-label={H.title} className="flex flex-col gap-4">
      <ViewHeader title={H.title} variant="span" executions={executions} stale={newestAllStale(fetchLines)} />
      {span !== null ? (
        <p className="text-sm">
          {H.spanLine(
            span.runs,
            span.onDemand,
            formatInstantDateLondon(instantMs(span.firstAt)),
            formatInstantDateLondon(instantMs(span.lastAt)),
          )}
        </p>
      ) : null}
      {hash !== null ? (
        <div>
          {heading !== null ? <p className="font-medium">{heading}</p> : null}
          <p className="text-xs">{H.itineraryHash(hash)}</p>
          <a
            href={hrefWith({ [HISTORY_PARAMS.hash]: null })}
            onClick={navigateTo({ [HISTORY_PARAMS.hash]: null })}
            className="underline"
          >
            {H.backToRoute}
          </a>
        </div>
      ) : (
        <div>
          <label className="flex flex-col text-sm">
            {H.routePicker}
            <select
              value={overlay ? ALL : chosen === undefined ? '' : pairKey(chosen)}
              onChange={(e) => updateSearchParams({ [HISTORY_PARAMS.pair]: e.target.value }, 'replace')}
              className="rounded border px-2 py-1"
            >
              {pairs.map((p) => (
                <option key={pairKey(p)} value={pairKey(p)}>
                  {H.pairOption(p.origin, p.destination)}
                </option>
              ))}
              <option value={ALL}>
                {H.allPairs(Math.min(pairs.length, MAX_OVERLAY_PAIRS), pairs.length)}
              </option>
            </select>
          </label>
          <p className="mt-1 text-sm text-slate-700">{H.offersPerItinerary}</p>
        </div>
      )}
      {pending ? (
        <p role="status">{COPY.loading}</p>
      ) : error !== null ? (
        <p role="alert">{COPY.loadFailed(error.message)}</p>
      ) : fetchLines.length === 0 && routeLines.length === 0 ? (
        <p>{H.empty}</p>
      ) : (
        <>
          {fetchLines.length > 0 ? (
            <>
              <HistoryChart lines={fetchLines} tablesId={tablesId} />
              <div id={tablesId} className="flex flex-col gap-3">
                {fetchLines.map((l) => (
                  <HistoryTable key={l.key} line={l} destination={destination} notes={notes} />
                ))}
              </div>
            </>
          ) : null}
          {routeLines.length > 0 ? (
            <>
              <RouteChart lines={routeLines} tablesId={routeTablesId} />
              <div id={routeTablesId} className="flex flex-col gap-3">
                {routeLines.map((l) => (
                  <RouteTable key={l.key} line={l} now={now} />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
