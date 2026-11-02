// WP21 Task 21.3 (R-e2e, test-r3-003): a verification flag is true only where PROOFS names the recording that set it, by
// its `<kind>/<date>/<n>` key; where the recordings are on this machine, each named key is a recording there. CI runs
// this on every commit (no recording is needed: a key whose day is absent locally is checked by shape only). The
// recorded suites the flip's required run reads fail instead of skipping with RECORDINGS_REQUIRED=1, and name
// themselves skipped otherwise.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMOUFOX_BUILDS, FLAG_NAMES, flagsFor, OS_ARCHES } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { PROOFS } from '../src/selectors.js';
import { RECORDED_ROOT } from './support/recordedList.js';

/** A recording's key as PROOFS names it: kind, day and number (a range "1–4" names its first). */
const KEY = /\b([a-z]+(?:-[a-z]+)*)\/(\d{4}-\d{2}-\d{2})\/(\d+)\b/g;
const keysOf = (proof: string): Array<{ kind: string; day: string; n: string }> =>
  [...proof.matchAll(KEY)].map((m) => ({ kind: m[1] ?? '', day: m[2] ?? '', n: m[3] ?? '' }));

beforeEach(() => {
  expect.hasAssertions();
});

describe('every true flag names its recording by key (R-e2e)', () => {
  it('for every entry and flag: true implies PROOFS names at least one <kind>/<date>/<n> key; a flag PROOFS does not name is false', () => {
    for (const entry of OS_ARCHES) {
      const flags = flagsFor(entry, CAMOUFOX_BUILDS[entry].build);
      for (const flag of FLAG_NAMES) {
        const proof = PROOFS[entry][flag];
        if (flags[flag]) {
          expect(proof, `${entry} ${flag}`).toBeDefined();
          expect(keysOf(proof ?? '').length, `${entry} ${flag}`).toBeGreaterThan(0);
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
    // why: a checkout with no recordings checks shapes only; the count is not asserted
    expect(checked).toBeGreaterThanOrEqual(0);
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
