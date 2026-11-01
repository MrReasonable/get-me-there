// Spec §2 (prov-010): the one `fetchedAt` window every camoufox capability shares (post.ts), list page, grid page and
// flight list alike: the request's start to now, with core's clock skew (5 s) either way, both ends included.
import { CAMOUFOX_CLOCK_SKEW_MS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { fetchedAtWithinRequest } from '../../src/camoufox/post.js';

const STARTED = '2026-10-14T15:00:00.000Z';
const NOW = '2026-10-14T15:00:10.000Z';

describe('fetchedAtWithinRequest (prov-010)', () => {
  it('the skew is core’s 5 s', () => {
    expect(CAMOUFOX_CLOCK_SKEW_MS).toBe(5000);
  });

  it.each([
    ['5 s before the start', '2026-10-14T14:59:55.000Z', true],
    ['at the start', STARTED, true],
    ['between the start and now', '2026-10-14T15:00:04.000Z', true],
    ['5 s after now', '2026-10-14T15:00:15.000Z', true],
    ['just over 5 s before the start', '2026-10-14T14:59:54.999Z', false],
    ['just over 5 s after now', '2026-10-14T15:00:15.001Z', false],
    ['a day before', '2026-10-13T15:00:00.000Z', false],
  ])('a page read %s → %s', (_name, fetchedAt, within) => {
    expect(fetchedAtWithinRequest(fetchedAt, STARTED, NOW)).toBe(within);
  });
});
