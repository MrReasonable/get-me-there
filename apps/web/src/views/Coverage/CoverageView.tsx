import { type CellKey, DEFAULT_DISCOVERY_REFRESH_HOURS, hoursSince } from '@gmt/core';
import { useCoverage, useExecution, useExecutionActions } from '../../api/queries.js';
import type { CoverageResponse, DefinitionResponse } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { type HeaderRun, ViewHeader } from '../../components/ViewHeader.js';
import { type BucketName, COPY } from '../../copy.js';
import { formatIsoDate, formatMicroGbp, formatRunInstant } from '../../format.js';
import { useNow } from '../../now.js';

/** Spec §3 / §6.6: the six buckets, which sum to the cell count. */
const BUCKETS = [
  'priced',
  'empty',
  'no_data',
  'error',
  'skipped',
  'not_run',
] as const satisfies readonly BucketName[];

const cellText = (c: CellKey) =>
  COPY.cellLabel(c.origin, c.destination, formatIsoDate(c.departureDate), formatIsoDate(c.returnDate));
/** The two reasons the contract allows (`'not_run' | 'skipped:budget'`), each in words. */
const reasonText = (r: 'not_run' | 'skipped:budget') =>
  r === 'skipped:budget' ? COPY.reasonBudget : COPY.reasonNotRun;
/**
 * Ruling 15 (UI-004): the definition's on-demand itinerary searches below the parent run, each with its own buckets
 * per stage × provider and its own ledger calls, so the view never presents the parent's ledger as the whole spend.
 */
function OnDemand({ rows }: { rows: CoverageResponse['onDemand'] }) {
  return (
    <div className="text-sm">
      <h3 className="font-semibold">{COPY.coverageOnDemandHeading}</h3>
      {rows.length === 0 ? (
        <p>{COPY.coverageOnDemandNone}</p>
      ) : (
        <section aria-label={COPY.coverageOnDemandScroll} className="overflow-x-auto">
          <table aria-label={COPY.coverageOnDemandHeading} className="border-collapse">
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageOnDemandCell}
                </th>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageOnDemandRun}
                </th>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageStage}
                </th>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageProvider}
                </th>
                {BUCKETS.map((b) => (
                  <th key={b} scope="col" className="p-1 text-right">
                    {COPY.bucket[b]}
                  </th>
                ))}
                <th scope="col" className="p-1 text-left">
                  {COPY.requestsHeading}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((r) =>
                r.perStage.map((s) => (
                  <tr
                    key={`${r.executionId}-${s.stage}-${s.providerId}`}
                    className="border-t border-slate-200"
                  >
                    <th scope="row" className="p-1 text-left font-normal">
                      {cellText(r.cell)}
                    </th>
                    <td className="p-1">
                      {COPY.coverageOnDemandRunText(
                        COPY.statusName[r.status],
                        r.startedAt === null ? COPY.none : formatRunInstant(r.startedAt),
                      )}
                    </td>
                    <td className="p-1">{COPY.stageName[s.stage]}</td>
                    <td className="p-1">{COPY.provider[s.providerId]}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className="p-1 text-right tabular-nums">
                        {s.buckets[b]}
                      </td>
                    ))}
                    <td className="p-1" data-cost="">
                      {COPY.coverageOnDemandCalls(
                        s.requests.calls,
                        s.requests.cacheHits,
                        formatMicroGbp(s.requests.costMicroGbp),
                      )}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

/**
 * View D (spec §11): per stage × provider counts, estimate vs ledger, selected-not-reached, flags,
 * errors with retry. The header names the run these counts come from (coverage.executionId) with
 * its own status and age, never the results response's list (review prov-011).
 */
export function CoverageView({ definition }: { definition: DefinitionResponse }) {
  const now = useNow();
  const coverage = useCoverage(definition.id);
  const run = useExecution(coverage.data?.executionId ?? null);
  const actions = useExecutionActions();
  if (coverage.error) return <LoadError error={coverage.error} retry={() => void coverage.refetch()} />;
  if (coverage.data === undefined) return <Loading />;
  // why: the header names the run the counts come from; counts without their run's identity, status and age would read
  // as complete, so a failed run load is shown with a retry and the counts wait for the run (CodeRabbit batch 3)
  if (run.error) return <LoadError error={run.error} retry={() => void run.refetch()} />;
  if (run.data === undefined) return <Loading />;
  const c = coverage.data;
  const r = run.data;
  const at = r.finishedAt ?? r.startedAt;
  const header: HeaderRun[] = [
    {
      id: r.id,
      status: r.status,
      isChild: r.isChild,
      startedAt: r.startedAt,
      ageHours: at === null ? 'unknown' : hoursSince(at, now),
    },
  ];
  // why: stale means older than one refresh cycle of the definition's quickest-refreshing discovery provider;
  // core's default stands in only for a provider that names no interval, or when there is no discovery provider.
  const intervals = definition.providers.discovery.map(
    (p) => definition.providers.discoveryRefreshHours[p] ?? DEFAULT_DISCOVERY_REFRESH_HOURS,
  );
  const refresh = intervals.length === 0 ? DEFAULT_DISCOVERY_REFRESH_HOURS : Math.min(...intervals);
  const stale = header[0] !== undefined && header[0].ageHours !== 'unknown' && header[0].ageHours > refresh;
  const retryable = c.errors.some((e) => e.retryable);
  return (
    <div className="space-y-4">
      <ViewHeader title={COPY.coverageHeading} executions={header} stale={stale} />
      {c.perStage.length === 0 ? (
        <p>{COPY.coverageEmpty}</p>
      ) : (
        // why: a labelled region without tabIndex (decision 46); browsers make a scrollable overflow box keyboard-focusable themselves.
        <section aria-label={COPY.coverageScroll} className="overflow-x-auto">
          <table aria-label={COPY.coverageHeading} className="border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageStage}
                </th>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageProvider}
                </th>
                {BUCKETS.map((b) => (
                  <th key={b} scope="col" className="p-1 text-right">
                    {COPY.bucket[b]}
                  </th>
                ))}
                <th scope="col" className="p-1 text-right">
                  {COPY.coverageCells}
                </th>
                <th scope="col" className="border-l border-slate-400 p-1 text-right">
                  {COPY.coverageSearched}
                </th>
                <th scope="col" className="p-1 text-right">
                  {COPY.coverageWithPrice}
                </th>
                <th scope="col" className="p-1 text-left">
                  {COPY.requestsHeading}
                </th>
              </tr>
            </thead>
            <tbody>
              {c.perStage.map((s) => {
                const sum = BUCKETS.reduce((n, b) => n + s.buckets[b], 0);
                // why: "searched" is computed here from its definition (spec §3), never taken on trust.
                const searched = s.buckets.priced + s.buckets.empty + s.buckets.no_data;
                const planned = s.requests.planCalls === null ? COPY.none : String(s.requests.planCalls);
                return (
                  <tr key={`${s.stage}-${s.providerId}`} className="border-t border-slate-200 align-top">
                    <th scope="row" className="p-1 text-left font-normal">
                      {COPY.stageName[s.stage]}
                    </th>
                    <td className="p-1">{COPY.provider[s.providerId]}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className="p-1 text-right tabular-nums">
                        {s.buckets[b]}
                      </td>
                    ))}
                    <td className="p-1 text-right tabular-nums">{s.total}</td>
                    <td className="border-l border-slate-400 p-1 text-right tabular-nums">{searched}</td>
                    <td className="p-1 text-right tabular-nums">
                      {COPY.withPriceValue(s.buckets.priced, s.total)}
                    </td>
                    <td className="p-1" data-cost="">
                      {s.stage === 'discovery'
                        ? COPY.requestRowTiles(
                            s.requests.tiles,
                            planned,
                            s.requests.calls,
                            s.requests.cacheHits,
                            formatMicroGbp(s.requests.costMicroGbp),
                          )
                        : COPY.requestRow(
                            s.requests.calls,
                            planned,
                            s.requests.cacheHits,
                            formatMicroGbp(s.requests.costMicroGbp),
                          )}
                      {s.overrun ? (
                        <p className="font-semibold">
                          {s.stage === 'discovery' ? COPY.overrunFlagTiles : COPY.overrunFlag}
                        </p>
                      ) : null}
                      {s.parityBreak ? <p className="font-semibold">{COPY.parityFlag}</p> : null}
                      {sum !== s.total ? (
                        <p role="alert" className="font-semibold text-red-800">
                          {COPY.sumMismatch(sum, s.total)}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      {c.summary.reused > 0 ? <p className="text-sm">{COPY.reusedNote(c.summary.reused)}</p> : null}
      <OnDemand rows={c.onDemand} />
      <div className="text-sm">
        <h3 className="font-semibold">{COPY.coverageLegend}</h3>
        <ul aria-label={COPY.coverageLegend}>
          {BUCKETS.map((b) => (
            <li key={b}>{COPY.bucketHelp[b]}</li>
          ))}
          <li>{COPY.searchedHelp}</li>
          <li>{COPY.withPriceHelp}</li>
        </ul>
      </div>
      <div>
        <h3 className="font-semibold">{COPY.selectedNotReached}</h3>
        {c.selectedNotReached.length === 0 ? (
          <p className="text-sm">{COPY.noneSelectedNotReached}</p>
        ) : (
          <ul aria-label={COPY.selectedNotReached} className="text-sm">
            {c.selectedNotReached.map((x) => (
              <li key={`${x.cell.origin}${x.cell.destination}${x.cell.departureDate}${x.cell.returnDate}`}>
                {cellText(x.cell)}: {reasonText(x.reason)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="font-semibold">{COPY.errorsHeading}</h3>
        {c.errors.length === 0 ? (
          <p className="text-sm">{COPY.noErrors}</p>
        ) : (
          <ul aria-label={COPY.errorsHeading} className="text-sm">
            {c.errors.map((e) => (
              <li
                key={`${e.stage}${e.providerId}${e.cell.origin}${e.cell.destination}${e.cell.departureDate}${e.cell.returnDate}`}
              >
                {cellText(e.cell)}: {COPY.errorRow(e.reason ?? COPY.noReasonRecorded, e.attempts)}
                {e.lastError !== null ? ` ${COPY.lastError(e.lastError)}` : null}
              </li>
            ))}
          </ul>
        )}
        {retryable ? (
          <button
            type="button"
            className="mt-1 min-h-11 rounded border border-slate-500 px-3"
            onClick={() => actions.resume.mutate(c.executionId)}
          >
            {COPY.retry}
          </button>
        ) : null}
        {actions.resume.error ? <p role="alert">{COPY.actionFailed(actions.resume.error.message)}</p> : null}
      </div>
    </div>
  );
}
