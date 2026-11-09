import { type LegTimes, type PairingRead, withinLimits } from '@gmt/core';
import type { TripResponse } from '../../api/types.js';

/**
 * Design 2026-11-08 §6.1 (plan Task 6): every state of the Trip page's card, decided once from the trip read so the
 * view only draws. The card follows the board: the figure the search page's row shows decides it, and a failed newest
 * list never lets an older trip lead (the board's rule, `pairingsFor` takes the newest list whatever its status).
 */
export type LimitName = 'journey' | 'stops' | 'departure' | 'arrival';

export type CardState =
  | { kind: 'unreachable' }
  | { kind: 'outside-window' }
  | { kind: 'verified' }
  | { kind: 'trip' }
  | { kind: 'reading' }
  | { kind: 'calendar-with-trip' }
  | { kind: 'none-within'; failing: LimitName[] }
  | { kind: 'other-limits' }
  | { kind: 'outbound-only' }
  | { kind: 'no-return' }
  | { kind: 'read-without-calendar' }
  | { kind: 'calendar-only' }
  | { kind: 'gone' }
  | { kind: 'over-journey-limit' }
  | { kind: 'no-price' }
  | { kind: 'not-offered' }
  | { kind: 'not-reached' }
  | { kind: 'browser-unavailable' }
  | { kind: 'not-searched' };

export interface Card {
  state: CardState;
  /** The newest read's failure beside any state (`listFailure`: set only where the board shows a failed read). */
  couldNotRead: TripResponse['listFailure'];
}

/** The order the limits are named in. */
const LIMIT_NAMES = ['journey', 'stops', 'departure', 'arrival'] as const satisfies readonly LimitName[];

/**
 * The limits that rule out every flight read on a leg, over both legs: a limit no flight of a leg meets is one the
 * operator can name ("none within your journey limit"). A limit each flight meets somewhere but never together with the
 * others names nothing, so the list may be empty.
 */
function failingLimits(r: TripResponse): LimitName[] {
  const failed = new Set<LimitName>();
  const legs: ReadonlyArray<{ flights: readonly LegTimes[]; leg: 'outbound' | 'return' }> = [
    { flights: r.flightList?.flights ?? [], leg: 'outbound' },
    { flights: r.flightList?.returns?.attempts.flatMap((a) => a.returns) ?? [], leg: 'return' },
  ];
  for (const { flights, leg } of legs) {
    if (flights.length === 0) continue;
    for (const name of LIMIT_NAMES)
      if (flights.every((f) => !withinLimits(f, r.limits, leg)[name])) failed.add(name);
  }
  return LIMIT_NAMES.filter((n) => failed.has(n));
}

/**
 * What a calendar figure's flight read makes of the card, one value per `PairingRead` (the Record keeps this
 * exhaustive: a new read is a compile error here). `within` is exactly a pairing figure's read, which the card decided
 * before this table, so the contract never gives it to a calendar figure. `sellers-not-read` and `offers-incomplete`
 * are never produced today (`pairingReadOf` names them for a pairing beneath a figure); they map to the same card as
 * `within-older`, a trip shown beneath the calendar price.
 */
const CALENDAR_READ: Record<PairingRead, (r: TripResponse) => CardState> = {
  within: () => ({ kind: 'trip' }),
  'within-older': () => ({ kind: 'calendar-with-trip' }),
  'sellers-not-read': () => ({ kind: 'calendar-with-trip' }),
  'offers-incomplete': () => ({ kind: 'calendar-with-trip' }),
  'over-limit': (r) => ({ kind: 'none-within', failing: failingLimits(r) }),
  'within-other-limits': () => ({ kind: 'other-limits' }),
  'outbound-only': () => ({ kind: 'outbound-only' }),
  'no-pairing-read': () => ({ kind: 'no-return' }),
  // why: a failed newest list shows the calendar price with the couldn't-read line, the board's rule
  'list-failed': (r) => (r.figure?.superseded ? { kind: 'gone' } : { kind: 'calendar-only' }),
  'not-read': (r) => (r.figure?.superseded ? { kind: 'gone' } : { kind: 'calendar-only' }),
};

/** With no figure, the dates' cells say why none: in this order across the airport pairs (design §6.1). */
function withoutFigure(r: TripResponse): CardState {
  if (r.flightList !== null) return { kind: 'read-without-calendar' };
  if (r.journeyLeftOut > 0) return { kind: 'over-journey-limit' };
  const has = (bucket: TripResponse['cells'][number]['bucket'], reasons?: readonly string[]) =>
    r.cells.some(
      (c) =>
        c.bucket === bucket &&
        (reasons === undefined || (c.skipReason !== null && reasons.includes(c.skipReason))),
    );
  // why: an error is "couldn't read" (the line sits beside the state), with no price to show
  if (has('error') || has('empty')) return { kind: 'no-price' };
  if (has('no_data')) return { kind: 'not-offered' };
  if (has('skipped', ['budget'])) return { kind: 'not-reached' };
  if (has('skipped', ['provider_unavailable', 'scheduled_only'])) return { kind: 'browser-unavailable' };
  return { kind: 'not-searched' };
}

/**
 * The card of a trip read, first match wins: the read failed; the dates are outside the search's now; a read is in
 * flight; a verified figure (its own price and booking; not seen in the latest search is `gone`); a leading pairing;
 * then a calendar figure by its flight read; then, with no figure, the dates' cells.
 */
export function cardOf(r: TripResponse, failed: boolean): Card {
  if (failed) return { state: { kind: 'unreachable' }, couldNotRead: null };
  const couldNotRead = r.listFailure;
  const done = (state: CardState): Card => ({ state, couldNotRead });
  if (!r.inWindow) return done({ kind: 'outside-window' });
  if (r.reading) return done({ kind: 'reading' });
  const f = r.figure;
  if (f === null) return done(withoutFigure(r));
  if (f.basis === 'verified') return done({ kind: f.notSeenInLatest === null ? 'verified' : 'gone' });
  if (f.basis === 'pairing') return done({ kind: 'trip' });
  return done(CALENDAR_READ[f.pairingRead](r));
}
