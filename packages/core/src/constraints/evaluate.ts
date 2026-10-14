import type { Constraints } from '../types/definition.js';
import type {
  NormalisedItinerary,
  ObservationFields,
  Segment,
  SuppliedField,
  Verdict,
  Verdicts,
} from '../types/itinerary.js';
import type { Cabin } from '../types/provenance.js';

const CABIN_RANK: Readonly<Record<Cabin, number>> = { economy: 0, premium_economy: 1, business: 2, first: 3 };
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const verdict = (ok: boolean): Verdict => (ok ? 'pass' : 'fail');

/** `HH:mm` inside [from, to]; a window whose `from` is later than `to` wraps midnight. */
function inWindow(time: string, w: { from: string; to: string }): boolean {
  if (!HHMM_RE.test(w.from) || !HHMM_RE.test(w.to))
    throw new RangeError(`window must be HH:mm: ${w.from}–${w.to}`);
  return w.from <= w.to ? time >= w.from && time <= w.to : time >= w.from || time <= w.to;
}

const hhmm = (local: string): string => local.slice(11, 16);

/** First and last segment of a direction, or null when it has none (then window rules are unverified). */
function ends(d: readonly Segment[]): { first: Segment; last: Segment } | null {
  const [first] = d;
  return first === undefined ? null : { first, last: d.reduce((_, x) => x, first) };
}

/**
 * Spec §6.2. Evaluated at read time against the current definition's constraints and the
 * observation's stored `supplied_fields_json`, so an edited constraint re-judges old rows.
 * Only constraints the definition sets are judged (a `false` boolean or an empty airline list is
 * "not set"); `cabin` is always judged against `requestedCabin` (the offer's cabin, never
 * evidence itself). Absent input is `unverified`, never `pass`.
 */
export function evaluateConstraints(
  it: NormalisedItinerary,
  obs: ObservationFields & { segmentCabins: Cabin[] | null },
  c: Constraints,
  requestedCabin: Cabin,
  supplied: readonly SuppliedField[],
): Verdicts {
  const has = (f: SuppliedField): boolean => supplied.includes(f);
  const segments = has('segments');
  const times = segments && has('segmentTimes');
  const all = [...it.outbound, ...it.inbound];
  const v: Verdicts = {};

  // why: requestedCabin is never evidence; only per-segment cabins stated by the vendor count, and
  // only when every segment states one (mixed-cabin itineraries are common).
  const cabins = has('segmentCabins') ? obs.segmentCabins : null;
  v.cabin =
    cabins === null || cabins.length !== all.length
      ? 'unverified'
      : verdict(cabins.every((k) => CABIN_RANK[k] >= CABIN_RANK[requestedCabin]));

  if (c.maxStops !== undefined) {
    const max = c.maxStops;
    v.maxStops = segments ? verdict(it.stopsOut <= max && it.stopsIn <= max) : 'unverified';
  }
  if (c.maxJourneyMinutes !== undefined) {
    const max = c.maxJourneyMinutes;
    const out = it.outboundMinutes;
    const back = it.inboundMinutes;
    v.maxJourneyMinutes =
      times && out !== undefined && back !== undefined ? verdict(out <= max && back <= max) : 'unverified';
  }
  if (c.minLayoverMinutes !== undefined) {
    const min = c.minLayoverMinutes;
    v.minLayoverMinutes = times ? verdict(it.layovers.every((l) => l.minutes >= min)) : 'unverified';
  }
  if (c.maxLayoverMinutes !== undefined) {
    const max = c.maxLayoverMinutes;
    v.maxLayoverMinutes = times ? verdict(it.layovers.every((l) => l.minutes <= max)) : 'unverified';
  }
  if (c.noOvernightLayover === true) {
    v.noOvernightLayover = times ? verdict(!it.layovers.some((l) => l.overnight)) : 'unverified';
  }
  const out = ends(it.outbound);
  const back = ends(it.inbound);
  if (c.departureWindowLocal !== undefined) {
    const w = c.departureWindowLocal;
    v.departureWindowLocal =
      times && out !== null && back !== null
        ? verdict(inWindow(hhmm(out.first.departLocal), w) && inWindow(hhmm(back.first.departLocal), w))
        : 'unverified';
  }
  if (c.arrivalWindowLocal !== undefined) {
    const w = c.arrivalWindowLocal;
    v.arrivalWindowLocal =
      times && out !== null && back !== null
        ? verdict(inWindow(hhmm(out.last.arriveLocal), w) && inWindow(hhmm(back.last.arriveLocal), w))
        : 'unverified';
  }
  if (c.noSelfTransfer === true) {
    v.noSelfTransfer =
      has('selfTransfer') && obs.selfTransfer !== null ? verdict(!obs.selfTransfer) : 'unverified';
  }
  if (c.noAirportChange === true) {
    v.noAirportChange =
      segments && it.airportChange !== undefined ? verdict(!it.airportChange) : 'unverified';
  }
  if (c.includeAirlines !== undefined && c.includeAirlines.length > 0) {
    const list = c.includeAirlines;
    v.includeAirlines = segments ? verdict(all.some((s) => list.includes(s.marketingCarrier))) : 'unverified';
  }
  if (c.excludeAirlines !== undefined && c.excludeAirlines.length > 0) {
    const list = c.excludeAirlines;
    v.excludeAirlines = segments
      ? verdict(!all.some((s) => list.includes(s.marketingCarrier)))
      : 'unverified';
  }
  const bags = has('baggage') ? obs.baggage : null;
  if (c.cabinBagRequired === true) {
    const cabinBag = bags?.cabinBag;
    v.cabinBagRequired = cabinBag === undefined ? 'unverified' : verdict(cabinBag === 'included');
  }
  if (c.checkedBagRequired === true) {
    const n = bags?.checkedBags;
    v.checkedBagRequired = n === undefined ? 'unverified' : verdict(n >= 1);
  }
  if (c.minCheckedBags !== undefined) {
    const min = c.minCheckedBags;
    const n = bags?.checkedBags;
    v.minCheckedBags = n === undefined ? 'unverified' : verdict(n >= min);
  }
  if (c.maxPricePence !== undefined) {
    v.maxPricePence = has('price') ? verdict(obs.pricePence <= c.maxPricePence) : 'unverified';
  }
  return v;
}
