import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';
import {
  LEFT_FOR_TEXT,
  leftForOf,
  SKIP_CODE_TEXT,
  SKIP_DETAIL_TEXT,
  scheduledOnlyPastText,
  scheduledOnlyText,
} from '../../src/labels/skip.js';
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '../../src/text/bannedWords.js';
import { SKIP_CODES, SKIP_DETAILS } from '../../src/types/execution.js';

describe('skip details and codes (spec §3, §8.2; migration 0007)', () => {
  it('names the two scheduled_only details and the two skipped_missed codes', () => {
    expect(SKIP_DETAILS).toEqual(['catch-up-no-browser', 'outside-browser-window']);
    expect(SKIP_CODES).toEqual(['half-cadence', 'browser-only-definition']);
    expect(core.SKIP_DETAILS).toBe(SKIP_DETAILS);
    expect(core.SKIP_CODES).toBe(SKIP_CODES);
  });
  it('SKIP_DETAIL_TEXT has the fixed reason of every detail, and nothing else', () => {
    expect(SKIP_DETAIL_TEXT).toEqual({
      'catch-up-no-browser': 'a catch-up loads no browser pages',
      'outside-browser-window': "outside this run's browser window",
    });
    expect(Object.keys(SKIP_DETAIL_TEXT)).toEqual([...SKIP_DETAILS]);
    expect(core.SKIP_DETAIL_TEXT).toBe(SKIP_DETAIL_TEXT);
  });
  it('SKIP_CODE_TEXT has the fixed text of every code, and nothing else', () => {
    expect(SKIP_CODE_TEXT).toEqual({
      'half-cadence': 'the next scheduled run was less than half the gap away',
      'browser-only-definition':
        'only the browser provider could run it, and a catch-up loads no browser pages',
    });
    expect(Object.keys(SKIP_CODE_TEXT)).toEqual([...SKIP_CODES]);
    expect(core.SKIP_CODE_TEXT).toBe(SKIP_CODE_TEXT);
  });
  it('every text passes the banned-word test (spec §11)', () => {
    for (const text of [...Object.values(SKIP_DETAIL_TEXT), ...Object.values(SKIP_CODE_TEXT)])
      expect(findBannedWords(text, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
  it('S6: "the next scheduled run" only when the definition is scheduled, enabled and its scheduled runs use the browser provider; "your next run" when only a run by hand would; otherwise not fetched', () => {
    expect(LEFT_FOR_TEXT).toEqual({
      'next-scheduled-run': 'left for the next scheduled run',
      'next-run': 'left for your next run of this search',
      'no-longer-used': 'not fetched: this search no longer uses the browser provider',
    });
    const both = { scheduled: true, manual: true };
    const manualOnly = { scheduled: false, manual: true };
    const none = { scheduled: false, manual: false };
    const scheduled = { scheduleCron: '0 6 * * *', enabled: true };
    expect(leftForOf(scheduled, both)).toBe('next-scheduled-run');
    expect(leftForOf(scheduled, manualOnly)).toBe('next-run');
    expect(leftForOf({ ...scheduled, enabled: false }, both)).toBe('next-run');
    expect(leftForOf({ scheduleCron: null, enabled: true }, both)).toBe('next-run');
    expect(leftForOf(scheduled, none)).toBe('no-longer-used');
    expect(leftForOf({ scheduleCron: null, enabled: false }, none)).toBe('no-longer-used');
    expect(leftForOf(scheduled, { scheduled: true, manual: false })).toBe('next-scheduled-run');
    expect(scheduledOnlyText('outside-browser-window', 'next-scheduled-run')).toBe(
      "left for the next scheduled run: outside this run's browser window",
    );
    expect(scheduledOnlyText('catch-up-no-browser', 'next-run')).toBe(
      'left for your next run of this search: a catch-up loads no browser pages',
    );
    expect(scheduledOnlyText('catch-up-no-browser', 'no-longer-used')).toBe(
      'not fetched: this search no longer uses the browser provider; a catch-up loads no browser pages',
    );
    expect(core.scheduledOnlyText).toBe(scheduledOnlyText);
    expect(core.leftForOf).toBe(leftForOf);
    for (const text of Object.values(LEFT_FOR_TEXT))
      expect(findBannedWords(text, BANNED_WORD_ALLOWLIST)).toEqual([]);
  });
  it('S9: an earlier run’s left cell reads in the past tense, from its stored detail alone', () => {
    expect(scheduledOnlyPastText('catch-up-no-browser')).toBe(
      'left by that run: a catch-up loads no browser pages',
    );
    expect(scheduledOnlyPastText('outside-browser-window')).toBe(
      "left by that run: outside this run's browser window",
    );
    expect(core.scheduledOnlyPastText).toBe(scheduledOnlyPastText);
  });
  it('keeps no test-only reader of stored strings (R32): the db narrows them on read', () => {
    expect('skipDetailText' in core).toBe(false);
    expect('skipCodeText' in core).toBe(false);
  });
});
