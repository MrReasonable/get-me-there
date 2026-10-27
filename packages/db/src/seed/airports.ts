import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, type Iata } from '@gmt/core';
import type { Db } from '../client.js';
import { isRecord } from '../internal/read.js';
import { AirportsRepo, metroIndex } from '../repositories/airports.js';
import { AIRPORT_KINDS, type AirportKind, type AirportsDataset } from '../types.js';

/** Spec §7: boot fails unless at least this many airports carry an IATA code and a tz. */
export const AIRPORTS_MIN_ROWS = 5000;

function fail(file: string, field: string, detail: string): never {
  throw new Error(`${file}: ${field} ${detail}`);
}
function str(file: string, field: string, v: unknown): string {
  return typeof v === 'string' ? v : fail(file, field, 'must be a string');
}
function num(file: string, field: string, v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fail(file, field, 'must be a finite number');
}

/** Reads and validates the vendored files (po-007). No network is involved anywhere in seeding (spec §7). */
export function loadAirportsDataset(dir: string): AirportsDataset {
  const files = readdirSync(dir).filter((f) => /^airports\..+\.json$/.test(f));
  const file = files[0];
  if (files.length !== 1 || file === undefined)
    throw new Error(`expected exactly one airports.<version>.json in ${dir}, found ${files.length}`);
  const a: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!isRecord(a) || !Array.isArray(a.airports)) fail(file, 'airports', 'must be an array');
  const version = str(file, 'version', a.version);
  const m: unknown = JSON.parse(readFileSync(join(dir, 'metros.json'), 'utf8'));
  if (!isRecord(m) || !isRecord(m.metros)) fail('metros.json', 'metros', 'must be an object');
  const revision = str('metros.json', 'revision', m.revision);
  // why: the build rules are versioned with the data, so a rule change alone re-seeds (dm-M3 re-review).
  const rules = str('metros.json', 'rules', m.rules);
  const metros: Record<string, string[]> = {};
  for (const [code, members] of Object.entries(m.metros)) {
    if (!Array.isArray(members)) fail('metros.json', `metros.${code}`, 'must be an array');
    metros[code] = members.map((x, i) => str('metros.json', `metros.${code}[${i}]`, x));
  }
  const index = metroIndex(metros);
  const oa = loadOurAirports(dir);
  const airports = a.airports.map((x: unknown, i: number) => {
    const f = `airports[${i}]`;
    if (!isRecord(x)) return fail(file, f, 'must be an object');
    const iataText = str(file, `${f}.iata`, x.iata);
    let iata: Iata;
    try {
      iata = asIata(iataText);
    } catch {
      return fail(file, `${f}.iata`, `is not an IATA code: ${iataText}`);
    }
    return {
      iata,
      icao: x.icao === null ? null : str(file, `${f}.icao`, x.icao),
      name: str(file, `${f}.name`, x.name),
      city: str(file, `${f}.city`, x.city),
      country: str(file, `${f}.country`, x.country),
      tz: str(file, `${f}.tz`, x.tz),
      lat: num(file, `${f}.lat`, x.lat),
      lon: num(file, `${f}.lon`, x.lon),
      metro: index.get(iata) ?? null,
      kind: oa?.kinds.get(iata) ?? null,
      // why: a code OurAirports does not list is unknown (null), not "no scheduled service"
      scheduled: oa === null || !oa.kinds.has(iata) ? null : oa.scheduled.has(iata),
    };
  });
  // why: the OurAirports retrieval date is part of the version, so new facts alone re-seed an existing database
  const oaVersion = oa === null ? '' : `+ourairports-${oa.retrieved}`;
  return { version: `${version}+metros-${revision}.${rules}${oaVersion}`, airports, metros };
}

/**
 * The vendored OurAirports facts (`ourairports.json`, public domain; spec §7, revision 51), or null when the directory
 * has none: every airport's kind and scheduled service are then unknown.
 */
function loadOurAirports(
  dir: string,
): { retrieved: string; kinds: Map<string, AirportKind>; scheduled: Set<string> } | null {
  const file = 'ourairports.json';
  if (!existsSync(join(dir, file))) return null;
  const o: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (!isRecord(o) || !isRecord(o.kinds) || !Array.isArray(o.scheduled))
    fail(file, 'kinds/scheduled', 'must be an object and an array');
  const retrieved = str(file, 'retrieved', o.retrieved);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrieved)) fail(file, 'retrieved', 'must be a YYYY-MM-DD date');
  const kinds = new Map<string, AirportKind>();
  for (const kind of AIRPORT_KINDS) {
    const codes = o.kinds[kind];
    if (!Array.isArray(codes)) fail(file, `kinds.${kind}`, 'must be an array');
    for (const [i, c] of codes.entries()) kinds.set(str(file, `kinds.${kind}[${i}]`, c), kind);
  }
  const scheduled = new Set(o.scheduled.map((c, i) => str(file, `scheduled[${i}]`, c)));
  return { retrieved, kinds, scheduled };
}

/** Seeds or re-seeds `airports` by upsert when the dataset version changes (spec §7); skips when every row is present at this version. */
export function seedAirports(db: Db, dataset: AirportsDataset): { inserted: number; datasetVersion: string } {
  const atVersion =
    db.raw
      .prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM airports WHERE dataset_version = ?')
      .get(dataset.version)?.n ?? 0;
  if (atVersion > 0 && atVersion >= dataset.airports.length)
    return { inserted: 0, datasetVersion: dataset.version };
  new AirportsRepo(db).upsertAll(dataset);
  return { inserted: dataset.airports.length, datasetVersion: dataset.version };
}

/** Spec §7 sanity check, run at boot after seeding; a failure fails boot (WP8). */
export function sanityCheckAirports(
  db: Db,
  referenced: Iata[],
): { ok: true } | { ok: false; reason: string } {
  const n =
    db.raw
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM airports WHERE iata GLOB '[A-Z][A-Z][A-Z]' AND length(tz) > 0`,
      )
      .get()?.n ?? 0;
  if (n < AIRPORTS_MIN_ROWS)
    return {
      ok: false,
      reason: `airports table holds ${n} rows with an IATA code and tz; at least ${AIRPORTS_MIN_ROWS} are required`,
    };
  const exists = db.raw.prepare('SELECT 1 AS present FROM airports WHERE iata = ?');
  const missing = [...new Set(referenced)].filter((iata) => exists.get(iata) === undefined).sort();
  if (missing.length > 0)
    return {
      ok: false,
      reason: `airports referenced by enabled definitions are missing: ${missing.join(', ')}`,
    };
  return { ok: true };
}
