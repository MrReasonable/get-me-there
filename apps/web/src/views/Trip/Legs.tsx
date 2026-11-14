import { COPY } from '../../copy.js';
import { formatMinutes } from '../../format.js';
import { dayText, type Leg, landsOn } from './model.js';

const T = COPY.trip;
const F = COPY.flights;
const D = COPY.datesView;

/** One leg: "09:15 LHR → 14:55 JFK", then its day ("lands Sun 29 Nov" another day), duration, changes and airline. */
function LegRow({ tag, leg }: { tag: string; leg: Leg }) {
  const meta = [
    T.legDay(dayText(leg.date), landsOn(leg)),
    ...(leg.stops === null ? [] : [F.changes(leg.stops)]),
    ...(leg.carriers === null ? [] : [leg.carriers]),
  ];
  return (
    <div className="trip-leg" data-testid="trip-leg">
      <span className="trip-leg-tag">{tag}</span>
      <div className="min-w-0">
        <p className="trip-times">
          {leg.departs} <span className="trip-apt">{leg.from}</span> → {leg.arrives}
          {leg.dayOffset === 0 ? null : <sup className="trip-plus">{T.dayOffset(leg.dayOffset)}</sup>}{' '}
          <span className="trip-apt">{leg.to}</span>
        </p>
        <p className="trip-legmeta">
          {meta[0]}
          {leg.minutes === null ? null : (
            <>
              {T.legSeparator}
              <b className="trip-duration">{formatMinutes(leg.minutes)}</b>
            </>
          )}
          {meta.slice(1).map((m) => (
            <span key={m}>
              {T.legSeparator}
              {m}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

/**
 * Design 2026-11-08 §6.1: the card's Out and Back, each with its times and airports, the day it leaves (and lands, when
 * another day), its own duration, changes and airline; a pairing whose list is not in hand says its two times only.
 */
export function Legs({
  legs,
  times,
}: {
  legs: { out: Leg; back: Leg } | null;
  times: { out: string; back: string } | null;
}) {
  if (legs !== null)
    return (
      <div className="trip-legs-list">
        <LegRow tag={T.out} leg={legs.out} />
        <LegRow tag={T.back} leg={legs.back} />
      </div>
    );
  if (times !== null) return <p className="trip-legmeta">{D.pairingTimes(times.out, times.back)}</p>;
  return null;
}
