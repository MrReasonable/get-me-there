// The pieces of the worker protocol the CLI, the worker and the status report share (spec §12 "Where settings live";
// decisions 76, 81, 82; WP16a Task 16a.5): the shared settings and their effective values, the start refusal file and
// its texts, the worker's data directory, the app-instance header, and every status field WP17's worker will emit.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONSENT_FIX } from '../../src/camoufox/consentFix.js';
import { countsRewriteSchema, MONTHLY_FILE, monthlyCountsSchema } from '../../src/camoufox/monthly.js';
import { APP_INSTANCE_HEADER, workerStatusSchema } from '../../src/camoufox/protocol.js';
import {
  effectiveSharedSettings,
  GRID_ONLY_SETTINGS,
  parseSharedSettings,
  readSharedSettings,
  SHARED_WORKER_DEFAULTS,
  SHARED_WORKER_SETTINGS,
  type SharedSettings,
  SharedSettingsError,
  sharedInt,
  sharedMode,
  sharedSettingDiffs,
  sharedSettingMessage,
} from '../../src/camoufox/settings.js';
import {
  START_REFUSAL_FILE,
  START_REFUSAL_REASONS,
  START_REFUSAL_TEXT,
  startRefusalSchema,
} from '../../src/camoufox/start.js';
import { WORKER_PORT, workerPortOf, workerUrlFor } from '../../src/camoufox/workerPort.js';
import * as core from '../../src/index.js';
import { camoufoxRootDir } from '../../src/local/paths.js';
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '../../src/text/bannedWords.js';

beforeEach(() => {
  expect.hasAssertions();
});

const FULL: unknown = JSON.parse(readFileSync(new URL('./worker-status-full.json', import.meta.url), 'utf8'));
/** A fresh copy of the fixture as a plain record (no cast: the entries are copied). */
const full = (): Record<string, unknown> => {
  const copy: unknown = structuredClone(FULL);
  if (typeof copy !== 'object' || copy === null) throw new Error('the fixture is not an object');
  return Object.fromEntries(Object.entries(copy));
};
const MONTHLY = {
  windowStart: '2027-03-01T00:00:00.000Z',
  windowEnd: '2027-04-01T00:00:00.000Z',
  pages: 12,
  scrolls: 340,
  readable: true,
};

describe('SHARED_WORKER_SETTINGS and their effective values (spec §12)', () => {
  it('names the ten settings the two sides must share, the grid-only two, and the app’s defaults', () => {
    expect(SHARED_WORKER_SETTINGS).toEqual([
      'CAMOUFOX_COOLDOWN_HOURS',
      'CAMOUFOX_PAGE_TIMEOUT_SECONDS',
      'CAMOUFOX_MIN_SPACING_SECONDS',
      'CAMOUFOX_MODE',
      'CAMOUFOX_GRID_SCROLL_CAP',
      'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
      'CAMOUFOX_MONTHLY_PAGE_CAP',
      'CAMOUFOX_MONTHLY_SCROLL_CAP',
      'CAMOUFOX_BILLING_DAY',
      'POINT_OF_SALE',
    ]);
    expect(GRID_ONLY_SETTINGS).toEqual(['CAMOUFOX_GRID_SCROLL_CAP', 'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS']);
    expect(SHARED_WORKER_DEFAULTS).toEqual({
      CAMOUFOX_COOLDOWN_HOURS: '48',
      CAMOUFOX_PAGE_TIMEOUT_SECONDS: '90',
      CAMOUFOX_MIN_SPACING_SECONDS: '30',
      CAMOUFOX_MODE: 'list',
      CAMOUFOX_GRID_SCROLL_CAP: '30',
      CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '5',
      CAMOUFOX_MONTHLY_PAGE_CAP: '1500',
      CAMOUFOX_MONTHLY_SCROLL_CAP: '6000',
      CAMOUFOX_BILLING_DAY: '1',
      POINT_OF_SALE: 'GB',
    });
    expect(core.SHARED_WORKER_SETTINGS).toBe(SHARED_WORKER_SETTINGS);
  });

  it('CAMOUFOX_BROWSER_WINDOW is the app’s alone, never a shared setting (decision 83)', () => {
    const names: readonly string[] = SHARED_WORKER_SETTINGS;
    expect(names.includes('CAMOUFOX_BROWSER_WINDOW')).toBe(false);
  });

  it('gives the default for an absent or empty line, normalises integers to decimal, and keeps every name', () => {
    expect(effectiveSharedSettings({})).toEqual(SHARED_WORKER_DEFAULTS);
    expect(effectiveSharedSettings({ CAMOUFOX_COOLDOWN_HOURS: '', POINT_OF_SALE: '' })).toEqual(
      SHARED_WORKER_DEFAULTS,
    );
    expect(
      effectiveSharedSettings({
        CAMOUFOX_COOLDOWN_HOURS: '030',
        CAMOUFOX_MODE: 'grid',
        CAMOUFOX_GRID_SCROLL_CAP: '0',
        CAMOUFOX_MONTHLY_PAGE_CAP: '0',
        CAMOUFOX_BILLING_DAY: '28',
        POINT_OF_SALE: 'US',
        UNRELATED: 'x',
      }),
    ).toEqual({
      ...SHARED_WORKER_DEFAULTS,
      CAMOUFOX_COOLDOWN_HOURS: '30',
      CAMOUFOX_MODE: 'grid',
      CAMOUFOX_GRID_SCROLL_CAP: '0',
      CAMOUFOX_MONTHLY_PAGE_CAP: '0',
      CAMOUFOX_BILLING_DAY: '28',
      POINT_OF_SALE: 'US',
    });
  });

  it.each([
    ['CAMOUFOX_COOLDOWN_HOURS', '23'],
    ['CAMOUFOX_COOLDOWN_HOURS', '4.5'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '29'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '241'],
    ['CAMOUFOX_MODE', 'Grid'],
    ['CAMOUFOX_GRID_SCROLL_CAP', '61'],
    ['CAMOUFOX_GRID_SCROLL_SPACING_SECONDS', '-1'],
    ['CAMOUFOX_MIN_SPACING_SECONDS', '-1'],
    ['CAMOUFOX_MIN_SPACING_SECONDS', '601'],
    ['CAMOUFOX_MIN_SPACING_SECONDS', '  '],
    ['CAMOUFOX_GRID_SCROLL_SPACING_SECONDS', '  '],
    ['CAMOUFOX_GRID_SCROLL_SPACING_SECONDS', '31'],
    ['CAMOUFOX_MONTHLY_PAGE_CAP', '-1'],
    ['CAMOUFOX_MONTHLY_SCROLL_CAP', 'lots'],
    ['CAMOUFOX_BILLING_DAY', '0'],
    ['CAMOUFOX_BILLING_DAY', '29'],
    ['POINT_OF_SALE', 'gb'],
  ])('refuses %s=%s naming the setting, never its value', (name, value) => {
    const sentinel = `${value}`;
    let message = '';
    try {
      effectiveSharedSettings({ [name]: sentinel });
    } catch (e) {
      if (!(e instanceof SharedSettingsError)) throw e;
      expect(e.settings).toEqual([name]);
      expect(e.name).toBe('SharedSettingsError');
      message = e.message;
    }
    expect(message).toContain(name);
    expect(message.replace(name, '')).not.toContain(`=${sentinel}`);
    expect(message).not.toMatch(new RegExp(`\\b${sentinel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
  });
});

describe('sharedSettingDiffs (names only; grid-only names in grid mode)', () => {
  const app: SharedSettings = { ...SHARED_WORKER_DEFAULTS, POINT_OF_SALE: 'GB' };
  it('empty when the two agree, and when one side omits a line the other sets to its default', () => {
    expect(sharedSettingDiffs(app, app, 'grid')).toEqual([]);
    expect(
      sharedSettingDiffs(
        effectiveSharedSettings({}),
        effectiveSharedSettings({ CAMOUFOX_BILLING_DAY: '1', CAMOUFOX_MODE: 'list' }),
        'list',
      ),
    ).toEqual([]);
  });
  it('names every differing setting, never a value, in SHARED_WORKER_SETTINGS order', () => {
    const worker = effectiveSharedSettings({
      CAMOUFOX_COOLDOWN_HOURS: '99',
      CAMOUFOX_PAGE_TIMEOUT_SECONDS: '99',
      CAMOUFOX_MIN_SPACING_SECONDS: '99',
      CAMOUFOX_MODE: 'grid',
      CAMOUFOX_GRID_SCROLL_CAP: '59',
      CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '29',
      CAMOUFOX_MONTHLY_PAGE_CAP: '1234567',
      CAMOUFOX_MONTHLY_SCROLL_CAP: '7654321',
      CAMOUFOX_BILLING_DAY: '27',
      POINT_OF_SALE: 'ZZ',
    });
    const diffs = sharedSettingDiffs(app, worker, 'grid');
    expect(diffs).toEqual([...SHARED_WORKER_SETTINGS]);
    expect(JSON.stringify(diffs)).not.toMatch(/1234567|7654321|ZZ/);
  });
  it('agrees when both sides say 0 for the scroll spacing, and differs from a side that says 5', () => {
    const zero = effectiveSharedSettings({ CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '0' });
    expect(zero.CAMOUFOX_GRID_SCROLL_SPACING_SECONDS).toBe('0');
    expect(
      sharedSettingDiffs(
        zero,
        effectiveSharedSettings({ CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '00' }),
        'grid',
      ),
    ).toEqual([]);
    expect(sharedSettingDiffs(zero, app, 'grid')).toEqual(['CAMOUFOX_GRID_SCROLL_SPACING_SECONDS']);
  });
  it('the page spacing is compared in both modes: 0 against the default 30 differs, 0 against 0 agrees', () => {
    const zero = effectiveSharedSettings({ CAMOUFOX_MIN_SPACING_SECONDS: '0' });
    for (const mode of ['list', 'grid'] as const) {
      expect(sharedSettingDiffs(zero, app, mode)).toEqual(['CAMOUFOX_MIN_SPACING_SECONDS']);
      expect(
        sharedSettingDiffs(zero, effectiveSharedSettings({ CAMOUFOX_MIN_SPACING_SECONDS: '0' }), mode),
      ).toEqual([]);
    }
  });
  it('compares the two grid-only settings only in grid mode', () => {
    const worker = { ...app, CAMOUFOX_GRID_SCROLL_CAP: '12', CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '9' };
    expect(sharedSettingDiffs(app, worker, 'list')).toEqual([]);
    expect(sharedSettingDiffs(app, worker, 'grid')).toEqual([
      'CAMOUFOX_GRID_SCROLL_CAP',
      'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS',
    ]);
    expect(sharedSettingDiffs(app, { ...app, CAMOUFOX_MONTHLY_PAGE_CAP: '100' }, 'list')).toEqual([
      'CAMOUFOX_MONTHLY_PAGE_CAP',
    ]);
  });
});

describe('the start refusal file and its texts (decision 76)', () => {
  it('reads { reason, at } and refuses an unknown reason, an extra field and any fix text', () => {
    expect(startRefusalSchema.parse({ reason: 'consent-expired', at: '2027-03-01T06:00:00.000Z' })).toEqual({
      reason: 'consent-expired',
      at: '2027-03-01T06:00:00.000Z',
    });
    for (const bad of [
      { reason: 'tired', at: '2027-03-01T06:00:00.000Z' },
      { reason: 'locked', at: '2027-03-01T06:00:00.000Z', extra: 1 },
      { reason: 'locked', at: '2027-03-01T06:00:00.000Z', fix: 'rm -rf /' },
      { reason: 'locked', at: 'yesterday' },
    ])
      expect(startRefusalSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });

  it('START_REFUSAL_TEXT has every reason, the fix commands of §3, and no banned word', () => {
    expect(START_REFUSAL_REASONS).toEqual([
      'flags-unset',
      'consent-missing',
      'consent-expired',
      'consent-voided',
      'consent-not-shown',
      'consent-not-rejection',
      'build-mismatch',
      'layout',
      'signed-in',
      'locked',
      'counts-missing',
      'counts-unreadable',
      'config',
    ]);
    expect(Object.keys(START_REFUSAL_TEXT)).toEqual([...START_REFUSAL_REASONS]);
    // why: W1, W2: every fix names a command that exists today; the consent ones are CONSENT_FIX's, the guided capture
    // since Task 17.5
    const capture = 'pnpm gmt consent';
    expect(CONSENT_FIX).toEqual({ command: capture, doc: 'docs/setup.md#capture-your-consent-choice' });
    expect(
      Object.fromEntries(START_REFUSAL_REASONS.map((r) => [r, START_REFUSAL_TEXT[r].fixCommand])),
    ).toEqual({
      'flags-unset': null,
      'consent-missing': capture,
      'consent-expired': capture,
      'consent-voided': capture,
      'consent-not-shown': capture,
      'consent-not-rejection': capture,
      'build-mismatch': 'pnpm gmt browser install',
      layout: 'pnpm gmt browser install',
      'signed-in': 'pnpm --filter @gmt/camoufox-worker clear-signed-in',
      locked: 'pnpm gmt restart',
      'counts-missing': 'pnpm gmt browser counts',
      'counts-unreadable': 'pnpm gmt browser counts',
      config: 'pnpm gmt start',
    });
    // why: review X5: an older record is refused by name, saying why it is not used
    expect(START_REFUSAL_TEXT['consent-voided'].summary).toBe(
      'the consent record is an older voided one, which this version does not use: capture a rejection',
    );
    expect(START_REFUSAL_TEXT['consent-not-rejection'].summary).toBe(
      'the stored consent choice is not a rejection: capture a rejection',
    );
    for (const r of START_REFUSAL_REASONS) {
      expect(START_REFUSAL_TEXT[r].summary.length, r).toBeGreaterThan(0);
      expect(findBannedWords(START_REFUSAL_TEXT[r].summary, BANNED_WORD_ALLOWLIST), r).toEqual([]);
    }
  });
});

describe('the app-instance header', () => {
  it('names the header', () => {
    expect(APP_INSTANCE_HEADER).toBe('x-gmt-app-instance');
  });
});

describe('workerStatusSchema: every field WP17’s worker will emit, optional, shape only (decision 76)', () => {
  it('parses the fixture holding every field (the same file WP17’s worker test checks its own /v1/status against)', () => {
    expect(workerStatusSchema.parse(FULL)).toEqual(FULL);
  });
  it('parses the current worker’s status, which has none of them', () => {
    const today = full();
    for (const k of ['sharedSettings', 'osArch', 'build', 'consent', 'monthly', 'appInstances'])
      delete today[k];
    expect(workerStatusSchema.safeParse(today).success).toBe(true);
  });
  // why: review X1, X5: a capture with its bound and (from this version) its mark; the older kinds are never served
  it('a captured record with each bound and each mark, or no mark (an earlier worker); monthly unreadable', () => {
    const at = '2028-03-01T06:00:00.000Z';
    for (const consent of [
      { kind: 'socs', expiresAt: at, boundedBy: 'cookie' },
      { kind: 'socs', expiresAt: at, boundedBy: 'capture', mark: 'reject' },
      { kind: 'socs', expiresAt: at, boundedBy: 'cookie', mark: 'accept' },
      { kind: 'socs', expiresAt: at, boundedBy: 'cookie', mark: 'unknown' },
    ])
      expect(workerStatusSchema.safeParse({ ...full(), consent }).success, JSON.stringify(consent)).toBe(
        true,
      );
    for (const consent of [
      { kind: 'not-shown', expiresAt: at, boundedBy: 'check' },
      { kind: 'voided', expiresAt: null, boundedBy: null },
      { kind: 'socs', expiresAt: null, boundedBy: 'cookie' },
      { kind: 'socs', expiresAt: at, boundedBy: 'cookie', mark: 'maybe' },
    ])
      expect(workerStatusSchema.safeParse({ ...full(), consent }).success, JSON.stringify(consent)).toBe(
        false,
      );
    expect(full().monthly).toEqual(MONTHLY);
    const unreadable = { ...MONTHLY, readable: false };
    expect(workerStatusSchema.safeParse({ ...full(), monthly: unreadable }).success).toBe(true);
  });
  it('still refuses an unknown field, and an unknown setting name, OS, consent kind or bound', () => {
    expect(workerStatusSchema.safeParse({ ...full(), extra: 1 }).success).toBe(false);
    expect(workerStatusSchema.safeParse({ ...full(), osArch: 'win32-x64' }).success).toBe(false);
    expect(
      workerStatusSchema.safeParse({ ...full(), sharedSettings: { CAMOUFOX_BROWSER_WINDOW: 'any' } }).success,
    ).toBe(false);
    expect(
      workerStatusSchema.safeParse({
        ...full(),
        consent: { kind: 'maybe', expiresAt: null, boundedBy: null },
      }).success,
    ).toBe(false);
    expect(
      workerStatusSchema.safeParse({
        ...full(),
        consent: { kind: 'socs', expiresAt: '2028-03-01T06:00:00.000Z', boundedBy: 'guess' },
      }).success,
    ).toBe(false);
    expect(workerStatusSchema.safeParse({ ...full(), monthly: { ...MONTHLY, pages: -1 } }).success).toBe(
      false,
    );
    expect(
      workerStatusSchema.safeParse({ ...full(), appInstances: { windowStart: 'x', count: 1 } }).success,
    ).toBe(false);
  });
});

// why: WP16a Task 16a.8 — the edges the mutation run found unpinned in the shared settings' rules
describe('shared settings: each rule matches the whole value', () => {
  it.each([
    ['CAMOUFOX_MODE', 'xgrid'],
    ['CAMOUFOX_MODE', 'gridx'],
    ['POINT_OF_SALE', 'xGB'],
    ['POINT_OF_SALE', 'GBx'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '3e1'],
    ['CAMOUFOX_PAGE_TIMEOUT_SECONDS', '30s'],
  ])('%s=%s is invalid', (name, value) => {
    expect(parseSharedSettings({ [name]: value })).toEqual({ ok: false, invalid: [name] });
  });
  it('the error names the settings, never their values', () => {
    const e = new SharedSettingsError(['CAMOUFOX_MODE', 'POINT_OF_SALE']);
    expect([e.name, e.message]).toEqual([
      'SharedSettingsError',
      'invalid shared camoufox settings: CAMOUFOX_MODE, POINT_OF_SALE',
    ]);
  });
  it('a reported grid step is at least one day each way', () => {
    const step = workerStatusSchema.shape.gridStepDays.unwrap().unwrap();
    expect(step.safeParse({ departures: 1, returns: 1 }).success).toBe(true);
    expect(step.safeParse({ departures: 0, returns: 1 }).success).toBe(false);
    expect(step.safeParse({ departures: 1, returns: 0 }).success).toBe(false);
  });
});

describe('one rule set for both sides (R27)', () => {
  it('readSharedSettings lists every invalid name and holds its default, so a reader reports them all and builds the rest', () => {
    const r = readSharedSettings({
      CAMOUFOX_COOLDOWN_HOURS: '23',
      POINT_OF_SALE: 'gb',
      CAMOUFOX_BILLING_DAY: '07',
    });
    expect(r.invalid).toEqual(['CAMOUFOX_COOLDOWN_HOURS', 'POINT_OF_SALE']);
    expect(r.settings).toEqual({ ...SHARED_WORKER_DEFAULTS, CAMOUFOX_BILLING_DAY: '7' });
  });
  it('the cool-down is bounded at 100,000 hours on both sides', () => {
    expect(readSharedSettings({ CAMOUFOX_COOLDOWN_HOURS: '100000' }).invalid).toEqual([]);
    expect(readSharedSettings({ CAMOUFOX_COOLDOWN_HOURS: '100001' }).invalid).toEqual([
      'CAMOUFOX_COOLDOWN_HOURS',
    ]);
  });
  it('each refusal states its rule, never the value given', () => {
    expect(SHARED_WORKER_SETTINGS.map(sharedSettingMessage)).toEqual([
      'CAMOUFOX_COOLDOWN_HOURS must be a whole number from 24 to 100000',
      'CAMOUFOX_PAGE_TIMEOUT_SECONDS must be a whole number from 30 to 240',
      'CAMOUFOX_MIN_SPACING_SECONDS must be a whole number from 0 to 600',
      'CAMOUFOX_MODE must be list or grid',
      'CAMOUFOX_GRID_SCROLL_CAP must be a whole number from 0 to 60',
      'CAMOUFOX_GRID_SCROLL_SPACING_SECONDS must be a whole number from 0 to 30',
      'CAMOUFOX_MONTHLY_PAGE_CAP must be a whole number of at least 0',
      'CAMOUFOX_MONTHLY_SCROLL_CAP must be a whole number of at least 0',
      'CAMOUFOX_BILLING_DAY must be a whole number from 1 to 28',
      'POINT_OF_SALE must be an ISO 3166-1 alpha-2 code',
    ]);
  });
  it('sharedInt and sharedMode read the typed values from the one record', () => {
    const s = effectiveSharedSettings({ CAMOUFOX_MODE: 'grid', CAMOUFOX_GRID_SCROLL_CAP: '012' });
    expect([
      sharedMode(s),
      sharedInt(s, 'CAMOUFOX_GRID_SCROLL_CAP'),
      sharedInt(s, 'CAMOUFOX_COOLDOWN_HOURS'),
    ]).toEqual(['grid', 12, 48]);
    expect(sharedMode(SHARED_WORKER_DEFAULTS)).toBe('list');
  });
});

// why: ca-b1-008: one port rule for the worker's listen and the app's CAMOUFOX_WORKER_URL
describe('the worker’s port', () => {
  it('is 8090 unset or empty, any whole number 1024–65535 otherwise, and null for anything else', () => {
    expect(workerPortOf(undefined)).toBe(8090);
    expect(workerPortOf('')).toBe(8090);
    expect(workerPortOf('1024')).toBe(1024);
    expect(workerPortOf('65535')).toBe(65535);
    for (const bad of ['1023', '65536', '80a', ' 8091', '8091.0', '-1'])
      expect(workerPortOf(bad), bad).toBeNull();
    expect(workerUrlFor(8091)).toBe('http://127.0.0.1:8091');
    expect(WORKER_PORT).toEqual({ default: 8090, min: 1024, max: 65535 });
  });
});

// why: W3 (ca-b1-005): the counts file's one shape, read and written by the worker, rewritten through its entry
describe('the monthly counts file', () => {
  const ok = {
    windowStart: '2027-10-01T00:00:00.000Z',
    windowEnd: '2027-11-01T00:00:00.000Z',
    pages: 40,
    scrolls: 200,
  };
  it('is the window and its whole counts, nothing else', () => {
    expect(MONTHLY_FILE).toBe('monthly.json');
    expect(monthlyCountsSchema.parse(ok)).toEqual(ok);
    for (const bad of [
      { ...ok, pages: -1 },
      { ...ok, scrolls: 1.5 },
      { ...ok, extra: 1 },
      { ...ok, windowEnd: 'x' },
    ])
      expect(monthlyCountsSchema.safeParse(bad).success).toBe(false);
    const { windowEnd: _, ...old } = ok;
    expect(monthlyCountsSchema.safeParse(old).success).toBe(false);
  });
  it('a rewrite carries pages and scrolls only, bounded', () => {
    expect(countsRewriteSchema.parse({ pages: 0, scrolls: 9_999_999 })).toEqual({
      pages: 0,
      scrolls: 9_999_999,
    });
    for (const bad of [
      { pages: 1 },
      { pages: 1, scrolls: 10_000_000 },
      { pages: 1, scrolls: 1, windowStart: ok.windowStart },
    ])
      expect(countsRewriteSchema.safeParse(bad).success).toBe(false);
  });
  it('the install root is under the home directory’s local share', () => {
    expect(camoufoxRootDir('/home/op')).toBe('/home/op/.local/share/get-me-there/camoufox');
    expect(START_REFUSAL_FILE).toBe('start-refusal.json');
  });
});
