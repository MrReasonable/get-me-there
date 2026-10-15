#!/usr/bin/env node
// Fails when any fixture file contains a credential-shaped string or a configured secret value.
// Spec §5.3: CI runs the same secret scan over fixtures/. Values come from the environment so the
// scan can be run locally with the real .env loaded; in CI the env has no secrets and only the
// shape rules apply.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages/providers/fixtures'];
const secretValues = ['TRAVELPAYOUTS_TOKEN', 'SEARCHAPI_KEY', 'SMTP_PASS', 'APP_BASIC_AUTH_PASS']
  .map((k) => process.env[k])
  .filter((v) => v && v.length >= 8);
// why: a vendor may echo a key encoded; the recorder refuses these forms in-process and this is the second layer
// (WP4b sec minor 2). The values themselves are never printed.
const secretForms = [
  ...new Set(
    secretValues.flatMap((v) => [
      v,
      Buffer.from(v, 'utf8').toString('base64'),
      Buffer.from(v, 'utf8').toString('base64url'),
      encodeURIComponent(v),
    ]),
  ),
];
const shapes = [
  /api_key=[A-Za-z0-9]{8,}/i,
  /token=[A-Za-z0-9]{16,}/i,
  /Bearer\s+[A-Za-z0-9._-]{16,}/,
  /X-Access-Token/i,
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let failures = 0;
for (const root of roots) {
  let files = [];
  try {
    files = [...walk(root)];
  } catch {
    continue; // the root does not exist yet (before WP4)
  }
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const v of secretForms) {
      if (text.includes(v)) {
        console.error(`secret value found in ${f}`);
        failures++;
      }
    }
    for (const re of shapes) {
      if (re.test(text)) {
        console.error(`credential-shaped string ${re} in ${f}`);
        failures++;
      }
    }
  }
}
console.log(
  `secret scan: checked ${secretValues.length} configured secret value(s) and ${shapes.length} shape rules`,
);
if (secretValues.length === 0)
  console.error(
    'secret scan: warning: no configured secret value is loaded, so only the shape rules ran; the real-value gate is node --env-file=.env scripts/secret-scan.mjs',
  );
if (failures > 0) process.exit(1);
console.log('secret scan: clean');
