import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, type Iata } from '@gmt/core';
import type { Db } from '../client.js';
import { isRecord } from '../internal/read.js';
import { AirportsRepo, metroIndex } from '../repositories/airports.js';
import type { AirportsDataset } from '../types.js';

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
  const metros: Record<string, string[]> = {};
  for (const [code, members] of Object.entries(m.metros)) {
    if (!Array.isArray(members)) fail('metros.json', `metros.${code}`, 'must be an array');
    metros[code] = members.map((x, i) => str('metros.json', `metros.${code}[${i}]`, x));
  }
  const index = metroIndex(metros);
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
    };
  });
  return { version: `${version}+metros-${revision}`, airports, metros };
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
