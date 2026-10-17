/**
 * Alert events (spec §11): when, which rule, status in words, the trip, the fare and the previous price each through
 * PriceCell (decisions 52, 56), the constraints in words, and the reason.
 */
import {
  type AlertEvent,
  type AlertEventPayload,
  apiContract,
  CONSTRAINT_LABELS,
  hoursSince,
  type IsoDateTime,
  isStale,
} from '@gmt/core';
import { PriceBoundary } from '../../components/PriceBoundary.js';
import { PriceCell } from '../../components/PriceCell.js';
import { COPY } from '../../copy.js';
import { formatRunInstant } from '../../format.js';
import { useNow } from '../../now.js';

const C = COPY.alertsView;

/** Core's payload schema (decision 56: one schema, no local copy); a payload of another shape parses to null. */
function payloadOf(e: AlertEvent): AlertEventPayload | null {
  const p = apiContract.alertEventPayloadSchema.safeParse(e.payload);
  return p.success ? p.data : null;
}

/** The verdict class in words; "verified" only beside the class-verified value (spec §11). */
function classText(p: AlertEventPayload): string {
  if (p.verdictClass === 'unchecked') return C.classUnchecked;
  if (p.verdictClass === 'verified') return C.classVerified;
  return C.classPartial(p.unverified.map((k) => CONSTRAINT_LABELS[k]).join(', '));
}

/** The age of the newer search that did not see this fare: whole hours, 'unknown' when no instant was recorded (PA-6). */
function notSeenHours(p: AlertEventPayload, now: IsoDateTime): number | 'unknown' | null {
  if (p.notSeenInLatest === null) return null;
  return p.notSeenInLatest.at === null ? 'unknown' : hoursSince(p.notSeenInLatest.at, now);
}

function EventRow(props: { e: AlertEvent; ruleText: string; now: IsoDateTime }) {
  const { e, now } = props;
  const p = payloadOf(e);
  const calendar = e.calendarPriceId !== null;
  return (
    <tr>
      <td>
        <time dateTime={e.firedAt}>{formatRunInstant(e.firedAt)}</time>
      </td>
      <td>
        {/* why: decision 55 — a rule's threshold is a price quoted in text, which WP9's sweep allows inside [data-quote] */}
        <span data-quote>{props.ruleText}</span>
      </td>
      <td>{C.status[e.status]}</td>
      <td>{p === null ? C.notRecorded : p.isNew ? `${p.route} · ${C.listedAsNew}` : p.route}</td>
      <td>
        {p === null ? (
          C.notRecorded
        ) : (
          <PriceBoundary>
            <PriceCell
              pricePence={p.pricePence}
              provenance={p.provenance}
              calendar={calendar}
              // why: the stored threshold is re-judged against now by core's isStale (decisions 55, 56; review PA-7)
              stale={isStale(p.provenance, now, p.staleThresholdHours)}
              truncated={p.truncated}
              unconfirmed={p.unverified.includes('priceConfirmed')}
              notSeenInLatestHours={notSeenHours(p, now)}
            />
          </PriceBoundary>
        )}
      </td>
      <td>
        {p === null ? (
          C.notRecorded
        ) : p.previous === null ? (
          C.noPrevious
        ) : (
          <PriceBoundary>
            <PriceCell
              pricePence={p.previous.pricePence}
              provenance={p.previous.provenance}
              calendar={calendar}
              stale={isStale(p.previous.provenance, now, p.staleThresholdHours)}
            />
          </PriceBoundary>
        )}
      </td>
      <td>{p === null ? C.notRecorded : classText(p)}</td>
      <td>
        {/* why: decision 55 — spec §6.8 reason text quotes the prices the rule judged; each fare is also a PriceCell */}
        <span data-quote>{e.reason ?? C.noReason}</span>
      </td>
    </tr>
  );
}

export function EventsTable(props: { events: readonly AlertEvent[]; ruleText: ReadonlyMap<string, string> }) {
  const now = useNow();
  if (props.events.length === 0) return <p>{C.noEvents}</p>;
  return (
    <table aria-label={C.eventsTable}>
      <thead>
        <tr>
          <th scope="col">{C.colFired}</th>
          <th scope="col">{C.colRule}</th>
          <th scope="col">{C.colStatus}</th>
          <th scope="col">{C.colTrip}</th>
          <th scope="col">{C.colPrice}</th>
          <th scope="col">{C.colPrevious}</th>
          <th scope="col">{C.colClass}</th>
          <th scope="col">{C.colReason}</th>
        </tr>
      </thead>
      <tbody>
        {props.events.map((e) => (
          <EventRow key={e.id} e={e} ruleText={props.ruleText.get(e.ruleId) ?? e.ruleId} now={now} />
        ))}
      </tbody>
    </table>
  );
}
