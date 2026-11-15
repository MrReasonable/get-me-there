import type { DecodedDatePairs } from '@gmt/core';
import {
  effectiveAge,
  type IsoDateTime,
  londonDateOf,
  type PriceLabelKind,
  priceLabelKind,
  staleWords,
  worstCaseAgeHours,
} from '@gmt/core';
import { useMemo } from 'react';
import { useRouteHistories } from '../../../api/queries.js';
import type { DefinitionResponse } from '../../../api/types.js';
import { LoadError } from '../../../components/LoadState.js';
import { PriceBoundary } from '../../../components/PriceBoundary.js';
import { PriceCell } from '../../../components/PriceCell.js';
import { labelAge, PriceLabel } from '../../../components/PriceLabel.js';
import { assertProvenance } from '../../../components/Provenance.js';
import { COPY } from '../../../copy.js';
import { formatIsoDateShort } from '../../../format.js';
import { labelDetail } from '../../../lib/figureLabel.js';
import { useNow } from '../../../now.js';
import { navigateToQuery } from '../../../state/urlState.js';
import { Fold } from './Fold.js';
import { lowestOf, lowestPerRun, type RunPoint } from './priceHistory.js';

const F = COPY.searchPage.folds;
const T = COPY.trip;

/** The kind of label a calendar point carries: the cache's is Cached, any other source's Calendar. */
const kindOf = (p: RunPoint): PriceLabelKind =>
  priceLabelKind({ kind: 'calendar', providerId: p.provenance.providerId }, false);

/** A point's age as a label words it: the effective age at the page's clock, as the rows' wire ages are. */
const ageOf = (p: RunPoint, now: IsoDateTime): number => worstCaseAgeHours(effectiveAge(p.provenance, now));

/** A run's day, in London time ("8 Nov"). */
const dayOf = (at: IsoDateTime): string => formatIsoDateShort(londonDateOf(at));

export interface PriceHistory {
  /** This search's runs' lowest calendar prices, newest first, at most six. */
  points: readonly RunPoint[];
  loading: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Ruling 19: the route history of each airport pair of the search (the History view's own reads, so one query each),
 * filtered to this search's executions. The page owns it so its synthetic check covers these points too.
 */
export function usePriceHistory(definition: DefinitionResponse, data: DecodedDatePairs | null): PriceHistory {
  const pairs = useMemo(
    () =>
      definition.origins.flatMap((origin) =>
        definition.destinations.map((destination) => ({ origin, destination })),
      ),
    [definition.origins, definition.destinations],
  );
  const queries = useRouteHistories(pairs, definition.cabin, data !== null);
  const runIds = useMemo(
    () => new Set((data?.executions ?? []).filter((e) => !e.isChild).map((e) => e.id)),
    [data],
  );
  // why: a handful of small arrays per render; the points follow the reads without a memo to keep in step
  const points = lowestPerRun(
    queries.map((q) => q.data),
    runIds,
  );
  return {
    points,
    loading: data === null || queries.some((q) => q.isPending),
    error: queries.find((q) => q.error !== null)?.error ?? null,
    retry: () => {
      for (const q of queries) void q.refetch();
    },
  };
}

/**
 * The summary's one line: the lowest of the runs listed, its day and its label ("Cached · 2d") as plain text (a label's
 * own detail is a disclosure, and a summary holds no control). The price goes through PriceCell like every price.
 */
function Lowest({ point }: { point: RunPoint }) {
  const now = useNow();
  const kind = kindOf(point);
  return (
    <PriceBoundary>
      {F.lowestCalendar}{' '}
      <PriceCell
        bare
        pricePence={point.pricePence}
        provenance={point.provenance}
        calendar
        stale={point.stale}
        truncated={point.truncated}
      />
      {', '}
      {dayOf(point.at)} ·{' '}
      <span className={point.stale === false ? undefined : 'price-label-stale'}>
        {T.labelText(T.label[kind], labelAge(ageOf(point, now)))}
      </span>
    </PriceBoundary>
  );
}

/** One run in the list: its day, its lowest calendar price, the price's label with its detail. */
function RunRow({ point }: { point: RunPoint }) {
  const now = useNow();
  const kind = kindOf(point);
  assertProvenance(point.provenance);
  return (
    <li className="sfold-run">
      <span className="sfold-run-day">{dayOf(point.at)}</span>
      {' · '}
      <PriceCell
        bare
        pricePence={point.pricePence}
        provenance={point.provenance}
        calendar
        stale={point.stale}
        truncated={point.truncated}
      />{' '}
      <PriceLabel
        kind={kind}
        ageHours={ageOf(point, now)}
        stale={point.stale}
        provenance={point.provenance}
        detail={labelDetail(kind, null)}
      />
      {point.stale === false ? null : <span className="sr-only"> {staleWords(point.stale)}</span>}
    </li>
  );
}

/**
 * Ruling 19, "Price over time": one calendar price per run of this search, newest first, up to six; the line that says
 * they are calendar prices; the full history. The read-trip line waits for stage 4.
 */
export function PriceOverTime({
  definition,
  history,
  requested,
  onHandled,
}: {
  definition: DefinitionResponse;
  history: PriceHistory;
  requested: boolean;
  onHandled: () => void;
}) {
  const low = lowestOf(history.points);
  const historyQuery = `?view=history&def=${encodeURIComponent(definition.id)}`;
  return (
    <Fold
      id="price-over-time"
      title={F.priceOverTime}
      state={low === null ? null : <Lowest point={low} />}
      requested={requested}
      onHandled={onHandled}
    >
      {history.error !== null ? (
        <LoadError error={history.error} retry={history.retry} />
      ) : history.points.length === 0 ? (
        history.loading ? null : (
          <p>{F.priceNone}</p>
        )
      ) : (
        <>
          <p className="sfold-h" id="price-over-time-heading">
            {F.priceHeading}
          </p>
          <ul className="sfold-runs" aria-labelledby="price-over-time-heading">
            {history.points.map((p) => (
              <RunRow key={p.executionId} point={p} />
            ))}
          </ul>
        </>
      )}
      <p className="sfold-note">{F.priceNotTrips}</p>
      <p className="sfold-note">
        <a href={historyQuery} onClick={navigateToQuery(historyQuery)}>
          {F.fullHistory}
        </a>
      </p>
    </Fold>
  );
}
