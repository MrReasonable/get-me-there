#!/usr/bin/env node
// The Windows leg's verdict (decisions 77, 78; spec §9 "CI matrix"): the leg runs every suite with vitest's JSON
// reporter and does not fail on test failures itself; this script's exit code is the leg's.
//   node scripts/windows-known-failures.mjs check <vitest results.json>   compare the results with the list
//   node scripts/windows-known-failures.mjs guard <vitest list.json> [--results <results.json>]   check the list against
//     `vitest list --json` (and the run's results, for the tests vitest list leaves out)
// Options: --root <dir> (default: the working directory), --list <file> (default: <root>/ci/windows-known-failures.txt).
// The list holds one `<file relative to the root> > <full title>` a line (the full title is vitest's `fullName`: the
// describe titles and the test title joined by a space); blank lines and lines starting with # are ignored.
// `check` fails on a failure the list does not name, a file that failed to load, and a listed test that did not fail
// (so the list only shrinks); each listed failure is still printed. `guard` fails on a line naming no test, a line
// matching two, and a duplicate line.
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** @param {string} root @param {string} file */
const rel = (root, file) =>
  relative(root, isAbsolute(file) ? file : resolve(root, file)).replaceAll('\\', '/');

/** @param {string} path */
function readList(path) {
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
  return lines.map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
}

/** @param {string} root @param {string} listPath @param {string} resultsPath */
export function check(root, listPath, resultsPath) {
  const known = new Set(readList(listPath));
  const r = JSON.parse(readFileSync(resultsPath, 'utf8'));
  const out = [];
  let bad = 0;
  const seen = new Set();
  for (const f of r.testResults ?? []) {
    const file = rel(root, f.name);
    if (f.status === 'failed' && (f.assertionResults ?? []).length === 0) {
      out.push(`file failed to load: ${file}`);
      bad++;
    }
    for (const t of f.assertionResults ?? []) {
      const key = `${file} > ${t.fullName}`;
      seen.add(key);
      if (t.status === 'failed') {
        if (known.has(key)) out.push(`known failure: ${key}`);
        else {
          out.push(`unlisted failure: ${key}`);
          bad++;
        }
      } else if (known.has(key)) {
        out.push(`listed test passed (remove its line): ${key}`);
        bad++;
      }
    }
  }
  for (const k of known)
    if (!seen.has(k)) {
      out.push(`listed test did not run: ${k}`);
      bad++;
    }
  return { out, bad };
}

/** @param {string} root @param {string} listPath @param {string} listedPath @param {string | undefined} resultsPath */
export function guard(root, listPath, listedPath, resultsPath) {
  const lines = readList(listPath);
  const listed = JSON.parse(readFileSync(listedPath, 'utf8'));
  // why: `vitest list` leaves out tests declared with it.skipIf even when they run, so the run's own results (when
  // given) count as tests too; a key found in both is one test
  const ran =
    resultsPath === undefined
      ? []
      : (JSON.parse(readFileSync(resultsPath, 'utf8')).testResults ?? []).flatMap((f) =>
          (f.assertionResults ?? []).map((t) => `${rel(root, f.name)} > ${t.fullName}`),
        );
  // why: `vitest list` joins the titles with " > " where the JSON reporter's fullName joins them with a space, escapes a
  // double quote as \", and lists a parameterised test (it.each) once with its placeholders, so such a name is matched
  // as a pattern (each %s, %d, %i, %f, %j, %o, %O or $name standing for any text)
  const keys = listed.map((t) => {
    const key = `${rel(root, t.file)} > ${String(t.name).replaceAll('\\"', '"').split(' > ').join(' ')}`;
    const parts = key.split(/%[sdifjoO]|\$[A-Za-z_][A-Za-z0-9_.]*/);
    if (parts.length === 1) return (line) => line === key;
    const re = new RegExp(`^${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?')}$`);
    return (line) => re.test(line);
  });
  const out = [];
  let bad = 0;
  const counted = new Map();
  for (const l of lines) counted.set(l, (counted.get(l) ?? 0) + 1);
  for (const [l, n] of counted) {
    if (n > 1) {
      out.push(`duplicate line: ${l}`);
      bad++;
    }
    const fromList = keys.filter((k) => k(l)).length;
    const matches = fromList > 0 ? fromList : ran.filter((k) => k === l).length;
    if (matches === 0) {
      out.push(`names no test: ${l}`);
      bad++;
    } else if (matches > 1) {
      out.push(`matches ${matches} tests: ${l}`);
      bad++;
    }
  }
  return { out, bad };
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const root = resolve(opt('--root') ?? process.cwd());
  const listPath = opt('--list') ?? join(root, 'ci', 'windows-known-failures.txt');
  const [command, file] = argv;
  if ((command !== 'check' && command !== 'guard') || file === undefined) {
    process.stderr.write(
      'usage: node scripts/windows-known-failures.mjs check|guard <file> [--root <dir>] [--list <file>]\n',
    );
    return 64;
  }
  let r;
  try {
    r = command === 'check' ? check(root, listPath, file) : guard(root, listPath, file, opt('--results'));
  } catch (e) {
    process.stderr.write(`windows-known-failures: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  for (const l of r.out) process.stdout.write(`${l}\n`);
  process.stdout.write(`${command}: ${r.bad === 0 ? 'ok' : `${r.bad} problem(s)`}\n`);
  return r.bad === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
