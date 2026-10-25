import { readdirSync, readFileSync } from 'node:fs';
import { CAMOUFOX_BUILDS, FLAG_NAMES as CORE_FLAG_NAMES, flagsFor } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BINARY_BUILD } from '../src/install.js';
import { FLAG_NAMES, flagsOf, PROOFS, SELECTORS, SELECTORS_VERSION } from '../src/selectors.js';

describe('the dated selectors module (spec §2; brief §9)', () => {
  it('is dated', () => {
    expect(SELECTORS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-/);
    expect(SELECTORS.version).toBe(SELECTORS_VERSION);
  });
  it('reports every flag as the 2026-10-18 recordings set them; View more stays off', () => {
    expect(flagsOf()).toEqual({
      RESULTS_VERIFIED: true,
      FORM_VERIFIED: true,
      CHEAPEST_FLOW_VERIFIED: true,
      VIEW_MORE_ADDS_CHEAPER: false,
      NO_FLIGHTS_VERIFIED: true,
      SOCS_STABLE: true,
      GRID_VERIFIED: true,
      LANDING_VERIFIED: false,
    });
    expect(Object.keys(flagsOf())).toEqual([...FLAG_NAMES]);
  });
  it('each true flag names its proving recording’s date (TS-13)', () => {
    for (const f of FLAG_NAMES) {
      if (!flagsOf()[f]) continue;
      expect(PROOFS[f], f).toMatch(/^\d{4}-\d{2}-\d{2} /);
    }
  });
  it('reads its flags through core’s flagsFor for the operator’s Mac and the pinned build (decision 81), values unchanged', () => {
    expect(FLAG_NAMES).toBe(CORE_FLAG_NAMES);
    expect(flagsOf()).toEqual(flagsFor('darwin-arm64', CAMOUFOX_BUILDS['darwin-arm64'].build));
    expect(DEFAULT_BINARY_BUILD).toBe(CAMOUFOX_BUILDS['darwin-arm64'].build);
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
