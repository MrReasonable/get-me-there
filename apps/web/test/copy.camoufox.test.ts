import { BANNED_WORD_ALLOWLIST, findBannedWords } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { COPY } from '../src/copy.js';

describe('camoufox copy (prov-008, prov-015, ruling 11)', () => {
  it('the phone legend names CF Camoufox and its source label', () => {
    expect(COPY.calendarView.legend.phoneProviders).toContain(
      ', CF Camoufox (Google Flights prices via Camoufox)',
    );
  });
  it('the Providers note says signed-out profile, own IP address and 1,500', () => {
    for (const w of [
      'signed-out profile',
      'own IP address',
      '1,500',
      'Off by default',
      'not a recognised results page',
    ])
      expect(COPY.camoufox.note).toContain(w);
  });
  it('no camoufox string holds a banned word', () => {
    const texts = [
      ...Object.values(COPY.camoufox.pageKinds),
      COPY.camoufox.coolingDown('2026-10-20T05:00:00.000Z'),
      COPY.camoufox.unavailable,
      COPY.camoufox.note,
    ];
    for (const t of texts) expect(findBannedWords(t, BANNED_WORD_ALLOWLIST), t).toEqual([]);
  });
  // why: prov-008 and fix round 1 (CodeRabbit): only the CAPTCHA kind is called a challenge page; every other kind,
  // the cooling-down line and the note never are, and no camoufox copy uses the ruled words
  it('only the CAPTCHA kind is called a challenge page, and no copy uses the ruled words', () => {
    const { captcha, ...others } = COPY.camoufox.pageKinds;
    expect(captcha).toMatch(/challenge page/);
    for (const [kind, words] of Object.entries(others)) expect(words, kind).not.toMatch(/challenge page/i);
    const all = [
      ...Object.values(COPY.camoufox.pageKinds),
      COPY.camoufox.coolingDown('2026-10-20T05:00:00.000Z'),
      COPY.camoufox.note,
      COPY.camoufox.unavailable,
    ];
    for (const t of all) expect(t).not.toMatch(/\bbots?\b|terms do not permi[t]/i);
  });
  it('the note leaves the terms to the operator in the ruled words', () => {
    expect(COPY.camoufox.note).toContain(
      "Read the provider's terms before enabling it; the operator is responsible for how it is used.",
    );
  });
  it('the outcome reasons word blocked and provider_unavailable', () => {
    expect(COPY.calendarView.panel.reasons.blocked).toBe(
      'stopped: Google showed a page this app does not read, or a check (the detail says which)',
    );
    expect(COPY.calendarView.panel.reasons.provider_unavailable).toBe('browser worker not reachable');
  });
});
