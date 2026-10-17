/** Spec §10 `/duration-analysis` (View C). */
import {
  type apiContract,
  type CellKey,
  cellKeyString,
  daysBetween,
  generateCells,
  type SearchDefinition,
} from '@gmt/core';
import type { z } from 'zod';
import type { Ports } from '../wiring.js';
import { SEARCHED } from './coverage.js';
import { executionSummary } from './executions.js';
import { pickCalendar, pickVerified } from './pick.js';
import { confirmedIn, EXECUTIONS_LIMIT, loadRows } from './results.js';
import { priceOf, type ResultRow } from './rows.js';
import { cellInSpace } from './space.js';

export type DurationResponse = z.infer<typeof apiContract.durationAnalysisResponseSchema>;

const cellsOf = (rows: readonly ResultRow[]): number => new Set(rows.map((r) => cellKeyString(r.cell))).size;

/**
 * Spec §10 `GET /duration-analysis`: per nights value, no interpolation (absent → null / []). Plan decision 54: the
 * minima and the `searched` counts read the same executions — the latest parent and the completed children — and the
 * same provider list, the definition's discovery providers, so a price never sits beside "not searched". Each minimum
 * carries its cell; `n` counts the cells of that nights value with a class-verified confirmed price (verified, picked
 * as every verified figure is, with its "not seen in latest search" mark) or that the provider priced (calendar, a
 * current price before a superseded one, with its `superseded` mark). `searched` counts per series, as WP10's Task 10.1
 * declares it: verification over the selected cells of the nights value (the latest parent's selection and the
 * completed children's cells), discovery over every cell of the nights value in the current space; `searched` is those
 * whose outcome in the set is priced, empty or no_data.
 */
export function assembleDuration(def: SearchDefinition, ports: Ports): DurationResponse {
  const all = ports.repos.executions.listForDefinition(def.id, {
    limit: EXECUTIONS_LIMIT,
    includeChildren: true,
  });
  const parent = all.find((e) => !e.isChild);
  const children = all.filter((e) => e.isChild && e.status === 'completed');
  const set = [...(parent === undefined ? [] : [parent]), ...children];
  const loaded = loadRows(
    def,
    ports,
    set.map((e) => e.id),
  );
  // why: plan decision 58: picked over every confirmed offer before any per-itinerary dedup (see assembleCalendar).
  const verified = loaded.verified.filter(confirmedIn(loaded)).filter((r) => r.verdictClass === 'verified');
  const inSpace = (c: CellKey) => cellInSpace(loaded.space, c);
  const answered = new Set(
    set
      .flatMap((e) => ports.repos.cells.outcomes(e.id))
      .filter((o) => SEARCHED.has(o.status) && inSpace(o))
      .map((o) => `${o.stage}|${o.stage === 'discovery' ? o.providerId : ''}|${cellKeyString(o)}`),
  );
  const selected = [
    ...(parent === undefined ? [] : ports.repos.cells.selected(parent.id).map(({ cell }) => cell)),
    ...children.flatMap((e) => (e.cell === null ? [] : [e.cell])),
  ].filter(inSpace);
  const selectedKeys = [...new Map(selected.map((c) => [cellKeyString(c), c])).values()];
  const space = generateCells(loaded.space);
  const nightsOf = (c: CellKey) => daysBetween(c.departureDate, c.returnDate);
  const count = (cells: readonly CellKey[], stage: string, providerId: string) => ({
    searched: cells.filter((c) => answered.has(`${stage}|${providerId}|${cellKeyString(c)}`)).length,
    total: cells.length,
  });
  const byNights: DurationResponse['byNights'] = [];
  for (let n = def.minNights; n <= def.maxNights; n++) {
    const v = verified.filter((r) => r.cell.nights === n);
    const best = pickVerified(v);
    const ofNights = space.filter((c) => c.nights === n);
    byNights.push({
      nights: n,
      minVerified:
        best === null
          ? null
          : { ...priceOf(best), cell: best.cell, n: cellsOf(v), notSeenInLatest: best.notSeenInLatest },
      minCalendar: def.providers.discovery.flatMap((providerId) => {
        const rows = loaded.calendar.filter(
          (r) => r.cell.nights === n && r.provenance.providerId === providerId,
        );
        const b = pickCalendar(rows);
        return b === null
          ? []
          : [
              {
                providerId,
                price: { ...priceOf(b), cell: b.cell, superseded: b.superseded },
                n: cellsOf(rows),
              },
            ];
      }),
      searched: {
        verification: count(
          selectedKeys.filter((c) => nightsOf(c) === n),
          'verification',
          '',
        ),
        discovery: def.providers.discovery.map((providerId) => ({
          providerId,
          ...count(ofNights, 'discovery', providerId),
        })),
      },
    });
  }
  return { byNights, executions: loaded.scoped.map((e) => executionSummary(e, loaded.rc.now)) };
}
