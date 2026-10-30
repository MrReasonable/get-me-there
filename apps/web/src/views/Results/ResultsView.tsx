import { bandCheapest, cellKeyString, filterRows, type Provenance, type SortKey, sortRows } from '@gmt/core';
import { useCallback, useEffect, useMemo } from 'react';
import { ApiError } from '../../api/client.js';
import { useCalendarGap, useProvidersWatch, useResults } from '../../api/queries.js';
import type {
  CalendarGapResponse,
  DefinitionResponse,
  ExecutionSummary,
  ResultsResponse,
} from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { SyntheticBanner } from '../../components/SyntheticBanner.js';
import { COPY } from '../../copy.js';
import { NARROW_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import { coverageLineText } from '../../lib/coverageLine.js';
import { parseDatesState } from '../../state/datesState.js';
import { oneOf } from '../../state/oneOf.js';
import {
  activeFilterCount,
  BACK_TO_DATES,
  BASIS_PARAM,
  CLASSES,
  DATES_COVERAGE,
  type DetailPair,
  detailScope,
  detailState,
  parseBasis,
  parseResultsState,
  parseSelectedRow,
  resultsStatePatch,
  SORT_KEYS,
} from '../../state/resultsState.js';
import { hrefWith, navigateTo, updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { withKey } from '../../state/withKey.js';
import { AirportPairPanel, type GapMark } from './AirportPairPanel.js';
import { BasisSwitch } from './BasisSwitch.js';
import { DetailHeader } from './DetailHeader.js';
import { Filters } from './Filters.js';
import { cellsForDatePair } from './panel.js';
import { ResultsHeader } from './ResultsHeader.js';
import { BAND_HOURS, ResultsTable, rowId, SORT_LABEL } from './ResultsTable.js';
import './results.css';

/** Spec §6.5: travel-time band width for bandCheapest. */
const SORT_VALUES = SORT_KEYS.flatMap((k) => [`${k}.asc`, `${k}.desc`]);
const isSortValue = oneOf(SORT_VALUES);

/** Narrow screens lose most sortable headers, so the sort is a select there (review UI-7). */
function SortSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    // why: at 375 px the longest option ("server ranking (class, then price)") must not widen the page, so the control
    // may shrink to its container.
    <span className="flex min-w-0 max-w-full flex-col gap-1 text-sm">
      <label htmlFor="sort-select" className="field-label">
        {COPY.sortSelect}
      </label>
      <select
        id="sort-select"
        className="input min-h-11 w-full min-w-0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{COPY.serverOrder}</option>
        {SORT_KEYS.flatMap((k) =>
          (['asc', 'desc'] as const).map((d) => (
            <option key={`${k}.${d}`} value={`${k}.${d}`}>
              {COPY.sortOption(SORT_LABEL[k], COPY.sortDir[d])}
            </option>
          )),
        )}
      </select>
    </span>
  );
}

/**
 * The calendar-gap marks of this date pair's cells, keyed by cell (spec §11: "the calendar-gap cells of this date pair
 * are marked in their panels"). The gap route answers for the whole search; only this date pair's cells on the airport
 * pairs in scope are marked.
 */
function gapMarks(gap: CalendarGapResponse | undefined, inScope: ReadonlySet<string>): Map<string, GapMark> {
  const out = new Map<string, GapMark>();
  if (gap === undefined || gap.cheapestVerified === null) return out;
  for (const c of gap.cells) {
    const { nights: _nights, ...key } = c.cell;
    const k = cellKeyString(key);
    if (inScope.has(k)) out.set(k, { calendar: c.calendar, reference: gap.cheapestVerified });
  }
  return out;
}

/**
 * Every provenance the detail received or marks (revision 50): rows, their other sellers, the cheapest, the board's
 * figure and its cheaper-cached price, and the calendar-gap prices the panels mark with their reference. Any synthetic
 * one, or the fixture provider's, raises the red banner whatever /providers said (spec §5.5; ruling 3).
 */
function anySynthetic(data: ResultsResponse, marks: ReadonlyMap<string, GapMark>): boolean {
  const rows = data.cheapest === null ? data.rows : [...data.rows, data.cheapest];
  const figure = data.datePairFigure;
  const kinds: Provenance[] = [
    ...rows.flatMap((r) => [r.provenance, ...r.otherOffers.map((o) => o.provenance)]),
    ...(figure === null
      ? []
      : [
          figure.price.provenance,
          ...(figure.cheaperCached === null ? [] : [figure.cheaperCached.provenance]),
        ]),
    ...[...marks.values()].flatMap((m) => [m.calendar.provenance, m.reference.provenance]),
  ];
  return kinds.some((p) => p.sourceKind === 'synthetic' || p.providerId === 'fixture');
}

export interface ResultsViewProps {
  definition: DefinitionResponse;
  /** The date pair the URL names (the landing rules hand it over only when it is well formed, WP19 Task 19.7). */
  datePair: DetailPair;
}

/**
 * Spec §11 Date pair detail (what was View A, Results): one date pair's itineraries and calendar prices, read from
 * `/results` scoped to the date pair, the Dates airport filter and its journey limit, so every rule below holds over that
 * date pair's cells; one fetch per basis, every sort and filter core's pure function over that page; one panel per
 * airport pair in scope beneath.
 */
export function ResultsView({ definition, datePair }: ResultsViewProps) {
  const params = useSearchParams();
  const basis = parseBasis(params.get(BASIS_PARAM));
  const ui = useMemo(() => detailState(parseResultsState(params)), [params]);
  const dates = useMemo(() => parseDatesState(params, definition), [params, definition]);
  const results = useResults(definition.id, basis, detailScope(dates, datePair));
  const providers = useProvidersWatch();
  // why: the gap read runs only when a verification provider is configured (spec §6.9: never on the £0 configuration)
  const gap = useCalendarGap(definition.id, results.data?.verificationProviderConfigured === true);
  const cells = useMemo(
    () =>
      cellsForDatePair(
        dates.from.length > 0 ? dates.from : definition.origins,
        dates.to.length > 0 ? dates.to : definition.destinations,
        datePair,
      ),
    [dates.from, dates.to, definition.origins, definition.destinations, datePair],
  );
  const marks = useMemo(() => gapMarks(gap.data, new Set(cells.map(cellKeyString))), [gap.data, cells]);
  // why: spec §11 URLs (WP19 Task 19.7): the landing rules judge the date pair's format only; one outside the current
  // resolved space is the server's answer, and the detail then replaces the URL with Dates, keeping def= and d.*
  const outside = results.error instanceof ApiError && results.error.code === 'date_pair_outside_space';
  useEffect(() => {
    if (outside) updateSearchParams(BACK_TO_DATES, 'replace');
  }, [outside]);
  const narrow = useMediaQuery(NARROW_QUERY);
  const { filtered, rows, banded, staleHidden } = useMemo(() => {
    if (results.data === undefined)
      return { filtered: [], rows: [], banded: new Set<string>(), staleHidden: 0 };
    const kept = filterRows(results.data.rows, ui.filters);
    // why: band over the filtered set, so "cheapest in its band" means among the rows the operator is looking at.
    const marked = bandCheapest(kept, BAND_HOURS);
    // why: the rows hide-stale removed are those the other filters keep and it drops, so a stale row another filter
    // already hid is never counted as hidden by it (CodeRabbit batch 3)
    const hidden =
      ui.filters.hideStale === true
        ? filterRows(results.data.rows, withKey(ui.filters, 'hideStale', undefined)).length - kept.length
        : 0;
    return {
      filtered: kept,
      rows: ui.sort === null ? kept : sortRows(kept, ui.sort.key, ui.sort.dir),
      banded: marked,
      staleHidden: hidden,
    };
  }, [results.data, ui]);
  const setSort = useCallback((value: string) => {
    // why: the detail's own state, so a stale f.nights, f.depart or f.dest is cleared rather than written back
    const current = detailState(parseResultsState(new URLSearchParams(window.location.search)));
    const sort = isSortValue(value) ? parseResultsState(new URLSearchParams({ sort: value })).sort : null;
    updateSearchParams(resultsStatePatch({ ...current, sort }));
  }, []);
  const onSort = useCallback(
    (key: SortKey) => {
      const current = parseResultsState(new URLSearchParams(window.location.search));
      setSort(`${key}.${current.sort?.key === key && current.sort.dir === 'asc' ? 'desc' : 'asc'}`);
    },
    [setSort],
  );

  if (outside) return <Loading />;
  if (results.error) return <LoadError error={results.error} retry={() => void results.refetch()} />;
  if (results.data === undefined) return <Loading />;
  const data = results.data;
  const verificationConfigured = data.verificationProviderConfigured;
  const f = ui.filters;
  const failedHidden =
    f.verdictClass === undefined ? data.rows.filter((r) => r.verdictClass === 'failed').length : 0;
  const synthetic = providers.data?.synthetic !== true && anySynthetic(data, marks);
  const order =
    ui.sort === null ? COPY.serverOrder : COPY.sortOption(SORT_LABEL[ui.sort.key], COPY.sortDir[ui.sort.dir]);
  const headline = filtered[0] ?? data.cheapest;
  const selectedRow = parseSelectedRow(params);
  return (
    <div className="space-y-4">
      {synthetic ? <SyntheticBanner /> : null}
      <DetailHeader
        datePair={datePair}
        airportPairs={{
          inScope: cells.length,
          total: definition.origins.length * definition.destinations.length,
        }}
        executions={data.executions}
        stale={data.rows.length > 0 && data.rows.every((r) => r.stale)}
      />
      <ResultsHeader data={data} filteredFirst={filtered[0] ?? null} coveragePatch={DATES_COVERAGE} />
      <BasisSwitch basis={data.basis} reason={data.basisReason} />
      <Filters state={ui} rows={data.rows} calendarBasis={data.basis === 'calendar'} narrow={narrow} />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-sm text-fg-2">
        {narrow ? (
          <SortSelect value={ui.sort === null ? '' : `${ui.sort.key}.${ui.sort.dir}`} onChange={setSort} />
        ) : null}
        <span>{COPY.orderNow(order)}</span>
        {data.truncated && ui.sort !== null && ui.sort.key !== 'price' ? (
          <span>{COPY.sortedWithin(SORT_LABEL[ui.sort.key], data.rows.length, data.total)}</span>
        ) : null}
        {activeFilterCount(f) > 0 ? <span>{COPY.showingRows(filtered.length, data.rows.length)}</span> : null}
        {staleHidden > 0 ? <span>{COPY.staleHidden(staleHidden)}</span> : null}
        {failedHidden > 0 ? (
          <span className="flex flex-wrap items-center gap-2">
            {COPY.failedHidden(failedHidden)}
            <button
              type="button"
              className="btn btn-sm min-h-11"
              onClick={() =>
                updateSearchParams(
                  resultsStatePatch({ ...ui, filters: withKey(f, 'verdictClass', [...CLASSES]) }),
                )
              }
            >
              {COPY.showFailed}
            </button>
          </span>
        ) : null}
      </div>
      {selectedRow !== null && !data.rows.some((r) => rowId(r) === selectedRow) ? (
        <p role="status">{COPY.detailView.rowGone}</p>
      ) : null}
      {data.rows.length === 0 ? (
        // why: spec §11: a date pair without a row says so with its coverage line, never "no flights"
        <div data-testid="detail-empty" className="plate plate-pad space-y-2">
          <p className="h-sub">{COPY.detailView.noRows}</p>
          <p className="text-sm">
            {coverageLineText(
              data.coverage,
              verificationConfigured,
              data.executions.find((e) => !e.isChild),
            )}
          </p>
          <p>
            <a href={hrefWith(DATES_COVERAGE)} onClick={navigateTo(DATES_COVERAGE)} className="link">
              {COPY.detailView.coverageSection}
            </a>
          </p>
        </div>
      ) : rows.length === 0 ? (
        <p className="plate notice flex flex-wrap items-center gap-3">
          {COPY.noRowsAfterFilter}
          <button
            type="button"
            className="btn btn-sm min-h-11"
            onClick={() => updateSearchParams(resultsStatePatch({ ...ui, filters: {} }))}
          >
            {COPY.clearFilters}
          </button>
        </p>
      ) : (
        <ResultsTable
          rows={rows}
          banded={banded}
          selectedRow={selectedRow}
          sort={ui.sort}
          onSort={onSort}
          narrow={narrow}
          verificationConfigured={verificationConfigured}
          definitionId={definition.id}
          bookingRow={headline === null ? null : rowId(headline)}
        />
      )}
      {gap.error ? <LoadError error={gap.error} retry={() => void gap.refetch()} /> : null}
      <Panels definition={definition} cells={cells} executions={data.executions} marks={marks} />
    </div>
  );
}

/** One panel per airport pair in scope (spec §11 Date pair detail, "Per airport pair"). */
function Panels({
  definition,
  cells,
  executions,
  marks,
}: {
  definition: DefinitionResponse;
  cells: ReturnType<typeof cellsForDatePair>;
  executions: readonly ExecutionSummary[];
  marks: ReadonlyMap<string, GapMark>;
}) {
  return (
    <section aria-label={COPY.panel.regionLabel} className="pair-plates">
      {cells.map((c) => {
        const k = cellKeyString(c);
        return (
          <AirportPairPanel
            key={k}
            definition={definition}
            cell={c}
            executions={executions}
            gap={marks.get(k) ?? null}
          />
        );
      })}
    </section>
  );
}
