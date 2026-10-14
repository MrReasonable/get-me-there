import { asIsoDate, type IsoDate } from '@gmt/core';

const DAY_MS = 86_400_000;

// why: UTC arithmetic on calendar values, never Date-local (spec §6.1). WP1's epoch-day helpers are not a
// dependency of WP4 (it depends on WP0 only); WP13's integration review replaces this file with core's helpers.

/** Days since 1970-01-01 for a `YYYY-MM-DD` string. */
export function epochDayOf(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS;
}

export function isoDateOfEpochDay(n: number): IsoDate {
  return asIsoDate(new Date(n * DAY_MS).toISOString().slice(0, 10));
}

export function addDaysIso(d: string, n: number): IsoDate {
  return isoDateOfEpochDay(epochDayOf(d) + n);
}

export function daysBetweenIso(a: string, b: string): number {
  return epochDayOf(b) - epochDayOf(a);
}

/** `YYYY-MM-DDTHH:mm` plus `minutes`, as wall-clock arithmetic (no timezone involved). */
export function localPlusMinutes(local: string, minutes: number): string {
  const ms = Date.UTC(
    Number(local.slice(0, 4)),
    Number(local.slice(5, 7)) - 1,
    Number(local.slice(8, 10)),
    Number(local.slice(11, 13)),
    Number(local.slice(14, 16)),
  );
  return new Date(ms + minutes * 60_000).toISOString().slice(0, 16);
}
