import { type CellKey, cellKeyString, isPriceUnconfirmed, priceUnconfirmed, resultRowKey } from '@gmt/core';
import { useState } from 'react';
import { ApiError } from '../../api/client.js';
import { useExecutionActions } from '../../api/queries.js';
import type { CellDetailResponse, DefinitionResponse, ExecutionSummary } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { verifyCellName } from '../../components/VerifyCellButton.js';
import { COPY } from '../../copy.js';
import { formatInstantLondon } from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import { instantMs } from '../../lib/time.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import {
  canPressVerify,
  noHeadroom,
  orderCalendarPrices,
  orderOutcomes,
  reasonText,
  runLabel,
} from './panel.js';

// The per-airport-pair panel's sections (review arch2-008: the panel component keeps the shell). Moved from the
// Calendar's side panel (WP19 Task 19.6), which uses them too until Task 19.8 removes it.

const P = COPY.panel;
const COLUMNS = [
  'run',
  'stage',
  'provider',
  'status',
  'reason',
  'attempts',
  'fetched',
  'detail',
  'reused',
] as const;
// why: ui-r2-010 — the Run column stays in view while the nine-column table scrolls sideways on a phone.
const STICKY = 'sticky left-0 bg-enamel';

/**
 * "hard stop N calls · M calls of budget headroom left" beside the button (decisions 38, 42, 45: WP7's childCapPreview;
 * decision 44: a cap is stated as a hard stop, never "up to").
 */
export function VerifyCost({
  verify,
  runCapZero = false,
}: {
  verify: CellDetailResponse['verify'];
  /** N2: the definition allows 0 billed calls, which no headroom can fix; the line names the setting that does. */
  runCapZero?: boolean;
}) {
  if (verify === null) return null;
  if (runCapZero)
    return (
      <p data-testid="verify-cost" className="text-xs font-semibold">
        {P.verifyZeroRunCap(verify.needCalls)}
      </p>
    );
  return (
    <p data-testid="verify-cost" className="text-xs">
      {P.verifyCost(verify.maxCalls, verify.headroomCalls)}
      {noHeadroom(verify) ? <span className="block font-bold">{P.verifyNoHeadroom}</span> : null}
    </p>
  );
}

// Observations are ResultRows; their searchLink may be null (synthetic rows, plan decision 15). The panel never renders it.
export function CellDetailBody(props: {
  detail: CellDetailResponse;
  executions: readonly ExecutionSummary[];
  note: string | null;
}) {
  const { detail, executions, note } = props;
  const latest = executions[0]?.id ?? null;
  const empty = detail.calendarPrices.length + detail.observations.length === 0;
  return (
    <>
      <h3 className="h-sub mt-4 mb-1">{P.outcomes}</h3>
      <div className="overflow-x-auto">
        <table className="data-table outcomes w-full">
          <thead>
            <tr>
              {COLUMNS.map((k) => (
                <th key={k} scope="col" className={`text-left ${k === 'run' ? STICKY : ''}`}>
                  {P.columns[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderOutcomes(detail.outcomes, executions).map((o) => (
              <tr
                key={`${o.executionId}|${o.stage}|${o.providerId}`}
                data-current={o.executionId === latest ? 'true' : 'false'}
              >
                <th scope="row" className={`text-left font-normal ${STICKY}`}>
                  {runLabel(o.executionId, executions)}
                  {o.executionId === latest ? <span className="block font-bold">{P.latestRun}</span> : null}
                </th>
                <td>{COPY.stageName[o.stage]}</td>
                <td>{COPY.provider[o.providerId]}</td>
                <td>
                  {COPY.bucket[o.status]}
                  {/* why: decision 48: a priced verification outcome with no confirmed price says so beside its status */}
                  {o.status === 'priced' && isPriceUnconfirmed(o.reason) ? (
                    <span className="block font-semibold">{COPY.panel.unconfirmedShort}</span>
                  ) : null}
                </td>
                <td>
                  {reasonText(o.reason, o.skipDetail, {
                    leftFor: detail.browserLeftFor,
                    latest: o.executionId === detail.latestExecutionId,
                  })}
                </td>
                <td>{o.attempts}</td>
                <td>{o.fetchedAt === null ? P.dash : formatInstantLondon(instantMs(o.fetchedAt))}</td>
                <td>{o.lastError ?? P.dash}</td>
                <td>
                  {o.reusedFromExecutionId === null
                    ? P.dash
                    : P.reusedFrom(runLabel(o.reusedFromExecutionId, executions))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="h-sub mt-4 mb-1">{P.prices}</h3>
      {empty ? (
        <p>{P.noPrices}</p>
      ) : (
        <ul className="prices flex flex-col">
          {orderCalendarPrices(detail.calendarPrices).map((p) => (
            <li key={`cal-${p.calendarPriceId}`}>
              <span className="text-xs text-fg-2">
                {P.calendarPriceRun(runLabel(p.executionId, executions))}
              </span>
              <PriceBoundary>
                <PriceCell
                  pricePence={p.pricePence}
                  provenance={p.provenance}
                  calendar
                  stale={p.stale}
                  truncated={p.truncated}
                  superseded={p.superseded}
                  destination={detail.cell.destination}
                  destinationNote={note}
                />
              </PriceBoundary>
            </li>
          ))}
          {detail.observations.map((o) => (
            <li
              key={`obs-${o.observationId ?? o.itineraryHash}-${o.seller ?? ''}`}
              data-testid="panel-observation"
            >
              <span className="text-xs text-fg-2">
                {P.observation(o.seller ?? COPY.none, COPY.classLabel[o.verdictClass])}
              </span>{' '}
              {/* why: WP9 owns ?row=<resultRowKey>, which selects and scrolls to that results row (plan decision 14) */}
              <a
                href={hrefWith({ view: 'results', row: resultRowKey(o) })}
                onClick={navigateTo({ view: 'results', row: resultRowKey(o) })}
                className="text-xs font-semibold underline"
              >
                {P.showInResults}
              </a>
              <PriceBoundary>
                {/* why: decision 44 and review prov-r2-001: an unconfirmed offer says so first, beside its amount */}
                <PriceCell
                  pricePence={o.pricePence}
                  provenance={o.provenance}
                  calendar={o.basis === 'calendar'}
                  stale={o.stale}
                  truncated={o.truncated}
                  unconfirmed={priceUnconfirmed(o)}
                  {...figureMarks(o)}
                  destination={o.cell.destination}
                  destinationNote={note}
                />
              </PriceBoundary>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The per-cell verify action (spec §8.1, §11): what the child search may spend, then "Search <cell> for itineraries
 * (uses billed calls)", which hands the started search to the status bar through the shared execution actions. The
 * status belongs to the cell that was submitted: a panel showing another cell shows none (moved from the Calendar's
 * side panel, WP19 Task 19.6).
 */
export function VerifySection({
  definition,
  cell,
  detail,
}: {
  definition: Pick<DefinitionResponse, 'id' | 'budget'>;
  cell: CellKey;
  /** The cell's detail once loaded: its `verify` preview is what the click confirms. */
  detail: CellDetailResponse | undefined;
}) {
  const verify = useExecutionActions().verify;
  const key = cellKeyString(cell);
  // why: the cell the last verify was sent for; the mutation's own status says nothing about which cell that was.
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
      {detail === undefined ? (
        <p data-testid="verify-cost" className="text-xs">
          {P.verifyCostLoading}
        </p>
      ) : (
        <VerifyCost verify={detail.verify} runCapZero={definition.budget.maxCalls === 0} />
      )}
      <button
        type="button"
        disabled={!canPressVerify(detail, verify.isPending)}
        onClick={() => {
          setSubmittedKey(key);
          verify.mutate({
            definitionId: definition.id,
            cell,
            // why: cost-004: the click confirms the hard stop shown above (and £0, so a priced estimate still asks), so
            // a cap-share soft confirm on a small trial window never dead-ends the button.
            ...(detail?.verify ? { confirmCalls: detail.verify.maxCalls, confirmCostPence: 0 } : {}),
          });
        }}
        className="btn btn-primary min-h-11 self-start"
      >
        {COPY.verifyCellFor(verifyCellName(cell))}
      </button>
      {/* why: the status belongs to the cell that was submitted; another cell shows none */}
      {verify.isSuccess && submittedKey === key ? (
        <p role="status">{COPY.verifyStartedFor(verifyCellName(cell))}</p>
      ) : null}
      {verify.isError && submittedKey === key ? <p role="alert">{verifyError(verify.error)}</p> : null}
    </div>
  );
}

/**
 * A refusal in words: a named budget cap (409 `cap`) or a confirmation the click did not cover (409 `confirm`, with the
 * engine's estimate, cost-004), each with WP8's message; a running child (409 `active`); or else.
 */
function verifyError(error: Error): string {
  if (error instanceof ApiError && error.status === 409) {
    if (error.code === 'cap') return P.verifyCapRefused(error.message);
    if (error.code === 'confirm') return P.verifyConfirmRefused(error.message);
    return P.verifyConflict;
  }
  return COPY.actionFailed(error.message);
}
