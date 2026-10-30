import {
  type CellKey,
  DEFAULT_DISCOVERY_REFRESH_HOURS,
  hoursSince,
  LEFT_FOR_TEXT,
  SKIP_DETAIL_TEXT,
} from '@gmt/core';
import { useId } from 'react';
import { useCoverage, useExecution, useExecutionActions } from '../../api/queries.js';
import type { CoverageResponse, DefinitionResponse } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { type HeaderRun, ViewHeader } from '../../components/ViewHeader.js';
import { type BucketName, COPY } from '../../copy.js';
import { formatIsoDate, formatMicroGbp, formatRunInstant } from '../../format.js';
import { useNow } from '../../now.js';
import { datesPatch } from '../../state/datesState.js';
import { updateSearchParams } from '../../state/urlState.js';

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
      <h3 className="h-sub mb-1">{COPY.coverageOnDemandHeading}</h3>
      {rows.length === 0 ? (
        <p>{COPY.coverageOnDemandNone}</p>
      ) : (
        <section aria-label={COPY.coverageOnDemandScroll} className="overflow-x-auto">
          <table aria-label={COPY.coverageOnDemandHeading} className="data-table">
            <thead>
              <tr>
                <th scope="col">{COPY.coverageOnDemandCell}</th>
                <th scope="col">{COPY.coverageOnDemandRun}</th>
                <th scope="col">{COPY.coverageStage}</th>
                <th scope="col">{COPY.coverageProvider}</th>
                {BUCKETS.map((b) => (
                  <th key={b} scope="col" className="text-right">
                    {COPY.bucket[b]}
                  </th>
                ))}
                <th scope="col">{COPY.requestsHeading}</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((r) =>
                r.perStage.map((s) => (
                  <tr key={`${r.executionId}-${s.stage}-${s.providerId}`}>
                    <th scope="row" className="font-normal">
                      {cellText(r.cell)}
                    </th>
                    <td>
                      {COPY.coverageOnDemandRunText(
                        COPY.statusName[r.status],
                        r.startedAt === null ? COPY.none : formatRunInstant(r.startedAt),
                      )}
                    </td>
                    <td>{COPY.stageName[s.stage]}</td>
                    <td>{COPY.provider[s.providerId]}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className="text-right tabular-nums">
                        {s.buckets[b]}
                      </td>
                    ))}
                    <td data-cost="">
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
 * What the Coverage view held (spec §11 Dates "Coverage section"; moved here by WP19 §4): per stage × provider counts
 * in the six buckets with "searched" as the umbrella beside them (the one place it appears) and the "with a price"
 * share, estimate vs ledger, selected-not-reached, flags, errors with retry, the browser provider's left cells and the
 * on-demand searches. The header names the run these counts come from (coverage.executionId) with its own status and
 * age, never the date-pairs read's (review prov-011).
 */
export function CoverageBody({ definition }: { definition: DefinitionResponse }) {
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
      // why: review S8 — a skipped firing names its time and reason here as History does (ViewHeader's one formatter)
      scheduledFor: r.scheduledFor,
      skipCode: r.skipCode,
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
          <table aria-label={COPY.coverageHeading} className="data-table">
            <thead>
              <tr>
                <th scope="col">{COPY.coverageStage}</th>
                <th scope="col">{COPY.coverageProvider}</th>
                {BUCKETS.map((b) => (
                  <th key={b} scope="col" className="text-right">
                    {COPY.bucket[b]}
                  </th>
                ))}
                <th scope="col" className="text-right">
                  {COPY.coverageCells}
                </th>
                <th scope="col" className="border-l border-line-strong text-right">
                  {COPY.coverageSearched}
                </th>
                <th scope="col" className="text-right">
                  {COPY.coverageWithPrice}
                </th>
                <th scope="col">{COPY.requestsHeading}</th>
              </tr>
            </thead>
            <tbody>
              {c.perStage.map((s) => {
                const sum = BUCKETS.reduce((n, b) => n + s.buckets[b], 0);
                // why: "searched" is computed here from its definition (spec §3), never taken on trust.
                const searched = s.buckets.priced + s.buckets.empty + s.buckets.no_data;
                const planned = s.requests.planCalls === null ? COPY.none : String(s.requests.planCalls);
                return (
                  <tr key={`${s.stage}-${s.providerId}`}>
                    <th scope="row" className="font-normal">
                      {COPY.stageName[s.stage]}
                    </th>
                    <td>{COPY.provider[s.providerId]}</td>
                    {BUCKETS.map((b) => (
                      <td key={b} className="text-right tabular-nums">
                        {s.buckets[b]}
                      </td>
                    ))}
                    <td className="text-right tabular-nums">{s.total}</td>
                    <td className="border-l border-line-strong text-right tabular-nums">{searched}</td>
                    <td className="text-right tabular-nums">
                      {COPY.withPriceValue(s.buckets.priced, s.total)}
                    </td>
                    <td data-cost="">
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
                      {s.requests.scrolls !== undefined ? (
                        <p data-testid="scrolls">{COPY.scrollsRow(s.requests.scrolls)}</p>
                      ) : null}
                      {s.overrun ? (
                        <p className="font-semibold">
                          {s.stage === 'discovery' ? COPY.overrunFlagTiles : COPY.overrunFlag}
                        </p>
                      ) : null}
                      {s.parityBreak ? <p className="font-semibold">{COPY.parityFlag}</p> : null}
                      {sum !== s.total ? (
                        <p role="alert" className="bad-text">
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
        <h3 className="h-sub mb-1">{COPY.coverageLegend}</h3>
        <ul aria-label={COPY.coverageLegend}>
          {BUCKETS.map((b) => (
            <li key={b}>{COPY.bucketHelp[b]}</li>
          ))}
          <li>{COPY.searchedHelp}</li>
          <li>{COPY.withPriceHelp}</li>
        </ul>
      </div>
      <div>
        <h3 className="h-sub mb-1">{COPY.selectedNotReached}</h3>
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
      {c.scheduledOnly.length > 0 ? (
        <div>
          <h3 className="h-sub mb-1">{COPY.scheduledOnlyHeading(LEFT_FOR_TEXT[c.browserLeftFor])}</h3>
          <ul aria-label={COPY.scheduledOnlyHeading(LEFT_FOR_TEXT[c.browserLeftFor])} className="text-sm">
            {c.scheduledOnly.map((g) => (
              <li key={`${g.stage}${g.providerId}${g.detail}`}>
                {COPY.scheduledOnlyRow(
                  COPY.provider[g.providerId],
                  COPY.stageName[g.stage],
                  g.cells,
                  SKIP_DETAIL_TEXT[g.detail],
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <h3 className="h-sub mb-1">{COPY.errorsHeading}</h3>
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
            className="btn mt-2 min-h-11"
            onClick={() => actions.resume.mutate(c.executionId)}
          >
            {COPY.retry}
          </button>
        ) : null}
        {actions.resume.error ? (
          <p role="alert" className="bad-text">
            {COPY.actionFailed(actions.resume.error.message)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Spec §11 Dates "Coverage section": folded by default; the header line's coverage link, `d.coverage=open` and
 * `?view=coverage` (Task 19.7) open it. It reads `GET /definitions/:id/coverage` only while open, over the latest
 * parent run, and says the filters do not narrow it.
 */
export function CoverageSection({ definition, open }: { definition: DefinitionResponse; open: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-toggle`} className="plate coverage-plate">
      <h3>
        <button
          id={`${id}-toggle`}
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          className="coverage-toggle min-h-11"
          onClick={() => updateSearchParams(datesPatch({ coverageOpen: !open }), 'replace')}
        >
          {COPY.datesView.coverageToggle}
        </button>
      </h3>
      <p className="px-[18px] pb-3 text-sm text-fg-2">{COPY.datesView.coverageNotFiltered}</p>
      <div id={`${id}-body`} className="coverage-body">
        {open ? <CoverageBody definition={definition} /> : null}
      </div>
    </section>
  );
}
