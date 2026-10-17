import { bandCheapest, filterRows, type SortKey, sortRows } from '@gmt/core';
import { useCallback, useMemo } from 'react';
import { useCalendarGap, useProviders, useResults } from '../../api/queries.js';
import type { CalendarGapResponse, DefinitionResponse, ResultsResponse } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { SyntheticBanner } from '../../components/SyntheticBanner.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { NARROW_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import {
  activeFilterCount,
  CLASSES,
  parseBasis,
  parseResultsState,
  parseSelectedRow,
  resultsStatePatch,
  SORT_KEYS,
  setFilter,
} from '../../state/resultsState.js';
import { hrefWith, navigateTo, updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { oneOf } from '../../state/withKey.js';
import { BasisSwitch } from './BasisSwitch.js';
import { CalendarGapBanner } from './CalendarGapBanner.js';
import { Filters } from './Filters.js';
import { ResultsHeader } from './ResultsHeader.js';
import { ResultsTable, SORT_LABEL } from './ResultsTable.js';

/** Spec §6.5: travel-time band width for bandCheapest. */
const BAND_HOURS = 6;
const SORT_VALUES = SORT_KEYS.flatMap((k) => [`${k}.asc`, `${k}.desc`]);
const isSortValue = oneOf(SORT_VALUES);

/** Narrow screens lose most sortable headers, so the sort is a select there (review UI-7). */
function SortSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="flex flex-col text-sm">
      <label htmlFor="sort-select">{COPY.sortSelect}</label>
      <select
        id="sort-select"
        className="min-h-11 rounded border border-slate-400 px-1"
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
 * Every provenance a Results page received: rows, their other sellers, the overall cheapest and the
 * calendar-gap prices. Any synthetic one raises the red banner, whatever /providers said (spec §5.5).
 */
function anySynthetic(data: ResultsResponse, gap: CalendarGapResponse | undefined): boolean {
  const rows = data.cheapest === null ? data.rows : [...data.rows, data.cheapest];
  const kinds = [
    ...rows.flatMap((r) => [r.provenance, ...r.otherOffers.map((o) => o.provenance)]),
    ...(gap === undefined
      ? []
      : [
          ...gap.cells.map((c) => c.calendar.provenance),
          ...(gap.cheapestVerified === null ? [] : [gap.cheapestVerified.provenance]),
        ]),
  ];
  // why: a fixture-provider provenance raises the banner even when its source kind is not tagged synthetic (ruling 3).
  return kinds.some((p) => p.sourceKind === 'synthetic' || p.providerId === 'fixture');
}

/** View A (spec §11): one fetch per basis; every sort and filter is core's pure function over that page. */
export function ResultsView({ definition }: { definition: DefinitionResponse }) {
  const params = useSearchParams();
  const basis = parseBasis(params.get('basis'));
  const ui = useMemo(() => parseResultsState(params), [params]);
  const results = useResults(definition.id, basis);
  const providers = useProviders();
  // why: the same cached query the calendar-gap banner reads; it only runs when a verification provider is configured.
  const gap = useCalendarGap(definition.id, results.data?.verificationProviderConfigured === true);
  const narrow = useMediaQuery(NARROW_QUERY);
  const { filtered, rows, banded } = useMemo(() => {
    if (results.data === undefined) return { filtered: [], rows: [], banded: new Set<string>() };
    const kept = filterRows(results.data.rows, ui.filters);
    // why: band over the filtered set, so "cheapest in its band" means among the rows the operator is looking at.
    const marked = bandCheapest(kept, BAND_HOURS);
    return {
      filtered: kept,
      rows: ui.sort === null ? kept : sortRows(kept, ui.sort.key, ui.sort.dir),
      banded: marked,
    };
  }, [results.data, ui]);
  const setSort = useCallback((value: string) => {
    const current = parseResultsState(new URLSearchParams(window.location.search));
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

  if (results.error) return <LoadError error={results.error} retry={() => void results.refetch()} />;
  if (results.data === undefined) return <Loading />;
  const data = results.data;
  const verificationConfigured = data.verificationProviderConfigured;
  const f = ui.filters;
  const failedHidden =
    f.verdictClass === undefined ? data.rows.filter((r) => r.verdictClass === 'failed').length : 0;
  const staleHidden = f.hideStale === true ? data.rows.filter((r) => r.stale).length : 0;
  const synthetic = providers.data?.synthetic !== true && anySynthetic(data, gap.data);
  const order =
    ui.sort === null ? COPY.serverOrder : COPY.sortOption(SORT_LABEL[ui.sort.key], COPY.sortDir[ui.sort.dir]);
  return (
    <div className="space-y-3">
      {synthetic ? <SyntheticBanner /> : null}
      <ViewHeader
        title={COPY.nav.results}
        executions={data.executions}
        stale={data.rows.length > 0 && data.rows.every((r) => r.stale)}
      />
      <ResultsHeader data={data} filteredFirst={filtered[0] ?? null} />
      <BasisSwitch basis={data.basis} reason={data.basisReason} />
      {verificationConfigured ? (
        <CalendarGapBanner definitionId={definition.id} destinationNotes={definition.destinationNotes} />
      ) : null}
      <Filters state={ui} rows={data.rows} calendarBasis={data.basis === 'calendar'} narrow={narrow} />
      <div className="flex flex-wrap items-end gap-3 text-sm">
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
          <span className="flex items-center gap-1">
            {COPY.failedHidden(failedHidden)}
            <button
              type="button"
              className="min-h-11 rounded border border-slate-500 px-3"
              onClick={() =>
                updateSearchParams(
                  resultsStatePatch({ ...ui, filters: setFilter(f, 'verdictClass', [...CLASSES]) }),
                )
              }
            >
              {COPY.showFailed}
            </button>
          </span>
        ) : null}
      </div>
      {data.rows.length === 0 ? (
        <p>
          <a
            href={hrefWith({ view: 'coverage' })}
            onClick={navigateTo({ view: 'coverage' })}
            className="underline"
          >
            {COPY.noRowsFromRun}
          </a>
        </p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-2">
          {COPY.noRowsAfterFilter}
          <button
            type="button"
            className="min-h-11 rounded border border-slate-500 px-3"
            onClick={() => updateSearchParams(resultsStatePatch({ ...ui, filters: {} }))}
          >
            {COPY.clearFilters}
          </button>
        </p>
      ) : (
        <ResultsTable
          rows={rows}
          banded={banded}
          selectedRow={parseSelectedRow(params)}
          sort={ui.sort}
          onSort={onSort}
          narrow={narrow}
          verificationConfigured={verificationConfigured}
          definitionId={definition.id}
        />
      )}
    </div>
  );
}
