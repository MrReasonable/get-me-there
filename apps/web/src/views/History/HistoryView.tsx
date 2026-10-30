import type { Iata } from '@gmt/core';
import { useId } from 'react';
import { useItineraryHistory, useResults, useRouteHistories } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { SETUP_COPY } from '../../copy/setup.js';
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
import './history.css';

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
  // why: route history is shared by every search with this airport pair, so the runs counted here are this search's
  // own parent runs (the header's), each with or without a price point in this chart.
  const pricedIds = new Set(
    fetchLines.flatMap((l) => l.points.flatMap((p) => (p.kind === 'price' ? [p.executionId] : []))),
  );
  const parentIds = executions.filter((e) => !e.isChild).map((e) => e.id);
  const withoutPrice = parentIds.filter((id) => !pricedIds.has(id)).length;
  const subject = hash === null ? 'route' : 'itinerary';
  const loaded = !pending && error === null;

  return (
    <section aria-label={H.title} className="history flex flex-col gap-4 pt-5">
      <ViewHeader title={H.title} variant="span" executions={executions} stale={newestAllStale(fetchLines)} />
      {span !== null ? (
        <p className="lede text-[15px]">
          <span>
            {H.spanLine(
              span.runs,
              span.onDemand,
              formatInstantDateLondon(instantMs(span.firstAt)),
              formatInstantDateLondon(instantMs(span.lastAt)),
            )}
          </span>
          {/* why: the header counts every run of the search; this line counts the runs with a price here, so it says
              how many of those runs have none, and the two counts agree (critique: "across 2 runs" vs "1 run shown") */}
          {loaded && withoutPrice > 0 ? (
            <span>
              {'. '}
              {SETUP_COPY.history.runsWithoutPrice(withoutPrice, parentIds.length, subject)}
            </span>
          ) : null}
        </p>
      ) : loaded && parentIds.length > 0 ? (
        <p className="lede text-[15px]">
          {SETUP_COPY.history.runsWithoutPrice(withoutPrice, parentIds.length, subject)}
        </p>
      ) : null}
      {hash !== null ? (
        <div className="plate plate-pad history-picker">
          {heading !== null ? <p className="h-sub">{heading}</p> : null}
          <p className="mono mt-1 text-xs text-fg-2">{H.itineraryHash(hash)}</p>
          <a
            href={hrefWith({ [HISTORY_PARAMS.hash]: null })}
            onClick={navigateTo({ [HISTORY_PARAMS.hash]: null })}
            className="link"
          >
            {H.backToRoute}
          </a>
        </div>
      ) : (
        <div className="plate plate-pad history-picker">
          <label className="field-label flex max-w-xs flex-col gap-1.5">
            {H.routePicker}
            <select
              value={overlay ? ALL : chosen === undefined ? '' : pairKey(chosen)}
              onChange={(e) => updateSearchParams({ [HISTORY_PARAMS.pair]: e.target.value }, 'replace')}
              className="input min-h-11 max-w-full"
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
          <p className="hint mt-2 max-w-prose">{H.offersPerItinerary}</p>
        </div>
      )}
      {pending ? (
        <p role="status" className="loading-line">
          {COPY.loading}
        </p>
      ) : error !== null ? (
        <p role="alert" className="plate notice bad-text">
          {COPY.loadFailed(error.message)}
        </p>
      ) : fetchLines.length === 0 && routeLines.length === 0 ? (
        <p className="plate plate-pad max-w-prose">{H.empty}</p>
      ) : (
        <>
          {fetchLines.length > 0 ? (
            <>
              <HistoryChart lines={fetchLines} tablesId={tablesId} />
              <div id={tablesId} className="plate plate-pad history-tables">
                {fetchLines.map((l) => (
                  <HistoryTable key={l.key} line={l} destination={destination} notes={notes} />
                ))}
              </div>
            </>
          ) : null}
          {routeLines.length > 0 ? (
            <>
              <RouteChart lines={routeLines} tablesId={routeTablesId} />
              <div id={routeTablesId} className="plate plate-pad history-tables">
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
