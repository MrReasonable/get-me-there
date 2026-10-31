import { asIsoDateTime } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { leftWords } from '../../src/lib/leftWords.js';

// Spec rev 55 §11 (WP20 Task 20.3): "about 1h 40m left" from a run's estimatedFinishAt and the page's clock.

const NOW = asIsoDateTime('2026-10-14T15:00:00.000Z');
const after = (minutes: number, seconds = 0) =>
  asIsoDateTime(new Date(Date.parse(NOW) + (minutes * 60 + seconds) * 1000).toISOString());

describe('leftWords', () => {
  it('is null without an estimate, so the card leaves the clause out', () => {
    expect(leftWords(null, NOW)).toBeNull();
  });

  it.each<[string, number, number, string]>([
    ['minutes under an hour', 8, 0, 'about 8m left'],
    ['a part minute rounds up', 8, 1, 'about 9m left'],
    ['59 minutes', 59, 0, 'about 59m left'],
    ['exactly an hour has no minutes', 60, 0, 'about 1h left'],
    ['an hour and 40 minutes', 100, 0, 'about 1h 40m left'],
    ['23h 59m', 23 * 60 + 59, 0, 'about 23h 59m left'],
    ['a whole day', 24 * 60, 0, 'about 1d left'],
    ['a day and a few hours', 24 * 60 + 5 * 60, 0, 'about 1d 5h left'],
  ])('%s', (_name, minutes, seconds, words) => {
    expect(leftWords(after(minutes, seconds), NOW)).toBe(words);
  });

  it('a finish at or before now still reads as 1 minute left while the run is going', () => {
    expect(leftWords(NOW, NOW)).toBe('about 1m left');
    expect(leftWords(after(-30), NOW)).toBe('about 1m left');
  });
});
