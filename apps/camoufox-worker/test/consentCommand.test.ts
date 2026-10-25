import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { asIsoDateTime, CONSENT_FIX } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';
import {
  CONSENT_PROMPT,
  CONSENT_USAGE,
  type ConsentDeps,
  consentCapture,
  consentCheck,
  consentImport,
  deleteProfile,
  entry,
  readBounded,
} from '../src/consent.js';
import type { ConsentDriver, SocsFields } from '../src/consentDriver.js';
import { CONSENT_LINE_PREFIX, decodeConsentLine, encodeConsentLine } from '../src/consentLine.js';
import { CooldownStore } from '../src/cooldown.js';
import { acquireLock } from '../src/lock.js';
import { Pacer } from '../src/pacer.js';
import type { EntryContext } from '../src/run.js';
import { EX_CONFIG, EX_UNAVAILABLE } from '../src/run.js';
import { SELECTORS } from '../src/selectors.js';
import {
  consentView,
  fakeConsentDriver,
  LANDING_URL,
  type Script,
  SOCS,
  view,
} from './support/fakeConsent.js';
import { fakeTimers, T0 } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

// why: WP17 Task 17.5 (decision 74): the consent command over a scripted driver, fake timers and a temporary data
// directory. Every SOCS value is synthetic: the research's shape (field 1 = 1 or 2, then a filler), never a recorded one.
const value = (choice: number): string =>
  Buffer.from([0x08, choice, 0x12, 0x09, ...Buffer.from('test-only')]).toString('base64url');
const REJECT: SocsFields = { ...SOCS, value: value(1) };
const ACCEPT: SocsFields = { ...SOCS, value: value(2) };
const KEY = 'synthetic-worker-key-0123456789abcdef';
const cfg = loadWorkerConfig({ CAMOUFOX_WORKER_KEY: KEY, HOME: '/Users/op' });
const UNRECOGNISED = view({ text: { ...view().text, landingHeading: false } });
/** When the fake window's SOCS is read and judged: four watch ticks after the load. */
const AT = '2026-10-18T05:00:04.000Z';
const READS = ['mainFrameHosts', 'accountCookieSeen', 'socsCookie', 'snapshotView'];

/** An earlier page: the pacer's last-page time and this window's counts beside it, as a worker leaves them. */
function lastPage(dir: string, at: string, pages = 1): void {
  writeFileSync(join(dir, 'pacer.json'), JSON.stringify({ lastPageAt: at }), { mode: 0o600 });
  writeFileSync(
    join(dir, 'monthly.json'),
    JSON.stringify({
      windowStart: '2026-10-01T00:00:00.000Z',
      windowEnd: '2026-11-01T00:00:00.000Z',
      pages,
      scrolls: 0,
    }),
    { mode: 0o600 },
  );
}

function setup(
  o: {
    script?: Script;
    driver?: (d: ConsentDriver) => ConsentDriver;
    platform?: string;
    display?: Record<string, string>;
    removeProfile?: (p: string) => void;
    stdin?: string | 'too-long';
  } = {},
) {
  const dataDir = tmpDir();
  const timers = fakeTimers();
  const out: string[] = [];
  const err: string[] = [];
  const profiles: string[] = [];
  const drivers: ReturnType<typeof fakeConsentDriver>[] = [];
  const deps: ConsentDeps = {
    platform: o.platform ?? 'darwin',
    display: o.display ?? {},
    clock: timers.clock,
    timers,
    selectors: SELECTORS,
    pid: 4242,
    isAlive: () => true,
    consentDriver: (profile) => {
      profiles.push(profile);
      const d = fakeConsentDriver(o.script ?? { saveAt: 0, socsAt: 1, closeAt: 3, socs: REJECT });
      drivers.push(d);
      return o.driver === undefined ? d : o.driver(d);
    },
    ...(o.removeProfile === undefined ? {} : { removeProfile: o.removeProfile }),
    readStdin: async () => o.stdin ?? '',
  };
  const ctx = (args: string[] = []): EntryContext => ({
    env: {},
    dataDir,
    args,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  const socsFile = join(dataDir, 'socs.json');
  return { dataDir, timers, out, err, profiles, drivers, deps, ctx, socsFile };
}
const capture = (t: ReturnType<typeof setup>) => consentCapture(t.ctx(), cfg, t.deps, { export: false });
const exported = (t: ReturnType<typeof setup>) =>
  consentCapture(t.ctx(['export']), cfg, t.deps, { export: true });

describe('consent: the capture (the person clicks; the tool observes)', () => {
  it('a rejection: the cookie written 0600 with its capture time, the profile gone, one page counted', async () => {
    const t = setup();
    expect(await capture(t)).toBe(0);
    const written = JSON.parse(readFileSync(t.socsFile, 'utf8'));
    expect(written).toEqual({
      value: REJECT.value,
      domain: '.google.com',
      path: '/',
      expires: REJECT.expires,
      secure: true,
      sameSite: 'Lax',
      capturedAt: AT,
    });
    expect(statSync(t.socsFile).mode & 0o777).toBe(0o600);
    expect(t.out).toEqual([
      CONSENT_PROMPT,
      `captured a rejection at ${AT} (expires 2027-01-15T08:00:00.000Z (the cookie’s own expiry)); written 0600`,
    ]);
    expect(t.err).toEqual([]);
    expect(t.profiles).toHaveLength(1);
    expect(t.profiles[0]?.startsWith(join(t.dataDir, 'probe-consent-'))).toBe(true);
    expect(existsSync(t.profiles[0] ?? '')).toBe(false);
    expect(JSON.parse(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8'))).toMatchObject({
      pages: 1,
      scrolls: 0,
    });
    expect(JSON.parse(readFileSync(join(t.dataDir, 'pacer.json'), 'utf8'))).toEqual({ lastPageAt: T0 });
    // why: the lock is released
    expect(existsSync(join(t.dataDir, 'worker.lock'))).toBe(false);
  });
  it('loads the landing page once and after it only reads (no click, type, navigation or script exists to call)', async () => {
    const t = setup();
    await capture(t);
    const d = t.drivers[0];
    expect(d?.loads).toEqual([LANDING_URL]);
    expect(d?.calls.slice(0, 2)).toEqual(['launchHeaded', 'load']);
    expect(d?.calls.slice(2, -1).every((c) => READS.includes(c))).toBe(true);
    expect(d?.calls.at(-1)).toBe('close');
  });
  it('the capture’s load is a page for the spacing: the worker’s next page waits it', async () => {
    const t = setup();
    await capture(t);
    const next = new Pacer({ dir: t.dataDir, minSpacingSeconds: 30, clock: t.timers.clock }).claim();
    expect(next.ok).toBe(false);
  });
  it('waits out the spacing from the persisted last page time before its load', async () => {
    const t = setup();
    lastPage(t.dataDir, '2026-10-18T04:59:50.000Z');
    expect(await capture(t)).toBe(0);
    expect(t.timers.sleeps[0]).toBe(18_000);
    expect(t.out[0]).toBe('waiting 18 s for the spacing');
  });
  it('Linux: the display groups run.ts passed reach the window; with neither it refuses before any page or window', async () => {
    const x = setup({ platform: 'linux', display: { DISPLAY: ':0', XAUTHORITY: '/x' } });
    expect(await capture(x)).toBe(0);
    expect(x.drivers[0]?.displays).toEqual([{ DISPLAY: ':0', XAUTHORITY: '/x' }]);
    const none = setup({ platform: 'linux' });
    expect(await capture(none)).toBe(EX_CONFIG);
    expect(none.err.join()).toContain('pnpm gmt consent export');
    expect(none.drivers).toEqual([]);
    expect(existsSync(join(none.dataDir, 'monthly.json'))).toBe(false);
  });

  const refusals: Array<[string, Script, string]> = [
    [
      'an Accept all',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: ACCEPT },
      'the choice was Accept all; only a rejection is ever kept: run pnpm gmt consent again and click Reject all; nothing is written',
    ],
    [
      'a value with no mark this tool recognises',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: SOCS },
      'the cookie’s value does not show a rejection this tool recognises; nothing is written',
    ],
    [
      'a SOCS with no consent page seen',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: REJECT, hosts: [['www.google.com']] },
      'a SOCS cookie appeared but no consent page was seen; nothing is written',
    ],
    [
      'a consent page left unclicked for 10 minutes',
      {},
      'the consent page was left for 10 minutes without a choice; nothing is written',
    ],
    [
      'the window closed before a choice',
      { closeAt: 1 },
      'the window was closed before a choice was made; nothing is written',
    ],
    [
      'the window closed after the choice, before its cookie',
      { saveAt: 0, closeAt: 2 },
      'the window was closed before the choice’s cookie was set; nothing is written',
    ],
    [
      'a first view not positively recognised',
      { first: UNRECOGNISED, after: UNRECOGNISED, closeAt: 1, hosts: [['www.google.com']] },
      'the first view was neither the consent page nor the landing view this tool recognises; nothing is written',
    ],
    [
      'an account cookie',
      { accountAt: 0, socs: REJECT, socsAt: 0, saveAt: 0 },
      'an account cookie appeared in the throwaway profile, which is deleted now; nothing is written',
    ],
    [
      'a cookie whose fields the parser refuses',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: { ...REJECT, secure: false } },
      'the cookie was refused: SOCS capture refused (not Secure); capture "Reject all" again with: pnpm gmt consent; nothing is written',
    ],
  ];
  it.each(refusals)('%s writes nothing and says which', async (_what, script, words) => {
    const t = setup({ script });
    expect(await capture(t)).toBe(EX_UNAVAILABLE);
    expect(t.err).toEqual([words]);
    expect(existsSync(t.socsFile)).toBe(false);
    expect(t.profiles.some((p) => existsSync(p))).toBe(false);
    expect(existsSync(join(t.dataDir, 'cooldown.json'))).toBe(false);
  });
  it('a region with no consent screen (the landing view, no consent page, no SOCS) writes nothing: pages need a captured rejection', async () => {
    const t = setup({ script: { first: view(), closeAt: 1, hosts: [['www.google.com']] } });
    expect(await capture(t)).toBe(EX_UNAVAILABLE);
    expect(t.err).toEqual([
      'no consent page was shown here, and the worker serves pages only on a captured rejection: capture on a desktop that shows the consent page with pnpm gmt consent export, then pipe its line into pnpm gmt consent import here; nothing is written',
    ]);
    expect(existsSync(t.socsFile)).toBe(false);
  });
  it('a challenge page writes nothing and starts its cool-down, as on the server path', async () => {
    const t = setup({
      script: { first: { ...consentView(), text: { ...consentView().text, challenge: true } } },
    });
    expect(await capture(t)).toBe(EX_UNAVAILABLE);
    expect(t.err).toEqual([
      'the window stopped on captcha; nothing is written; cooling down until 2026-10-20T05:00:00.000Z',
    ]);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active()?.cause,
    ).toBe('captcha');
    expect(existsSync(t.socsFile)).toBe(false);
  });
  it('a page that never loads (offline), or a window closed before it loads, writes nothing and says which', async () => {
    const offline = setup({
      driver: (d) => ({
        ...d,
        load: async () => {
          throw new Error('page.goto: NS_ERROR_OFFLINE\nCall log: …');
        },
      }),
    });
    expect(await capture(offline)).toBe(EX_UNAVAILABLE);
    expect(offline.err).toEqual([
      'the landing page did not load (page.goto: NS_ERROR_OFFLINE); nothing is written',
    ]);
    const closed = setup({
      driver: (d) => ({
        ...d,
        closed: () => true,
        load: async () => {
          throw new Error('Target page, context or browser has been closed');
        },
      }),
    });
    expect(await capture(closed)).toBe(EX_UNAVAILABLE);
    expect(closed.err).toEqual(['the window was closed before the page loaded; nothing is written']);
    for (const t of [offline, closed]) {
      expect(existsSync(t.socsFile)).toBe(false);
      expect(t.drivers[0]?.calls.at(-1)).toBe('close');
      expect(t.profiles.some((p) => existsSync(p))).toBe(false);
    }
  });
  it('refuses while the worker’s lock is held, during a cool-down (naming its end), and at the monthly page cap', async () => {
    const held = setup();
    acquireLock(held.dataDir, { pid: 999 });
    expect(await capture(held)).toBe(EX_CONFIG);
    expect(held.err).toEqual([
      "the camoufox worker's data directory is locked by pid 999: stop the worker first (pnpm gmt consent does)",
    ]);
    const cooling = setup();
    new CooldownStore({ dir: cooling.dataDir, challengeHours: 48, clock: cooling.timers.clock }).start(
      'captcha',
    );
    expect(await capture(cooling)).toBe(EX_UNAVAILABLE);
    expect(cooling.err).toEqual([
      'cooling down until 2026-10-20T05:00:00.000Z (captcha); no page is loaded before then',
    ]);
    const full = setup();
    lastPage(full.dataDir, '2026-10-17T00:00:00.000Z', cfg.monthlyPageCap);
    expect(await capture(full)).toBe(EX_UNAVAILABLE);
    expect(full.err.join()).toContain('monthly page cap');
    for (const t of [held, cooling, full]) {
      expect(t.drivers).toEqual([]);
      expect(existsSync(t.socsFile)).toBe(false);
    }
  });
  it('sweeps a profile a killed capture left, before it starts', async () => {
    const t = setup();
    mkdirSync(join(t.dataDir, 'probe-consent-1-1'), { mode: 0o700 });
    expect(await capture(t)).toBe(0);
    expect(readdirSync(t.dataDir).filter((f) => f.startsWith('probe-'))).toEqual([]);
  });
});

describe('the throwaway profile is deleted on every path', () => {
  it('a deletion that throws once is retried; twice, it is reported (the next start sweeps it)', async () => {
    let calls = 0;
    const once = setup({
      removeProfile: () => {
        calls++;
        if (calls === 1) throw new Error('EBUSY');
      },
    });
    expect(await capture(once)).toBe(0);
    expect(calls).toBe(2);
    expect(once.err).toEqual([]);
    const err: string[] = [];
    deleteProfile(
      '/data/probe-consent-1-1',
      () => {
        throw new Error('EBUSY');
      },
      (l) => err.push(l),
    );
    expect(err).toEqual([
      'the throwaway profile /data/probe-consent-1-1 could not be deleted (EBUSY); the worker’s next start removes it',
    ]);
    const odd: string[] = [];
    deleteProfile(
      '/p',
      () => {
        throw 'x';
      },
      (l) => odd.push(l),
    );
    expect(odd[0]).toContain('(x)');
  });
  it('a driver that throws mid-watch still closes and deletes, and the error is not swallowed', async () => {
    const t = setup({
      driver: (d) => ({
        ...d,
        socsCookie: async () => {
          throw new Error('protocol error');
        },
      }),
    });
    await expect(capture(t)).rejects.toThrow('protocol error');
    expect(t.drivers[0]?.calls.at(-1)).toBe('close');
    expect(t.profiles.some((p) => existsSync(p))).toBe(false);
    expect(existsSync(join(t.dataDir, 'worker.lock'))).toBe(false);
  });
});

describe('consent export: the line for a machine with no display', () => {
  it('prints exactly one line, gmt-socs-v1. and the fields with a reject mark, as its only standard output; writes nothing here', async () => {
    const t = setup();
    expect(await exported(t)).toBe(0);
    expect(t.out).toHaveLength(1);
    const line = t.out[0] ?? '';
    expect(line.startsWith(CONSENT_LINE_PREFIX)).toBe(true);
    expect(decodeConsentLine(line)).toEqual({
      socs: { name: 'SOCS', ...REJECT },
      capturedAt: AT,
      mark: 'reject',
    });
    expect(t.err[0]).toBe(CONSENT_PROMPT);
    expect(t.err.at(-1)).toContain('pipe the line above into pnpm gmt consent import');
    expect(existsSync(t.socsFile)).toBe(false);
  });
  it('a spacing wait is said on standard error, keeping standard output to the line', async () => {
    const t = setup();
    lastPage(t.dataDir, '2026-10-18T04:59:50.000Z');
    expect(await exported(t)).toBe(0);
    expect(t.out).toHaveLength(1);
    expect(t.err[0]).toBe('waiting 18 s for the spacing');
  });
  // why: CodeRabbit (PR #18): a cookie that outlives its capture plus 13 months exports the bounded expiry
  it('a cookie expiring after its capture plus 13 months exports a line import accepts, its expiry bounded', async () => {
    const far = Date.parse('2028-01-01T00:00:00.000Z') / 1000;
    const t = setup({ script: { saveAt: 0, socsAt: 1, closeAt: 3, socs: { ...REJECT, expires: far } } });
    expect(await exported(t)).toBe(0);
    const line = decodeConsentLine(t.out[0] ?? '');
    expect(line).toMatchObject({
      socs: { expires: Date.parse('2027-11-18T05:00:04.000Z') / 1000 },
      mark: 'reject',
    });
    const i = setup({ stdin: t.out[0] ?? '' });
    // why: the importing machine reads the line after it was captured
    expect(await consentImport(i.ctx(['import']), { ...i.deps, clock: t.timers.clock })).toBe(0);
  });
  it('an acceptance exports nothing', async () => {
    const t = setup({ script: { saveAt: 0, socsAt: 1, closeAt: 3, socs: ACCEPT } });
    expect(await exported(t)).toBe(EX_UNAVAILABLE);
    expect(t.out).toEqual([]);
  });
});

const lineFor = (
  socs: SocsFields,
  mark: 'reject' | 'accept' | 'unknown',
  capturedAt = '2026-10-10T08:00:00.000Z',
) =>
  encodeConsentLine({
    socs: {
      name: 'SOCS',
      value: socs.value,
      domain: '.google.com',
      path: '/',
      expires: socs.expires,
      secure: true,
      sameSite: 'Lax',
    },
    capturedAt: asIsoDateTime(capturedAt),
    mark,
  });

describe('consent import: standard input only, the mark recomputed', () => {
  it('a valid rejection line writes socs.json keeping its capture time', async () => {
    const t = setup({ stdin: `${lineFor(REJECT, 'reject')}\n` });
    expect(await consentImport(t.ctx(['import']), t.deps)).toBe(0);
    expect(JSON.parse(readFileSync(t.socsFile, 'utf8'))).toMatchObject({
      value: REJECT.value,
      capturedAt: '2026-10-10T08:00:00.000Z',
    });
    expect(statSync(t.socsFile).mode & 0o777).toBe(0o600);
    expect(t.out).toEqual([
      'imported the rejection captured at 2026-10-10T08:00:00.000Z (expires 2027-01-15T08:00:00.000Z (the cookie’s own expiry)); written 0600',
    ]);
  });
  it.each([
    [
      'more than 4 KB',
      'too-long',
      'more than 4096 bytes on standard input: the line is one gmt-socs-v1. line; nothing is written',
    ],
    [
      'nothing',
      '  \n',
      'nothing on standard input: pipe in the line pnpm gmt consent export printed; nothing is written',
    ],
    [
      'a wrong prefix',
      'gmt-socs-v0.xyz',
      'the line was refused: the line does not start with gmt-socs-v1.; nothing is written',
    ],
    [
      'an Accept all value carrying a forged reject mark',
      forged(),
      'the line was refused: the line’s mark (reject) is not its value’s own (accept); nothing is written',
    ],
    [
      'a true Accept all line',
      lineFor(ACCEPT, 'accept'),
      'the line records Accept all; only a rejection is imported, so nothing is written',
    ],
    [
      'a line with no recognisable choice',
      lineFor(SOCS, 'unknown'),
      'the line records no choice this tool recognises; only a rejection is imported, so nothing is written',
    ],
    [
      'an expired cookie',
      lineFor(
        { ...REJECT, expires: Date.parse('2026-10-18T04:00:00.000Z') / 1000 },
        'reject',
        '2026-10-01T00:00:00.000Z',
      ),
      'SOCS capture refused (the cookie has expired); capture "Reject all" again with: pnpm gmt consent; nothing is written',
    ],
    [
      'a capture dated in the future',
      lineFor(REJECT, 'reject', '2026-10-19T00:00:00.000Z'),
      'SOCS capture refused (dated in the future); capture "Reject all" again with: pnpm gmt consent; nothing is written',
    ],
  ])('refuses %s, writing nothing', async (_what, stdin, words) => {
    const t = setup({ stdin });
    expect(await consentImport(t.ctx(['import']), t.deps)).toBe(EX_CONFIG);
    expect(t.err).toEqual([words]);
    expect(existsSync(t.socsFile)).toBe(false);
  });
  it('refuses while the worker’s lock is held', async () => {
    const t = setup({ stdin: lineFor(REJECT, 'reject') });
    acquireLock(t.dataDir, { pid: 999 });
    expect(await consentImport(t.ctx(['import']), t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toContain('stop the worker first (pnpm gmt consent import does)');
    expect(existsSync(t.socsFile)).toBe(false);
  });
  it('an argument is refused: the line never travels on the command line', async () => {
    const t = setup();
    expect(await entry(t.ctx(['import', lineFor(REJECT, 'reject')]))).toBe(EX_CONFIG);
    expect(t.err).toEqual(['consent import reads the line from standard input only; it takes no argument']);
  });
  it('reads at most 4 KB, stopping as soon as more arrives', async () => {
    expect(await readBounded(Readable.from([Buffer.from('ab'), 'cd']), 4)).toBe('abcd');
    expect(await readBounded(Readable.from(['abc', 'de', 'never']), 4)).toBe('too-long');
    expect(await readBounded(Readable.from([]), 4)).toBe('');
  });
});

/** An Accept all value carrying a reject mark: the line a forger would make, encoded around the codec. */
function forged(): string {
  const raw = {
    socs: {
      name: 'SOCS',
      value: ACCEPT.value,
      domain: '.google.com',
      path: '/',
      expires: ACCEPT.expires,
      secure: true,
      sameSite: 'Lax',
    },
    capturedAt: '2026-10-10T08:00:00.000Z',
    mark: 'reject',
  };
  return `${CONSENT_LINE_PREFIX}${Buffer.from(JSON.stringify(raw)).toString('base64url')}`;
}

describe('consent check: the stored record’s mark and expiry, no page loaded', () => {
  const write = (dir: string, o: unknown) =>
    writeFileSync(join(dir, 'socs.json'), JSON.stringify(o), { mode: 0o600 });
  const stored = (v: string, expires = REJECT.expires) => ({
    value: v,
    domain: '.google.com',
    path: '/',
    expires,
    secure: true,
    sameSite: 'Lax',
    capturedAt: '2026-10-10T08:00:00.000Z',
  });
  it('an in-date rejection: its capture time, mark and expiry, exit 0; never the value', () => {
    const t = setup();
    write(t.dataDir, stored(REJECT.value));
    expect(consentCheck(t.ctx(['check']), t.timers.clock)).toBe(0);
    expect(t.out).toEqual([
      'consent: captured 2026-10-10T08:00:00.000Z, mark reject, expires 2027-01-15T08:00:00.000Z (the cookie’s own expiry)',
    ]);
    expect(t.out.join()).not.toContain(REJECT.value);
  });
  it('bounded by the capture when the cookie outlives 13 months', () => {
    const t = setup();
    write(t.dataDir, stored(REJECT.value, Date.parse('2028-01-01T00:00:00.000Z') / 1000));
    expect(consentCheck(t.ctx(['check']), t.timers.clock)).toBe(0);
    expect(t.out[0]).toBe(
      'consent: captured 2026-10-10T08:00:00.000Z, mark reject, expires 2027-11-10T08:00:00.000Z (its capture plus 13 months)',
    );
  });
  const fix = `capture one with ${CONSENT_FIX.command}`;
  it.each([
    ['no record', null, `consent: no record: ${fix}`],
    [
      'an unreadable record',
      'not json',
      `consent: the record cannot be read (its mode, its JSON or its fields): ${fix}`,
    ],
    [
      'an accepted value (entered by hand)',
      stored(ACCEPT.value),
      `consent: captured 2026-10-10T08:00:00.000Z, mark accept, expires 2027-01-15T08:00:00.000Z (the cookie’s own expiry); not a rejection: ${fix}`,
    ],
    [
      'an expired rejection',
      stored(REJECT.value, Date.parse('2026-10-18T04:00:00.000Z') / 1000),
      `consent: captured 2026-10-10T08:00:00.000Z, mark reject, expires 2026-10-18T04:00:00.000Z (the cookie’s own expiry); expired: ${fix}`,
    ],
    [
      'a not-shown record',
      { consent: 'not-shown', checkedAt: '2026-10-01T00:00:00.000Z' },
      `consent: no consent page was shown (checked 2026-10-01T00:00:00.000Z, expires 2027-11-01T00:00:00.000Z); the worker serves pages only on a captured rejection: ${fix}`,
    ],
    [
      'a voided record',
      { consent: 'voided', voidedAt: '2026-10-02T00:00:00.000Z' },
      `consent: voided at 2026-10-02T00:00:00.000Z, a consent page was shown again: ${fix}`,
    ],
  ])('%s: exit 78, saying so', (_what, record, words) => {
    const t = setup();
    if (typeof record === 'string') writeFileSync(join(t.dataDir, 'socs.json'), record, { mode: 0o600 });
    else if (record !== null) write(t.dataDir, record);
    expect(consentCheck(t.ctx(['check']), t.timers.clock)).toBe(EX_CONFIG);
    expect(t.err).toEqual([words]);
    expect(t.out).toEqual([]);
  });
});

describe('the consent entry', () => {
  it.each([[['bogus']], [['export', 'x']], [['check', 'x']]])('refuses %j with its usage', async (args) => {
    const t = setup();
    expect(await entry(t.ctx(args))).toBe(EX_CONFIG);
    expect(t.err).toEqual([CONSENT_USAGE]);
  });
  it('check reads the record with no browser', async () => {
    const t = setup();
    expect(await entry(t.ctx(['check']))).toBe(EX_CONFIG);
    expect(t.err).toEqual([`consent: no record: capture one with ${CONSENT_FIX.command}`]);
  });
});

describe('the SOCS value appears only in export’s one line', () => {
  it('no other output of capture, export, import or check holds it, raw or as base64url', async () => {
    const a = setup();
    await capture(a);
    const b = setup();
    await exported(b);
    const c = setup({ stdin: lineFor(REJECT, 'reject') });
    await consentImport(c.ctx(['import']), c.deps);
    consentCheck(c.ctx(['check']), c.timers.clock);
    const said = [...a.out, ...a.err, ...b.err, ...c.out, ...c.err].join('\n');
    expect(said).not.toContain(REJECT.value);
    expect(said).not.toContain(Buffer.from(REJECT.value).toString('base64url'));
    expect(said).not.toContain(CONSENT_LINE_PREFIX);
    expect(b.out.join('\n')).not.toContain(REJECT.value);
  });
});
