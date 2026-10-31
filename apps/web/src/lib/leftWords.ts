import type { IsoDateTime } from '@gmt/core';
import { COPY } from '../copy.js';
import { instantMs } from './time.js';

const MINUTE_MS = 60_000;

/**
 * Spec rev 55 §11 (WP20 Task 20.3; Task 20.5 reuses it, ruling A19): how long a run has left, "about 1h 40m left", from
 * the run's `estimatedFinishAt` and the page's clock. The estimate is rounded up to whole minutes and never reads as
 * nothing left while the run is still going: a finish at or before `now` is "about 1m left". Returns null when the run
 * has no estimate (the caller then leaves the clause out). Pure, epoch-millisecond arithmetic on the two instants.
 */
export function leftWords(estimatedFinishAt: IsoDateTime | null, now: IsoDateTime): string | null {
  if (estimatedFinishAt === null) return null;
  const minutes = Math.max(1, Math.ceil((instantMs(estimatedFinishAt) - instantMs(now)) / MINUTE_MS));
  if (minutes < 60) return COPY.searchesView.left(`${minutes}m`);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return COPY.searchesView.left(rest === 0 ? `${hours}h` : `${hours}h ${rest}m`);
  const days = Math.floor(hours / 24);
  const hoursOfDay = hours % 24;
  return COPY.searchesView.left(hoursOfDay === 0 ? `${days}d` : `${days}d ${hoursOfDay}h`);
}
