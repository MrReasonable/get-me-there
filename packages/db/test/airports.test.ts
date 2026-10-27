import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../src/internal/read.js';
import { RowRejected } from '../src/internal/validate.js';
import { AIRPORTS_DATA_DIR } from '../src/paths.js';
import { AirportsRepo } from '../src/repositories/airports.js';
import {
  AIRPORTS_MIN_ROWS,
  loadAirportsDataset,
  sanityCheckAirports,
  seedAirports,
} from '../src/seed/airports.js';
import type { AirportsDataset } from '../src/types.js';
import { freshDb, tmpDir } from './helpers/db.js';
import { EWR, JFK, LGW, LHR } from './helpers/factories.js';

type Row = AirportsDataset['airports'][number];
const A = 'A'.charCodeAt(0);
/** Synthetic IATA-shaped codes AAA, AAB, …; their names say they are synthetic. */
const syntheticCode = (i: number) =>
  String.fromCharCode(A + Math.floor(i / 676), A + (Math.floor(i / 26) % 26), A + (i % 26));
const row = (iata: string, over: Partial<Row> = {}): Row => ({
  iata: asIata(iata),
  icao: null,
  name: `Synthetic ${iata}`,
  city: 'Synthetic City',
  country: 'ZZ',
  tz: 'UTC',
  lat: 0,
  lon: 0,
  metro: null,
  ...over,
});
const dataset = (
  airports: Row[],
  version = 'synthetic-1',
  metros: Record<string, string[]> = {},
): AirportsDataset => ({ version, airports, metros });
const many = (n: number, version?: string) =>
  dataset(
    Array.from({ length: n }, (_, i) => row(syntheticCode(i))),
    version,
  );

describe('airports seed and sanity check (spec §7 airports)', () => {
  it(`passes with ${AIRPORTS_MIN_ROWS} rows carrying IATA and tz and fails with one fewer`, {
    timeout: 30_000,
  }, () => {
    const db = freshDb();
    seedAirports(db, many(AIRPORTS_MIN_ROWS - 1));
    expect(sanityCheckAirports(db, [])).toMatchObject({ ok: false, reason: expect.stringContaining('5000') });
    seedAirports(db, many(AIRPORTS_MIN_ROWS, 'synthetic-2'));
    expect(sanityCheckAirports(db, [asIata('AAA')])).toEqual({ ok: true });
  });

  it('fails naming every referenced airport that is missing', () => {
    const db = freshDb();
    seedAirports(db, many(AIRPORTS_MIN_ROWS));
    expect(sanityCheckAirports(db, [asIata('AAA'), asIata('ZZZ'), asIata('ZZY'), asIata('ZZZ')])).toEqual({
      ok: false,
      reason: 'airports referenced by enabled definitions are missing: ZZY, ZZZ',
    });
  });

  it('re-seeding the same version inserts nothing; a new version upserts by IATA and applies its metro list', () => {
    const db = freshDb();
    const rows = [row('AAA'), row('AAB'), row('AAC')];
    expect(seedAirports(db, dataset(rows, 'v1'))).toEqual({ inserted: 3, datasetVersion: 'v1' });
    expect(seedAirports(db, dataset(rows, 'v1'))).toEqual({ inserted: 0, datasetVersion: 'v1' });
    expect(seedAirports(db, dataset(rows, 'v2', { AAX: ['AAA', 'AAB', 'QQQ'] }))).toEqual({
      inserted: 3,
      datasetVersion: 'v2',
    });
    const repo = new AirportsRepo(db);
    expect(repo.get('AAA')).toMatchObject({ datasetVersion: 'v2', metro: 'AAX' });
    expect(repo.get('AAC')?.metro).toBeNull();
    expect(repo.datasetVersion()).toBe('v2');
    expect(repo.count()).toBe(3);
  });

  it("search over the vendored data: the worked example's airports lead, a metro comes whole, and none without scheduled service is suggested (plan-a-search)", {
    // why: loads and seeds the whole vendored dataset (5,000+ rows), as the test below does, so the same budget.
    timeout: 30_000,
  }, () => {
    // why: the operator's checks against the real table, kept offline and to the worked example's airports: a name
    // fragment listed a small airfield before Heathrow, and "new y" missed Newark, whose city is not New York.
    const db = freshDb();
    seedAirports(db, loadAirportsDataset(AIRPORTS_DATA_DIR));
    const repo = new AirportsRepo(db);
    const codes = (q: string) => repo.search(q, 20).map((a) => a.iata);
    expect(codes('heath')[0]).toBe('LHR');
    expect(codes('new y').slice(0, 3)).toEqual(expect.arrayContaining(['JFK', 'EWR']));
    expect(codes('lond').slice(0, 6)).toEqual(expect.arrayContaining(['LHR', 'LGW']));
    for (const q of ['lond', 'new y', 'heath', 'airport'])
      expect(repo.search(q, 20).filter((a) => a.scheduled === false)).toEqual([]);
    expect(repo.get(LHR)).toMatchObject({ kind: 'large', scheduled: true });
  });

  it('the vendored data carries the worked example, its metro members, one country per metro, and passes the sanity check', {
    // why: loads and seeds the whole vendored dataset (5,000+ rows); same size as the first test, so the same budget.
    timeout: 30_000,
  }, () => {
    const ds = loadAirportsDataset(AIRPORTS_DATA_DIR);
    // the metro rules are versioned too, so a rule change re-seeds an existing database (dm-M3 re-review)
    expect(ds.version).toBe('2026-10-01-a89e4e0+metros-1378312633.r2+ourairports-2026-10-27');
    expect(
      ds.airports.filter((a) => /^[A-Z]{3}$/.test(a.iata) && a.tz.length > 0).length,
    ).toBeGreaterThanOrEqual(AIRPORTS_MIN_ROWS);
    const db = freshDb();
    seedAirports(db, ds);
    expect(sanityCheckAirports(db, [LHR, LGW, JFK, EWR])).toEqual({ ok: true });
    const repo = new AirportsRepo(db);
    expect(repo.airportsOfMetro('LON')).toEqual(expect.arrayContaining([LHR, LGW]));
    expect(repo.airportsOfMetro('NYC')).toEqual(expect.arrayContaining([JFK, EWR]));
    for (const [code, members] of Object.entries(ds.metros)) {
      const countries = members.map((m) => repo.get(m)?.country);
      expect(countries, `every member of ${code} is a seeded airport`).not.toContain(undefined);
      expect(new Set(countries).size, `metro ${code} spans one country`).toBe(1);
    }
    expect(repo.get('LHR')).toMatchObject({
      icao: 'EGLL',
      country: 'GB',
      tz: 'Europe/London',
      metro: 'LON',
      source: expect.stringContaining('mwgg/Airports'),
    });
    expect(repo.tzOf('EWR')).toBe('America/New_York');
    expect(repo.sharedMetro([LHR, LGW])).toBe('LON');
    expect(repo.sharedMetro([JFK, EWR])).toBe('NYC');
  });

  it('the vendored metro list holds only current multi-airport cities: no one-airport metro, no member the data does not seed (dm-M3)', () => {
    const { metros, airports } = loadAirportsDataset(AIRPORTS_DATA_DIR);
    const seeded = new Set<string>(airports.map((a) => a.iata));
    for (const [code, members] of Object.entries(metros)) {
      expect(members.length, `${code} has at least two members`).toBeGreaterThanOrEqual(2);
      // a closed or former airport is not in the airports file, so a stale member would show up here
      for (const m of members) expect(seeded.has(m), `${code} member ${m} is seeded`).toBe(true);
    }
  });

  it('airports with no passenger service, as recorded in metros.ATTRIBUTION, are in no metro (dm-M3 re-review)', () => {
    const { metros } = loadAirportsDataset(AIRPORTS_DATA_DIR);
    const attribution = readFileSync(join(AIRPORTS_DATA_DIR, 'metros.ATTRIBUTION'), 'utf8').replace(
      /\s+/g,
      ' ',
    );
    // why: the closed list lives in build-airports.mjs and is copied into the attribution as "(XXX Name, reason; ...)".
    const listed = /airports with no passenger service \(([^)]*)\)/.exec(attribution)?.[1];
    const closed = (listed ?? '').split(';').map((entry) => entry.trim().slice(0, 3));
    expect(closed.length, 'the attribution lists the closed airports').toBeGreaterThanOrEqual(1);
    const members = Object.values(metros).flat();
    for (const code of closed) {
      expect(code, 'a three-letter code leads each entry').toMatch(/^[A-Z]{3}$/);
      expect(members, code).not.toContain(code);
      expect(Object.keys(metros), code).not.toContain(code);
    }
  });

  it('loadAirportsDataset requires the metro rules version', () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, 'airports.v.json'),
      JSON.stringify({ version: 'v', source: 's', licence: 'l', airports: [] }),
    );
    writeFileSync(
      join(dir, 'metros.json'),
      JSON.stringify({ source: 's', revision: '1', licence: 'l', retrieved: '2026-10-14', metros: {} }),
    );
    expect(() => loadAirportsDataset(dir)).toThrow(/metros\.json.*rules/);
  });

  it('seeding reads only local files: the seed module imports node:fs, node:path, @gmt/core and relative modules only (test-016)', () => {
    const source = readFileSync(new URL('../src/seed/airports.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(
      imports.every((i) => i === 'node:fs' || i === 'node:path' || i === '@gmt/core' || i?.startsWith('.')),
    ).toBe(true);
  });

  it('the licence and attribution files sit beside the data', () => {
    expect(readFileSync(join(AIRPORTS_DATA_DIR, 'airports.LICENSE'), 'utf8')).toMatch(
      /MIT License[\s\S]*mwgg/,
    );
    const attribution = readFileSync(join(AIRPORTS_DATA_DIR, 'metros.ATTRIBUTION'), 'utf8');
    expect(attribution).toContain('CC BY-SA 4.0');
    expect(attribution).toContain('1378312633');
    expect(existsSync(join(AIRPORTS_DATA_DIR, 'metros.json'))).toBe(true);
    // the OurAirports facts carry their source, download date, checksum and licence (spec §7, revision 51)
    const oa = readFileSync(join(AIRPORTS_DATA_DIR, 'ourairports.ATTRIBUTION'), 'utf8');
    expect(oa).toMatch(/public domain/i);
    const facts: unknown = JSON.parse(readFileSync(join(AIRPORTS_DATA_DIR, 'ourairports.json'), 'utf8'));
    expect(facts).toMatchObject({
      source: 'https://ourairports.com/data/airports.csv',
      retrieved: '2026-10-27',
    });
    expect(facts).toHaveProperty('sha256', expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(oa).toContain(isRecord(facts) ? String(facts.sha256) : 'missing');
  });

  it('loadAirportsDataset rejects a malformed file naming the file and field (po-007)', () => {
    const dir = tmpDir();
    writeFileSync(
      join(dir, 'airports.bad.json'),
      JSON.stringify({
        version: 'bad',
        source: 's',
        licence: 'l',
        airports: [
          { iata: 'AAA', icao: null, name: 'n', city: 'c', country: 'ZZ', tz: 'UTC', lat: 'north', lon: 0 },
        ],
      }),
    );
    writeFileSync(
      join(dir, 'metros.json'),
      JSON.stringify({
        source: 's',
        revision: '1',
        rules: 'r2',
        licence: 'l',
        retrieved: '2026-10-14',
        metros: {},
      }),
    );
    expect(() => loadAirportsDataset(dir)).toThrow(/airports\.bad\.json.*airports\[0\]\.lat/);
  });

  it('a new version clears the metro of airports it no longer lists; they stay, at their old version (dm-M4)', () => {
    const db = freshDb();
    const repo = new AirportsRepo(db);
    repo.upsertAll(dataset([row('AAA'), row('AAB'), row('AAC')], 'v1', { AAX: ['AAA', 'AAB', 'AAC'] }));
    repo.upsertAll(dataset([row('AAA'), row('AAC')], 'v2', { AAX: ['AAA', 'AAC'] }));
    expect(repo.get('AAB')).toMatchObject({ metro: null, datasetVersion: 'v1' }); // still referenced by definitions, so kept
    expect(repo.airportsOfMetro('AAX')).toEqual(['AAA', 'AAC']);
    expect([repo.metroOf('AAA'), repo.get('AAA')?.datasetVersion]).toEqual(['AAX', 'v2']);
  });

  it('a metro of fewer than two airports is refused (dm-M3)', () => {
    expect(() =>
      new AirportsRepo(freshDb()).upsertAll(dataset([row('AAA'), row('AAB')], 'v', { AAX: ['AAA'] })),
    ).toThrow(expect.objectContaining({ rule: 'metro' }));
  });

  it('a metro list that puts one airport in two metros is refused', () => {
    expect(() =>
      new AirportsRepo(freshDb()).upsertAll(
        dataset([row('AAA'), row('AAB'), row('AAC')], 'v', { AAX: ['AAA', 'AAB'], AAY: ['AAA', 'AAC'] }),
      ),
    ).toThrow(expect.objectContaining({ rule: 'metro' }));
  });
});

describe('AirportsRepo', () => {
  const seeded = (rows: Row[], metros: Record<string, string[]> = {}) => {
    const repo = new AirportsRepo(freshDb());
    repo.upsertAll(dataset(rows, 'test', metros));
    return repo;
  };

  it('exists, metroOf, airportsOfMetro, sharedMetro, tzOf', () => {
    const repo = seeded(
      [row('AAA'), row('AAB'), row('BBB'), row('BBC'), row('CCC', { tz: 'Europe/London' })],
      { AAX: ['AAA', 'AAB'], BBX: ['BBB', 'BBC'] },
    );
    expect([repo.exists('AAA'), repo.exists('ZZZ')]).toEqual([true, false]);
    expect([repo.metroOf('AAA'), repo.metroOf('CCC')]).toEqual(['AAX', null]);
    expect(repo.airportsOfMetro('AAX')).toEqual(['AAA', 'AAB']);
    expect(repo.sharedMetro([asIata('AAA'), asIata('AAB')])).toBe('AAX');
    expect(repo.sharedMetro([asIata('AAA'), asIata('BBB')])).toBeNull();
    expect(repo.sharedMetro([asIata('AAA'), asIata('CCC')])).toBeNull();
    expect(repo.sharedMetro([asIata('AAA'), asIata('ZZZ')])).toBeNull();
    expect(repo.sharedMetro([])).toBeNull();
    expect([repo.tzOf('CCC'), repo.tzOf('ZZZ')]).toEqual(['Europe/London', null]);
  });

  it('search ranks an exact code, then the members of a metro code, then a code prefix, then name or city; wildcards are literal', () => {
    const repo = seeded(
      [
        row('AAB', { name: 'Alpha Field' }),
        row('AAA', { name: 'Beta Field' }),
        row('BAA', { name: 'Field AA' }),
        row('CCC', { name: '100% Synthetic' }),
        row('QQQ'),
        row('QQR'),
      ],
      { QQX: ['QQQ', 'QQR'] },
    );
    expect(repo.search('aaa', 10).map((a) => a.iata)).toEqual(['AAA']);
    expect(repo.search('QQX', 10).map((a) => a.iata)).toEqual(['QQQ', 'QQR']); // po-003: a metro code lists its airports
    expect(repo.search('AA', 10).map((a) => a.iata)).toEqual(['AAA', 'AAB', 'BAA']);
    expect(repo.search('alpha', 10).map((a) => a.iata)).toEqual(['AAB']);
    expect(repo.search('%', 10).map((a) => a.iata)).toEqual(['CCC']);
    expect(repo.search('  ', 10)).toEqual([]);
    expect(repo.search('field', 1)).toHaveLength(1);
  });

  it('search returns every airport of a matched metro as one block, metros first in a band, text matches first inside', () => {
    // why: the operator types a place, not a code. Invented airports (QQ*) beside the worked example's: a metro
    // member whose city is a neighbouring town (QQS, as Newark is to New York) comes with its metro, and a name
    // fragment matching both Heathrow and an invented airfield puts the London block first.
    const repo = seeded(
      [
        row('LHR', { name: 'London Heathrow Airport', city: 'London', country: 'GB' }),
        row('LGW', { name: 'London Gatwick Airport', city: 'London', country: 'GB' }),
        row('QQS', { name: 'Synthetic Outer Airport', city: 'Outerby', country: 'GB' }),
        row('QQB', { name: 'Synthetic Hill Airport', city: 'London', country: 'GB' }),
        row('QQD', { name: 'Synthetic Field', city: 'Londwell' }),
        row('QQE', { name: 'Synthetic Strip', city: 'East London' }),
        row('QQH', { name: 'Heathfield Airport', city: '' }),
        row('JFK', { name: 'John F Kennedy International Airport', city: 'New York', country: 'US' }),
        row('EWR', { name: 'Newark Liberty International Airport', city: 'Newark', country: 'US' }),
        row('QQN', { name: 'Synthetic Seaplane Base', city: 'New York', country: 'US' }),
        row('QQC', { name: 'Qarville Central Airport', city: 'Qarville' }),
        row('QQO', { name: 'Qarville South Airport', city: 'Qarville' }),
        row('QQV', { name: 'Qarville Valley Airport', city: 'Vallet' }),
        row('QQP', { name: 'Cox Field', city: 'Qarville' }),
        row('QQT', { name: 'Thornhill Field', city: 'Synthetic City' }),
      ],
      { LON: ['LHR', 'LGW', 'QQS'], NYC: ['EWR', 'JFK'], QAR: ['QQC', 'QQO', 'QQV'] },
    );
    const codes = (q: string) => repo.search(q, 20).map((a) => a.iata);
    expect(codes('lond')).toEqual(['LGW', 'LHR', 'QQS', 'QQB', 'QQD', 'QQE']);
    expect(codes('new y')).toEqual(['JFK', 'EWR', 'QQN']);
    expect(codes('york')).toEqual(['JFK', 'EWR', 'QQN']);
    expect(codes('heath')).toEqual(['LHR', 'LGW', 'QQS', 'QQH']);
    // a metro code leads with its own city's airports; a member named after the city but elsewhere comes after them
    expect(codes('qar')).toEqual(['QQC', 'QQO', 'QQV', 'QQP']);
    // "hill" starts a word of one name before it sits inside another
    expect(codes('hill')).toEqual(['QQB', 'QQT']);
    // a code comes first, then the rest of its metro
    expect(codes('lhr')).toEqual(['LHR', 'LGW', 'QQS']);
    expect(codes('LON')).toEqual(['LGW', 'LHR', 'QQS', 'QQB', 'QQD', 'QQE']);
  });

  it('rejects a malformed country, an unknown time zone and a malformed metro code, writing nothing', () => {
    // why: a malformed IATA code cannot be built without a cast (asIata throws), so the typed path proves the other rules.
    const repo = new AirportsRepo(freshDb());
    expect(() => repo.upsertAll(dataset([row('AAA'), { ...row('AAC'), country: 'zz' }]))).toThrow(
      RowRejected,
    );
    expect(() => repo.upsertAll(dataset([row('AAA', { tz: 'Mars/Olympus_Mons' })]))).toThrow(/tz/);
    expect(() => repo.upsertAll(dataset([row('AAA')], 'v', { x1: ['AAA'] }))).toThrow(/metro/);
    expect(repo.count()).toBe(0);
    expect(repo.datasetVersion()).toBeNull();
  });
});
