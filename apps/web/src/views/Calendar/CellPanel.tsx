import { type CellKey, cellKeyString, daysBetween, type IsoDate } from '@gmt/core';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useCellDetail, useExecutionActions } from '../../api/queries.js';
import type { DefinitionResponse, ExecutionSummary } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatDayShort, formatIsoDateLong } from '../../format.js';
import { DayMarker } from './DayMarker.js';
import { CellDetailBody, DayPrices, VerifyCost } from './PanelSections.js';
import { canPressVerify, cellsForDay, toKey, verifyCellName } from './panel.js';
import type { DaySlice } from './types.js';

const P = COPY.calendarView.panel;

export interface CellPanelProps {
  definition: DefinitionResponse;
  date: IsoDate;
  /** The day as the grid shows it: its six-bucket marker and its prices with full provenance live here. */
  slice: DaySlice;
  /** The calendar response's executions, newest first: they order and label the outcome rows. */
  executions: readonly ExecutionSummary[];
  initialCell: CellKey | null;
  /**
   * At phone width the panel is a section of the page below the grid, not an overlay (review ui-r2-010): a full-width
   * non-modal dialog would let Tab wander into the hidden grid behind it.
   */
  inline: boolean;
  onClose(): void;
}

/**
 * View B side panel (spec §11, plan decision 38): the day's six-bucket marker and its prices with full provenance; a
 * cell picker; that cell's outcomes per run, stage and provider, newest first; its prices; and the per-cell verify
 * action with what it may spend. Verify is hidden without a verification provider (spec §8.1).
 */
export function CellPanel(props: CellPanelProps) {
  const { definition, date, slice, executions, initialCell, inline, onClose } = props;
  const cells = useMemo(() => cellsForDay(definition, date), [definition, date]);
  const [selected, setSelected] = useState<CellKey | null>(
    initialCell === null ? (cells[0] ?? null) : toKey(initialCell),
  );
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const detail = useCellDetail(definition.id, selected);
  const verify = useExecutionActions().verify;
  const canVerify = definition.providers.verification.length > 0;
  const key = selected === null ? '' : cellKeyString(selected);
  const selectedIndex = cells.findIndex((c) => cellKeyString(c) === key);
  const notes = definition.destinationNotes;

  const body: ReactNode = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {P.title(formatIsoDateLong(date))}
        </h2>
        <button type="button" onClick={onClose} className="rounded border px-2">
          {P.close}
        </button>
      </div>
      <section aria-label={P.dayHeading} className="mt-3 flex flex-col gap-2">
        <h3 className="font-medium">{P.dayHeading}</h3>
        <DayMarker slice={slice} />
        <DayPrices slice={slice} notes={notes} />
      </section>
      <label className="mt-3 flex flex-col text-sm">
        {P.cellPicker}
        <select
          value={selectedIndex >= 0 ? String(selectedIndex) : ''}
          onChange={(e) => setSelected(cells[Number(e.target.value)] ?? null)}
          className="rounded border px-2 py-1"
        >
          {cells.map((c, i) => (
            <option key={cellKeyString(c)} value={String(i)}>
              {P.cellOption(
                c.origin,
                c.destination,
                daysBetween(c.departureDate, c.returnDate),
                formatDayShort(c.returnDate),
              )}
            </option>
          ))}
        </select>
      </label>
      {selected !== null && detail.isPending ? <p role="status">{COPY.loading}</p> : null}
      {detail.isError ? <p role="alert">{COPY.loadFailed(detail.error.message)}</p> : null}
      {detail.data !== undefined ? (
        <CellDetailBody
          detail={detail.data}
          executions={executions}
          note={notes[detail.data.cell.destination] ?? null}
        />
      ) : null}
      {canVerify && selected !== null ? (
        <div className="mt-4 flex flex-col gap-1">
          {detail.data === undefined ? (
            <p data-testid="verify-cost" className="text-xs">
              {P.verifyCostLoading}
            </p>
          ) : (
            <VerifyCost verify={detail.data.verify} />
          )}
          <button
            type="button"
            disabled={!canPressVerify(detail.data, verify.isPending)}
            onClick={() => verify.mutate({ definitionId: definition.id, cell: selected })}
            className="self-start rounded bg-slate-900 px-3 py-1 text-white disabled:bg-slate-400"
          >
            {COPY.verifyCellFor(verifyCellName(selected))}
          </button>
          {verify.isSuccess ? <p role="status">{COPY.verifyStartedFor(verifyCellName(selected))}</p> : null}
          {verify.isError ? <p role="alert">{verifyError(verify.error)}</p> : null}
        </div>
      ) : null}
    </>
  );
  const onKeyDown = (e: { key: string; preventDefault(): void }) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  if (inline) {
    return (
      <section
        aria-labelledby={headingId}
        data-testid="cell-panel"
        onKeyDown={onKeyDown}
        className="mt-2 border-t pt-4"
      >
        {body}
      </section>
    );
  }
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={headingId}
      data-testid="cell-panel"
      onKeyDown={onKeyDown}
      className="fixed inset-y-0 right-0 z-10 w-full max-w-lg overflow-y-auto border-l bg-white p-4 shadow-lg"
    >
      {body}
    </aside>
  );
}

/** A refusal in words: a running child, a named budget cap (409 `cap`, WP8 passes the engine's message), or else. */
function verifyError(error: Error): string {
  if (error instanceof ApiError && error.status === 409) {
    return error.code === 'cap' ? P.verifyCapRefused(error.message) : P.verifyConflict;
  }
  return COPY.actionFailed(error.message);
}
