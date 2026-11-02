// WP21 Task 21.3 (R-e2e, test-r3-003): a verification flag is true only where PROOFS names the recording that set it, by
// its `<kind>/<date>/<n>` key, or cites the operator ruling that set it ("operator ruling of <date>": the controller's
// ruling, never an invented key); where the recordings are on this machine, each named key is a recording there. CI runs
// this on every commit (no recording is needed: a key whose day is absent locally is checked by shape only). The
// recorded suites the flip's required run reads fail instead of skipping with RECORDINGS_REQUIRED=1, and name
// themselves skipped otherwise.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMOUFOX_BUILDS, FLAG_NAMES, flagsFor, OS_ARCHES } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROOFS } from '../src/selectors.js';
import { RECORDED_ROOT, RECORDINGS_REQUIRED } from './support/recordedList.js';

/** A recording's key as PROOFS names it: kind, day and number (a range "1–4" names its first). */
const KEY = /\b([a-z]+(?:-[a-z]+)*)\/(\d{4}-\d{2}-\d{2})\/(\d+)\b/g;
const keysOf = (proof: string): Array<{ kind: string; day: string; n: string }> =>
  [...proof.matchAll(KEY)].map((m) => ({ kind: m[1] ?? '', day: m[2] ?? '', n: m[3] ?? '' }));
/** A proof that rests on an operator ruling instead of a recording key (the controller's ruling of WP21 Task 21.3). */
const RULING = /operator ruling of \d{4}-\d{2}-\d{2}/;
/** A proof names its recording by key, or cites the operator ruling that set the flag. */
const proven = (proof: string): boolean => keysOf(proof).length > 0 || RULING.test(proof);

beforeEach(() => {
  expect.hasAssertions();
});

describe('every true flag names its recording by key (R-e2e)', () => {
  it('for every entry and flag: true implies PROOFS names a <kind>/<date>/<n> key or an operator ruling; a flag PROOFS does not name is false', () => {
    for (const entry of OS_ARCHES) {
      const flags = flagsFor(entry, CAMOUFOX_BUILDS[entry].build);
      for (const flag of FLAG_NAMES) {
        const proof = PROOFS[entry][flag];
        if (flags[flag]) {
          expect(proof, `${entry} ${flag}`).toBeDefined();
          expect(proven(proof ?? ''), `${entry} ${flag}`).toBe(true);
        }
        if (proof === undefined) expect(flags[flag], `${entry} ${flag}`).toBe(false);
      }
    }
  });
  it('where a named key’s day is on this machine, the key is a recording there', () => {
    let checked = 0;
    for (const entry of OS_ARCHES)
      for (const proof of Object.values(PROOFS[entry]))
        for (const k of keysOf(proof ?? '')) {
          const day = join(RECORDED_ROOT, k.kind, k.day);
          if (!existsSync(day)) continue;
          checked++;
          // why: a results-like kind writes <n>.facts.json beside its meta; the grid kind writes <n>.json
          const found = existsSync(join(day, `${k.n}.facts.json`)) || existsSync(join(day, `${k.n}.json`));
          expect(found, `${k.kind}/${k.day}/${k.n}`).toBe(true);
        }
    // why: review M8: a checkout with no recordings checks shapes only; the required run must check at least one key
    expect(checked > 0 || !RECORDINGS_REQUIRED, `${checked} keys checked`).toBe(true);
  });
  it('the return-select and booking-select proofs, when present, name each recording by its own key (A19: no range)', () => {
    for (const entry of OS_ARCHES)
      for (const flag of ['RETURN_SELECT_VERIFIED', 'BOOKING_SELECT_VERIFIED'] as const) {
        const proof = PROOFS[entry][flag];
        if (proof === undefined) {
          expect(flagsFor(entry, CAMOUFOX_BUILDS[entry].build)[flag], `${entry} ${flag}`).toBe(false);
          continue;
        }
        expect(proof, `${entry} ${flag}`).not.toMatch(/\d[–-]\d/);
        expect(keysOf(proof).length, `${entry} ${flag}`).toBeGreaterThan(0);
      }
  });
  it('the darwin-arm64 SOCS_STABLE proof is the operator ruling of 2026-10-18, naming no recording key', () => {
    const proof = PROOFS['darwin-arm64'].SOCS_STABLE ?? '';
    expect(proof).toBe(
      '2026-10-18 socs-stability recording, passes 1–3 all read back same (operator ruling of 2026-10-18)',
    );
    expect(keysOf(proof)).toEqual([]);
    expect(proven(proof)).toBe(true);
  });
  it('the ruling form needs its date: a proof that names neither a key nor a dated ruling is not proven', () => {
    expect(proven('2026-10-18 a socs-stability recording, passes 1–3')).toBe(false);
    expect(proven('passes 1–3 (operator ruling)')).toBe(false);
    expect(proven('(operator ruling of 2026-10-18)')).toBe(true);
  });
  it('the key pattern reads every form PROOFS uses, and nothing that is no key', () => {
    expect(keysOf('2026-11-01 select-outbound/2026-11-01/3 and select-return/2026-11-01/5 (…)')).toEqual([
      { kind: 'select-outbound', day: '2026-11-01', n: '3' },
      { kind: 'select-return', day: '2026-11-01', n: '5' },
    ]);
    expect(keysOf('2026-10-18 grid/2026-10-18/1–4 (…)')).toEqual([
      { kind: 'grid', day: '2026-10-18', n: '1' },
    ]);
    expect(keysOf('2026-10-18 a socs-stability recording, passes 1–3')).toEqual([]);
  });
});

describe('the recorded suites the flip’s required run reads (test-r3-003)', () => {
  const dir = fileURLToPath(new URL('./', import.meta.url));
  it.each([
    'returnsRecorded.test.ts',
    'offersRecorded.test.ts',
    'selectRecorded.test.ts',
    'bookingRecorded.test.ts',
  ])('%s fails instead of skipping under RECORDINGS_REQUIRED=1, and names itself skipped otherwise', (f) => {
    const src = readFileSync(join(dir, f), 'utf8');
    expect(src).toMatch(/describe\.skipIf\(!present && !RECORDINGS_REQUIRED\)/);
    expect(src).toMatch(/skipTitle\(/);
    expect(src).toMatch(/expect\(present\)\.toBe\(true\)/);
  });
});
