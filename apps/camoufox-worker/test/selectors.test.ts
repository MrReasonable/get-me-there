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
      // why: WP21 Task 21.3: the 2026-11-01 recordings and the end-to-end select-return/2026-11-02/1
      RETURN_SELECT_VERIFIED: true,
      BOOKING_SELECT_VERIFIED: true,
    });
    expect(Object.keys(flagsOf())).toEqual([...FLAG_NAMES]);
  });
  // why: WP21 Task 21.3: the outbound and the return are selected only on an entry a recording of the served sequence
  // set them on: darwin-arm64 alone (select-return/2026-11-02/1, end to end), PROOFS naming it; every other entry
  // reports both false, with no proof named
  it('RETURN_SELECT_VERIFIED and BOOKING_SELECT_VERIFIED are true on darwin-arm64 only, named by the end-to-end recording', () => {
    for (const k of OS_ARCHES) {
      const on = k === 'darwin-arm64';
      const flags = flagsOf(selectorsFor(k, CAMOUFOX_BUILDS[k].build));
      for (const f of ['RETURN_SELECT_VERIFIED', 'BOOKING_SELECT_VERIFIED'] as const) {
        expect(flags[f], `${k} ${f}`).toBe(on);
        if (on) expect(PROOFS[k][f], `${k} ${f}`).toContain('select-return/2026-11-02/1');
        else expect(PROOFS[k][f], `${k} ${f}`).toBeUndefined();
      }
    }
  });
  // why: WP21 Task 21.0: the return view's patterns are a hypothesis the recording checks (Task 21.3 dates them); both
  // price forms are admitted so the research can see whichever the page uses
  // why: select-return/2026-11-01/1 and 2 (the booking research): each offer is a button named by this pattern; a
  // hypothesis for the build until BOOKING_SELECT_VERIFIED is set on an entry
  it('the booking view hypothesis: an offer button names the seller, an optional fare and the stated price', () => {
    const { offer } = SELECTORS.booking;
    for (const ok of [
      'Continue to book with QQ Air for 451 British pounds',
      'Continue to book with QQ Air, Economy Light for 1,204 British pounds',
    ])
      expect(offer.test(ok), ok).toBe(true);
    for (const no of [
      'Continue to book with QQ Air for From 451 British pounds',
      'More booking options',
      'View QQ Air, 451 British pounds',
    ])
      expect(offer.test(no), no).toBe(false);
  });
  // why: select-return/2026-11-01/1 and 2: the expansion control is a button named by a count and the fixed phrase
  it('the booking view’s expansion control: a count, then more booking option(s); never an offer', () => {
    const { moreOptions, offer } = SELECTORS.booking;
    for (const ok of ['3 more booking options', '1 more booking option', '12 more booking options'])
      expect(moreOptions.test(ok), ok).toBe(true);
    for (const no of [
      'More booking options',
      'Continue to book with QQ Air for 451 British pounds',
      'View QQ Air, 451 British pounds options',
      '3 more booking options for 451 British pounds',
    ])
      expect(moreOptions.test(no), no).toBe(false);
    expect(offer.test('3 more booking options')).toBe(false);
  });
  // why: WP21 Task 21.3: dated from select-outbound/2026-11-01/3 and 4 (every return name in the "From" form; the
  // heading in its plain, Top and Other forms)
  it('the return view as recorded: a returning-flights heading, and return links in the "From" form only', () => {
    const { heading, resultLink } = SELECTORS.returns;
    for (const h of [
      'Returning flights',
      'returning flights',
      'Top returning flights',
      'Other returning flights',
    ])
      expect(heading.test(h), h).toBe(true);
    for (const h of ['Top departing flights', 'Returning flights soon', 'Best returning flights'])
      expect(heading.test(h), h).toBe(false);
    expect(resultLink.test('From 478 British pounds round trip total. Nonstop flight with QQ Air.')).toBe(
      true,
    );
    // why: the total alone was never recorded (0 of 38 return names), so it is no return link
    expect(resultLink.test('1,204 British pounds round trip total. Nonstop flight with QQ Air.')).toBe(false);
    expect(resultLink.test('Select flight')).toBe(false);
    expect(resultLink.source).toBe(SELECTORS.results.resultLink.source);
  });
  // why: WP21 Task 21.3: select-return/2026-11-01/1 and 3 showed the grouped "View <seller>, …" control; the view's
  // price-comparison note has no selector (the controller's ruling of 2026-11-02: its wording follows the fare)
  it('the booking view as recorded: the path, offer, expansion and grouped patterns only, the grouped control never naming an offer or the expansion', () => {
    const { grouped, offer, moreOptions } = SELECTORS.booking;
    expect(Object.keys(SELECTORS.booking).sort()).toEqual(['grouped', 'moreOptions', 'offer', 'path']);
    for (const ok of [
      'View QQ Travel, QQ Fares 1,250 British pounds options',
      'View QQ Travel, QQ Air 478 British pounds more',
    ])
      expect(grouped.test(ok), ok).toBe(true);
    for (const no of [
      'Continue to book with QQ Travel for 1,180 British pounds',
      'Continue to book with QQ Travel, Economy Basic for 1,180 British pounds',
      '17 more booking options',
      'View more flights',
      'View QQ Travel',
    ]) {
      expect(grouped.test(no), no).toBe(false);
    }
    // why: the grouped control is counted, never pressed: neither the offer pattern nor the expansion's names it
    for (const g of ['View QQ Travel, QQ Fares 1,250 British pounds options']) {
      expect(offer.test(g), g).toBe(false);
      expect(moreOptions.test(g), g).toBe(false);
    }
    expect(SELECTORS_VERSION).toBe('2026-11-01-returns');
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
