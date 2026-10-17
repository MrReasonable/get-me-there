import { type CellKey, formatDuration, type Iata, type IsoDate, type IsoMonth, monthOf } from '@gmt/core';
import { useMemo, useState } from 'react';
import { useCalendar } from '../../api/queries.js';
import type { CalendarDay, DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { formatIsoMonth } from '../../format.js';
import { NARROW_QUERY, useMediaQuery } from '../../hooks/useMediaQuery.js';
import { useNow } from '../../now.js';
import { updateSearchParams, useSearchParams } from '../../state/urlState.js';
import { CalendarGrid } from './CalendarGrid.js';
import { CalendarLegend } from './CalendarLegend.js';
import { CellPanel } from './CellPanel.js';
import { ReusedNote } from './DayMarker.js';
import { defaultColourBasis } from './display.js';
import { type SliceOptions, sliceOf, totalReused } from './marker.js';
import { buildCalendarModel } from './model.js';
import type { DayBasis, GridDay } from './types.js';

/** URL keys of the view's state (ui-r1-016: filters survive navigation and links, like WP9's Results state). */
export const CALENDAR_PARAMS = { destination: 'cal.dest', basis: 'cal.basis', month: 'cal.month' } as const;

/** The destination filter from the URL: one of the definition's destinations, else all. */
export function parseDestination(raw: string | null, destinations: readonly Iata[]): Iata | 'all' {
  return destinations.find((d) => d === raw) ?? 'all';
}

/** The operator's chosen colour basis from the URL, or null for the default. */
export function parseBasis(raw: string | null): DayBasis | null {
  return raw === 'verified' || raw === 'calendar' ? raw : null;
}

function gridDays(days: readonly CalendarDay[], o: SliceOptions, destination: Iata | null): GridDay[] {
  return days.map((d) => ({ date: d.date, slice: sliceOf(d, o, destination) }));
}

/**
 * View B: the calendar heatmap for one definition (spec §11 View B, §10 calendar route; plan decisions 38, 53). A
 * destination filter is sent to the api, which computes that destination's counts, minimums and unconfirmed cells; the
 * days are rendered as they come. The default colour basis is judged on the all-destination calendar (the same query
 * the unfiltered view uses), so a filter change never flips what colour means.
 */
export function CalendarView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const params = useSearchParams();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [open, setOpen] = useState<{ date: IsoDate; cell: CellKey | null } | null>(null);
  const destination = parseDestination(params.get(CALENDAR_PARAMS.destination), definition.destinations);
  const filter = destination === 'all' ? null : destination;
  const q = useCalendar(definition.id, filter);
  const all = useCalendar(definition.id, null);
  const hasVerification = definition.providers.verification.length > 0;
  const discoveryProviders = definition.providers.discovery;
  const raw = q.data?.days;
  const allRaw = all.data?.days;

  const allDays = useMemo(
    () => gridDays(allRaw ?? [], { verificationConfigured: hasVerification, discoveryProviders }, null),
    [allRaw, hasVerification, discoveryProviders],
  );
  const days = useMemo(
    () => gridDays(raw ?? [], { verificationConfigured: hasVerification, discoveryProviders }, filter),
    [raw, filter, hasVerification, discoveryProviders],
  );
  const chosen = parseBasis(params.get(CALENDAR_PARAMS.basis));
  // why: plan decision 38 — the default is judged over all destinations, so a filter change never flips the colouring.
  const colourBasis: DayBasis =
    chosen === 'calendar' || (chosen === 'verified' && hasVerification)
      ? chosen
      : defaultColourBasis(allDays, hasVerification, now);
  const model = useMemo(() => buildCalendarModel(days, colourBasis, now), [days, colourBasis, now]);
  const months = useMemo(() => [...new Set(days.map((d) => monthOf(d.date)))], [days]);

  // why: the default basis needs the all-destination calendar too, so a filtered view waits for both.
  if (q.isPending || all.isPending) return <p role="status">{COPY.loading}</p>;
  if (q.isError) return <p role="alert">{COPY.loadFailed(q.error.message)}</p>;
  // why: the default basis is judged on the all-destination calendar (decision 38); without it say so, never judge on no days.
  if (all.isError) return <p role="alert">{COPY.loadFailed(all.error.message)}</p>;

  const C = COPY.calendarView;
  const wanted = months.find((m) => m === params.get(CALENDAR_PARAMS.month)) ?? months[0];
  // why: plan decision 38 — at phone width one month at a time as a compact grid, never every day stacked.
  const drawn: IsoMonth[] = narrow ? (wanted === undefined ? [] : [wanted]) : months;
  const at = wanted === undefined ? -1 : months.indexOf(wanted);
  const openSlice = open === null ? undefined : days.find((d) => d.date === open.date)?.slice;
  const closePanel = () => {
    const date = open?.date;
    setOpen(null);
    if (date !== undefined) document.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  };
  const setParam = (key: string, value: string | null) => updateSearchParams({ [key]: value }, 'replace');

  return (
    <section aria-label={C.title} className="flex flex-col gap-4">
      <ViewHeader
        variant="span"
        title={C.title}
        executions={q.data.executions}
        stale={model.shownPrices > 0 && model.stalePrices === model.shownPrices}
      />
      {model.stalePrices > 0 ? (
        <p className="text-sm">
          {C.staleLine(model.stalePrices, model.shownPrices, formatDuration(q.data.staleAfterHours))}
        </p>
      ) : null}
      <ReusedNote count={totalReused(days.map((d) => d.slice))} />
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col text-sm">
          {C.destinationFilter}
          <select
            value={destination}
            onChange={(e) =>
              setParam(CALENDAR_PARAMS.destination, e.target.value === 'all' ? null : e.target.value)
            }
            className="rounded border px-2 py-1"
          >
            <option value="all">{C.allDestinations}</option>
            {definition.destinations.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="text-sm">
          <legend>{C.colourBy}</legend>
          {(['verified', 'calendar'] as const).map((b) => (
            <label key={b} className="mr-3">
              <input
                type="radio"
                name="colour-basis"
                value={b}
                checked={colourBasis === b}
                disabled={b === 'verified' && !hasVerification}
                onChange={() => setParam(CALENDAR_PARAMS.basis, b)}
              />{' '}
              {COPY.basisName[b]}
            </label>
          ))}
        </fieldset>
      </div>
      {days.length === 0 ? (
        <p>{C.empty}</p>
      ) : (
        <>
          {/* why: ui-r2-006 — month navigation before the legend, so a phone reaches it without scrolling past */}
          {narrow && wanted !== undefined ? (
            <nav aria-label={C.monthNav} className="flex items-center gap-2 text-sm">
              <button
                type="button"
                disabled={at <= 0}
                onClick={() => setParam(CALENDAR_PARAMS.month, months[at - 1] ?? null)}
                className="rounded border px-2 disabled:opacity-50"
              >
                {C.previousMonth}
              </button>
              <span>{formatIsoMonth(wanted)}</span>
              <button
                type="button"
                disabled={at >= months.length - 1}
                onClick={() => setParam(CALENDAR_PARAMS.month, months[at + 1] ?? null)}
                className="rounded border px-2 disabled:opacity-50"
              >
                {C.nextMonth}
              </button>
            </nav>
          ) : null}
          <CalendarLegend model={model} />
          <CalendarGrid
            days={days}
            model={model}
            months={drawn}
            destinationNotes={definition.destinationNotes}
            compact={narrow}
            onOpen={(date, cell) => setOpen({ date, cell })}
          />
        </>
      )}
      {open !== null && openSlice !== undefined ? (
        <CellPanel
          definition={definition}
          date={open.date}
          slice={openSlice}
          executions={q.data.executions}
          initialCell={open.cell}
          inline={narrow}
          onClose={closePanel}
        />
      ) : null}
    </section>
  );
}
