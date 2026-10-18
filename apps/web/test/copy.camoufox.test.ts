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
      'do not permit this automated access',
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
  it('the unrecognised and cooling-down wordings do not say bot check (prov-008)', () => {
    expect(COPY.camoufox.pageKinds.unrecognised).not.toMatch(/bot check/i);
    expect(COPY.camoufox.coolingDown('2026-10-20T05:00:00.000Z')).not.toMatch(/bot check/i);
    expect(COPY.camoufox.pageKinds.captcha).toMatch(/bot check/);
  });
  it('the outcome reasons word blocked and provider_unavailable', () => {
    expect(COPY.calendarView.panel.reasons.blocked).toBe(
      'stopped: Google showed a page this app does not read, or a check (the detail says which)',
    );
    expect(COPY.calendarView.panel.reasons.provider_unavailable).toBe('browser worker not reachable');
  });
});
