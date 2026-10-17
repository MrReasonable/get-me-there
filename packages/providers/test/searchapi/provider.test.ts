import { asIata, asIsoDate, BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SEARCHAPI_DISCOVERY_INFO,
  SEARCHAPI_DISPLAY_NAME,
  SEARCHAPI_VERIFICATION_INFO,
} from '../../src/searchapi/provider.js';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, saKit } from './support/kit.js';
import { capabilities, makeProvider } from './support/provider.js';
import { CELL_QUERY, ok, syntheticHandler } from './support/synthetic.js';

afterEach(() => assertEverySentAllowed());

describe('searchApiProvider (spec §5.1, §2)', () => {
  const p = makeProvider();

  it('identifies as searchapi with the labelled display name and all four cabins', () => {
    expect(p.id).toBe('searchapi');
    expect(p.displayName).toBe('Google Flights via SearchApi');
    expect(p.cabins).toEqual(['economy', 'premium_economy', 'business', 'first']);
  });

  it('declares discovery scraped-aggregate ≤24 h and verification scraped-search of unknown age (plan decision 24)', () => {
    const { discovery, verification } = capabilities(p);
    expect(discovery.info).toEqual(SEARCHAPI_DISCOVERY_INFO);
    // why: ruling 17 (pie-007): the 24 h is the app's assumption, not a vendor bound, and the info says so.
    expect(discovery.info).toMatchObject({
      sourceKind: 'scraped-aggregate',
      maxAgeHours: 24,
      maxAgeAssumed: true,
    });
    expect(verification.info).toMatchObject({ sourceKind: 'scraped-search', maxAgeHours: 'unknown' });
  });

  it('provenance notes say what is assumed and what is declared (PA-10, PA-11, ruling 2)', () => {
    expect(SEARCHAPI_DISCOVERY_INFO.provenanceNote).toContain('Google date grid via SearchApi');
    expect(SEARCHAPI_DISCOVERY_INFO.provenanceNote).toContain(
      'window is undocumented; the app assumes up to 24 hours',
    );
    expect(SEARCHAPI_DISCOVERY_INFO.provenanceNote).toContain('separate-ticket');
    expect(SEARCHAPI_VERIFICATION_INFO.provenanceNote).toContain('Google Flights via SearchApi');
    expect(SEARCHAPI_VERIFICATION_INFO.provenanceNote).toContain('cached result of undocumented age');
    expect(SEARCHAPI_VERIFICATION_INFO.provenanceNote).toContain(
      "declaration of Google's round-trip price for one adult",
    );
  });

  it('display name and provenance notes carry no banned word (spec §11)', () => {
    for (const text of [
      SEARCHAPI_DISPLAY_NAME,
      SEARCHAPI_DISCOVERY_INFO.provenanceNote,
      SEARCHAPI_VERIFICATION_INFO.provenanceNote,
    ])
      expect(findBannedWords(text, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });

  it('never declares seller, selfTransfer or fareConditions (never invent a seller; Task 5.9 checks the rest against recordings)', () => {
    for (const f of ['seller', 'selfTransfer', 'fareConditions'] as const)
      expect(p.suppliedFields).not.toContain(f);
  });

  it('estimate prices calls at the configured per-call cost, the rate http-kit ledgers with (ruling po-006)', () => {
    expect(
      capabilities(makeProvider(saKit(), { costPerCallMicroGbp: 1234 })).verification.estimate(CELL_QUERY),
    ).toMatchObject({ calls: 5, costMicroGbp: 5 * 1234, seconds: 145 });
    expect(capabilities(p).verification.estimate({ ...CELL_QUERY, expandTop: 3 })).toMatchObject({
      calls: 7,
      costMicroGbp: 0,
    });
  });

  it('plan length is the discovery estimate (spec §5.2 estimate parity): 21 tiles for the worked band', () => {
    const q = {
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureFrom: asIsoDate('2026-10-21'),
      departureTo: asIsoDate('2027-04-20'),
      minNights: 10,
      maxNights: 21,
      cabin: 'economy' as const,
      currency: 'GBP' as const,
    };
    expect(capabilities(p).discovery.plan(q)).toHaveLength(21);
  });

  it('healthcheck is stateless and sends nothing: ok, detail "not probed" (plan decision 24)', async () => {
    server.use(syntheticHandler(() => ok({})));
    const k = saKit();
    const h = await makeProvider(k).healthcheck(ctx());
    expect(h).toEqual({ ok: true, detail: expect.stringMatching(/^not probed/) });
    expect(k.events).toEqual([]);
  });

  it('refuses a point of sale the recorded allowlist cannot send, or a malformed one', () => {
    expect(() => makeProvider(saKit(), { pointOfSale: 'gb' })).toThrow(/POINT_OF_SALE/);
    expect(() => makeProvider(saKit(), { pointOfSale: 'US' })).toThrow(/record fixtures for it first/);
  });
});
