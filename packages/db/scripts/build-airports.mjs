#!/usr/bin/env node
// Builds the vendored airports data (spec §7, decision 11). Run by a person when updating the data, never by the app or CI.
//
//   node packages/db/scripts/build-airports.mjs --input <mwgg airports.json> --commit <40-hex sha> --date <YYYY-MM-DD>
//   node packages/db/scripts/build-airports.mjs --wikitext <section wikitext> --revision <Wikipedia revision id> [--retrieved <YYYY-MM-DD>]
//   node --import tsx packages/db/scripts/build-airports.mjs --ourairports <OurAirports airports.csv> --retrieved <YYYY-MM-DD>
// The second and third forms need the first's output: metro members are checked against the built airports file (po-002),
// and the OurAirports facts (spec §7, revision 51) are kept only for its IATA codes.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MIN_ROWS = 5000; // spec §7 sanity threshold
/**
 * The metro rules version, written to metros.json and folded into the dataset version so a rule change re-seeds.
 * r1: first sentence only, ≥ 2 members, majority country. r2: adds CLOSED_TO_PASSENGERS (dm-M3 re-review).
 */
const RULES = 'r2';
/**
 * Airports mwgg still carries but with no scheduled passenger service; mwgg has no status field, so they are listed
 * by hand. A metro left with one airport after this is dropped by the ≥ 2 rule.
 */
const CLOSED_TO_PASSENGERS = {
  SDV: 'Sde Dov, Tel Aviv: closed 2019',
  DKR: 'Dakar-Yoff (Léopold Sédar Senghor): closed to commercial traffic 2017, replaced by DSS',
  YMX: 'Montréal-Mirabel: passenger flights ended 2004',
  RAJ: 'Rajkot (old airport): replaced by Hirasar (HSR) 2023',
  MES: 'Medan Soewondo: an air force base since Kualanamu (KNO) opened in 2013',
};
const IATA = /^[A-Z]{3}$/;
const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    commit: { type: 'string' },
    date: { type: 'string' },
    wikitext: { type: 'string' },
    revision: { type: 'string' },
    retrieved: { type: 'string' },
    ourairports: { type: 'string' },
  },
});

/** The one built airports file's IATA codes (loadAirportsDataset requires exactly one). */
function builtCodes() {
  const built = readdirSync(dataDir).filter((f) => /^airports\..+\.json$/.test(f));
  if (built.length !== 1) throw new Error(`expected exactly one built airports file, found ${built.length}`);
  return new Set(JSON.parse(readFileSync(dataDir + built[0], 'utf8')).airports.map((a) => a.iata));
}

if (values.ourairports) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.retrieved ?? ''))
    throw new Error('--retrieved <YYYY-MM-DD> (the download date) is required with --ourairports');
  // why: the reduction is the tested TypeScript in src, so this form runs under tsx (see the usage above).
  const { ourAirportsFacts } = await import('../src/seed/ourairports.ts');
  const bytes = readFileSync(values.ourairports);
  const { facts, duplicates } = ourAirportsFacts(bytes.toString('utf8'), builtCodes());
  const out = {
    source: 'https://ourairports.com/data/airports.csv',
    retrieved: values.retrieved,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    licence: 'Public Domain; see ourairports.ATTRIBUTION',
    fields:
      'kinds: IATA codes by OurAirports type (large_airport, medium_airport, small_airport, other); scheduled: IATA codes with scheduled_service = yes',
    ...facts,
  };
  writeFileSync(`${dataDir}ourairports.json`, `${JSON.stringify(out)}\n`);
  const n = Object.values(facts.kinds).reduce((t, l) => t + l.length, 0);
  console.log(
    `wrote ourairports.json: ${n} airports (${facts.kinds.large.length} large, ${facts.kinds.medium.length} medium), ${facts.scheduled.length} with scheduled service; codes on several rows: ${duplicates.length}`,
  );
  process.exit(0);
}

if (values.wikitext) {
  if (!/^\d+$/.test(values.revision ?? ''))
    throw new Error('--revision <numeric revision id> is required with --wikitext');
  // why: loadAirportsDataset requires exactly one airports file; with two present the metros could be checked against a stale one.
  const built = readdirSync(dataDir).filter((f) => /^airports\..+\.json$/.test(f));
  if (built.length !== 1) throw new Error(`expected exactly one built airports file, found ${built.length}`);
  const [builtFile] = built;
  const byIata = new Map(
    JSON.parse(readFileSync(dataDir + builtFile, 'utf8')).airports.map((a) => [a.iata, a]),
  );
  const metros = {};
  const drops = [];
  const owner = new Map();
  for (const line of readFileSync(values.wikitext, 'utf8').split('\n')) {
    if (!line.startsWith('*')) continue;
    const head = line.match(/\(([A-Z]{3})\)&nbsp;–/);
    if (!head) continue;
    // why: a code introduced by "formerly" (inline or in ''…'' italics) is a historical code, not a member.
    // why: only the first sentence lists current members; later sentences describe former airports ("The city also
    // previously had … (THF) … now closed"), so their codes are dropped (dm-M3). An initial ("O. R. Tambo") is not a
    // sentence end.
    const [current, ...history] = line
      .slice(line.indexOf(head[0]) + head[0].length)
      .split(/(?<!\b[A-Z])\.\s+(?=[A-Z])/);
    for (const m of history.join(' ').matchAll(/\(([A-Z]{3})[,)]/g))
      drops.push(`${head[1]}:${m[1]} named only in a later sentence about former airports`);
    const rest = current.replace(/''[^']*''/g, '').replace(/formerly [A-Z]{3}/g, '');
    const codes = [...new Set([...rest.matchAll(/\(([A-Z]{3})[,)]/g)].map((m) => m[1]))].sort();
    for (const c of codes)
      if (c in CLOSED_TO_PASSENGERS)
        drops.push(`${head[1]}:${c} closed to passengers (${CLOSED_TO_PASSENGERS[c]})`);
    const present = codes.filter((c) => byIata.has(c) && !(c in CLOSED_TO_PASSENGERS));
    for (const c of codes)
      if (!byIata.has(c) && !(c in CLOSED_TO_PASSENGERS))
        drops.push(`${head[1]}:${c} absent from the airports file`);
    const countries = {};
    for (const c of present) countries[byIata.get(c).country] = (countries[byIata.get(c).country] ?? 0) + 1;
    const majority = Object.entries(countries).sort((a, b) => b[1] - a[1])[0]?.[0];
    const kept = present.filter((c) => byIata.get(c).country === majority);
    for (const c of present)
      if (byIata.get(c).country !== majority)
        drops.push(`${head[1]}:${c} in ${byIata.get(c).country}, not ${majority}`);
    for (const c of kept) {
      if (owner.has(c) && owner.get(c) !== head[1])
        throw new Error(`${c} is listed under both ${owner.get(c)} and ${head[1]}`);
      owner.set(c, head[1]);
    }
    // why: a metro code stands for a multi-airport city; one left with a single member is not one (dm-M3).
    if (kept.length >= 2) metros[head[1]] = kept;
    else if (kept.length === 1) drops.push(`${head[1]}: only ${kept[0]} remains, not a multi-airport city`);
  }
  const source = `https://en.wikipedia.org/w/index.php?title=IATA_airport_code&oldid=${values.revision}`;
  writeFileSync(
    `${dataDir}metros.json`,
    `${JSON.stringify({ source, revision: values.revision, rules: RULES, licence: 'CC BY-SA 4.0', retrieved: values.retrieved ?? new Date().toISOString().slice(0, 10), metros }, null, 1)}\n`,
  );
  console.log(
    `wrote ${Object.keys(metros).length} metro codes from revision ${values.revision}; dropped: ${drops.join('; ') || 'none'}`,
  );
  process.exit(0);
}

if (
  !values.input ||
  !/^[0-9a-f]{40}$/.test(values.commit ?? '') ||
  !/^\d{4}-\d{2}-\d{2}$/.test(values.date ?? '')
) {
  console.error(
    'usage: build-airports.mjs --input <airports.json> --commit <40-hex sha> --date <YYYY-MM-DD>',
  );
  process.exit(2);
}
const knownTz = (tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
const seen = new Set();
const airports = [];
let skipped = 0;
for (const a of Object.values(JSON.parse(readFileSync(values.input, 'utf8')))) {
  const iata = typeof a.iata === 'string' ? a.iata.trim() : '';
  if (!IATA.test(iata) || typeof a.tz !== 'string' || a.tz.length === 0) continue;
  if (
    !knownTz(a.tz) ||
    typeof a.lat !== 'number' ||
    typeof a.lon !== 'number' ||
    !/^[A-Z]{2}$/.test(a.country ?? '')
  ) {
    skipped++;
    continue;
  }
  if (seen.has(iata)) throw new Error(`duplicate IATA code ${iata}; refusing to guess which row is right`);
  seen.add(iata);
  airports.push({
    iata,
    icao: a.icao || null,
    name: String(a.name),
    city: typeof a.city === 'string' ? a.city : '',
    country: a.country,
    tz: a.tz,
    lat: a.lat,
    lon: a.lon,
  });
}
airports.sort((x, y) => (x.iata < y.iata ? -1 : 1));
if (airports.length < MIN_ROWS)
  throw new Error(`only ${airports.length} airports with IATA and tz; at least ${MIN_ROWS} required`);
const version = `${values.date}-${values.commit.slice(0, 7)}`;
writeFileSync(
  `${dataDir}airports.${version}.json`,
  `${JSON.stringify({ version, source: `mwgg/Airports@${values.commit}`, licence: 'MIT; see airports.LICENSE', airports })}\n`,
);
// why: loadAirportsDataset requires exactly one airports.*.json; the old one goes only after the new one is written.
for (const f of readdirSync(dataDir))
  if (/^airports\..+\.json$/.test(f) && f !== `airports.${version}.json`) rmSync(dataDir + f);
console.log(
  `wrote ${airports.length} airports (${skipped} skipped for an unknown tz, missing coordinates or country), version ${version}`,
);
