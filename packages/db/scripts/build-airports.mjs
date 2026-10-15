#!/usr/bin/env node
// Builds the vendored airports data (spec §7, decision 11). Run by a person when updating the data, never by the app or CI.
//
//   node packages/db/scripts/build-airports.mjs --input <mwgg airports.json> --commit <40-hex sha> --date <YYYY-MM-DD>
//   node packages/db/scripts/build-airports.mjs --wikitext <section wikitext> --revision <Wikipedia revision id> [--retrieved <YYYY-MM-DD>]
// The second form needs the first's output: metro members are checked against the built airports file (po-002).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MIN_ROWS = 5000; // spec §7 sanity threshold
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
  },
});

if (values.wikitext) {
  if (!/^\d+$/.test(values.revision ?? ''))
    throw new Error('--revision <numeric revision id> is required with --wikitext');
  const builtFile = readdirSync(dataDir).find((f) => /^airports\..+\.json$/.test(f));
  if (!builtFile) throw new Error('build the airports file first');
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
    const present = codes.filter((c) => byIata.has(c));
    for (const c of codes) if (!byIata.has(c)) drops.push(`${head[1]}:${c} absent from the airports file`);
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
    `${JSON.stringify({ source, revision: values.revision, licence: 'CC BY-SA 4.0', retrieved: values.retrieved ?? new Date().toISOString().slice(0, 10), metros }, null, 1)}\n`,
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
console.log(
  `wrote ${airports.length} airports (${skipped} skipped for an unknown tz, missing coordinates or country), version ${version}`,
);
