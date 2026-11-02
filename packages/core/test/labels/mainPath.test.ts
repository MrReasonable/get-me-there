import { describe, expect, it } from 'vitest';
import { MAIN_PATH_SOURCE, mainPathSource } from '../../src/labels/mainPath.js';
import { providerIdSchema } from '../../src/types/provenance.js';

describe('main-path source names (spec rev 55 §3 "Main-path words", design §7)', () => {
  it("names the four sources in the main path's words", () => {
    expect(mainPathSource('camoufox')).toBe('the browser worker');
    expect(mainPathSource('travelpayouts')).toBe('the Aviasales cache');
    expect(mainPathSource('searchapi')).toBe('Google Flights via SearchApi');
    expect(mainPathSource('fixture')).toBe('the test source');
  });

  it('has exactly one name for every provider id', () => {
    expect(Object.keys(MAIN_PATH_SOURCE).sort()).toEqual([...providerIdSchema.options].sort());
    for (const id of providerIdSchema.options) expect(mainPathSource(id)).toBe(MAIN_PATH_SOURCE[id]);
  });

  it("never uses the set-up views' provider name for the browser worker", () => {
    for (const name of Object.values(MAIN_PATH_SOURCE)) expect(name).not.toMatch(/camoufox/i);
  });
});
