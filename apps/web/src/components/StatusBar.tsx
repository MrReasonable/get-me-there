import { ACTIVE_STATUSES, apiContract } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCoverage, useExecution, useExecutionActions, useResults } from '../api/queries.js';
import type { DefinitionResponse, ExecutionResponse, UsageRow } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatInstantUtc, formatIsoDate, formatMicroGbp } from '../format.js';
import { parseBasis } from '../state/resultsState.js';
import { useSearchParams } from '../state/urlState.js';

const ACTIVE: ReadonlySet<string> = new Set(ACTIVE_STATUSES);
/** Spend at or above this share of a cap is marked "near cap" (review UI-10). */
const NEAR_CAP = 0.8;

/**
 * Spec §11 progress, one line per stage × provider (never summed across providers). "Done" counts
 * only outcomes a provider answered or failed on: priced, no fares, no cached data, error (decision 36);
 * skipped and not-searched cells are stated beside it, so the three always add up to the cell count.
 * The itinerary-search line counts against the selected cells, "itinerary-searched K of N selected"
 * (spec §3, §11), when the results response gives N.
 */
function progressLines(e: ExecutionResponse, selected: number | null) {
  return e.progress.map((p) => {
    const l = {
      stage: COPY.stageName[p.stage],
      provider: COPY.provider[p.providerId],
      verb: COPY.progressVerb[p.stage],
      done: p.buckets.priced + p.buckets.empty + p.buckets.no_data + p.buckets.error,
      total: p.total,
      error: p.buckets.error,
      skipped: p.buckets.skipped,
      notRun: p.buckets.not_run,
    };
    const bySelection = p.stage === 'verification' && selected !== null;
    return {
      ...l,
      key: `${p.stage}-${p.providerId}`,
      max: bySelection ? selected : p.total,
      text: bySelection ? COPY.progressSelected({ ...l, selected }) : COPY.progress(l),
    };
  });
}

/** Usage rows carry WP8's scope label (`execution-calls`, `global-month`, `provider-month:searchapi`). */
function usageOf(e: ExecutionResponse, label: string): UsageRow | null {
  return e.budget.find((u) => u.scope === label) ?? null;
}

const capText = (cap: number | null, fmt: (n: number) => string): string =>
  cap === null ? COPY.noCap : fmt(cap);
/** At or above 80% of the cap; any use of a zero cap counts (it is already over); no cap is never near. */
export const near = (used: number, cap: number | null): boolean =>
  cap !== null && used > 0 && used >= cap * NEAR_CAP;

function Spend({ text, used, cap }: { text: string; used: number; cap: number | null }) {
  // why: data-cost marks a cost or cap figure, never a fare; the rendered sweep allows "£" only in a PriceCell or here.
  return (
    <span data-cost="">
      {text}
      {near(used, cap) ? (
        <span className="ml-1 rounded bg-amber-200 px-1 font-medium">{COPY.nearCap}</span>
      ) : null}
    </span>
  );
}

/** `provider-month:<id>` rows: the call cap is the hard stop on a subscription plan (spec §1, §5.3). */
function ProviderMonths({ e }: { e: ExecutionResponse }) {
  return e.budget
    .filter((u) => u.scope.startsWith('provider-month:'))
    .map((u) => {
      const id = apiContract.providerIdSchema.safeParse(u.scope.slice('provider-month:'.length));
      const name = id.success ? COPY.provider[id.data] : u.scope;
      return (
        <Spend
          key={u.scope}
          text={COPY.spendProviderMonth(name, u.calls, capText(u.cap, String))}
          used={u.calls}
          cap={u.cap}
        />
      );
    });
}

export interface StatusBarProps {
  definition: DefinitionResponse | null;
  /** "Run now" appears only on Results and Definitions (review UI-10). */
  showRunNow: boolean;
}

/** Spec §11 status bar, on every view: stage, progress, spend, paused reason + Resume, blocked schedule, Cancel. */
export function StatusBar({ definition, showRunNow }: StatusBarProps) {
  const params = useSearchParams();
  const results = useResults(definition?.id ?? null, parseBasis(params.get('basis')));
  const executions = results.data?.executions ?? [];
  // why: lists are newest first; the bar follows the newest parent run, and a one-cell child is a separate line.
  const latestId = executions.find((x) => !x.isChild)?.id ?? null;
  const child = executions.find((x) => x.isChild && ACTIVE.has(x.status)) ?? null;
  const execution = useExecution(latestId);
  const coverage = useCoverage(definition?.id ?? null);
  const actions = useExecutionActions();
  const qc = useQueryClient();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  // why: when a polled run changes status, the rows and coverage it produced change too.
  const status = execution.data?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current !== undefined && previous.current !== status) {
      void qc.invalidateQueries({ queryKey: ['results'] });
      void qc.invalidateQueries({ queryKey: ['coverage'] });
    }
    previous.current = status;
  }, [status, qc]);

  if (definition === null) return null;
  const blockedSince = coverage.data?.scheduleBlockedSince ?? null;
  const e = execution.data;
  const failure = actions.cancel.error ?? actions.resume.error ?? actions.start.error;
  const runCalls = e ? usageOf(e, 'execution-calls') : null;
  const freeCalls = e ? usageOf(e, 'execution-free-calls') : null;
  const runCost = e ? usageOf(e, 'execution-cost') : null;
  const month = e ? usageOf(e, 'global-month') : null;
  const active = e !== undefined && ACTIVE.has(e.status);
  const est = definition.estimate;

  return (
    <section
      aria-label={COPY.statusBarLabel}
      className="flex flex-wrap items-center gap-3 border-b border-slate-300 bg-slate-50 px-4 py-2 text-sm"
    >
      <span aria-live="polite" className="flex flex-wrap items-center gap-3">
        {e === undefined ? (
          <span>{results.data !== undefined && latestId === null ? COPY.noExecution : COPY.loading}</span>
        ) : (
          <>
            <span className="font-semibold">{COPY.statusName[e.status]}</span>
            {e.stage !== null ? <span>{COPY.stageName[e.stage]}</span> : null}
            {e.status === 'paused_budget' || e.status === 'paused_error' ? (
              <span className="font-medium">
                {COPY.paused(e.reason ?? COPY.statusName[e.status])}
                {e.resumeAfter !== null ? ` · ${COPY.resumesAt(formatInstantUtc(e.resumeAfter))}` : null}
              </span>
            ) : null}
          </>
        )}
        {child !== null ? <span>{COPY.childRun(COPY.statusName[child.status])}</span> : null}
      </span>
      {e !== undefined
        ? progressLines(e, results.data?.coverage.selected ?? null).map((l) => (
            <span
              key={l.key}
              role="progressbar"
              aria-label={COPY.progressLabel(l.stage, l.provider)}
              aria-valuemin={0}
              aria-valuemax={l.max}
              aria-valuenow={l.done}
            >
              {l.text}
            </span>
          ))
        : null}
      {runCalls ? (
        <Spend
          text={COPY.spendRunCalls(runCalls.calls, capText(runCalls.cap, String))}
          used={runCalls.calls}
          cap={runCalls.cap}
        />
      ) : null}
      {freeCalls ? (
        <Spend
          text={COPY.spendRunFreeCalls(freeCalls.calls, capText(freeCalls.cap, String))}
          used={freeCalls.calls}
          cap={freeCalls.cap}
        />
      ) : null}
      {runCost ? (
        <Spend
          text={COPY.spendRunCost(formatMicroGbp(runCost.costMicroGbp), capText(runCost.cap, formatMicroGbp))}
          used={runCost.costMicroGbp}
          cap={runCost.cap}
        />
      ) : null}
      {month ? (
        <Spend
          text={COPY.spendMonth(formatMicroGbp(month.costMicroGbp), capText(month.cap, formatMicroGbp))}
          used={month.costMicroGbp}
          cap={month.cap}
        />
      ) : null}
      {e ? <ProviderMonths e={e} /> : null}
      {blockedSince !== null ? (
        <span className="font-medium">{COPY.scheduleBlocked(formatIsoDate(blockedSince.slice(0, 10)))}</span>
      ) : null}
      {e && (e.status === 'paused_budget' || e.status === 'paused_error') ? (
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3"
          onClick={() => actions.resume.mutate(e.id)}
        >
          {COPY.resume}
        </button>
      ) : null}
      {e && active && !confirmingCancel ? (
        <button
          type="button"
          className="min-h-11 rounded border border-slate-500 px-3"
          onClick={() => setConfirmingCancel(true)}
        >
          {COPY.cancel}
        </button>
      ) : null}
      {e && active && confirmingCancel ? (
        <>
          <button
            type="button"
            className="min-h-11 rounded border border-red-800 px-3 font-medium text-red-900"
            onClick={() => {
              setConfirmingCancel(false);
              actions.cancel.mutate(e.id);
            }}
          >
            {COPY.confirmCancel}
          </button>
          <button
            type="button"
            className="min-h-11 rounded border border-slate-500 px-3"
            onClick={() => setConfirmingCancel(false)}
          >
            {COPY.keepRunning}
          </button>
        </>
      ) : null}
      {showRunNow && !active && results.data !== undefined ? (
        <>
          <button
            type="button"
            data-cost=""
            className="min-h-11 rounded border border-slate-500 px-3 disabled:opacity-60"
            disabled={definition.needsConfirmation !== null}
            onClick={() =>
              actions.start.mutate({
                id: definition.id,
                confirmCostPence: definition.confirmedCostPence,
                confirmCalls: definition.confirmedCalls,
              })
            }
          >
            {est === null
              ? COPY.runNowUnestimated
              : COPY.runNow(
                  est.totalCalls,
                  definition.budget.maxCalls,
                  formatMicroGbp(est.totalCostMicroGbp),
                )}
          </button>
          {definition.needsConfirmation !== null ? <span>{COPY.runNowBlocked}</span> : null}
        </>
      ) : null}
      {failure ? (
        <span role="alert" className="text-red-800">
          {COPY.actionFailed(failure.message)}
        </span>
      ) : null}
    </section>
  );
}
