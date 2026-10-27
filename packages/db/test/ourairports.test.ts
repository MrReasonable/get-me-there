// OurAirports facts (spec §7, revision 51): the CSV reduction the build script uses, the loader that joins the vendored
// facts to the airports, and the search that ranks and filters by them. A few invented rows only; no network.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { AirportsRepo } from '../src/repositories/airports.js';
import { loadAirportsDataset, seedAirports } from '../src/seed/airports.js';
import { kindOf, ourAirportsFacts, parseCsv } from '../src/seed/ourairports.js';
import type { AirportKind, AirportsDataset } from '../src/types.js';
import { freshDb, tmpDir } from './helpers/db.js';

/** Invented rows in OurAirports' column layout (a subset of its columns, in its order). */
const CSV = [
  '"id","ident","type","name","municipality","scheduled_service","iata_code"',
  '1,"XAAA","large_airport","Alpha International, Main","Alpha","yes","AAA"',
  '2,"XAAB","medium_airport","Alpha City","Alpha","yes","AAB"',
  '3,"XAAC","medium_airport","RAF Alpha","Alpha","no","AAC"',
  '4,"XAAD","seaplane_base","Alpha ""Harbour"" Seaplane Base","Alpha","no","AAD"',
  '5,"XAAE","closed","Old Beta Field","Beta","no","AAE"',
  '6,"XAAF","small_airport","Beta Field","Beta","yes","AAE"',
  '7,"XZZZ","large_airport","Not in the airports file","Zeta","yes","ZZZ"',
  '8,"XAAG","heliport","Pad","Alpha","no",""',
].join('\r\n');

describe('the OurAirports CSV reduction (build-airports.mjs --ourairports)', () => {
  it('reads quoted fields with commas and doubled quotes', () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('maps the type to four kinds and keeps only the codes of the airports file', () => {
    expect(
      ['large_airport', 'medium_airport', 'small_airport', 'seaplane_base', 'closed'].map(kindOf),
    ).toEqual(['large', 'medium', 'small', 'other', 'other']);
    const { facts, duplicates } = ourAirportsFacts(CSV, new Set(['AAA', 'AAB', 'AAC', 'AAD', 'AAE', 'AAX']));
    expect(facts).toEqual({
      kinds: { large: ['AAA'], medium: ['AAB', 'AAC'], small: ['AAE'], other: ['AAD'] },
      // a code on two rows (a closed field and its successor) takes the better row, so it is not hidden
      scheduled: ['AAA', 'AAB', 'AAE'],
    });
    expect(duplicates).toEqual(['AAE']);
  });

  it('refuses a CSV without the columns it reads', () => {
    expect(() => ourAirportsFacts('"id","type"\n1,"large_airport"', new Set())).toThrow(/scheduled_service/);
  });
});

/** A dataset directory with the given airports and, unless null, an ourairports.json. */
function datasetDir(ourairports: object | null): string {
  const dir = tmpDir();
  const row = (iata: string, name: string, city: string) => ({
    iata,
    icao: null,
    name,
    city,
    country: 'ZZ',
    tz: 'UTC',
    lat: 0,
    lon: 0,
  });
  writeFileSync(
    join(dir, 'airports.v1.json'),
    JSON.stringify({
      version: 'v1',
      source: 's',
      licence: 'l',
      airports: [
        row('AAA', 'Alpha International', 'Alpha'),
        row('AAC', 'RAF Alpha', 'Alpha'),
        row('AAX', 'X', 'X'),
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
  if (ourairports !== null) writeFileSync(join(dir, 'ourairports.json'), JSON.stringify(ourairports));
  return dir;
}

describe('loading the vendored OurAirports facts', () => {
  it('joins kind and scheduled by code, unknown codes null, and puts the retrieval date in the version', () => {
    const ds = loadAirportsDataset(
      datasetDir({
        retrieved: '2026-10-27',
        kinds: { large: ['AAA'], medium: ['AAC'], small: [], other: [] },
        scheduled: ['AAA'],
      }),
    );
    expect(ds.version).toBe('v1+metros-1.r2+ourairports-2026-10-27');
    expect(ds.airports.map((a) => [a.iata, a.kind, a.scheduled])).toEqual([
      ['AAA', 'large', true],
      ['AAC', 'medium', false],
      ['AAX', null, null],
    ]);
  });

  it('without the file every airport is unknown and the version is unchanged', () => {
    const ds = loadAirportsDataset(datasetDir(null));
    expect(ds.version).toBe('v1+metros-1.r2');
    expect(ds.airports.every((a) => a.kind === null && a.scheduled === null)).toBe(true);
  });

  it('refuses a malformed file', () => {
    expect(() => loadAirportsDataset(datasetDir({ retrieved: 'today', kinds: {}, scheduled: [] }))).toThrow(
      /ourairports\.json/,
    );
  });

  it('seeds the facts and reads them back; a re-seed with new facts updates them', () => {
    const db = freshDb();
    const base = (kind: 'large' | null, scheduled: boolean | null): AirportsDataset => ({
      version: kind === null ? 'a' : 'b',
      metros: {},
      airports: [
        {
          iata: asIata('AAA'),
          icao: null,
          name: 'A',
          city: 'A',
          country: 'ZZ',
          tz: 'UTC',
          lat: 0,
          lon: 0,
          metro: null,
          kind,
          scheduled,
        },
      ],
    });
    seedAirports(db, base(null, null));
    const repo = new AirportsRepo(db);
    expect(repo.get('AAA')).toMatchObject({ kind: null, scheduled: null });
    seedAirports(db, base('large', true));
    expect(repo.get('AAA')).toMatchObject({ kind: 'large', scheduled: true });
  });
});

describe('search by OurAirports facts', () => {
  type Row = AirportsDataset['airports'][number];
  const row = (
    iata: string,
    name: string,
    city: string,
    kind: AirportKind | null,
    scheduled: boolean | null,
  ): Row => ({
    iata: asIata(iata),
    icao: null,
    name,
    city,
    country: 'ZZ',
    tz: 'UTC',
    lat: 0,
    lon: 0,
    metro: null,
    kind,
    scheduled,
  });
  const repo = () => {
    const r = new AirportsRepo(freshDb());
    r.upsertAll({
      version: 'synthetic',
      metros: { LON: ['LHR', 'LGW', 'SEN'], PAR: ['BVA', 'CDG', 'LBG', 'ORY'] },
      airports: [
        // as in the vendored data, Heathlands names no city
        row('HAT', 'Heathlands Airport', '', 'small', true),
        row('LHR', 'London Heathrow Airport', 'London', 'large', true),
        row('LGW', 'London Gatwick Airport', 'London', 'large', true),
        row('SEN', 'Southend Airport', 'Southend', 'medium', true),
        row('NHT', 'RAF Northolt', 'London', 'medium', false),
        row('NYS', 'New York Skyports Seaplane Base', 'New York', 'other', false),
        row('BVA', 'Paris Beauvais Tille Airport', 'Beauvais/Tille', 'large', true),
        row('CDG', 'Charles de Gaulle International Airport', 'Paris', 'large', true),
        row('ORY', 'Paris-Orly Airport', 'Paris', 'large', true),
        row('LBG', 'Paris-Le Bourget Airport', 'Paris', 'large', false),
        row('PRX', 'Cox Field', 'Paris', 'small', true),
        row('PAZ', 'Parma Field', 'Parma', 'medium', true),
        row('PAU', 'Paradise Field', 'Paradise', null, null),
      ],
    });
    return r;
  };
  const codes = (q: string, limit = 20) =>
    repo()
      .search(q, limit)
      .map((a) => a.iata);

  it('"heath" puts Heathrow (large, scheduled) before Heathlands (small)', () => {
    expect(codes('heath')).toEqual(['LHR', 'LGW', 'SEN', 'HAT']);
  });

  it('"par" puts Paris\'s large airports first, Beauvais after them; medium before unknown in the next band', () => {
    expect(codes('par')).toEqual(['CDG', 'ORY', 'BVA', 'PAZ', 'PAU', 'PRX']);
  });

  it('hides airports with no scheduled service (an air base, a seaplane base), unless the exact code is typed', () => {
    expect(codes('northolt')).toEqual([]);
    expect(codes('lond')).not.toContain('NHT');
    expect(codes('seaplane')).toEqual([]);
    expect(codes('NHT')).toEqual(['NHT']);
    expect(codes('lbg')).toEqual(['LBG', 'BVA', 'CDG', 'ORY']);
  });

  it('never cuts a metro short: the limit counts it as one block', () => {
    expect(codes('lond', 2)).toEqual(['LGW', 'LHR', 'SEN']);
    expect(codes('heath', 1)).toEqual(['LHR', 'LGW', 'SEN']);
  });
});
