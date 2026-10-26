/** Spec §10 `/calendar-gap` (spec §6.9): the Dates view's banner and the date pair detail's marks. */
import type { apiContract, SearchDefinition } from '@gmt/core';
import type { Engine } from '@gmt/engine';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { pickVerified } from './pick.js';
import { confirmedIn, loadRows } from './results.js';
import { priceOf, type ResultRow } from './rows.js';

export type CalendarGapResponse = z.infer<typeof apiContract.calendarGapResponseSchema>;

/** A verified-basis figure with its "not seen in latest search" mark (decision 54). */
function verifiedFigure(r: ResultRow) {
  return { ...priceOf(r), notSeenInLatest: r.notSeenInLatest };
}

/**
 * Spec §10 `GET /calendar-gap`: current calendar prices below the reference verified price (latest seen, then fresh,
 * then cheapest; decisions 54, 58): the class-verified confirmed price picked as every verified figure is, with its mark; empty without a verification provider. A superseded calendar price is not listed: a
 * later search of that cell found no fares. why: search_cells.best_observation_id is the cheapest observation written,
 * not the cheapest class-verified one, so the yardstick is computed at read time (plan round-2 pin).
 */
export function assembleCalendarGap(
  def: SearchDefinition,
  ports: Ports,
  engine: Engine,
): CalendarGapResponse {
  if (def.providers.verification.length === 0) return { cheapestVerified: null, cells: [] };
  const loaded = loadRows(def, ports);
  const best = pickVerified(
    loaded.verified.filter(confirmedIn(loaded)).filter((r) => r.verdictClass === 'verified'),
  );
  if (best === null || best.itineraryHash === null) return { cheapestVerified: null, cells: [] };
  const below = loaded.calendar
    .filter((r) => !r.superseded && r.pricePence < best.pricePence)
    .sort((a, b) => a.pricePence - b.pricePence);
  return {
    cheapestVerified: { ...verifiedFigure(best), cell: best.cell, itineraryHash: best.itineraryHash },
    // why: review prov M2: available means the engine's own preview admits the cell, as the cell detail's `verify` does.
    cells: below.map((r) => ({
      cell: r.cell,
      calendar: priceOf(r),
      verifyAvailable: engine.childCapPreview(def.id, r.cell).ok,
    })),
  };
}
