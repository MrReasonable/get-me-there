import type { IsoDate } from '@gmt/core';
import { COPY } from '../copy.js';
import { formatIsoDateShort, formatMinutes, formatWeekday } from '../format.js';

// Ruling 20 (Trips and Search plan): the words one way of a trip is shown in, on every row that shows trips.

const R = COPY.rows;

/** One way of a trip as a row states it: what a list page or a verified result gives, any of it unknown (null). */
export interface LegWordsFacts {
  durationMinutes: number | null;
  stops: number | null;
  /** The airlines, as the page states them; left off (absent or empty) where the row shows none (the cards). */
  carriers?: readonly string[] | undefined;
}

/** A leg's local times, "HH:MM" (or a local date-time); null where unknown. */
export interface LegWordsTimes {
  depart: string | null;
  arrive: string | null;
}

/** The "HH:MM" at the end of a local time: a list page's is already that, a verified result's is "2027-03-14T18:30". */
export function clockOf(local: string | null): string | null {
  const m = local === null ? null : /(\d{2}:\d{2})$/.exec(local);
  return m?.[1] ?? null;
}

/**
 * "07:15 → 17:55 · 10h 40m · 1 change · Aer Lingus" ("direct" for no stops; airlines joined by ", "): the parts that
 * are known, in that order, so a verified leg with no stated minutes still shows its times. Empty when nothing is known.
 */
export function legWords(leg: LegWordsFacts, times: LegWordsTimes): string {
  const depart = clockOf(times.depart);
  const arrive = clockOf(times.arrive);
  const parts = [
    depart !== null && arrive !== null ? R.legTimes(depart, arrive) : null,
    leg.durationMinutes === null ? null : formatMinutes(leg.durationMinutes),
    leg.stops === null ? null : leg.stops === 0 ? R.direct : R.changes(leg.stops),
    leg.carriers === undefined || leg.carriers.length === 0 ? null : leg.carriers.join(R.carrierJoin),
  ];
  return parts.filter((p): p is string => p !== null).join(R.legJoin);
}

/** "Wed 11 Nov", a stay's day as a row names it. */
export function rowDay(d: IsoDate): string {
  return `${formatWeekday(d)} ${formatIsoDateShort(d)}`;
}
