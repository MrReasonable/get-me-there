import { daysBetween } from '../dates/epochDay.js';
import { groupThousands } from '../text/money.js';
import {
  type CellKey,
  cellKeyString,
  type ResolvedSpace,
  type SearchDefinition,
} from '../types/definition.js';
import type { Iata, IsoDate } from '../types/ids.js';
import { countCells } from './generate.js';
import { resolveSpace } from './window.js';

/**
 * Airports-table lookups `validateSearchSpace` needs. `AirportsRepo` (WP3) satisfies it; tests
 * pass a literal. `metroOf` is part of the contract (WP9's autocomplete hint) and is not called
 * here: the city-code message needs the airports of a metro, which `airportsOfMetro` gives.
 */
export interface AirportLookup {
  exists(iata: Iata): boolean;
  metroOf(iata: Iata): string | null;
  /** Airports the table maps to a metropolitan (city) code, sorted by code (WP3); empty when the code is not a metro. */
  airportsOfMetro(code: string): Iata[];
}

export type ValidationResult =
  | { ok: true; resolved: ResolvedSpace; clamped: boolean; notes: string[] }
  | { ok: false; errors: Array<{ field: string; message: string }> };

/** Spec §6.1 limits. */
const MAX_WINDOW_DAYS = 400;
const MAX_NIGHTS = 90;
const IATA_RE = /^[A-Z]{3}$/;

/**
 * Validate a definition's space at save time (`POST`/`PUT /definitions`). Spec §6.1: IATA format
 * `^[A-Z]{3}$` and existence; `to ≥ from`; window ≤ 400 days; `0 ≤ minNights ≤ maxNights ≤ 90`;
 * ≥1 origin and destination, disjoint; `countCells ≤ MAX_CELLS_PER_DEFINITION` (`maxCells`);
 * `alwaysInclude` members of the resolved space; `startOffsetDays = 0` rejected; a window that
 * resolves to zero cells rejected (spec §10: 422). Spec §6.7 policy bounds: `maxCells`, `topN`
 * and `perDepartureDateBest` non-negative integers, `topN ≤ maxCells`, distinct `alwaysInclude`
 * cells ≤ `maxCells` (the estimate's upper bound, so selection can never exceed it).
 *
 * why: the engine must not call this at execution start. There a relative window may have slid
 * past an `alwaysInclude` cell, which spec §6.1 says is "dropped with a note, not an error", and a
 * zero-cell window is recorded as `skipped_window`; the engine uses `resolveSpace`, `countCells`
 * and `selectCandidates`' omission of out-of-space members instead.
 *
 * why: nothing is upper-cased or otherwise repaired here. `iataSchema` upper-cases operator input
 * at the API boundary (review focus 1), so codes arrive upper-case; one that does not (a row
 * written around the schema) is rejected with a format error rather than silently repaired.
 *
 * Every error carries a dotted `field` path matching the request body (`origins.0`,
 * `window.startOffsetDays`, `verification.alwaysInclude.2`) so the form can place it. Every
 * message and note is operator-facing copy and is checked against the banned-word list.
 */
export function validateSearchSpace(
  def: Pick<
    SearchDefinition,
    'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights' | 'verification'
  >,
  todayLondon: IsoDate,
  lookup: AirportLookup,
  maxCells: number,
): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const err = (field: string, message: string) => errors.push({ field, message });

  checkAirports('origins', def.origins, lookup, err);
  checkAirports('destinations', def.destinations, lookup, err);
  def.destinations.forEach((code, i) => {
    if (def.origins.includes(code)) err(`destinations.${i}`, `${code} is both an origin and a destination`);
  });

  if (!isCount(def.minNights)) err('minNights', 'minNights must be a whole number of 0 or more');
  if (!Number.isInteger(def.maxNights) || def.maxNights > MAX_NIGHTS) {
    err('maxNights', `maxNights must be a whole number no greater than ${MAX_NIGHTS}`);
  }
  if (def.maxNights < def.minNights) err('maxNights', 'maxNights must be at least minNights');

  const w = def.window;
  if (w.kind === 'relative') {
    if (!Number.isInteger(w.startOffsetDays) || w.startOffsetDays < 1) {
      err(
        'window.startOffsetDays',
        'startOffsetDays must be at least 1 (the window starts tomorrow at the earliest)',
      );
    } else if (w.startOffsetDays > MAX_WINDOW_DAYS) {
      // why: a huge offset would push the resolved window past 9999-12-31, where addDays throws; bound it
      // like lengthDays so POST /definitions gets a field error (422) and not a 500.
      err('window.startOffsetDays', `startOffsetDays must be no greater than ${MAX_WINDOW_DAYS}`);
    }
    if (!Number.isInteger(w.lengthDays) || w.lengthDays < 1 || w.lengthDays > MAX_WINDOW_DAYS) {
      err('window.lengthDays', `lengthDays must be a whole number from 1 to ${MAX_WINDOW_DAYS}`);
    }
  } else {
    const span = daysBetween(w.from, w.to) + 1;
    if (span < 1) err('window.to', 'the window must end on or after the day it starts');
    if (span > MAX_WINDOW_DAYS) err('window.to', `the window must be at most ${MAX_WINDOW_DAYS} days long`);
  }

  const v = def.verification;
  const maxCellsOk = isCount(v.maxCells);
  if (!maxCellsOk) err('verification.maxCells', 'maxCells must be a whole number of 0 or more');
  if (!isCount(v.topN)) err('verification.topN', 'topN must be a whole number of 0 or more');
  else if (maxCellsOk && v.topN > v.maxCells) {
    err('verification.topN', `topN must be no greater than maxCells (${v.maxCells})`);
  }
  if (v.perDepartureDateBest !== undefined && !isCount(v.perDepartureDateBest)) {
    err('verification.perDepartureDateBest', 'perDepartureDateBest must be a whole number of 0 or more');
  }
  const distinct = new Set(v.alwaysInclude.map(cellKeyString)).size;
  if (maxCellsOk && distinct > v.maxCells) {
    err(
      'verification.alwaysInclude',
      `alwaysInclude lists ${distinct} distinct cells; maxCells is ${v.maxCells}`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  const { space: resolved, clamped } = resolveSpace(def, todayLondon);
  const cells = countCells(resolved);
  if (cells === 0) {
    return {
      ok: false,
      errors: [
        {
          field: 'window',
          message: `the window resolves to no departure days: it ends before ${resolved.departureFrom}`,
        },
      ],
    };
  }
  if (cells > maxCells) {
    const days = daysBetween(resolved.departureFrom, resolved.departureTo) + 1;
    const nights = def.maxNights - def.minNights + 1;
    const factors = [
      plural(def.origins.length, 'origin'),
      plural(def.destinations.length, 'destination'),
      plural(days, 'day'),
      plural(nights, 'night length'),
    ].join(' × ');
    return {
      ok: false,
      errors: [
        {
          field: 'window',
          message: `the space has ${groupThousands(cells)} cells (${factors}); the limit MAX_CELLS_PER_DEFINITION is ${groupThousands(maxCells)}. Shorten the window, narrow the nights or remove an airport.`,
        },
      ],
    };
  }
  v.alwaysInclude.forEach((cell, i) => {
    const why = outsideReason(cell, resolved);
    if (why !== null) {
      err(
        `verification.alwaysInclude.${i}`,
        `${cell.origin}→${cell.destination} ${cell.departureDate}–${cell.returnDate}: ${why}`,
      );
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const notes = clamped
    ? [`window start moved to ${resolved.departureFrom} (tomorrow); searches start tomorrow at the earliest`]
    : [];
  return { ok: true, resolved, clamped, notes };
}

/** A non-negative integer (spec §6.1 nights, spec §6.7 policy counts). */
function isCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/** "1 origin", "2 origins". */
function plural(n: number, word: string): string {
  return `${groupThousands(n)} ${word}${n === 1 ? '' : 's'}`;
}

function checkAirports(
  field: 'origins' | 'destinations',
  codes: readonly Iata[],
  lookup: AirportLookup,
  err: (field: string, message: string) => void,
): void {
  if (codes.length === 0) {
    err(field, `at least one ${field === 'origins' ? 'origin' : 'destination'} is required`);
  }
  codes.forEach((code, i) => {
    const problem = airportProblem(code, codes.indexOf(code) !== i, lookup);
    if (problem !== null) err(`${field}.${i}`, problem);
  });
}

/** The first thing wrong with one code, or null. Order: format, duplicate, existence, metro. */
function airportProblem(code: Iata, duplicate: boolean, lookup: AirportLookup): string | null {
  if (!IATA_RE.test(code)) return `${code} is not a three-letter upper-case IATA code`;
  if (duplicate) return `${code} is listed twice`;
  // why: existence is checked before the metro test, so a code that is both an airport and a
  // metro code in the table (some cities share their main airport's code) is accepted.
  if (lookup.exists(code)) return null;
  const metro = lookup.airportsOfMetro(code);
  if (metro.length > 0) return `${code} is a city code; use one of ${metro.join(', ')}`;
  return `${code} is not in the airports table`;
}

/** Why a cell lies outside a resolved space (the first failing condition), or null when it is inside. */
function outsideReason(cell: CellKey, space: ResolvedSpace): string | null {
  if (!space.origins.includes(cell.origin)) return `${cell.origin} is not one of this definition's origins`;
  if (!space.destinations.includes(cell.destination)) {
    return `${cell.destination} is not one of this definition's destinations`;
  }
  if (daysBetween(space.departureFrom, cell.departureDate) < 0) {
    return `departs before the window starts (${space.departureFrom})`;
  }
  if (daysBetween(cell.departureDate, space.departureTo) < 0) {
    return `departs after the window ends (${space.departureTo})`;
  }
  const nights = daysBetween(cell.departureDate, cell.returnDate);
  if (nights < space.minNights || nights > space.maxNights) {
    return `${nights} nights is outside ${space.minNights}–${space.maxNights}`;
  }
  return null;
}
