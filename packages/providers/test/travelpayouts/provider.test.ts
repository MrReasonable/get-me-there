import { findBannedWords, Secret } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { TRAVELPAYOUTS_INFO, TRAVELPAYOUTS_POINT_OF_SALE } from '../../src/travelpayouts/provider.js';
import { ctx, discoveryOf, makeHarness, makeProvider, TOKEN } from './harness.js';

describe('travelpayoutsProvider identity (spec §2, §5.1, §5.2)', () => {
  it('is a discovery-only authorised-cached provider that declares economy only', () => {
    const p = makeProvider(makeHarness());
    expect(p.id).toBe('travelpayouts');
    expect(p.displayName).toBe('Aviasales cache');
    expect(p.verification).toBeUndefined();
    expect(p.cabins).toEqual(['economy']);
    expect(p.suppliedFields).toEqual(['price']);
    expect(discoveryOf(p).info).toEqual({
      sourceKind: 'authorised-cached',
      maxAgeHours: 48,
      provenanceNote: TRAVELPAYOUTS_INFO.provenanceNote,
    });
    expect(TRAVELPAYOUTS_POINT_OF_SALE).toBe('unknown');
  });

  it('the provenance note attributes the round trip and the 48 hours to the vendor, says the row age comes from the link and the 48 hours is the fallback, names no passenger count, and uses no banned word (spec §11)', () => {
    const note = TRAVELPAYOUTS_INFO.provenanceNote;
    expect(note).toContain(
      "Travelpayouts describes these as cached round-trip prices that Aviasales users found within the last 48 hours (vendor's declaration)",
    );
    expect(note).toContain("A row's own search link carries the day it was searched");
    expect(note).toContain('the 48 hours applies only to a row whose link has no search date');
    expect(note).toContain('cabin not stated by the vendor, treated as economy');
    expect(note).not.toContain('rows carry no timestamp');
    // ruling 4: the vendor states no passenger count, so the note states none
    expect(note).not.toMatch(/adults?|passengers?/i);
    expect(findBannedWords(note)).toEqual([]);
  });

  it.each([-1, 1.5, Number.NaN])('refuses cacheTtlSeconds %d', (ttl) => {
    expect(() => makeProvider(makeHarness(), { cacheTtlSeconds: ttl })).toThrow(/cacheTtlSeconds/);
  });

  it('refuses an empty token at construction (fails closed: no request is ever made with it)', () => {
    expect(() => makeProvider(makeHarness(), { token: new Secret('') })).toThrow(
      /TRAVELPAYOUTS_TOKEN is empty/,
    );
  });
});

describe('healthcheck (stateless, plan decision 24)', () => {
  it('sends no request, writes no ledger row, and never echoes the token', async () => {
    const h = makeHarness();
    const p = makeProvider(h);
    const first = await p.healthcheck(ctx());
    const second = await p.healthcheck(ctx());
    expect(first).toEqual({
      ok: true,
      detail: 'not probed: token configured; the healthcheck sends no request',
    });
    expect(second).toEqual(first);
    expect(h.events).toEqual([]);
    expect(JSON.stringify(first)).not.toContain(TOKEN.reveal());
  });
});
