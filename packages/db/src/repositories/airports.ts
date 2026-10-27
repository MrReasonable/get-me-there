import { type Iata, isValidTimeZone } from '@gmt/core';
import type { Db } from '../client.js';
import { readIata } from '../internal/read.js';
import { RowRejected } from '../internal/validate.js';
import type { Airport, AirportsDataset } from '../types.js';

interface AirportDbRow {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  tz: string;
  lat: number;
  lon: number;
  metro: string | null;
  source: string;
  dataset_version: string;
}
const toAirport = (r: AirportDbRow): Airport => ({
  iata: readIata('airports.iata', r.iata),
  icao: r.icao,
  name: r.name,
  city: r.city,
  country: r.country,
  tz: r.tz,
  lat: r.lat,
  lon: r.lon,
  metro: r.metro,
  source: r.source,
  datasetVersion: r.dataset_version,
});
const IATA = /^[A-Z]{3}$/;

/** Metro code per airport; an airport in two metros is a data error, never a guess. Used at build, load and seed. */
export function metroIndex(metros: Record<string, string[]>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [code, members] of Object.entries(metros)) {
    if (!IATA.test(code)) throw new RowRejected('metro', `metro code must match ^[A-Z]{3}$, got ${code}`);
    // why: a metro code stands for a multi-airport city; a one-airport "metro" would only alias its airport (dm-M3).
    if (members.length < 2) throw new RowRejected('metro', `metro ${code} needs at least two airports`);
    for (const m of members) {
      const prior = out.get(m);
      if (prior !== undefined && prior !== code)
        throw new RowRejected('metro', `${m} is listed under both ${prior} and ${code}`);
      out.set(m, code);
    }
  }
  return out;
}

/** Airport lookups for validation, tiling and normalisation (spec §5.2, §5.6, §6.1). No airport is named in code. */
export class AirportsRepo {
  constructor(private readonly db: Db) {}

  exists(iata: string): boolean {
    return this.db.raw.prepare('SELECT 1 AS present FROM airports WHERE iata = ?').get(iata) !== undefined;
  }

  get(iata: string): Airport | null {
    const r = this.db.raw.prepare<[string], AirportDbRow>('SELECT * FROM airports WHERE iata = ?').get(iata);
    return r === undefined ? null : toAirport(r);
  }

  tzOf(iata: string): string | null {
    return (
      this.db.raw.prepare<[string], { tz: string }>('SELECT tz FROM airports WHERE iata = ?').get(iata)?.tz ??
      null
    );
  }

  /**
   * Autocomplete (spec §11, `GET /api/airports`). The table has no size or traffic field, so membership of a metro
   * stands in for "a major airport". Each airport gets a code band (0 exact code, 1 a metro code's member (po-003),
   * 2 code prefix) and a text band (3 a city word starting with the text, 4 a name word starting with it, 5 any other name or city
   * substring); its rank is the better of the two. Every airport of a metro any hit belongs to is returned (a metro's
   * outlying airport may name a neighbouring town as its city), and a metro sorts as one block at its best member's
   * rank, ahead of single airports of that rank; inside a block, text matches lead, then the rest by code.
   * So "heath" puts the London block (Heathrow first) before Heathlands, and "par" lists Paris's airports with
   * Beauvais, whose city is not Paris, last of them.
   */
  search(q: string, limit: number): Airport[] {
    const needle = q.trim();
    if (needle.length === 0) return [];
    // why: the operator's text is matched literally; % and _ are escaped for LIKE (case-insensitive for ASCII).
    const e = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
    return this.db.raw
      .prepare<Record<string, unknown>, AirportDbRow>(
        `WITH banded AS (
           SELECT iata, metro,
             CASE
               WHEN iata = upper(@q) THEN 0
               WHEN metro = upper(@q) THEN 1
               WHEN iata LIKE upper(@e) || '%' ESCAPE '\\' THEN 2
               ELSE 9
             END AS code_r,
             CASE
               WHEN ' ' || city LIKE '% ' || @e || '%' ESCAPE '\\' THEN 3
               WHEN ' ' || name LIKE '% ' || @e || '%' ESCAPE '\\' THEN 4
               WHEN name LIKE '%' || @e || '%' ESCAPE '\\' OR city LIKE '%' || @e || '%' ESCAPE '\\' THEN 5
               ELSE 9
             END AS text_r
           FROM airports
         ),
         hits AS (SELECT iata, metro, text_r, min(code_r, text_r) AS r FROM banded WHERE min(code_r, text_r) < 9),
         metro_hits AS (SELECT metro, min(r) AS r FROM hits WHERE metro IS NOT NULL GROUP BY metro)
         SELECT a.*
         FROM airports a
         LEFT JOIN hits h ON h.iata = a.iata
         LEFT JOIN metro_hits m ON m.metro = a.metro
         WHERE h.iata IS NOT NULL OR m.metro IS NOT NULL
         ORDER BY coalesce(m.r, h.r), a.metro IS NULL, a.metro, coalesce(h.text_r, 9), coalesce(h.r, 9), a.iata
         LIMIT @limit`,
      )
      .all({ q: needle, e, limit: Math.max(1, Math.trunc(limit)) })
      .map(toAirport);
  }

  metroOf(iata: string): string | null {
    return (
      this.db.raw
        .prepare<[string], { metro: string | null }>('SELECT metro FROM airports WHERE iata = ?')
        .get(iata)?.metro ?? null
    );
  }

  /** Every airport the table maps to a metro code (WP1 names them, plan Review Focus 1). */
  airportsOfMetro(code: string): Iata[] {
    return this.db.raw
      .prepare<[string], { iata: string }>('SELECT iata FROM airports WHERE metro = ? ORDER BY iata')
      .all(code)
      .map((r) => readIata('airports.iata', r.iata));
  }

  /** The one metro code every given airport shares, else null (spec §5.2). */
  sharedMetro(iatas: Iata[]): string | null {
    const unique = [...new Set(iatas)];
    if (unique.length === 0) return null;
    const r = this.db.raw
      .prepare<[string], { n: number; nulls: number; distinctMetros: number; metro: string | null }>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(metro IS NULL), 0) AS nulls, COUNT(DISTINCT metro) AS distinctMetros, MIN(metro) AS metro FROM airports WHERE iata IN (SELECT value FROM json_each(?))`,
      )
      .get(JSON.stringify(unique));
    if (r === undefined || r.n !== unique.length || r.nulls > 0 || r.distinctMetros !== 1) return null;
    return r.metro;
  }

  count(): number {
    return this.db.raw.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM airports').get()?.n ?? 0;
  }

  /** The version most rows carry, or null for an empty table. */
  datasetVersion(): string | null {
    return (
      this.db.raw
        .prepare<[], { v: string }>(
          'SELECT dataset_version AS v FROM airports GROUP BY dataset_version ORDER BY COUNT(*) DESC, v DESC LIMIT 1',
        )
        .get()?.v ?? null
    );
  }

  /** Upsert by IATA in one transaction; every row is validated first, so a bad dataset writes nothing. `metro` comes from `dataset.metros`. */
  upsertAll(dataset: AirportsDataset): void {
    const metros = metroIndex(dataset.metros);
    for (const a of dataset.airports) {
      if (!IATA.test(a.iata))
        throw new RowRejected('iata', `airport code must match ^[A-Z]{3}$, got ${a.iata}`);
      if (!/^[A-Z]{2}$/.test(a.country))
        throw new RowRejected('country', `country must be ISO alpha-2, got ${a.country} for ${a.iata}`);
      if (!isValidTimeZone(a.tz)) throw new RowRejected('tz', `unknown time zone ${a.tz} for ${a.iata}`);
    }
    const source = `mwgg/Airports ${dataset.version}`;
    const stmt = this.db.raw.prepare(
      `INSERT INTO airports (iata, icao, name, city, country, tz, lat, lon, metro, source, dataset_version)
       VALUES (@iata, @icao, @name, @city, @country, @tz, @lat, @lon, @metro, @source, @datasetVersion)
       ON CONFLICT(iata) DO UPDATE SET icao = excluded.icao, name = excluded.name, city = excluded.city, country = excluded.country, tz = excluded.tz,
         lat = excluded.lat, lon = excluded.lon, metro = excluded.metro, source = excluded.source, dataset_version = excluded.dataset_version`,
    );
    this.db.transaction(() => {
      for (const a of dataset.airports)
        stmt.run({ ...a, metro: metros.get(a.iata) ?? null, source, datasetVersion: dataset.version });
      // why: a row the new dataset no longer lists is kept (definitions may reference it) but must not keep a metro
      // the vendored list no longer gives it (dm-M4).
      this.db.raw
        .prepare('UPDATE airports SET metro = NULL WHERE dataset_version <> ? AND metro IS NOT NULL')
        .run(dataset.version);
    });
  }
}
