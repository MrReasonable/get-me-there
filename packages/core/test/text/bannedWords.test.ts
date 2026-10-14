import { describe, expect, it } from 'vitest';
import { BANNED_WORD_ALLOWLIST, BANNED_WORDS, findBannedWords } from '../../src/text/bannedWords.js';

describe('findBannedWords (spec §11)', () => {
  it('lists the canonical words and the single allowlist', () => {
    expect(BANNED_WORDS).toEqual([
      'exhaustive',
      'all combinations',
      'every combination',
      'live',
      'bookable',
      'guaranteed',
      'real-time',
    ]);
    expect(BANNED_WORD_ALLOWLIST).toEqual(['smoke:live', 'lives in']);
  });
  it('matches on word boundaries, case-insensitively', () => {
    expect(findBannedWords('Live prices here')).toEqual([{ word: 'live', index: 0 }]);
    expect(findBannedWords('delivered olives alive')).toEqual([]);
    expect(findBannedWords('Real-Time and realtime')).toEqual([{ word: 'real-time', index: 0 }]);
    expect(findBannedWords('Exhaustively? no: exhaustive.')).toEqual([{ word: 'exhaustive', index: 18 }]);
  });
  it('honours an allowlist of exact phrases', () => {
    expect(findBannedWords('she lives in Leeds; live now', ['lives in'])).toEqual([
      { word: 'live', index: 20 },
    ]);
    expect(findBannedWords('pnpm smoke:live runs one tile', BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
  it('finds multi-word phrases and reports hits in text order', () => {
    expect(findBannedWords('searches ALL combinations, guaranteed')).toEqual([
      { word: 'all combinations', index: 9 },
      { word: 'guaranteed', index: 27 },
    ]);
  });
  it('treats unicode letters as word characters', () => {
    expect(findBannedWords('olivé live')).toEqual([{ word: 'live', index: 6 }]);
    expect(findBannedWords('élive')).toEqual([]);
  });
});
