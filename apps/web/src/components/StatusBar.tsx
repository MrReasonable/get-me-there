import { ACTIVE_STATUSES, apiContract, budgetScopeLabel, RESUMABLE_STATUSES } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCoverage, useExecution, useExecutionActions, useResults } from '../api/queries.js';
import type { DefinitionResponse, ExecutionResponse, UsageRow } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatIsoDate, formatMicroGbp, formatRunInstant } from '../format.js';
import { NARROW_QUERY, useMediaQuery } from '../hooks/useMediaQuery.js';
import { parseBasis } from '../state/resultsState.js';
import { useSearchParams } from '../state/urlState.js';
import { LoadError } from './LoadState.js';

const ACTIVE: ReadonlySet<string> = new Set(ACTIVE_STATUSES);
/** Active runs the API will resume: the paused two and an interrupted one (spec §7; derived, never hand-listed). */
const RESUMABLE_ACTIVE: ReadonlySet<string> = new Set(
  ACTIVE_STATUSES.filter((s) => RESUMABLE_STATUSES.includes(s)),
);
/** Spend at or above this share of a cap is marked "near cap" (review UI-10). */
const NEAR_CAP = 0.8;

/**
 * Spec §11 progress, one line per stage × provider (never summed across providers). The bar counts
 * attempts, labelled "attempted": priced, no fares, no cached data, error (decision 36), since "searched" is View D's
 * word and excludes errors;
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

/** Usage rows carry WP8's scope label, which core's `budgetScopeLabel` formats (decisions 54, 57). */
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

/**
 * Each provider's binding window (ruling 2, decision 67): the API sends only the window the plan uses, the month on a
 * monthly plan and the lifetime on the trial, so the bar renders whichever arrives, worded as the Providers view words
 * it, and the near-cap mark reads that window's cap. The call cap is the hard stop (spec §1, §5.3).
 */
function ProviderWindows({ e }: { e: ExecutionResponse }) {
  return apiContract.providerIdSchema.options.map((providerId) => {
    const provider = COPY.provider[providerId];
    const month = usageOf(e, budgetScopeLabel({ kind: 'provider-month', providerId }));
    const lifetime = usageOf(e, budgetScopeLabel({ kind: 'provider-lifetime', providerId }));
    const u = lifetime ?? month;
    if (u === null) return null;
    const cap = capText(u.cap, String);
    return (
      <Spend
        key={providerId}
        text={
          lifetime !== null
            ? COPY.spendProviderLifetime(provider, u.calls, cap)
            : COPY.spendProviderMonth(provider, u.calls, cap)
        }
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
  const narrow = useMediaQuery(NARROW_QUERY);

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
  const runCalls = e ? usageOf(e, budgetScopeLabel({ kind: 'execution-calls', executionId: e.id })) : null;
  const freeCalls = e
    ? usageOf(e, budgetScopeLabel({ kind: 'execution-free-calls', executionId: e.id }))
    : null;
  const runCost = e ? usageOf(e, budgetScopeLabel({ kind: 'execution-cost', executionId: e.id })) : null;
  const month = e ? usageOf(e, budgetScopeLabel({ kind: 'global-month' })) : null;
  const active = e !== undefined && ACTIVE.has(e.status);
  const est = definition.estimate;

  const loadError = results.error ?? execution.error;
  const retryLoad = () => {
    if (results.error) void results.refetch();
    if (execution.error) void execution.refetch();
  };
  const canResume = e !== undefined && RESUMABLE_ACTIVE.has(e.status);
  const busy = (m: { isPending: boolean }) => (m.isPending ? true : undefined);

  return (
    <section
      aria-label={COPY.statusBarLabel}
      className="flex flex-col gap-1 border-b border-slate-300 bg-slate-50 px-4 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* why: only the status words are announced as they change; the child-run line and the numbers are not. */}
        <span aria-live="polite" className="flex flex-wrap items-center gap-3">
          {e === undefined ? (
            loadError ? null : (
              <span>{results.data !== undefined && latestId === null ? COPY.noExecution : COPY.loading}</span>
            )
          ) : (
            <>
              <span className="font-semibold">{COPY.statusName[e.status]}</span>
              {e.stage !== null ? <span>{COPY.stageName[e.stage]}</span> : null}
              {e.status === 'paused_budget' || e.status === 'paused_error' ? (
                <span className="font-medium">
                  {COPY.paused(e.reason ?? COPY.statusName[e.status])}
                  {e.resumeAfter !== null ? ` · ${COPY.resumesAt(formatRunInstant(e.resumeAfter))}` : null}
                </span>
              ) : null}
            </>
          )}
        </span>
        {loadError ? <LoadError error={loadError} retry={retryLoad} /> : null}
        {child !== null ? <span>{COPY.childRun(COPY.statusName[child.status])}</span> : null}
        {blockedSince !== null ? (
          <span className="font-medium">
            {COPY.scheduleBlocked(formatIsoDate(blockedSince.slice(0, 10)))}
          </span>
        ) : null}
        {e && canResume ? (
          <button
            type="button"
            className="min-h-11 rounded border border-slate-500 px-3"
            disabled={actions.resume.isPending}
            aria-busy={busy(actions.resume)}
            onClick={() => actions.resume.mutate(e.id)}
          >
            {actions.resume.isPending ? COPY.working : COPY.resume}
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
              disabled={actions.cancel.isPending}
              aria-busy={busy(actions.cancel)}
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
              disabled={definition.needsConfirmation !== null || actions.start.isPending}
              aria-busy={busy(actions.start)}
              onClick={() =>
                actions.start.mutate({
                  id: definition.id,
                  confirmCostPence: definition.confirmedCostPence,
                  confirmCalls: definition.confirmedCalls,
                })
              }
            >
              {actions.start.isPending
                ? COPY.working
                : est === null
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
      </div>
      {e !== undefined ? (
        // why: on a phone the numbers fold into one line (spec §11 375px); Cancel, Resume and the status stay visible above.
        <details open={!narrow} className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2">{COPY.runDetails}</summary>
          <div className="flex flex-wrap items-center gap-3">
            {progressLines(e, results.data?.coverage.selected ?? null).map((l) => (
              <span
                key={l.key}
                role="progressbar"
                aria-label={COPY.progressLabel(l.stage, l.provider)}
                aria-valuemin={0}
                aria-valuemax={l.max}
                aria-valuenow={l.done}
                aria-valuetext={l.text}
              >
                {l.text}
              </span>
            ))}
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
                text={COPY.spendRunCost(
                  formatMicroGbp(runCost.costMicroGbp),
                  capText(runCost.cap, formatMicroGbp),
                )}
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
            <ProviderWindows e={e} />
          </div>
        </details>
      ) : null}
      {failure ? (
        <span role="alert" className="text-red-800">
          {COPY.actionFailed(failure.message)}
        </span>
      ) : null}
    </section>
  );
}
