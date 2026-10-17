import { isPriceUnconfirmed, priceUnconfirmed, resultRowKey } from '@gmt/core';
import type { CellDetailResponse, ExecutionSummary } from '../../api/types.js';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatDayShort, formatInstantLondon } from '../../format.js';
import { figureMarks } from '../../lib/marks.js';
import { instantMs } from '../../lib/time.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { noHeadroom, orderCalendarPrices, orderOutcomes, reasonText, runLabel } from './panel.js';
import type { DayPrice, DaySlice } from './types.js';

// The side panel's sections (review arch2-008: CellPanel.tsx keeps the shell, the picker and the action).

const P = COPY.calendarView.panel;
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
const STICKY = 'sticky left-0 bg-white';

/**
 * "hard stop N calls · M calls of budget headroom left" beside the button (decisions 38, 42, 45: WP7's childCapPreview;
 * decision 44: a cap is stated as a hard stop, never "up to").
 */
export function VerifyCost({ verify }: { verify: CellDetailResponse['verify'] }) {
  if (verify === null) return null;
  return (
    <p data-testid="verify-cost" className="text-xs">
      {P.verifyCost(verify.maxCalls, verify.headroomCalls)}
      {noHeadroom(verify) ? <span className="block font-medium">{P.verifyNoHeadroom}</span> : null}
    </p>
  );
}

/** The day's own prices with full provenance (the day cell shows them compact). */
export function DayPrices({ slice, notes }: { slice: DaySlice; notes: Partial<Record<string, string>> }) {
  const rows: Array<{ key: string; label: string; price: DayPrice; calendar: boolean }> = [];
  if (slice.cheapestVerified !== null)
    rows.push({ key: 'v', label: P.dayVerified, price: slice.cheapestVerified, calendar: false });
  if (slice.cheapestPartiallyVerified !== null)
    rows.push({
      key: 'pv',
      label: P.dayPartlyVerified,
      price: slice.cheapestPartiallyVerified,
      calendar: false,
    });
  if (slice.cheapestCalendar !== null)
    rows.push({ key: 'c', label: P.dayCalendar, price: slice.cheapestCalendar, calendar: true });
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => {
        const destination = r.price.cell.destination;
        return (
          <li key={r.key}>
            <span className="text-xs">{r.label}</span>
            <span className="block text-xs">
              {P.dayCell(r.price.cell.nights, formatDayShort(r.price.cell.returnDate))}
            </span>
            <PriceBoundary>
              <PriceCell
                {...figureMarks(r.price)}
                pricePence={r.price.pricePence}
                provenance={r.price.provenance}
                calendar={r.calendar}
                stale={r.price.stale}
                truncated={r.price.truncated}
                destination={destination}
                destinationNote={notes[destination] ?? null}
              />
            </PriceBoundary>
          </li>
        );
      })}
    </ul>
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
      <h3 className="mt-4 font-medium">{P.outcomes}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
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
                  {o.executionId === latest ? <span className="block font-medium">{P.latestRun}</span> : null}
                </th>
                <td>{COPY.stageName[o.stage]}</td>
                <td>{COPY.provider[o.providerId]}</td>
                <td>
                  {COPY.bucket[o.status]}
                  {/* why: decision 48: a priced verification outcome with no confirmed price says so beside its status */}
                  {o.status === 'priced' && isPriceUnconfirmed(o.reason) ? (
                    <span className="block font-semibold">{COPY.calendarView.unconfirmedShort}</span>
                  ) : null}
                </td>
                <td>{reasonText(o.reason)}</td>
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
      <h3 className="mt-4 font-medium">{P.prices}</h3>
      {empty ? (
        <p>{P.noPrices}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orderCalendarPrices(detail.calendarPrices).map((p) => (
            <li key={`cal-${p.calendarPriceId}`}>
              <span className="text-xs">{P.calendarPriceRun(runLabel(p.executionId, executions))}</span>
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
              <span className="text-xs">
                {P.observation(o.seller ?? COPY.none, COPY.classLabel[o.verdictClass])}
              </span>{' '}
              {/* why: WP9 owns ?row=<resultRowKey>, which selects and scrolls to that results row (plan decision 14) */}
              <a
                href={hrefWith({ view: 'results', row: resultRowKey(o) })}
                onClick={navigateTo({ view: 'results', row: resultRowKey(o) })}
                className="text-xs underline"
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
