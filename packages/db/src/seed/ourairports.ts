import type { AirportKind } from '../types.js';

/**
 * OurAirports (public domain) facts the airport search ranks and filters by (spec §7, decision 11, revision 51): each
 * airport's size class and whether it has scheduled service. mwgg/Airports stays the base (OurAirports has no time
 * zones); these two facts are joined to it by IATA code. Used by `scripts/build-airports.mjs` when the data is updated,
 * never at seed or boot, and never with the network.
 */
export interface OurAirportsFacts {
  /** IATA codes by size class, each list sorted. */
  kinds: Record<AirportKind, string[]>;
  /** IATA codes with scheduled service, sorted; a code in `kinds` but not here has none. */
  scheduled: string[];
}

/** OurAirports' `type` column as the four classes the search uses; heliports, seaplane bases, closed and the rest are `other`. */
export function kindOf(type: string): AirportKind {
  if (type === 'large_airport') return 'large';
  if (type === 'medium_airport') return 'medium';
  if (type === 'small_airport') return 'small';
  return 'other';
}

/** RFC 4180 CSV: quoted fields may hold commas, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const KIND_ORDER: readonly AirportKind[] = ['large', 'medium', 'small', 'other'];

/**
 * The facts for the IATA codes in `codes`, from OurAirports' airports.csv. A code on several rows (a closed airport
 * keeps its old code beside the new one) takes the best row: the larger class, then scheduled service, so a code is
 * never hidden because of a row for a closed airport. `duplicates` names each code that had more than one row.
 */
export function ourAirportsFacts(
  csv: string,
  codes: ReadonlySet<string>,
): { facts: OurAirportsFacts; duplicates: string[] } {
  const [header, ...rows] = parseCsv(csv);
  if (header === undefined) throw new Error('OurAirports CSV is empty');
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`OurAirports CSV has no ${name} column`);
    return i;
  };
  const [typeCol, scheduledCol, iataCol] = [col('type'), col('scheduled_service'), col('iata_code')];
  const best = new Map<string, { kind: AirportKind; scheduled: boolean }>();
  const duplicates = new Set<string>();
  const score = (f: { kind: AirportKind; scheduled: boolean }) =>
    KIND_ORDER.indexOf(f.kind) * 2 + (f.scheduled ? 0 : 1);
  for (const r of rows) {
    const iata = (r[iataCol] ?? '').trim();
    if (!codes.has(iata)) continue;
    const fact = { kind: kindOf(r[typeCol] ?? ''), scheduled: r[scheduledCol] === 'yes' };
    const prior = best.get(iata);
    if (prior !== undefined) duplicates.add(iata);
    if (prior === undefined || score(fact) < score(prior)) best.set(iata, fact);
  }
  const kinds: Record<AirportKind, string[]> = { large: [], medium: [], small: [], other: [] };
  const scheduled: string[] = [];
  for (const [iata, f] of [...best.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    kinds[f.kind].push(iata);
    if (f.scheduled) scheduled.push(iata);
  }
  return { facts: { kinds, scheduled }, duplicates: [...duplicates].sort() };
}
