import { useId, useMemo } from 'react';
import { useDurationAnalysis } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { ViewHeader } from '../../components/ViewHeader.js';
import { COPY } from '../../copy.js';
import { DurationChart, DurationTable } from './DurationChart.js';
import { buildDurationData } from './data.js';

/** View C: cheapest found per stay length (spec §11 View C, §10 duration-analysis route). */
export function DurationView({ definition }: { definition: DefinitionResponse }) {
  const q = useDurationAnalysis(definition.id);
  const tableId = useId();
  const data = useMemo(
    () =>
      q.data === undefined
        ? null
        : buildDurationData(
            q.data,
            definition.minNights,
            definition.maxNights,
            definition.providers.verification.length > 0,
          ),
    [q.data, definition],
  );
  if (q.isPending) return <p role="status">{COPY.loading}</p>;
  if (q.isError) return <p role="alert">{COPY.loadFailed(q.error.message)}</p>;
  const shown = data?.shownPrices ?? 0;
  const stale = data?.stalePrices ?? 0;
  return (
    <section aria-label={COPY.durationView.title} className="flex flex-col gap-4">
      <ViewHeader
        variant="span"
        title={COPY.durationView.title}
        executions={q.data.executions}
        stale={shown > 0 && stale === shown}
      />
      {stale > 0 ? <p className="text-sm">{COPY.durationView.staleLine(stale, shown)}</p> : null}
      {data === null || data.isEmpty ? (
        <p>{COPY.durationView.empty}</p>
      ) : (
        <>
          <DurationChart data={data} tableId={tableId} notes={definition.destinationNotes} />
          <DurationTable data={data} id={tableId} notes={definition.destinationNotes} />
        </>
      )}
    </section>
  );
}
