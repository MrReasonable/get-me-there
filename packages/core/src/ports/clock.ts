import { asIsoDate, type IsoDate, type IsoDateTime, isoDateTimeOfEpochMs } from '../types/ids.js';

/** Injected everywhere time is read, so tests pin instants. Spec §6.1: dates resolve in Europe/London. */
export interface Clock {
  now(): IsoDateTime;
  todayLondon(): IsoDate;
}

// why: `en-CA` formats as YYYY-MM-DD, which is exactly the IsoDate form; no manual assembly needed.
const londonDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date in Europe/London for an instant. */
export function londonDateOf(instant: IsoDateTime): IsoDate {
  return asIsoDate(londonDate.format(new Date(instant)));
}

/**
 * The calendar date an instant falls on in `timeZone`, as an IsoDate (`en-CA` formats as YYYY-MM-DD). The one copy for
 * any zone: SearchApi's period end and the Status report's dates read it.
 */
export function dateIn(instant: string, timeZone: string): IsoDate {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return asIsoDate(f.format(new Date(instant)));
}

export const systemClock: Clock = {
  now: () => isoDateTimeOfEpochMs(Date.now()),
  todayLondon: () => londonDateOf(isoDateTimeOfEpochMs(Date.now())),
};

/** Test clock: a fixed instant that can be advanced or set. */
export function fixedClock(
  at: IsoDateTime,
): Clock & { advance(ms: number): void; set(at: IsoDateTime): void } {
  let current = new Date(at).getTime();
  return {
    now: () => isoDateTimeOfEpochMs(current),
    todayLondon: () => londonDateOf(isoDateTimeOfEpochMs(current)),
    advance: (ms) => {
      current += ms;
    },
    set: (next) => {
      current = new Date(next).getTime();
    },
  };
}
