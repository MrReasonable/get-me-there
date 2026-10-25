// The Status report's pure rules (brief WP18 §6): the boundaries are pinned to the millisecond.
import { describe, expect, it } from 'vitest';
import {
  ageEndsLine,
  BACKUP_MAX_AGE_MS,
  BUCKET_WORDS,
  backupState,
  CONSENT_WARN_MS,
  capPercent,
  capWarn,
  consentWindowState,
  coverageGapWarn,
  coverageLine,
  formatDateIn,
  formatInstantIn,
  formatTimeIn,
} from '../../src/status/rules.js';
import { asIsoDateTime, isoDateTimeOfEpochMs } from '../../src/types/ids.js';

const T = Date.parse('2026-10-14T09:00:00.000Z');
const at = (ms: number) => isoDateTimeOfEpochMs(ms);
const now = at(T);

describe('backupState', () => {
  const appStartedAt = at(T - 100 * 3_600_000);
  it('a backup 1 ms inside 36 h is ok and one at 36 h warns', () => {
    expect(backupState({ newestAt: at(T - BACKUP_MAX_AGE_MS + 1), appStartedAt, now })).toEqual({
      state: 'ok',
      first: false,
    });
    expect(backupState({ newestAt: at(T - BACKUP_MAX_AGE_MS), appStartedAt, now })).toEqual({
      state: 'warn',
      first: false,
    });
  });
  it('none in a young app is ok and the first one is due; at 36 h of age it fails', () => {
    expect(backupState({ newestAt: null, appStartedAt: at(T - BACKUP_MAX_AGE_MS + 1), now })).toEqual({
      state: 'ok',
      first: true,
    });
    expect(backupState({ newestAt: null, appStartedAt: at(T - BACKUP_MAX_AGE_MS), now })).toEqual({
      state: 'fail',
      first: false,
    });
  });
});

describe('consentWindowState', () => {
  it('30 days is ok, a millisecond short of it warns, now or earlier fails', () => {
    expect(consentWindowState(at(T + CONSENT_WARN_MS), now)).toBe('ok');
    expect(consentWindowState(at(T + CONSENT_WARN_MS - 1), now)).toBe('warn');
    expect(consentWindowState(at(T + 1), now)).toBe('warn');
    expect(consentWindowState(at(T), now)).toBe('fail');
    expect(consentWindowState(at(T - 1), now)).toBe('fail');
  });
  it('30 days is elapsed time on both sides of the Europe/London changes', () => {
    for (const day of ['2027-03-28T00:00:00.000Z', '2027-10-31T00:00:00.000Z']) {
      const start = Date.parse(day);
      for (const offset of [-3, 3]) {
        const n = at(start + offset * 86_400_000);
        expect(consentWindowState(at(Date.parse(n) + CONSENT_WARN_MS - 1), n)).toBe('warn');
        expect(consentWindowState(at(Date.parse(n) + CONSENT_WARN_MS), n)).toBe('ok');
      }
    }
  });
});

describe('coverageGapWarn', () => {
  it('warns past 20% of the cells and not at it', () => {
    expect(coverageGapWarn({ error: 100, skipped: 100, not_run: 212 }, 1000)).toBe(true);
    expect(coverageGapWarn({ error: 100, skipped: 50, not_run: 50 }, 1000)).toBe(false);
    expect(coverageGapWarn({ error: 100, skipped: 50, not_run: 51 }, 1000)).toBe(true);
    expect(coverageGapWarn({ error: 0, skipped: 0, not_run: 0 }, 0)).toBe(false);
  });
});

describe('coverageLine', () => {
  const b = { priced: 12, empty: 3, no_data: 4, error: 0, skipped: 1, not_run: 5, reused: 0 };
  it('words the six buckets in order with the total and no suffix when nothing was reused', () => {
    expect(coverageLine(b, 25)).toBe(
      'priced 12, no fares 3, no cached data 4, error 0, skipped 1, not searched 5 of 25 cells',
    );
    expect(BUCKET_WORDS.map(([, w]) => w)).toEqual([
      'priced',
      'no fares',
      'no cached data',
      'error',
      'skipped',
      'not searched',
    ]);
  });
  it('adds the reused count and a singular cell', () => {
    expect(coverageLine({ ...b, reused: 7 }, 25)).toMatch(/ of 25 cells \(7 reused from earlier runs\)$/);
    expect(coverageLine({ ...b, priced: 1, empty: 0, no_data: 0, skipped: 0, not_run: 0 }, 1)).toMatch(
      / of 1 cell$/,
    );
  });
});

describe('ageEndsLine', () => {
  it('names both ends, newest first', () => {
    expect(ageEndsLine('1h old', '6d old')).toBe('newest price 1h old, oldest 6d old');
  });
});

describe('instant formats', () => {
  it('reads the zone own clock, across the changes', () => {
    expect(formatInstantIn(asIsoDateTime('2026-10-14T09:05:00.000Z'), 'Europe/London')).toBe(
      '2026-10-14 10:05',
    );
    expect(formatInstantIn(asIsoDateTime('2026-12-14T09:05:00.000Z'), 'Europe/London')).toBe(
      '2026-12-14 09:05',
    );
    expect(formatInstantIn(asIsoDateTime('2026-12-14T00:05:00.000Z'), 'UTC')).toBe('2026-12-14 00:05');
    expect(formatDateIn(asIsoDateTime('2026-10-14T23:30:00.000Z'), 'Europe/London')).toBe('2026-10-15');
    expect(formatTimeIn(asIsoDateTime('2026-10-14T23:30:00.000Z'), 'Europe/London')).toBe('00:30');
  });
});

describe('cap use', () => {
  it('is a whole percent, null without a cap, and warns from 80%', () => {
    expect(capPercent(79, 100)).toBe(79);
    expect(capPercent(1, 3)).toBe(33);
    expect(capPercent(5, null)).toBeNull();
    expect(capPercent(5, 0)).toBeNull();
    expect(capWarn(79, 100)).toBe(false);
    expect(capWarn(80, 100)).toBe(true);
    expect(capWarn(80, null)).toBe(false);
    expect(capWarn(1, 0)).toBe(false);
  });
});
