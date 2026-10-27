import { useQueries } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import { qk } from '../../api/queries.js';
import type { AirportsResponse } from '../../api/types.js';
import { PLAN_COPY } from '../../copy/plan.js';

/** One row of `GET /api/airports`. */
export type AirportRow = AirportsResponse[number];

/** An option in the airport picker: a whole metro (city) or one airport. */
export type AirportChoice =
  | { kind: 'metro'; metro: string; city: string; codes: readonly string[] }
  | { kind: 'airport'; row: AirportRow };

/** The airports table's words that say nothing once the option says it is an airport. */
const TRAILING = /\s+(international\s+)?airport$/i;

/**
 * The airport's own name without a trailing "Airport" ("London Heathrow Airport" reads "London Heathrow"). The city
 * stays in the name: some airports are named after a neighbouring town, so dropping it could misname them.
 */
export function shortAirportName(name: string): string {
  return name.replace(TRAILING, '').trim() || name;
}

/** "London Heathrow (LHR) · London, GB" — read as one option by a screen reader too. */
export function airportOptionText(row: AirportRow): string {
  return PLAN_COPY.airportOption(shortAirportName(row.name), row.iata, row.city, row.country);
}

/**
 * The city most of these airports name (a metro's outlying airport names its own town); on a tie the first in
 * alphabetical order, so the answer never depends on the order the airports were picked in.
 */
function commonCity(rows: readonly AirportRow[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.city, (counts.get(r.city) ?? 0) + 1);
  const ranked = [...counts.entries()].sort(([a, n], [b, m]) => m - n || a.localeCompare(b));
  return ranked[0]?.[0] ?? '';
}

/**
 * The picker's options for a search answer: when the answer holds a metro (by the table's `metro` column, never by
 * city name; the search returns every member of a metro it matches), the first option adds that whole metro, the
 * first in the answer's order; then every airport in the answer's order.
 */
export function airportChoices(rows: readonly AirportRow[]): AirportChoice[] {
  const byMetro = new Map<string, AirportRow[]>();
  for (const r of rows) {
    if (r.metro === null) continue;
    byMetro.set(r.metro, [...(byMetro.get(r.metro) ?? []), r]);
  }
  const group = [...byMetro.entries()].find(([, members]) => members.length >= 2);
  const airports: AirportChoice[] = rows.map((row) => ({ kind: 'airport', row }));
  if (group === undefined) return airports;
  const [metro, members] = group;
  return [
    { kind: 'metro', metro, city: commonCity(members), codes: members.map((m) => m.iata) },
    ...airports,
  ];
}

/** What the airports table says about listed codes; `settled` once every lookup has answered or failed. */
export interface AirportDetails {
  rows: ReadonlyMap<string, AirportRow>;
  settled: boolean;
}

/**
 * The option highlighted when an answer arrives (automatic selection): the whole metro when the text names it (its
 * code, or the start of a word of its city, as "lond" or "new y"), else the first airport, so typing "heath" and
 * pressing Enter adds Heathrow, not all of London.
 */
export function preferredChoice(choices: readonly AirportChoice[], text: string): number {
  const first = choices[0];
  if (first?.kind !== 'metro') return 0;
  const t = text.trim().toLowerCase();
  const namesCity = ` ${first.city.toLowerCase()}`.includes(` ${t}`);
  return t === first.metro.toLowerCase() || namesCity ? 0 : Math.min(1, choices.length - 1);
}

/** The row for each listed code that the airports table knows, looked up with the autocomplete's own cached query. */
export function useAirportDetails(codes: readonly string[]): AirportDetails {
  const results = useQueries({
    queries: codes.map((code) => ({
      queryKey: qk.airports(code),
      queryFn: () => api.airports(code),
      staleTime: 60_000,
    })),
  });
  const out = new Map<string, AirportRow>();
  codes.forEach((code, i) => {
    const row = results[i]?.data?.find((a) => a.iata === code);
    if (row !== undefined) out.set(code, row);
  });
  return { rows: out, settled: results.every((r) => !r.isPending) };
}

/** The places of a list of airports: one city per metro (or per city when it has none), the code when unknown. */
function placesOf(codes: readonly string[], details: ReadonlyMap<string, AirportRow>): string {
  const groups = new Map<string, AirportRow[]>();
  const places: string[] = [];
  for (const code of codes) {
    const row = details.get(code);
    if (row === undefined) {
      places.push(code);
      continue;
    }
    const key = row.metro ?? `city:${row.city}`;
    const members = groups.get(key);
    if (members === undefined) {
      groups.set(key, [row]);
      places.push(key);
    } else members.push(row);
  }
  const named = places.map((p) => {
    const members = groups.get(p);
    return members === undefined ? p : commonCity(members);
  });
  return [...new Set(named)].join(', ');
}

/** "London → New York" from the chosen airports; empty until both ends have one. */
export function suggestedName(
  origins: readonly string[],
  destinations: readonly string[],
  details: ReadonlyMap<string, AirportRow>,
): string {
  if (origins.length === 0 || destinations.length === 0) return '';
  return PLAN_COPY.nameArrow(placesOf(origins, details), placesOf(destinations, details));
}
