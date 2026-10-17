import { effectiveAge, formatFetchedAgo, resultRowKey, type SortKey } from '@gmt/core';
import {
  createColumnHelper,
  type ExpandedState,
  rowExpandingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';
import type { ResultRow } from '../../api/types.js';
import { ClassBadge } from '../../components/ClassBadge.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell, priceUnconfirmed } from '../../components/PriceCell.js';
import { provenanceConsistent } from '../../components/Provenance.js';
import { COPY } from '../../copy.js';
import { formatIsoDate, formatMinutes } from '../../format.js';
import { useNow } from '../../now.js';
import { SORT_KEYS, type SortDir } from '../../state/resultsState.js';
import { ExpandedRow, rowName } from './ExpandedRow.js';

// why: only the expanding feature; sorting and filtering are core's functions over the fetched page (spec §6.5).
const features = tableFeatures({ rowExpandingFeature });
const helper = createColumnHelper<typeof features, ResultRow>();

export type ColumnId =
  | 'expand'
  | 'price'
  | 'totalTime'
  | 'departure'
  | 'return'
  | 'nights'
  | 'destination'
  | 'carriers'
  | 'stops'
  | 'class'
  | 'fetched'
  | 'provider'
  | 'adjusted';

/** Spec §11 column order (after the expand toggle); the spec mandates every one (ruling on UI-14). */
export const WIDE_COLUMNS: readonly ColumnId[] = [
  'expand',
  'price',
  'totalTime',
  'departure',
  'return',
  'nights',
  'destination',
  'carriers',
  'stops',
  'class',
  'fetched',
  'provider',
  'adjusted',
];
/** Spec §11 at 375px: price with provenance, the class badge, dates and stops stay in the primary row. */
/** The travel-time band `bandCheapest` marks within, in hours (spec §6.5); the one place the width is stated. */
export const BAND_HOURS = 6;

export const NARROW_COLUMNS: readonly ColumnId[] = [
  'expand',
  'price',
  'class',
  'departure',
  'return',
  'stops',
];

/** Which column sorts by which core SortKey; keyed by the column id string TanStack hands back. */
const SORT_KEY: ReadonlyMap<string, SortKey> = new Map<string, SortKey>(SORT_KEYS.map((k) => [k, k]));
/** The column label of each sort key, for the narrow-screen sort select and the order line. */
export const SORT_LABEL: Record<SortKey, string> = {
  price: COPY.columns.price,
  totalTime: COPY.columns.totalTime,
  departure: COPY.columns.departure,
  return: COPY.columns.return,
  nights: COPY.columns.nights,
  stops: COPY.columns.stops,
  adjusted: COPY.columns.adjusted,
};

type Sort = { key: SortKey; dir: SortDir } | null;

/** Row identity is core's resultRowKey (itineraryHash, or `calendar:<id>`): the bandCheapest Set and `?row=` both use it. */
export const rowId = (r: ResultRow): string => resultRowKey(r);

const detailId = (id: string) => `detail-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
const rowDomId = (id: string) => `row-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

/**
 * The sort and the band marks reach the cells through context, so the column definitions never change
 * when the sort or the filters do, and a header keeps keyboard focus after Enter (spec §11 keyboard-operable table).
 */
const TableContext = createContext<{ sort: Sort; onSort: (k: SortKey) => void; banded: ReadonlySet<string> }>(
  {
    sort: null,
    onSort: () => undefined,
    banded: new Set(),
  },
);

function SortHeader({ id }: { id: ColumnId }) {
  const { sort, onSort } = useContext(TableContext);
  const key = SORT_KEY.get(id);
  const label = COPY.columns[id];
  if (key === undefined) return <span>{label}</span>;
  const active = sort?.key === key;
  const next: SortDir = active && sort?.dir === 'asc' ? 'desc' : 'asc';
  return (
    <button
      type="button"
      className="min-h-11 underline"
      onClick={() => onSort(key)}
      aria-label={COPY.sortBy(label, COPY.sortDir[next])}
    >
      {label}
      {active ? (sort?.dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );
}

function FetchedAgo({ row }: { row: ResultRow }) {
  const now = useNow();
  return <span>{formatFetchedAgo(effectiveAge(row.provenance, now))}</span>;
}

/**
 * The price column: every price through PriceCell. Wide, the Provider and Destination columns carry
 * those, so the provenance line shows source and age (ruling on UI-14); narrow, the line is complete.
 */
function PriceColumn({ row, narrow }: { row: ResultRow; narrow: boolean }) {
  const banded = useContext(TableContext).banded.has(rowId(row));
  return (
    <div className="flex flex-col gap-0.5">
      <PriceBoundary>
        <PriceCell
          pricePence={row.pricePence}
          provenance={row.provenance}
          calendar={row.basis === 'calendar'}
          stale={row.stale}
          truncated={row.truncated}
          superseded={row.superseded}
          destination={row.cell.destination}
          destinationNote={row.destinationNote}
          notSeenInLatestHours={row.notSeenInLatest?.ageHours ?? null}
          besideColumns={!narrow}
          unconfirmed={priceUnconfirmed(row)}
        />
      </PriceBoundary>
      {row.basis === 'calendar' && row.notApplied.length > 0 ? (
        <span className="text-xs">
          {COPY.notApplied(row.notApplied.map((n) => COPY.constraint[n]).join(', '))}
        </span>
      ) : null}
      {banded ? <span className="text-xs font-medium">{COPY.bandCheapest(BAND_HOURS)}</span> : null}
    </div>
  );
}

/** The adjusted column: the same PriceCell, so it carries "≈", "stale" and its own words (review prov-009). */
function AdjustedColumn({ row }: { row: ResultRow }) {
  if (row.adjustedPence === null) return null;
  return (
    <PriceBoundary>
      <PriceCell
        pricePence={row.adjustedPence}
        provenance={row.provenance}
        calendar={row.basis === 'calendar'}
        stale={row.stale}
        truncated={row.truncated}
        superseded={row.superseded}
        qualifier={COPY.adjustedQualifier}
        besideColumns
        unconfirmed={priceUnconfirmed(row)}
      />
    </PriceBoundary>
  );
}

function cellFor(id: ColumnId, r: ResultRow, narrow: boolean) {
  const calendar = r.basis === 'calendar';
  // why: a row whose provenance is inconsistent (the fixture provider without the synthetic tag) is withheld whole:
  // only its identity (destination, dates) and the price column's withheld notice show (ruling 3).
  const withheld = !provenanceConsistent(r.provenance);
  if (
    withheld &&
    id !== 'price' &&
    id !== 'departure' &&
    id !== 'return' &&
    id !== 'nights' &&
    id !== 'destination' &&
    id !== 'expand'
  )
    return <span>{COPY.withheldCell}</span>;
  switch (id) {
    case 'price':
      return <PriceColumn row={r} narrow={narrow} />;
    case 'totalTime':
      return <span>{r.totalMinutes === null ? COPY.notChecked : formatMinutes(r.totalMinutes)}</span>;
    case 'departure':
      return <span>{formatIsoDate(r.cell.departureDate)}</span>;
    case 'return':
      return <span>{formatIsoDate(r.cell.returnDate)}</span>;
    case 'nights':
      return <span>{COPY.nightsValue(r.cell.nights)}</span>;
    case 'destination':
      return <span>{r.cell.destination}</span>;
    case 'carriers':
      return <span>{calendar ? COPY.notChecked : r.carriers.join(', ')}</span>;
    case 'stops':
      return (
        <span>
          {r.stopsOut === null || r.stopsIn === null
            ? COPY.notChecked
            : COPY.stopsValue(r.stopsOut, r.stopsIn)}
        </span>
      );
    case 'class':
      return <ClassBadge cls={r.verdictClass} />;
    case 'fetched':
      return <FetchedAgo row={r} />;
    case 'provider':
      return <span>{COPY.provider[r.provenance.providerId]}</span>;
    case 'adjusted':
      return <AdjustedColumn row={r} />;
    case 'expand':
      return null;
  }
}

function buildColumns(ids: readonly ColumnId[], narrow: boolean) {
  return ids.map((id) =>
    helper.display({
      id,
      header: () => <SortHeader id={id} />,
      cell: ({ row }) => {
        if (id !== 'expand') return cellFor(id, row.original, narrow);
        const open = row.getIsExpanded();
        const name = rowName(row.original);
        return (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded border border-slate-500"
            aria-expanded={open}
            aria-controls={detailId(row.id)}
            aria-label={open ? COPY.hideDetails(name) : COPY.showDetails(name)}
            onClick={row.getToggleExpandedHandler()}
          >
            {open ? '−' : '+'}
          </button>
        );
      },
    }),
  );
}

export interface ResultsTableProps {
  /** Non-empty: the view renders the empty states. */
  rows: readonly ResultRow[];
  /** Row keys core's bandCheapest marked over the filtered set (spec §6.5). */
  banded: ReadonlySet<string>;
  /** `?row=<resultRowKey>`: selected, expanded and scrolled to (email links). */
  selectedRow: string | null;
  sort: Sort;
  onSort: (k: SortKey) => void;
  narrow: boolean;
  verificationConfigured: boolean;
  definitionId: string;
}

/** View A table. Rows arrive filtered and sorted by core's functions; the table renders and expands. */
export function ResultsTable({
  rows,
  banded,
  selectedRow,
  sort,
  onSort,
  narrow,
  verificationConfigured,
  definitionId,
}: ResultsTableProps) {
  const [expanded, setExpanded] = useState<ExpandedState>(() =>
    selectedRow === null ? {} : { [selectedRow]: true },
  );
  const selectedPresent = selectedRow !== null && rows.some((r) => rowId(r) === selectedRow);
  useEffect(() => {
    // why: an email link lands here; bring its row into view once the rows are rendered.
    if (selectedRow !== null && selectedPresent)
      document.getElementById(rowDomId(selectedRow))?.scrollIntoView({ block: 'center' });
  }, [selectedRow, selectedPresent]);
  const adjusted = rows.some((r) => r.adjustedPence !== null);
  const ids = useMemo(
    () => (narrow ? NARROW_COLUMNS : WIDE_COLUMNS.filter((c) => c !== 'adjusted' || adjusted)),
    [narrow, adjusted],
  );
  const columns = useMemo(() => buildColumns(ids, narrow), [ids, narrow]);
  const context = useMemo(() => ({ sort, onSort, banded }), [sort, onSort, banded]);
  const data = useMemo(() => [...rows], [rows]);
  const table = useTable({
    features,
    columns,
    data,
    getRowId: rowId,
    getRowCanExpand: () => true,
    state: { expanded },
    onExpandedChange: setExpanded,
  });
  return (
    <TableContext.Provider value={context}>
      {/* why: a labelled scroll region, so a table wider than the screen scrolls inside itself, not the page (UI-3). */}
      <section aria-label={COPY.resultsScroll} className="overflow-x-auto">
        <table aria-label={COPY.resultsTableLabel} className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((h) => {
                  const key = SORT_KEY.get(h.column.id);
                  const ariaSort =
                    key === undefined
                      ? undefined
                      : sort?.key === key
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none';
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={ariaSort}
                      className="border-b border-slate-400 p-1 text-left"
                    >
                      <table.FlexRender header={h} />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>
                <tr
                  id={rowDomId(row.id)}
                  aria-current={row.id === selectedRow ? 'true' : undefined}
                  className={`border-b border-slate-200 align-top ${row.id === selectedRow ? 'bg-amber-50 outline outline-2 outline-amber-600' : ''}`}
                >
                  {row.getAllCells().map((c) => (
                    <td key={c.id} className="p-1">
                      <table.FlexRender cell={c} />
                    </td>
                  ))}
                </tr>
                {row.getIsExpanded() ? (
                  <tr id={detailId(row.id)}>
                    <td colSpan={ids.length} className="bg-slate-50">
                      <ExpandedRow
                        row={row.original}
                        extras={narrow}
                        verificationConfigured={verificationConfigured}
                        definitionId={definitionId}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </TableContext.Provider>
  );
}
