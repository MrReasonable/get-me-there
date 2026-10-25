import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { asIsoDateTime, CONSENT_FIX } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCaptureConfig } from '../src/config.js';
import {
  type CaptureSetup,
  CONSENT_PROMPT,
  CONSENT_USAGE,
  type ConsentDeps,
  consentCapture,
  consentCheck,
  consentEntry,
  consentImport,
  deleteProfile,
  displayFrom,
  EX_INTERRUPTED,
  entry,
  readBounded,
  realCaptureSetup,
} from '../src/consent.js';
import type { ConsentDriver, SocsFields } from '../src/consentDriver.js';
import { CONSENT_LINE_PREFIX, decodeConsentLine, encodeConsentLine } from '../src/consentLine.js';
import { CooldownStore } from '../src/cooldown.js';
import { acquireLock } from '../src/lock.js';
import { Pacer } from '../src/pacer.js';
import { installDirFor } from '../src/paths.js';
import { osArchOf } from '../src/platform.js';
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
import { SYNTHETIC_REJECT } from './support/socsValues.js';
import { fakeTimers, T0 } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

// why: WP17 Task 17.5 (decision 74) and review r1 (X1–X6): the consent command over a scripted driver, fake timers and a
// temporary data directory. Every SOCS value is synthetic: the observed shape (field 1, then field 2), never a recorded
// one. Every refusal starts from a stored rejection and shows it kept byte for byte (X3, ts-b1-001).
const value = (choice: number): string =>
  Buffer.from([0x08, choice, 0x12, 0x09, ...Buffer.from('test-only')]).toString('base64url');
const REJECT: SocsFields = { ...SOCS, value: value(1) };
const ACCEPT: SocsFields = { ...SOCS, value: value(2) };
const cfg = loadCaptureConfig({ HOME: '/Users/op' });
const UNRECOGNISED = view({ text: { ...view().text, landingHeading: false } });
/** When the fake window's SOCS is read and judged: four watch ticks after the load. */
const AT = '2026-10-18T05:00:04.000Z';
const READS = ['mainFrameHosts', 'accountCookieSeen', 'socsCookie', 'snapshotView'];
const NOTHING = 'nothing is written, and a record already here is kept as it was';
/** The record already stored before each refusal: a rejection captured earlier, of another synthetic value. */
const EARLIER = {
  value: SYNTHETIC_REJECT,
  domain: '.google.com',
  path: '/',
  expires: 1_800_000_000,
  secure: true,
  sameSite: 'Lax',
  capturedAt: '2026-10-01T08:00:00.000Z',
};

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
    stdin?: string | 'too-long' | Promise<string>;
    interrupted?: AbortSignal;
    /** false starts from an empty data directory; by default a stored rejection is there. */
    existing?: boolean;
  } = {},
) {
  const dataDir = tmpDir();
  const socsFile = join(dataDir, 'socs.json');
  if (o.existing !== false) writeFileSync(socsFile, JSON.stringify(EARLIER), { mode: 0o600 });
  const before = existsSync(socsFile) ? readFileSync(socsFile) : null;
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
    readStdin: async () => (o.stdin === undefined ? '' : await o.stdin),
    ...(o.interrupted === undefined ? {} : { interrupted: o.interrupted }),
  };
  const ctx = (args: string[] = []): EntryContext => ({
    env: {},
    dataDir,
    args,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  /** The stored record is exactly what it was before the command ran. */
  const kept = () => expect(readFileSync(socsFile)).toEqual(before);
  return { dataDir, timers, out, err, profiles, drivers, deps, ctx, socsFile, kept };
}
type World = ReturnType<typeof setup>;
const capture = (t: World) => consentCapture(t.ctx(), cfg, t.deps, { export: false });
const exported = (t: World) => consentCapture(t.ctx(['export']), cfg, t.deps, { export: true });

describe('consent: the capture (the person clicks; the tool observes)', () => {
  it('a rejection: the cookie written 0600 with its capture time, replacing the earlier one; the profile gone, one page counted', async () => {
    const t = setup();
    expect(await capture(t)).toBe(0);
    expect(JSON.parse(readFileSync(t.socsFile, 'utf8'))).toEqual({
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
    expect(existsSync(join(t.dataDir, 'worker.lock'))).toBe(false);
  });
  it('the prompt says to wait for Google Flights before closing the window', () => {
    expect(CONSENT_PROMPT).toBe(
      'Click **Reject all** in the window, wait until Google Flights shows, then close the window. Nothing else is needed',
    );
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
  it('Linux: the display groups reach the window; with neither it refuses before any page or window', async () => {
    const x = setup({ platform: 'linux', display: { DISPLAY: ':0', XAUTHORITY: '/x' } });
    expect(await capture(x)).toBe(0);
    expect(x.drivers[0]?.displays).toEqual([{ DISPLAY: ':0', XAUTHORITY: '/x' }]);
    const none = setup({ platform: 'linux' });
    expect(await capture(none)).toBe(EX_CONFIG);
    expect(none.err.join()).toContain('pnpm gmt consent export');
    expect(none.drivers).toEqual([]);
    expect(existsSync(join(none.dataDir, 'monthly.json'))).toBe(false);
    none.kept();
  });

  const refusals: Array<[string, Script, string]> = [
    [
      'an Accept all',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: ACCEPT },
      `the choice was Accept all, and only a rejection is ever kept: run pnpm gmt consent again and click Reject all; ${NOTHING}`,
    ],
    [
      'a value with no mark this tool reads',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: SOCS },
      `the value does not show a rejection this version reads (if you clicked Reject all, the cookie’s format may have changed: the browser provider stays off until this checkout is updated to read it); if you clicked Reject all, update this checkout (git pull, then pnpm install) and run pnpm gmt consent again, and report it if it persists; ${NOTHING}`,
    ],
    [
      'a rejection mark sent with the Accept all form’s fields',
      {
        saveAt: 0,
        socsAt: 1,
        closeAt: 3,
        socs: REJECT,
        saveFields: ['escs', 'set_aps', 'set_eom', 'set_sc'],
      },
      `the choice’s submission carried set_aps and set_sc, which only the Accept all form sent when this was researched; a choice made under More options has not been observed, so it is not kept: run pnpm gmt consent again and click Reject all on the first page; ${NOTHING}`,
    ],
    [
      'one Accept-only field',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: REJECT, saveFields: ['escs', 'set_sc'] },
      `the choice’s submission carried set_sc, which only the Accept all form sent when this was researched; a choice made under More options has not been observed, so it is not kept: run pnpm gmt consent again and click Reject all on the first page; ${NOTHING}`,
    ],
    [
      'a SOCS with no consent page seen',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: REJECT, hosts: [['www.google.com']] },
      `a SOCS cookie appeared but no consent page was seen; ${NOTHING}`,
    ],
    [
      'a consent page left unclicked for 10 minutes',
      {},
      `the consent page was left for 10 minutes without a choice; ${NOTHING}`,
    ],
    [
      'the window closed before a choice',
      { closeAt: 1 },
      `the window was closed before a choice was made; ${NOTHING}`,
    ],
    [
      'the window closed after the choice, before its cookie',
      { saveAt: 0, closeAt: 2 },
      `the window was closed before the choice’s cookie was set (wait until Google Flights shows before closing it); ${NOTHING}`,
    ],
    [
      // why: X2, pa-b1-006: the SOCS the consent page sets before any click is never the choice's, whatever its mark
      'a SOCS that was already there before the click, unchanged after it',
      { socsAt: -1, socs: REJECT, saveAt: 1, closeAt: 4 },
      `the window was closed before the choice’s cookie was set (wait until Google Flights shows before closing it); ${NOTHING}`,
    ],
    [
      'a first view not positively recognised',
      { first: UNRECOGNISED, after: UNRECOGNISED, closeAt: 1, hosts: [['www.google.com']] },
      `the first view was neither the consent page nor the landing view this tool recognises; ${NOTHING}`,
    ],
    [
      'an account cookie',
      { accountAt: 0, socs: REJECT, socsAt: 1, saveAt: 0 },
      `an account cookie appeared in the throwaway profile, which is deleted now; ${NOTHING}`,
    ],
    [
      'a cookie whose fields the parser refuses',
      { saveAt: 0, socsAt: 1, closeAt: 3, socs: { ...REJECT, secure: false } },
      `the cookie was refused: SOCS capture refused (not Secure); capture "Reject all" again with: pnpm gmt consent; ${NOTHING}`,
    ],
  ];
  it.each(refusals)(
    '%s writes nothing, keeps the stored record and says which',
    async (_what, script, words) => {
      const t = setup({ script });
      expect(await capture(t)).toBe(EX_UNAVAILABLE);
      expect(t.err).toEqual([words]);
      t.kept();
      expect(t.profiles.some((p) => existsSync(p))).toBe(false);
      expect(existsSync(join(t.dataDir, 'cooldown.json'))).toBe(false);
    },
  );
  it('a region with no consent page writes nothing and says the provider needs a rejection captured elsewhere', async () => {
    const t = setup({ script: { first: view(), closeAt: 1, hosts: [['www.google.com']] }, existing: false });
    expect(await capture(t)).toBe(EX_UNAVAILABLE);
    expect(t.err).toEqual([
      `Google showed this machine’s region no consent page, so there is no choice to capture here. The browser provider cannot start without a captured rejection: capture one on a machine that is shown the consent page, with pnpm gmt consent export there piped into pnpm gmt consent import here; if no machine you use is shown it, leave the browser provider off (SearchApi and Travelpayouts still work); ${NOTHING}`,
    ]);
    expect(existsSync(t.socsFile)).toBe(false);
  });
  it('a challenge page writes nothing, keeps the stored record and starts its cool-down, as on the server path', async () => {
    const t = setup({
      script: { first: { ...consentView(), text: { ...consentView().text, challenge: true } } },
    });
    expect(await capture(t)).toBe(EX_UNAVAILABLE);
    expect(t.err).toEqual([
      `the window stopped on captcha; ${NOTHING}; cooling down until 2026-10-20T05:00:00.000Z`,
    ]);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active()?.cause,
    ).toBe('captcha');
    t.kept();
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
    expect(offline.err).toEqual([`the landing page did not load (page.goto: NS_ERROR_OFFLINE); ${NOTHING}`]);
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
    expect(closed.err).toEqual([`the window was closed before the page loaded; ${NOTHING}`]);
    for (const t of [offline, closed]) {
      t.kept();
      expect(t.drivers[0]?.calls.at(-1)).toBe('close');
      expect(t.profiles.some((p) => existsSync(p))).toBe(false);
    }
  });
  it('refuses while the worker’s lock is held, keeping the stored record', async () => {
    const held = setup();
    acquireLock(held.dataDir, { pid: 999 });
    expect(await capture(held)).toBe(EX_CONFIG);
    expect(held.err).toEqual([
      "the camoufox worker's data directory is locked by pid 999: stop the worker first (pnpm gmt consent does)",
    ]);
    expect(held.drivers).toEqual([]);
    held.kept();
  });
  it('refuses during a cool-down, naming its end, keeping the stored record', async () => {
    const cooling = setup();
    new CooldownStore({ dir: cooling.dataDir, challengeHours: 48, clock: cooling.timers.clock }).start(
      'captcha',
    );
    expect(await capture(cooling)).toBe(EX_UNAVAILABLE);
    expect(cooling.err).toEqual([
      'cooling down until 2026-10-20T05:00:00.000Z (captcha); no page is loaded before then',
    ]);
    expect(cooling.drivers).toEqual([]);
    cooling.kept();
  });
  // why: ts-b1-006: its own test, as it reads the counts file through its 0600 mode check (POSIX)
  it('refuses at the monthly page cap, keeping the stored record', async () => {
    const full = setup();
    lastPage(full.dataDir, '2026-10-17T00:00:00.000Z', cfg.monthlyPageCap);
    expect(await capture(full)).toBe(EX_UNAVAILABLE);
    expect(full.err.join()).toContain('monthly page cap');
    expect(full.drivers).toEqual([]);
    full.kept();
  });
  it('sweeps a profile a killed capture left, before it starts', async () => {
    const t = setup();
    mkdirSync(join(t.dataDir, 'probe-consent-1-1'), { mode: 0o700 });
    expect(await capture(t)).toBe(0);
    expect(readdirSync(t.dataDir).filter((f) => f.startsWith('probe-'))).toEqual([]);
  });
});

describe('an interruption (SIGINT or SIGTERM: review X3)', () => {
  it('during the watch: the window closes, the profile goes, the lock is released and the stored record is kept', async () => {
    const stop = new AbortController();
    // why: the window is never closed by the person; the interruption arrives on the first watch tick's sleep
    const t = setup({ script: {}, interrupted: stop.signal });
    const sleep = t.timers.sleep.bind(t.timers);
    t.deps.timers = {
      ...t.timers,
      sleep: (ms, signal) => {
        stop.abort();
        return sleep(ms, signal);
      },
    };
    expect(await capture(t)).toBe(EX_INTERRUPTED);
    expect(t.err).toEqual([
      `interrupted: the window is closed and its throwaway profile deleted; ${NOTHING}`,
    ]);
    expect(t.drivers[0]?.calls).toContain('close');
    expect(t.profiles.some((p) => existsSync(p))).toBe(false);
    expect(existsSync(join(t.dataDir, 'worker.lock'))).toBe(false);
    t.kept();
  });
  it('during the spacing wait: no window opens', async () => {
    const stop = new AbortController();
    const t = setup({ interrupted: stop.signal });
    lastPage(t.dataDir, '2026-10-18T04:59:50.000Z');
    t.deps.timers = { ...t.timers, sleep: () => (stop.abort(), new Promise(() => undefined)) };
    expect(await capture(t)).toBe(EX_INTERRUPTED);
    expect(t.err).toEqual([`interrupted before the page loaded; ${NOTHING}`]);
    expect(t.drivers).toEqual([]);
    expect(existsSync(join(t.dataDir, 'worker.lock'))).toBe(false);
    t.kept();
  });
  it('already interrupted: nothing opens', async () => {
    const stop = new AbortController();
    stop.abort();
    const t = setup({ interrupted: stop.signal });
    expect(await capture(t)).toBe(EX_INTERRUPTED);
    expect(t.drivers).toEqual([]);
    t.kept();
  });
  it('during an import’s read: nothing is written', async () => {
    const stop = new AbortController();
    const t = setup({ stdin: new Promise(() => undefined), interrupted: stop.signal });
    const run = consentImport(t.ctx(['import']), t.deps);
    stop.abort();
    expect(await run).toBe(EX_INTERRUPTED);
    expect(t.err).toEqual([`interrupted before a line was read; ${NOTHING}`]);
    expect(existsSync(join(t.dataDir, 'worker.lock'))).toBe(false);
    t.kept();
  });
  it('the entry turns SIGINT or SIGTERM into that abort, and stops listening when it ends', async () => {
    const t = setup({ script: {} });
    const handlers: Array<() => void> = [];
    let removed = 0;
    const signals = {
      on: (h: () => void) => {
        handlers.push(h);
        return () => {
          removed++;
        };
      },
    };
    const sleep = t.timers.sleep.bind(t.timers);
    const setupFake: CaptureSetup = () => ({
      ...t.deps,
      timers: {
        ...t.timers,
        sleep: (ms, s) => {
          for (const h of handlers) h();
          return sleep(ms, s);
        },
      },
    });
    expect(await consentEntry({ ...t.ctx([]), env: { HOME: '/Users/op' } }, setupFake, signals)).toBe(
      EX_INTERRUPTED,
    );
    expect([handlers.length, removed]).toEqual([1, 1]);
    t.kept();
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
  it('a driver that throws mid-watch still closes and deletes, keeps the stored record, and the error is not swallowed', async () => {
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
    t.kept();
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
    expect(t.err.at(-1)).toBe(
      `exported the rejection captured at ${AT} (expires 2027-01-15T08:00:00.000Z (the cookie’s own expiry)): pipe the line above into pnpm gmt consent import on the other machine. It holds the cookie from a signed-out throwaway profile (only its first field is understood), its capture time and its expiry: move it by pipe, never as an argument or in a ticket`,
    );
    t.kept();
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
    // why: X2: the capped expiry is the capture's bound, never named as the cookie's own
    expect(i.out[0]).toContain('the exported line’s expiry');
  });
  it('an Accept all exports nothing and names the export command to run again', async () => {
    const t = setup({ script: { saveAt: 0, socsAt: 1, closeAt: 3, socs: ACCEPT } });
    expect(await exported(t)).toBe(EX_UNAVAILABLE);
    expect(t.out).toEqual([]);
    expect(t.err.at(-1)).toContain('run pnpm gmt consent export again and click Reject all');
  });
  it('runs with no worker.env: the shared settings at their defaults, and the display groups from run.ts', async () => {
    const t = setup({ existing: false });
    const seen: Array<{ display: Readonly<Record<string, string>>; point: string }> = [];
    const fake: CaptureSetup = (_ctx, c, display) => {
      seen.push({ display, point: c.pointOfSale });
      return { ...t.deps, display };
    };
    const ctx: EntryContext = {
      ...t.ctx(['export']),
      env: { HOME: '/home/op', DISPLAY: ':1', XAUTHORITY: '/x', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/b' },
    };
    expect(await consentEntry(ctx, fake)).toBe(0);
    expect(seen).toEqual([{ display: { DISPLAY: ':1', XAUTHORITY: '/x' }, point: 'GB' }]);
    expect(t.out).toHaveLength(1);
    expect(displayFrom({ WAYLAND_DISPLAY: 'w', XDG_RUNTIME_DIR: '/r', PATH: '/p' })).toEqual({
      WAYLAND_DISPLAY: 'w',
      XDG_RUNTIME_DIR: '/r',
    });
  });
  it('a refused setup (no install) is said with 78 and nothing opens', async () => {
    const t = setup();
    const refusing: CaptureSetup = () => ({ refused: 'no Camoufox install' });
    expect(await consentEntry({ ...t.ctx(['export']), env: { HOME: '/Users/op' } }, refusing)).toBe(
      EX_CONFIG,
    );
    expect(t.err).toEqual(['no Camoufox install']);
    // why: settings that do not parse are said with 78, never thrown
    const bad = setup();
    expect(await consentEntry(bad.ctx(['export']), refusing)).toBe(EX_CONFIG);
    expect(bad.err).toEqual(["the worker's settings in worker.env are not valid: HOME"]);
    t.kept();
  });
});

// why: ts-b1-003, X4: the real setup refuses a machine with no install, naming the one install command, and the
// consent command never downloads (camoufox-js's download branch calls fetch)
describe('the real capture setup on a machine with no install', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const osArch = osArchOf(process.platform, process.arch);
  it.skipIf(osArch === null)('refuses naming pnpm gmt browser install, with no fetch', () => {
    const fetch = vi.fn(() => {
      throw new Error('no fetch in this test');
    });
    vi.stubGlobal('fetch', fetch);
    const home = tmpDir();
    const dataDir = tmpDir();
    const ctx: EntryContext = {
      env: { HOME: home, CAMOUFOX_INSTALL_DIR: osArch === null ? '' : installDirFor(osArch, home) },
      dataDir,
      args: ['export'],
      out: () => undefined,
      err: () => undefined,
    };
    const r = realCaptureSetup(ctx, loadCaptureConfig({ HOME: home }), {});
    expect(r).toEqual({
      refused: expect.stringMatching(
        /run pnpm gmt browser install; the consent capture needs the pinned Camoufox, which pnpm gmt browser install lays out \(nothing is downloaded here\)$/,
      ),
    });
    expect(fetch).not.toHaveBeenCalled();
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

describe('consent import: standard input only, the mark recomputed', () => {
  it('a valid rejection line writes socs.json keeping its capture time, its expiry named as the line’s', async () => {
    const t = setup({ stdin: `${lineFor(REJECT, 'reject')}\n` });
    expect(await consentImport(t.ctx(['import']), t.deps)).toBe(0);
    expect(JSON.parse(readFileSync(t.socsFile, 'utf8'))).toMatchObject({
      value: REJECT.value,
      capturedAt: '2026-10-10T08:00:00.000Z',
    });
    expect(statSync(t.socsFile).mode & 0o777).toBe(0o600);
    expect(t.out).toEqual([
      'imported the rejection captured at 2026-10-10T08:00:00.000Z (expires 2027-01-15T08:00:00.000Z, the exported line’s expiry: the earlier of the cookie’s own and its capture plus 13 months); written 0600',
    ]);
  });
  it.each([
    [
      'more than 4 KB',
      'too-long',
      `more than 4096 bytes on standard input: the line is one gmt-socs-v1. line; ${NOTHING}`,
    ],
    [
      'nothing',
      '  \n',
      `nothing on standard input: pipe in the line pnpm gmt consent export printed; ${NOTHING}`,
    ],
    [
      'a wrong prefix',
      'gmt-socs-v0.xyz',
      `the line was refused: the line does not start with gmt-socs-v1.; ${NOTHING}`,
    ],
    [
      'an Accept all value carrying a forged reject mark',
      forged(),
      `the line was refused: the line’s mark (reject) is not its value’s own (accept); ${NOTHING}`,
    ],
    [
      'a true Accept all line',
      lineFor(ACCEPT, 'accept'),
      `the line was refused: the value records Accept all, and only a rejection is ever stored or applied; ${NOTHING}`,
    ],
    [
      'a line with no recognisable choice',
      lineFor(SOCS, 'unknown'),
      `the line was refused: the value does not show a rejection this version reads (if you clicked Reject all, the cookie’s format may have changed: the browser provider stays off until this checkout is updated to read it); ${NOTHING}`,
    ],
    [
      'an expired cookie',
      lineFor(
        { ...REJECT, expires: Date.parse('2026-10-18T04:00:00.000Z') / 1000 },
        'reject',
        '2026-10-01T00:00:00.000Z',
      ),
      `SOCS capture refused (the cookie has expired); capture "Reject all" again with: pnpm gmt consent; ${NOTHING}`,
    ],
    [
      'a capture dated in the future',
      lineFor(REJECT, 'reject', '2026-10-19T00:00:00.000Z'),
      `SOCS capture refused (dated in the future); capture "Reject all" again with: pnpm gmt consent; ${NOTHING}`,
    ],
  ])('refuses %s, keeping the stored record', async (_what, stdin, words) => {
    const t = setup({ stdin });
    expect(await consentImport(t.ctx(['import']), t.deps)).toBe(EX_CONFIG);
    expect(t.err).toEqual([words]);
    t.kept();
  });
  it('refuses while the worker’s lock is held, keeping the stored record', async () => {
    const t = setup({ stdin: lineFor(REJECT, 'reject') });
    acquireLock(t.dataDir, { pid: 999 });
    expect(await consentImport(t.ctx(['import']), t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toContain('stop the worker first (pnpm gmt consent import does)');
    t.kept();
  });
  it('an argument is refused: the line never travels on the command line', async () => {
    const t = setup();
    expect(await entry(t.ctx(['import', lineFor(REJECT, 'reject')]))).toBe(EX_CONFIG);
    expect(t.err).toEqual(['consent import reads the line from standard input only; it takes no argument']);
    t.kept();
  });
  it('reads at most 4 KB, stopping as soon as more arrives', async () => {
    expect(await readBounded(Readable.from([Buffer.from('ab'), 'cd']), 4)).toBe('abcd');
    expect(await readBounded(Readable.from(['abc', 'de', 'never']), 4)).toBe('too-long');
    expect(await readBounded(Readable.from([]), 4)).toBe('');
  });
});

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
  it('an in-date rejection: its capture time, mark and expiry, exit 0; never the value; the file untouched', () => {
    const t = setup({ existing: false });
    write(t.dataDir, stored(REJECT.value));
    const before = readFileSync(t.socsFile);
    expect(consentCheck(t.ctx(['check']), t.timers.clock)).toBe(0);
    expect(t.out).toEqual([
      'consent: captured 2026-10-10T08:00:00.000Z, mark reject, expires 2027-01-15T08:00:00.000Z (the cookie’s own expiry)',
    ]);
    expect(t.out.join()).not.toContain(REJECT.value);
    expect(readFileSync(t.socsFile)).toEqual(before);
  });
  it('bounded by the capture when the cookie outlives 13 months', () => {
    const t = setup({ existing: false });
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
      'an older not-shown record',
      { consent: 'not-shown', checkedAt: '2026-10-01T00:00:00.000Z' },
      `consent: the record is an older not-shown one, which this version neither writes nor uses (pages need a captured rejection): ${fix}`,
    ],
    [
      'an older voided record',
      { consent: 'voided', voidedAt: '2026-10-02T00:00:00.000Z' },
      `consent: the record is an older voided one, which this version neither writes nor uses (pages need a captured rejection): ${fix}`,
    ],
  ])('%s: exit 78, saying so, the file untouched', (_what, record, words) => {
    const t = setup({ existing: false });
    if (typeof record === 'string') writeFileSync(join(t.dataDir, 'socs.json'), record, { mode: 0o600 });
    else if (record !== null) write(t.dataDir, record);
    const before = existsSync(t.socsFile) ? readFileSync(t.socsFile) : null;
    expect(consentCheck(t.ctx(['check']), t.timers.clock)).toBe(EX_CONFIG);
    expect(t.err).toEqual([words]);
    expect(t.out).toEqual([]);
    expect(existsSync(t.socsFile) ? readFileSync(t.socsFile) : null).toEqual(before);
  });
});

describe('the consent entry', () => {
  it.each([[['bogus']], [['export', 'x']], [['check', 'x']]])('refuses %j with its usage', async (args) => {
    const t = setup();
    expect(await entry(t.ctx(args))).toBe(EX_CONFIG);
    expect(t.err).toEqual([CONSENT_USAGE]);
  });
  it('check reads the record with no browser', async () => {
    const t = setup({ existing: false });
    expect(await entry(t.ctx(['check']))).toBe(EX_CONFIG);
    expect(t.err).toEqual([`consent: no record: capture one with ${CONSENT_FIX.command}`]);
  });
});

// why: ts-b1-004: each path is shown to have run (its exit code and its own success line) before the absence checks
describe('the SOCS value appears only in export’s one line', () => {
  it('no other output of capture, export, import or check holds it, raw or as base64url', async () => {
    const a = setup();
    expect(await capture(a)).toBe(0);
    expect(a.out.join()).toContain('captured a rejection');
    const b = setup();
    expect(await exported(b)).toBe(0);
    expect(b.out).toHaveLength(1);
    expect(b.err.join()).toContain('exported the rejection');
    const c = setup({ stdin: lineFor(REJECT, 'reject') });
    expect(await consentImport(c.ctx(['import']), c.deps)).toBe(0);
    expect(c.out.join()).toContain('imported the rejection');
    expect(consentCheck(c.ctx(['check']), c.timers.clock)).toBe(0);
    expect(c.out.join()).toContain('mark reject');
    const said = [...a.out, ...a.err, ...b.err, ...c.out, ...c.err].join('\n');
    expect(said).not.toContain(REJECT.value);
    expect(said).not.toContain(Buffer.from(REJECT.value).toString('base64url'));
    expect(said).not.toContain(CONSENT_LINE_PREFIX);
    expect(b.out.join('\n')).not.toContain(REJECT.value);
  });
});
