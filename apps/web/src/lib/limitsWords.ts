import type { FlightLimits } from '@gmt/core';
import { listText } from '../copy/setup.js';
import { COPY } from '../copy.js';
import { hoursText } from './flightLines.js';

// The search's flight limits in words, one wording for the Trip page's card ("none within your 25h limit each way") and
// the Search page's over-limit line (Ruling 4; CodeRabbit CR43).

const T = COPY.trip;
const P = COPY.searchPage;

/** A flight limit by name, in the order the limits are named in. */
export type LimitName = 'journey' | 'stops' | 'departure' | 'arrival';
export const LIMIT_NAMES = [
  'journey',
  'stops',
  'departure',
  'arrival',
] as const satisfies readonly LimitName[];

/** The limits a search sets, in the order they are named in. */
export function setLimits(limits: FlightLimits): LimitName[] {
  return LIMIT_NAMES.filter((n) => {
    if (n === 'journey') return limits.maxJourneyMinutes !== null;
    if (n === 'stops') return limits.maxStops !== null;
    if (n === 'departure') return limits.departureWindowLocal !== null;
    return limits.arrivalWindowLocal !== null;
  });
}

/** The named limits in words ("your 25h limit each way and your 1-change limit"), else "your limits". */
export function limitsText(names: readonly LimitName[], limits: FlightLimits): string {
  const words = names.flatMap((n): string[] => {
    if (n === 'journey')
      return limits.maxJourneyMinutes === null ? [] : [T.limitJourney(hoursText(limits.maxJourneyMinutes))];
    if (n === 'stops') return limits.maxStops === null ? [] : [T.limitStops(limits.maxStops)];
    if (n === 'departure') return limits.departureWindowLocal === null ? [] : [T.limitDeparture];
    return limits.arrivalWindowLocal === null ? [] : [T.limitArrival];
  });
  return words.length === 0 ? T.limitAny : listText(words);
}

/**
 * Ruling 4's line for the dates whose trips were all left out once their flights were read (core's `overLimitCount`):
 * "N dates' trips are over 25h each way" when the journey limit is the search's only one; with any other limit set (the
 * count then holds trips that broke a stops or time-window limit too), "N dates' trips are outside your limits (<the
 * limits>)". Null with no date over, or no limit set.
 */
export function overLimitText(n: number, limits: FlightLimits): string | null {
  const set = setLimits(limits);
  if (n === 0 || set.length === 0) return null;
  if (set.length === 1 && limits.maxJourneyMinutes !== null)
    return P.overLimit(n, hoursText(limits.maxJourneyMinutes));
  return P.outsideLimits(n, limitsText(set, limits));
}
