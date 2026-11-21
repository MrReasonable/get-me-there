// The Status report's pure rules (brief WP18 §6): the boundaries are pinned to the millisecond.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ageEndsLine,
  BACKUP_FILE_PATTERN,
  BACKUP_MAX_AGE_MS,
  backupState,
  backupTimeOf,
  CONSENT_MAX_AGE_MONTHS,
  CONSENT_WARN_MS,
  capPercent,
  capWarn,
  consentBoundOf,
  consentWindowState,
  coverageBuckets,
  coverageGapWarn,
  lastRunLine,
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
  it('exactly 30 days left warns (spec §8.3), a millisecond more is ok, now or earlier fails', () => {
    expect(consentWindowState(at(T + CONSENT_WARN_MS + 1), now)).toBe('ok');
    expect(consentWindowState(at(T + CONSENT_WARN_MS), now)).toBe('warn');
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
        expect(consentWindowState(at(Date.parse(n) + CONSENT_WARN_MS), n)).toBe('warn');
        expect(consentWindowState(at(Date.parse(n) + CONSENT_WARN_MS + 1), n)).toBe('ok');
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

describe('lastRunLine', () => {
  const b = { priced: 12, empty: 3, no_data: 4, error: 3, skipped: 1, not_run: 2, reused: 0 };
  const none = { cells: 0, from: '' };
  it('words every part in order, the error bucket split into not shown and not read', () => {
    expect(lastRunLine(b, 25, { cells: 2, from: 'Gatwick (LGW)' })).toBe(
      'prices for 12 of 25 date pairs; 3 with no flights; 4 with no price found; 2 not shown because no flights were found from Gatwick (LGW); 1 not read (the page failed); 1 skipped; 2 not searched yet',
    );
  });
  it('leaves out each part after the first when it is 0, and adds the reused count', () => {
    expect(
      lastRunLine({ ...b, priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 25 }, 25, none),
    ).toBe('prices for 0 of 25 date pairs; 25 not searched yet');
    expect(lastRunLine({ ...b, reused: 7 }, 25, none)).toMatch(
      /; 3 not read \(the page failed\); 1 skipped; 2 not searched yet \(7 reused from earlier runs\)$/,
    );
    expect(lastRunLine({ ...b, error: 2 }, 25, { cells: 2, from: 'QQA' })).not.toMatch(/not read/);
  });
  it('says one date pair in the singular', () => {
    expect(
      lastRunLine({ ...b, priced: 1, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0 }, 1, none),
    ).toBe('prices for 1 of 1 date pair');
  });
});

describe('ageEndsLine', () => {
  it('names both ends, newest first', () => {
    expect(ageEndsLine('1h old', '6d old')).toBe('newest price 1h old, oldest 6d old');
  });
});

describe('the 13-month consent rule', () => {
  it('clamps to the end of the month, as the worker does', () => {
    expect(CONSENT_MAX_AGE_MONTHS).toBe(13);
    expect(consentBoundOf(asIsoDateTime('2026-01-31T10:00:00.000Z'))).toBe('2027-02-28T10:00:00.000Z');
    expect(consentBoundOf(asIsoDateTime('2026-10-14T09:00:00.000Z'))).toBe('2027-11-14T09:00:00.000Z');
  });
});

describe('backup names', () => {
  it('reads the instant in a daily backup name and nothing else', () => {
    expect(backupTimeOf('get-me-there-2026-10-24T03-30-01-123Z.db')).toBe('2026-10-24T03:30:01.123Z');
    expect(backupTimeOf('get-me-there-2026-10-24T03-30-01-123Z.db.tmp')).toBeNull();
    expect(backupTimeOf('notes.txt')).toBeNull();
    for (const bad of [
      'x-get-me-there-2026-10-24T03-30-01-123Z.db',
      'get-me-there-2026-10-24T03-30-01-12Z.db',
      'get-me-there-2026-10-24T03-30-01-1234Z.db',
      'get-me-there-26-10-24T03-30-01-123Z.db',
      'get-me-there-2026-10-24T03:30:01.123Z.db',
      'get-me-there-2026-1a-24T03-30-01-123Z.db',
      'get-me-there-2026-10-24T03-30-01-123Z.sqlite',
      'get-me-there-2026-10-24T03-30-01-123.db',
    ])
      expect(backupTimeOf(bad), bad).toBeNull();
    expect(BACKUP_FILE_PATTERN.test('get-me-there-2026-10-24T03-30-01-123Z.db')).toBe(true);
  });
});

describe('coverageBuckets', () => {
  const STATUSES = ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run', null] as const;
  it('counts a cell with no roll-up as not searched', () => {
    expect(coverageBuckets(['priced', null, 'error'], 1)).toEqual({
      buckets: { priced: 1, empty: 0, no_data: 0, error: 1, skipped: 0, not_run: 1, reused: 1 },
      total: 3,
    });
  });
  it('the six parts always sum to the number of cells (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...STATUSES), { maxLength: 200 }), (cells) => {
        const { buckets, total } = coverageBuckets(cells, 0);
        const sum =
          buckets.priced +
          buckets.empty +
          buckets.no_data +
          buckets.error +
          buckets.skipped +
          buckets.not_run;
        expect(total).toBe(cells.length);
        expect(sum).toBe(total);
      }),
    );
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
    expect(capWarn(0, 0)).toBe(false);
    expect(capWarn(5, 0)).toBe(false);
    expect(capPercent(0, 0)).toBeNull();
    expect(capPercent(0, -5)).toBeNull();
    expect(capPercent(100, 100)).toBe(100);
  });
});
