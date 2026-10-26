import { readdirSync, readFileSync } from 'node:fs';
import { CAMOUFOX_BUILDS, FLAG_NAMES as CORE_FLAG_NAMES, flagsFor, OS_ARCHES } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { FLAG_NAMES, flagsOf, PROOFS, SELECTORS, SELECTORS_VERSION, selectorsFor } from '../src/selectors.js';

describe('the dated selectors module (spec §2; brief §9)', () => {
  it('is dated', () => {
    expect(SELECTORS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    expect(SELECTORS.version).toBe(SELECTORS_VERSION);
  });
  it('reports every flag as the 2026-10-18, 2026-10-25 and 2026-10-26 recordings set them; View more stays off', () => {
    expect(flagsOf()).toEqual({
      RESULTS_VERIFIED: true,
      FORM_VERIFIED: true,
      CHEAPEST_FLOW_VERIFIED: true,
      VIEW_MORE_ADDS_CHEAPER: false,
      NO_FLIGHTS_VERIFIED: true,
      SOCS_STABLE: true,
      GRID_VERIFIED: true,
      LANDING_VERIFIED: true,
      // why: grid/2026-10-26/7 and 8 showed the date grid's unpriced cells on the operator's Mac
      GRID_UNPRICED_VERIFIED: true,
    });
    expect(Object.keys(flagsOf())).toEqual([...FLAG_NAMES]);
  });
  it('each true flag of every entry names its proving recording’s date, and no false flag names one (TS-13)', () => {
    for (const k of OS_ARCHES) {
      const flags = flagsFor(k, CAMOUFOX_BUILDS[k].build);
      for (const f of FLAG_NAMES) {
        if (flags[f]) expect(PROOFS[k][f], `${k} ${f}`).toMatch(/^\d{4}-\d{2}-\d{2} /);
        else if (f !== 'VIEW_MORE_ADDS_CHEAPER') expect(PROOFS[k][f], `${k} ${f}`).toBeUndefined();
      }
    }
  });
  it('reads its flags through core’s flagsFor for the operator’s Mac and the pinned build (decision 81), values unchanged', () => {
    expect(FLAG_NAMES).toBe(CORE_FLAG_NAMES);
    expect(flagsOf()).toEqual(flagsFor('darwin-arm64', CAMOUFOX_BUILDS['darwin-arm64'].build));
  });
  it('no worker module states a verification flag’s value itself: every flag is read through core (grep)', () => {
    const dir = new URL('../src/', import.meta.url);
    const flag = new RegExp(`\\b(${FLAG_NAMES.join('|')})\\s*:\\s*(true|false)\\b`);
    // why: the recorder alone switches the no-flights hypothesis on while it records the line that would prove it
    // (record.ts `reading`); that is a recording mode, never a verified value the worker runs with
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'record.ts')
      .filter((f) => flag.test(readFileSync(new URL(f, dir), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

// why: decision 75: the running worker's flags are its own entry's, for the build it runs, all false otherwise
describe('selectorsFor (the running entry’s flags)', () => {
  it('gives each entry its own flags for its pinned build, and none for another build or entry', () => {
    const pin = CAMOUFOX_BUILDS['darwin-arm64'].build;
    expect(flagsOf(selectorsFor('darwin-arm64', pin))).toEqual(flagsFor('darwin-arm64', pin));
    expect(Object.values(flagsOf(selectorsFor('darwin-arm64', '153.0.1-beta.30'))).some(Boolean)).toBe(false);
    // why: WP17 Task 17.8: each entry's own session set its flags for its build, and none for another build
    for (const k of ['darwin-x64', 'linux-arm64', 'linux-x64'] as const) {
      const linux = CAMOUFOX_BUILDS[k].build;
      expect(flagsOf(selectorsFor(k, linux))).toEqual(flagsFor(k, linux));
      expect(selectorsFor(k, linux).FORM_VERIFIED, k).toBe(true);
      expect(Object.values(flagsOf(selectorsFor(k, '153.0.1-beta.30'))).some(Boolean), k).toBe(false);
    }
    const s = selectorsFor('linux-arm64', 'b', () => ({
      ...flagsFor('darwin-arm64', pin),
      GRID_VERIFIED: false,
    }));
    expect([s.FORM_VERIFIED, s.GRID_VERIFIED, s.version, s.hosts]).toEqual([
      true,
      false,
      SELECTORS.version,
      SELECTORS.hosts,
    ]);
  });
});
