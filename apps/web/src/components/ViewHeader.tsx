import type { ExecutionSummary } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatInstantUtc } from '../format.js';

export interface ViewHeaderProps {
  title: string;
  /** ExecutionSummary rows, newest first (plan "API contract"); `ageHours` may be 'unknown'. Only these fields are read. */
  executions: readonly HeaderRun[];
  stale: boolean;
  /**
   * 'span': a cross-execution view (decisions 42, 46; WP10's Calendar, Duration and History): the runs are
   * named and no single run status or not-completed banner applies. Default 'single'.
   */
  variant?: 'single' | 'span';
}

/** The fields of an ExecutionSummary the header names. */
export type HeaderRun = Pick<ExecutionSummary, 'id' | 'status' | 'isChild' | 'startedAt' | 'ageHours'>;

/** A run with no start has no age to give: it says "not started yet" (review prov-r2-011). */
function itemText(e: HeaderRun): string {
  const status = COPY.statusName[e.status];
  if (e.startedAt === null)
    return e.isChild ? COPY.childExecutionNotStarted(status) : COPY.executionNotStarted(status);
  const make = e.isChild ? COPY.childExecutionItem : COPY.executionItem;
  return make(formatInstantUtc(e.startedAt), status, COPY.agoOf(e.ageHours));
}

/**
 * Spec §11: every view header names the executions shown (by start time, never an id), their status
 * and age, a stale label, and a banner when the latest run that produced the view is not completed.
 */
export function ViewHeader({ title, executions, stale, variant = 'single' }: ViewHeaderProps) {
  const span = variant === 'span';
  // why: a one-cell child run never stands for the view; the banner follows the newest parent run.
  const latest = executions.find((e) => !e.isChild);
  const list = executions.map(itemText).join(', ');
  return (
    <div className="mb-2 space-y-1">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-sm text-slate-700">
        {executions.length === 0 ? COPY.noExecution : COPY.executionsShown(list)}
      </p>
      {span && executions.length > 0 ? (
        <p className="text-sm text-slate-700">{COPY.spanExecutions(executions.length)}</p>
      ) : null}
      {stale ? (
        <p className="text-sm">
          <span className="mr-1 rounded bg-amber-200 px-1">{COPY.stale}</span>
          {COPY.staleView}
        </p>
      ) : null}
      {!span && latest !== undefined && latest.status !== 'completed' ? (
        <p role="status" className="rounded bg-amber-100 px-2 py-1 text-sm">
          {COPY.notCompletedBanner(COPY.statusName[latest.status])}
        </p>
      ) : null}
    </div>
  );
}
