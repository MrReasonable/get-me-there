import type { CellKey, Iata } from '@gmt/core';
import { useId } from 'react';
import { useCellDetail } from '../../api/queries.js';
import type { CalendarGapResponse, DefinitionResponse, ExecutionSummary } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { CellDetailBody, VerifySection } from './PanelSections.js';

const P = COPY.panel;

/**
 * A calendar-gap cell of this date pair (spec §11, decision 58): its calendar price below the reference verified price,
 * and that reference, which is the whole search's (the gap route is not narrowed by the date pair or any filter).
 */
export interface GapMark {
  calendar: CalendarGapResponse['cells'][number]['calendar'];
  reference: NonNullable<CalendarGapResponse['cheapestVerified']>;
}

export interface AirportPairPanelProps {
  definition: DefinitionResponse;
  /** The date pair's cell on this panel's airport pair. */
  cell: CellKey;
  /** The detail's executions, newest first: they order and label the outcome rows. */
  executions: readonly ExecutionSummary[];
  gap: GapMark | null;
}

/**
 * Spec §11 Date pair detail, "Per airport pair" (what the Calendar's side panel was; WP19 Task 19.6 moved it): the
 * cell's outcomes per run, stage and provider with reasons (§3's texts for left browser cells), its prices each with
 * full provenance and point of sale through PriceCell (superseded ones marked), the calendar-gap mark when this cell
 * is one, and, with a verification provider, the per-cell verify action with what it may spend.
 */
export function AirportPairPanel({ definition, cell, executions, gap }: AirportPairPanelProps) {
  const headingId = useId();
  const detail = useCellDetail(definition.id, cell);
  const canVerify = definition.providers.verification.length > 0;
  const note = definition.destinationNotes[cell.destination] ?? null;
  return (
    <section aria-labelledby={headingId} data-testid="airport-pair-panel" className="plate pair-plate">
      <h3 id={headingId} className="h-section">
        {P.heading(cell.origin, cell.destination)}
      </h3>
      {gap !== null ? (
        <Gap gap={gap} destination={cell.destination} notes={definition.destinationNotes} />
      ) : null}
      {detail.isPending ? (
        <p role="status" className="loading-line">
          {COPY.loading}
        </p>
      ) : null}
      {detail.isError ? (
        <p role="alert" className="bad-text">
          {COPY.loadFailed(detail.error.message)}
        </p>
      ) : null}
      {detail.data !== undefined ? (
        <CellDetailBody detail={detail.data} executions={executions} note={note} />
      ) : null}
      {canVerify ? <VerifySection definition={definition} cell={cell} detail={detail.data} /> : null}
    </section>
  );
}

/**
 * The gap mark: the cell's calendar price (constraints not checked) and the reference it is below, each through
 * PriceCell. why: no unconfirmed badge on the reference: it is chosen from class-verified rows only (WP8), and a price
 * the final step did not confirm is never class verified (decision 37; review prov-wp09-r3-002).
 */
function Gap({
  gap,
  destination,
  notes,
}: {
  gap: GapMark;
  destination: Iata;
  /** The operator's per-destination notes (spec §11): every price for a destination carries its note. */
  notes: Partial<Record<Iata, string>>;
}) {
  const ref = gap.reference;
  return (
    <div data-testid="gap-mark" className="inset mt-3 flex flex-wrap items-center gap-2 p-3 text-sm">
      <span aria-hidden="true" className="tag tag-warn">
        ▲
      </span>
      <span className="font-bold">{COPY.calendarGapLead(1)}</span>
      <PriceBoundary>
        <PriceCell
          pricePence={gap.calendar.pricePence}
          provenance={gap.calendar.provenance}
          calendar
          stale={gap.calendar.stale}
          truncated={gap.calendar.truncated}
          destination={destination}
          destinationNote={notes[destination] ?? null}
        />
      </PriceBoundary>
      <span>{COPY.datesView.gapReference}</span>
      <PriceBoundary>
        <PriceCell
          pricePence={ref.pricePence}
          provenance={ref.provenance}
          calendar={false}
          stale={ref.stale}
          truncated={ref.truncated}
          destination={ref.cell.destination}
          destinationNote={notes[ref.cell.destination] ?? null}
          notSeenInLatestHours={ref.notSeenInLatest?.ageHours ?? null}
        />
      </PriceBoundary>
    </div>
  );
}
