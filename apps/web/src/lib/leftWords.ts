import type { IsoDateTime } from '@gmt/core';
import { COPY } from '../copy.js';
import { instantMs } from './time.js';

const MINUTE_MS = 60_000;

/**
 * Spec rev 55 §11 (WP20 Task 20.3; Task 20.5 reuses it, ruling A19): how long a run has left, "about 1h 40m left", from
 * the run's `estimatedFinishAt` and the page's clock. From a minute up it is rounded up to whole minutes; under a minute
 * it is "less than a minute left" (ruling 20.5 concern 1), which a finish at or before `now` also reads, so it never
 * says nothing is left while the run is still going. Returns null when the run has no estimate (the caller then leaves
 * the clause out). Pure, epoch-millisecond arithmetic on the two instants.
 */
export function leftWords(estimatedFinishAt: IsoDateTime | null, now: IsoDateTime): string | null {
  if (estimatedFinishAt === null) return null;
  const ms = instantMs(estimatedFinishAt) - instantMs(now);
  if (ms < MINUTE_MS) return COPY.searchesView.lessThanAMinuteLeft;
  const minutes = Math.ceil(ms / MINUTE_MS);
  if (minutes < 60) return COPY.searchesView.left(`${minutes}m`);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return COPY.searchesView.left(rest === 0 ? `${hours}h` : `${hours}h ${rest}m`);
  const days = Math.floor(hours / 24);
  const hoursOfDay = hours % 24;
  return COPY.searchesView.left(hoursOfDay === 0 ? `${days}d` : `${days}d ${hoursOfDay}h`);
}
