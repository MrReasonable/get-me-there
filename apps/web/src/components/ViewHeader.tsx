import { SKIP_CODE_TEXT } from '@gmt/core';
import type { ExecutionSummary } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatRunInstant } from '../format.js';

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
export type HeaderRun = Pick<
  ExecutionSummary,
  'id' | 'status' | 'isChild' | 'startedAt' | 'ageHours' | 'scheduledFor' | 'skipCode'
>;

/**
 * A run with no start has no age to give: it says "not started yet" (review prov-r2-011), or, for a scheduled row that
 * never started (a skip), the firing it stands for and, for a missed firing, the reason recorded with it (review R17).
 */
function itemText(e: HeaderRun): string {
  const status =
    e.skipCode === null
      ? COPY.statusName[e.status]
      : COPY.skippedWhy(COPY.statusName[e.status], SKIP_CODE_TEXT[e.skipCode]);
  if (e.startedAt === null && !e.isChild && e.scheduledFor !== null)
    return COPY.firingNotStarted(formatRunInstant(e.scheduledFor), status);
  if (e.startedAt === null)
    return e.isChild ? COPY.childExecutionNotStarted(status) : COPY.executionNotStarted(status);
  const make = e.isChild ? COPY.childExecutionItem : COPY.executionItem;
  return make(formatRunInstant(e.startedAt), status, COPY.agoOf(e.ageHours));
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
      <h2 className="h-section">{title}</h2>
      <p className="text-sm text-fg-2">
        {executions.length === 0 ? COPY.noExecution : COPY.executionsShown(list)}
      </p>
      {span && executions.length > 0 ? (
        <p className="text-sm text-fg-2">
          {COPY.spanExecutions(
            executions.filter((e) => !e.isChild).length,
            executions.filter((e) => e.isChild).length,
          )}
        </p>
      ) : null}
      {stale ? (
        <p className="text-sm">
          <span className="tag tag-warn mr-2">{COPY.stale}</span>
          {COPY.staleView}
        </p>
      ) : null}
      {!span && latest !== undefined && latest.status !== 'completed' ? (
        <p role="status" className="plate notice text-sm font-semibold">
          {COPY.notCompletedBanner(COPY.statusName[latest.status])}
        </p>
      ) : null}
    </div>
  );
}
