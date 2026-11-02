import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { leftWords } from '../../src/lib/leftWords.js';

// Spec rev 55 §11 (WP20 Task 20.3): "about 1h 40m left" from a run's estimatedFinishAt and the page's clock.
// why: every finish is a literal instant after NOW, so the test builds no Date (apps/web: only src/now.tsx does)

const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
const at = (iso: string) => asIsoDateTime(iso);

describe('leftWords', () => {
  it('is null without an estimate, so the card leaves the clause out', () => {
    expect(leftWords(null, NOW)).toBeNull();
  });

  it.each<[string, string, string]>([
    ['minutes under an hour', '2026-10-14T15:08:00.000Z', 'about 8m left'],
    ['a part minute rounds up', '2026-10-14T15:08:01.000Z', 'about 9m left'],
    ['59 minutes', '2026-10-14T15:59:00.000Z', 'about 59m left'],
    ['exactly an hour has no minutes', '2026-10-14T16:00:00.000Z', 'about 1h left'],
    ['an hour and 40 minutes', '2026-10-14T16:40:00.000Z', 'about 1h 40m left'],
    ['23h 59m', '2026-10-15T14:59:00.000Z', 'about 23h 59m left'],
    ['a whole day', '2026-10-15T15:00:00.000Z', 'about 1d left'],
    ['a day and a few hours', '2026-10-15T20:00:00.000Z', 'about 1d 5h left'],
  ])('%s', (_name, finish, words) => {
    expect(leftWords(at(finish), NOW)).toBe(words);
  });

  // why: ruling 20.5 concern 1 — under a minute is said as such, and never as nothing left while the run is going
  it('under a minute, or a finish at or before now while the run is going, reads "less than a minute left"', () => {
    expect(leftWords(at('2026-10-14T15:00:30.000Z'), NOW)).toBe('less than a minute left');
    expect(leftWords(at('2026-10-14T15:00:59.000Z'), NOW)).toBe('less than a minute left');
    expect(leftWords(NOW, NOW)).toBe('less than a minute left');
    expect(leftWords(at('2026-10-14T14:30:00.000Z'), NOW)).toBe('less than a minute left');
  });

  it('a minute or more rounds up to whole minutes (720 s is about 12m; 6,000 s is about 1h 40m)', () => {
    expect(leftWords(at('2026-10-14T15:01:00.000Z'), NOW)).toBe('about 1m left');
    expect(leftWords(at('2026-10-14T15:01:01.000Z'), NOW)).toBe('about 2m left');
    expect(leftWords(at('2026-10-14T15:12:00.000Z'), NOW)).toBe('about 12m left');
    expect(leftWords(at('2026-10-14T16:40:00.000Z'), NOW)).toBe('about 1h 40m left');
  });
});
