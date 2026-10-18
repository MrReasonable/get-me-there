import { describe, expect, it } from 'vitest';
import { SOURCE_LABELS } from '../../src/labels/source.js';
import { findBannedWords } from '../../src/text/bannedWords.js';
import { providerIdSchema, sourceKindSchema } from '../../src/types/provenance.js';

describe('camoufox in core (spec §5.1 rev 32)', () => {
  it('accepts the new ids and refuses unknown ones', () => {
    expect(providerIdSchema.parse('camoufox')).toBe('camoufox');
    expect(sourceKindSchema.parse('scraped-self')).toBe('scraped-self');
    expect(() => providerIdSchema.parse('browser')).toThrow();
    expect(() => providerIdSchema.parse('camofox')).toThrow();
  });
  it('labels the source in the §11 words, with no banned word', () => {
    expect(SOURCE_LABELS['scraped-self']).toBe('Google Flights prices via Camoufox');
    expect(findBannedWords(SOURCE_LABELS['scraped-self'])).toEqual([]);
  });
});
