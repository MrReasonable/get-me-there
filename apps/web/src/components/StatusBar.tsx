import { ACTIVE_STATUSES, apiContract, budgetScopeLabel, capWarn, RESUMABLE_STATUSES } from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useCoverage, useExecution, useExecutionActions, useResults } from '../api/queries.js';
import { failureOf, useStatus } from '../api/statusQuery.js';
import type { DefinitionResponse, ExecutionResponse, UsageRow } from '../api/types.js';
import { COPY } from '../copy.js';
import { formatIsoDate, formatMicroGbp, formatRunInstant } from '../format.js';
import { useCheckedWords } from '../hooks/useCheckedWords.js';
import { NARROW_QUERY, useMediaQuery } from '../hooks/useMediaQuery.js';
import { BASIS_PARAM, DATES_COVERAGE, parseBasis } from '../state/resultsState.js';
import { hrefWith, navigateTo, useSearchParams } from '../state/urlState.js';
import { LoadError } from './LoadState.js';

const ACTIVE: ReadonlySet<string> = new Set(ACTIVE_STATUSES);
/** Active runs the API will resume: the paused two and an interrupted one (spec §7; derived, never hand-listed). */
const RESUMABLE_ACTIVE: ReadonlySet<string> = new Set(
  ACTIVE_STATUSES.filter((s) => RESUMABLE_STATUSES.includes(s)),
);

/**
 * Spec §11 progress, one line per stage × provider (never summed across providers). Ruling 4 (decision 67): the line
 * names the six buckets, so a run whose cells mostly came back "no cached data" never reads as fully covered; the
 * "searched" umbrella appears only in View D beside its breakdown (spec §3, §6.6). The progress bar's value is the
 * cells answered or failed so far (priced, no fares, no cached data, error), which only a screen reader's number uses.
 * The itinerary-search line counts against the selected cells (spec §3, §11) when the results response gives N.
 */
function progressLines(e: ExecutionResponse, selected: number | null) {
  return e.progress.map((p) => {
    const l = {
      stage: COPY.stageName[p.stage],
      provider: COPY.provider[p.providerId],
      buckets: p.buckets,
      total: p.total,
    };
    const bySelection = p.stage === 'verification' && selected !== null;
    return {
      ...l,
      key: `${p.stage}-${p.providerId}`,
      done: p.buckets.priced + p.buckets.empty + p.buckets.no_data + p.buckets.error,
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
/** At or above 80% of the cap, by core's one rule (a cap of 0 or no cap is never near; review V8). */
export const near = (used: number, cap: number | null): boolean => capWarn(used, cap);

function Spend({ text, used, cap }: { text: string; used: number; cap: number | null }) {
  // why: data-cost marks a cost or cap figure, never a fare; the rendered sweep allows "£" only in a PriceCell or here.
  return (
    <span data-cost="">
      {text}
      {near(used, cap) ? <span className="tag tag-warn ml-1">{COPY.nearCap}</span> : null}
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

/**
 * The status bar's link to the Status view (spec §11), from the same query as the view and core's one `barSummary`:
 * any fail "Status: n failing", any warn the quieter "Status: n to check", the area named when there is one. Nothing
 * for ok checks (notes included) and while the first answer is awaited. After a failed refresh it says the report is
 * stale and how old; with no report, that the app is not answering: never a clean state from old data.
 */
export function StatusLink() {
  const q = useStatus();
  const checked = useCheckedWords(q.data?.generatedAt ?? null);
  let text: string | null = null;
  let tone = '';
  let glyph = '';
  if (q.data === undefined) {
    if (q.error) {
      text = {
        'not-answering': COPY.statusLink.notAnswering,
        'sign-in-refused': COPY.statusLink.signInRefused,
        'report-failed': COPY.statusLink.reportFailed,
      }[failureOf(q.error)];
      tone = 'font-semibold text-bad';
      glyph = '✕';
    }
  } else if (q.isRefetchError && checked !== null) {
    text = COPY.statusLink.stale(checked);
    tone = 'text-warn';
    glyph = '▲';
  } else {
    const bar = apiContract.barSummary(q.data.checks);
    if (bar.kind !== 'clean') {
      text = bar.text;
      tone = bar.kind === 'fail' ? 'font-semibold text-bad' : 'text-warn';
      glyph = bar.kind === 'fail' ? '✕' : '▲';
    }
  }
  if (text === null) return null;
  return (
    // why: V11 (ui-b1-004): the key labels the landmark; the link keeps its own text as its name, so the count is read
    <section aria-label={COPY.statusLink.label} className="statusline">
      <a
        href={hrefWith({ view: 'status' })}
        onClick={navigateTo({ view: 'status' })}
        className={`inline-flex min-h-11 items-center gap-1.5 underline ${tone}`}
      >
        {/* why: a glyph beside the words, so failing and to check differ in more than colour */}
        <span aria-hidden="true" className="tag-glyph">
          {glyph}
        </span>
        {text}
      </a>
    </section>
  );
}

/**
 * "Run now" with the estimate it will spend (spec §11: the status bar on Results and Definitions, and the Dates view's
 * never-run state), confirmed by the definition's stored calls and pence (decision 43); blocked, with the reason, while
 * the estimate is above what was confirmed. The caller owns the mutation, so its error shows where it was pressed.
 */
export function RunNowButton({
  definition,
  start,
}: {
  definition: DefinitionResponse;
  start: ReturnType<typeof useExecutionActions>['start'];
}) {
  const est = definition.estimate;
  return (
    <>
      <button
        type="button"
        data-cost=""
        className="btn btn-primary btn-sm min-h-11"
        disabled={definition.needsConfirmation !== null || start.isPending}
        aria-busy={start.isPending ? true : undefined}
        onClick={() =>
          start.mutate({
            id: definition.id,
            confirmCostPence: definition.confirmedCostPence,
            confirmCalls: definition.confirmedCalls,
          })
        }
      >
        {start.isPending
          ? COPY.working
          : est === null
            ? COPY.runNowUnestimated
            : COPY.runNow(est.totalCalls, definition.budget.maxCalls, formatMicroGbp(est.totalCostMicroGbp))}
      </button>
      {definition.needsConfirmation !== null ? <span>{COPY.runNowBlocked}</span> : null}
    </>
  );
}

export interface StatusBarProps {
  definition: DefinitionResponse | null;
  /** "Run now" appears only on Dates and Definitions (review UI-10; WP19 Task 19.7: Dates replaced Results). */
  showRunNow: boolean;
  /**
   * The view shows its own Run now while the search has never run (the Dates view's never-run state), so the bar leaves
   * it out until a run exists: the action is offered once, as that state's primary action.
   */
  viewOwnsFirstRun?: boolean;
}

/**
 * Spec §11 status bar, on every view: the link to the Status view, then the run's stage, progress, spend, paused reason
 * + Resume, blocked schedule and Cancel. The link needs no definition; the run's part does.
 */
export function StatusBar(props: StatusBarProps) {
  return (
    <>
      <StatusLink />
      <RunStatus {...props} />
    </>
  );
}

/** The run's part of the bar: stage, progress, spend, paused reason + Resume, blocked schedule, Cancel. */
function RunStatus({ definition, showRunNow, viewOwnsFirstRun = false }: StatusBarProps) {
  const params = useSearchParams();
  const results = useResults(definition?.id ?? null, parseBasis(params.get(BASIS_PARAM)));
  const executions = results.data?.executions ?? [];
  // why: lists are newest first; the bar follows the newest parent run, and a one-cell child is a separate line.
  const latestId = executions.find((x) => !x.isChild)?.id ?? null;
  const child = executions.find((x) => x.isChild && ACTIVE.has(x.status)) ?? null;
  const execution = useExecution(latestId);
  const coverage = useCoverage(definition?.id ?? null);
  const actions = useExecutionActions();
  const qc = useQueryClient();
  // why: the confirmation is bound to the run it was opened for; if the bar moves to another run, it must be asked again.
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  const narrow = useMediaQuery(NARROW_QUERY);
  // why: a confirmation belongs to the run on display; once another run (or none) is shown it is abandoned, and coming
  // back to the first run must ask for Cancel again rather than revive it.
  const displayedId = execution.data?.id;
  useEffect(() => {
    setConfirmingCancelId((open) => (open !== null && open !== displayedId ? null : open));
    return () => setConfirmingCancelId(null);
  }, [displayedId]);

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

  const loadError = results.error ?? execution.error;
  const retryLoad = () => {
    if (results.error) void results.refetch();
    if (execution.error) void execution.refetch();
  };
  const confirmingCancel = e !== undefined && confirmingCancelId === e.id;
  const canResume = e !== undefined && RESUMABLE_ACTIVE.has(e.status);
  const busy = (m: { isPending: boolean }) => (m.isPending ? true : undefined);

  return (
    <section aria-label={COPY.statusBarLabel} className="statusline run-status">
      <div className="flex flex-wrap items-center gap-3">
        {/* why: only the status words are announced as they change; the child-run line and the numbers are not. */}
        <span aria-live="polite" className="flex flex-wrap items-center gap-x-3">
          {e === undefined ? (
            loadError ? null : (
              <span>{results.data !== undefined && latestId === null ? COPY.noExecution : COPY.loading}</span>
            )
          ) : (
            <>
              <span className="status-word" data-status={e.status}>
                {COPY.statusName[e.status]}
              </span>
              {e.stage !== null ? <span>{COPY.stageName[e.stage]}</span> : null}
              {e.status === 'paused_budget' || e.status === 'paused_error' ? (
                <span className="warn-text">
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
          <span className="warn-text">{COPY.scheduleBlocked(formatIsoDate(blockedSince.slice(0, 10)))}</span>
        ) : null}
        {e && canResume ? (
          <button
            type="button"
            className="btn btn-sm min-h-11"
            disabled={actions.resume.isPending}
            aria-busy={busy(actions.resume)}
            onClick={() => actions.resume.mutate(e.id)}
          >
            {actions.resume.isPending ? COPY.working : COPY.resume}
          </button>
        ) : null}
        {e && active && !confirmingCancel ? (
          <button type="button" className="btn btn-sm min-h-11" onClick={() => setConfirmingCancelId(e.id)}>
            {COPY.cancel}
          </button>
        ) : null}
        {e && active && confirmingCancel ? (
          <>
            <button
              type="button"
              className="btn btn-danger btn-sm min-h-11"
              disabled={actions.cancel.isPending}
              aria-busy={busy(actions.cancel)}
              onClick={() => {
                setConfirmingCancelId(null);
                actions.cancel.mutate(e.id);
              }}
            >
              {COPY.confirmCancel}
            </button>
            <button type="button" className="btn btn-sm min-h-11" onClick={() => setConfirmingCancelId(null)}>
              {COPY.keepRunning}
            </button>
          </>
        ) : null}
        {showRunNow &&
        !active &&
        results.data !== undefined &&
        !(viewOwnsFirstRun && executions.length === 0) ? (
          <RunNowButton definition={definition} start={actions.start} />
        ) : null}
      </div>
      {e !== undefined ? (
        // why: on a phone a finished run's numbers fold into one line (spec §11 375px); Cancel, Resume and the status stay
        // visible above. An active or paused run keeps them open (ruling 15, UI-006): spend is never hidden while it grows.
        <details open={!narrow || active} className="fold statusline-details">
          <summary className="min-h-11">{COPY.runDetails}</summary>
          <div className="run-numbers">
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
            {/* why: spec §11: the progress breakdown links to the Dates view's coverage section (WP19 Task 19.7) */}
            <a href={hrefWith(DATES_COVERAGE)} onClick={navigateTo(DATES_COVERAGE)} className="link">
              {COPY.progressCoverageLink}
            </a>
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
        <span role="alert" className="bad-text">
          {COPY.actionFailed(failure.message)}
        </span>
      ) : null}
    </section>
  );
}
