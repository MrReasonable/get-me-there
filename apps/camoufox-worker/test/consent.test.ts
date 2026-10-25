import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyLanding } from '../src/classify.js';
import { createConsentDriver, displayEnvOf, headedEnv, NO_DISPLAY, NoDisplay } from '../src/consentDriver.js';
import { decideConsentCaptureRoute } from '../src/consentGuard.js';
import { observe, type ResearchSession, researchRecord } from '../src/consentResearch.js';
import { SOCS_CAPTURE_LIMIT_MS, watchConsentWindow } from '../src/consentWatch.js';
import type { HeadedContextLike, RequestLike } from '../src/driver.js';
import { decideProbeRoute, decideRoute } from '../src/guard.js';
import { buildLaunchOptions } from '../src/launch.js';
import { SELECTORS } from '../src/selectors.js';
import { consentView, fakeConsentDriver, request, SOCS, view } from './support/fakeConsent.js';
import { FakeContext } from './support/fakeContext.js';
import { memoryLog } from './support/log.js';
import { fakeTimers } from './support/timers.js';

// why: WP17 Task 17.4 (decision 74): the consent capture's guard, its driver, its watcher and research 17.0c's record

describe('the consent capture’s guard', () => {
  const S = SELECTORS;
  it('admits the main frame’s document navigations and form POSTs to consent.google.com, /save included', () => {
    for (const [url, method] of [
      ['https://consent.google.com/ml?continue=x', 'GET'],
      ['https://consent.google.com/save', 'POST'],
      ['https://consent.google.com/save?x=1', 'GET'],
    ] as const)
      expect(decideConsentCaptureRoute(url, true, method, true, S), url).toEqual({ action: 'continue' });
  });
  it('and the redirect back to www.google.com/travel/flights, as the allowlist does', () => {
    expect(
      decideConsentCaptureRoute('https://www.google.com/travel/flights?hl=en-GB', true, 'GET', true, S),
    ).toEqual({
      action: 'continue',
    });
  });
  it('refuses every other host, a sub-frame on the consent host, another method and plain http', () => {
    expect(decideConsentCaptureRoute('https://accounts.google.com/x', true)).toEqual({
      action: 'abort',
      kind: 'sign-in',
    });
    expect(decideConsentCaptureRoute('https://www.example.test/', true)).toEqual({
      action: 'abort',
      kind: 'off-allowlist',
    });
    expect(decideConsentCaptureRoute('https://consent.google.com/save', true, 'POST', false)).toEqual({
      action: 'abort',
      kind: 'consent-unhandled',
    });
    expect(decideConsentCaptureRoute('https://consent.google.com/save', true, 'PUT')).toEqual({
      action: 'abort',
      kind: 'consent-unhandled',
    });
    expect(decideConsentCaptureRoute('http://consent.google.com/save', true, 'POST')).toMatchObject({
      action: 'abort',
    });
    expect(decideConsentCaptureRoute('https://consent.google.com:8443/save', true, 'POST')).toMatchObject({
      action: 'abort',
    });
    expect(decideConsentCaptureRoute('not a url', true)).toMatchObject({ action: 'abort' });
    expect(decideConsentCaptureRoute('https://consent.google.com/x.js', false)).toEqual({
      action: 'continue',
    });
  });
  it('the server path and the probe still refuse /save', () => {
    expect(decideRoute('https://consent.google.com/save', true)).toEqual({
      action: 'abort',
      kind: 'consent-unhandled',
    });
    expect(decideProbeRoute('https://consent.google.com/save', true, 'POST')).toEqual({
      action: 'abort',
      kind: 'consent-unhandled',
    });
  });
});

describe('the display variables (decision 74)', () => {
  it('groups DISPLAY with XAUTHORITY and WAYLAND_DISPLAY with XDG_RUNTIME_DIR, each only when its main variable is set', () => {
    expect(displayEnvOf({ DISPLAY: ':0', XAUTHORITY: '/a', DBUS_SESSION_BUS_ADDRESS: 'x' })).toEqual({
      x11: { DISPLAY: ':0', XAUTHORITY: '/a' },
      wayland: null,
    });
    expect(displayEnvOf({ XAUTHORITY: '/a', XDG_RUNTIME_DIR: '/run/user/1' })).toEqual({
      x11: null,
      wayland: null,
    });
    expect(displayEnvOf({ WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1' })).toEqual({
      x11: null,
      wayland: { WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1' },
    });
    expect(displayEnvOf({ DISPLAY: ':1', XAUTHORITY: '' }).x11).toEqual({ DISPLAY: ':1' });
  });
  it('the headed window gets only the groups present, never DBUS; with neither on Linux it refuses, pointing at export and import', () => {
    expect(headedEnv({ x11: { DISPLAY: ':0', XAUTHORITY: '/a' }, wayland: null }, 'linux')).toEqual({
      DISPLAY: ':0',
      XAUTHORITY: '/a',
    });
    expect(
      headedEnv({ x11: null, wayland: { WAYLAND_DISPLAY: 'w', XDG_RUNTIME_DIR: '/r' } }, 'linux'),
    ).toEqual({
      WAYLAND_DISPLAY: 'w',
      XDG_RUNTIME_DIR: '/r',
    });
    expect(() => headedEnv({ x11: null, wayland: null }, 'linux')).toThrow(new NoDisplay());
    expect(NO_DISPLAY).toContain('pnpm gmt consent export');
    expect(NO_DISPLAY).toContain('pnpm gmt consent import');
    expect(headedEnv({ x11: null, wayland: null }, 'darwin')).toEqual({});
  });
  it('the headless worker’s browser environment is unchanged: no display variable in it', () => {
    expect(Object.keys(buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' }).env)).toEqual([
      'HOME',
      'PATH',
      'TMPDIR',
      'LANG',
    ]);
  });
});

/** A FakeContext that is also a headed one: a person may close it. */
class HeadedFake extends FakeContext implements HeadedContextLike {
  readonly closeListeners: Array<() => void> = [];
  override on(event: 'request', listener: (r: RequestLike) => void): unknown;
  override on(event: 'close', listener: () => void): unknown;
  override on(event: 'request' | 'close', listener: (r: RequestLike) => void): unknown {
    // why: a close listener takes no argument; it is called with a stand-in that it ignores
    if (event === 'close') this.closeListeners.push(() => listener(request({ url: 'about:blank' })));
    else super.on('request', listener);
    return this;
  }
}

describe('the real consent driver over a fake headed context', () => {
  it('launches headed with the display group, loads one page only, reads SOCS by name and domain only, sees the close', async () => {
    const c = new HeadedFake();
    c.navigations = [
      {
        hops: ['https://www.google.com/travel/flights?hl=en-GB&gl=GB'],
        tree: { role: 'document', name: '' },
      },
    ];
    c.jar = [
      { name: 'NID', value: 'other', domain: '.google.com', path: '/' },
      { name: 'SOCS', value: 'elsewhere', domain: 'www.google.com', path: '/' },
      {
        name: 'SOCS',
        value: 'v',
        domain: '.google.com',
        path: '/',
        expires: 1_800_000_000,
        secure: true,
        sameSite: 'Lax',
      },
    ];
    const displays: Array<Readonly<Record<string, string>>> = [];
    const timers = fakeTimers();
    const d = createConsentDriver({
      platform: 'linux',
      options: buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' }),
      profileDir: '/tmp/probe-x',
      launch: async (_o, _p, display) => {
        displays.push(display);
        return c;
      },
      log: memoryLog(),
      clock: timers.clock,
      timers,
    });
    await expect(d.load('x')).rejects.toThrow('the consent window is not open');
    await d.launchHeaded({ x11: { DISPLAY: ':0' }, wayland: null });
    expect(displays).toEqual([{ DISPLAY: ':0' }]);
    await expect(d.launchHeaded({ x11: { DISPLAY: ':0' }, wayland: null })).rejects.toThrow('already open');
    await d.load('https://www.google.com/travel/flights?hl=en-GB&gl=GB');
    await expect(d.load('https://www.google.com/travel/flights')).rejects.toThrow('loads one page only');
    expect(await d.socsCookie()).toEqual({
      value: 'v',
      domain: '.google.com',
      path: '/',
      expires: 1_800_000_000,
      secure: true,
      sameSite: 'Lax',
    });
    expect(await d.accountCookieSeen()).toBe(false);
    expect(d.mainFrameHosts()).toEqual(['www.google.com']);
    expect((await d.snapshotView()).url).toBe('https://www.google.com/travel/flights?hl=en-GB&gl=GB');
    expect(d.closed()).toBe(false);
    for (const l of c.closeListeners) l();
    expect(d.closed()).toBe(true);
    await d.close();
    expect(c.closed).toBe(1);
    await expect(d.socsCookie()).rejects.toThrow('not open');
  });
  it('with no display on Linux the window never opens', async () => {
    let launched = 0;
    const timers = fakeTimers();
    const d = createConsentDriver({
      platform: 'linux',
      options: buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' }),
      profileDir: '/tmp/probe-y',
      launch: async () => {
        launched++;
        return new HeadedFake();
      },
      log: memoryLog(),
      clock: timers.clock,
      timers,
    });
    await expect(d.launchHeaded({ x11: null, wayland: null })).rejects.toBeInstanceOf(NoDisplay);
    expect(launched).toBe(0);
  });
});

describe('watching the window (the tool only observes)', () => {
  const on = { ...SELECTORS, LANDING_VERIFIED: true };
  it('a consent page, then SOCS after it, then the person closes the window: closed, with SOCS after consent and the landing view after', async () => {
    const d = fakeConsentDriver({ socsAt: 1, closeAt: 3 });
    const w = await watchConsentWindow(d, { timers: fakeTimers(), selectors: on });
    expect(w).toMatchObject({
      ended: 'closed',
      firstView: 'consent',
      consentHostSeen: true,
      socs: SOCS,
      socsAfterConsent: true,
    });
    expect(w.afterFacts).not.toBeNull();
    expect(
      d.calls.filter(
        (c) => !['mainFrameHosts', 'accountCookieSeen', 'socsCookie', 'snapshotView'].includes(c),
      ),
    ).toEqual([]);
  });
  it('a window left for 10 minutes ends timed-out on the injected clock', async () => {
    const timers = fakeTimers();
    const w = await watchConsentWindow(fakeConsentDriver({}), { timers });
    expect(w.ended).toBe('timed-out');
    expect(timers.now() - Date.parse('2026-10-18T05:00:00.000Z')).toBeGreaterThanOrEqual(
      SOCS_CAPTURE_LIMIT_MS,
    );
  });
  it('an account cookie ends the watch at once', async () => {
    expect(
      (await watchConsentWindow(fakeConsentDriver({ accountAt: 0 }), { timers: fakeTimers() })).ended,
    ).toBe('account-cookie');
  });
  it('a challenge as the first view is blocked; an unrecognised one is watched; the landing view is recognised', async () => {
    const challenge = view({ text: { ...view().text, challenge: true } });
    expect(
      await watchConsentWindow(fakeConsentDriver({ first: challenge }), { timers: fakeTimers() }),
    ).toMatchObject({
      ended: 'blocked',
      blocked: 'captcha',
    });
    const other = await watchConsentWindow(
      fakeConsentDriver({ first: view(), closeAt: 0, hosts: [['www.google.com']] }),
      {
        timers: fakeTimers(),
      },
    );
    expect([other.ended, other.firstView, other.consentHostSeen]).toEqual(['closed', 'other', false]);
    const landing = await watchConsentWindow(
      fakeConsentDriver({ first: view(), closeAt: 0, hosts: [['www.google.com']] }),
      { timers: fakeTimers(), selectors: on },
    );
    expect(landing.firstView).toBe('landing');
    expect(classifyLanding(consentView(), on).kind).toEqual({ kind: 'blocked', page: 'consent-unhandled' });
  });
  it('SOCS with no consent host seen is not SOCS after consent', async () => {
    const w = await watchConsentWindow(
      fakeConsentDriver({ first: view(), hosts: [['www.google.com']], socsAt: 0, closeAt: 2 }),
      { timers: fakeTimers() },
    );
    expect([w.socs, w.socsAfterConsent]).toEqual([SOCS, false]);
  });
  it('a read that fails because the person closed the window reads as closed; any other failure is thrown', async () => {
    const d = fakeConsentDriver({});
    let closed = false;
    const failing = {
      ...d,
      closed: () => closed,
      socsCookie: async () => {
        closed = true;
        throw new Error('Target closed');
      },
    };
    expect((await watchConsentWindow(failing, { timers: fakeTimers() })).ended).toBe('closed');
    const broken = { ...d, socsCookie: async () => Promise.reject(new Error('boom')) };
    await expect(watchConsentWindow(broken, { timers: fakeTimers() })).rejects.toThrow('boom');
  });
});

describe('research 17.0c’s record: names only, and the one value that tells the choices apart', () => {
  const reqs = (choice: string) => [
    request({ url: 'https://consent.google.com/ml?continue=x' }),
    request({
      url: 'https://consent.google.com/save',
      method: 'POST',
      body: `gl=GB&hl=en-GB&pc=fgc&continue=https%3A%2F%2Fwww.google.com&x=SECRET-${choice}-x&set_eom=${choice === 'reject' ? 'true' : 'false'}&bl=boq-same`,
    }),
    request({ url: 'https://www.google.com/travel/flights?hl=en-GB&gl=GB' }),
    request({ url: 'https://www.gstatic.com/x.js', nav: false }),
    request({
      url: 'https://www.google.com/log',
      method: 'POST',
      nav: false,
      body: `token=SECRET-${choice}-t`,
    }),
  ];
  const session = (choice: 'reject' | 'accept'): ResearchSession => ({
    choice,
    requests: reqs(choice)
      .map(observe)
      .filter((r) => r !== null),
    socs: { ...SOCS, value: `socs-${choice}` },
    hosts: ['consent.google.com', 'www.google.com'],
    ended: 'closed',
  });
  it('keeps each request’s method, host, path and field names; no other value is ever written', () => {
    const rec = researchRecord(session('reject'), session('accept'));
    const text = JSON.stringify(rec);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('fgc');
    expect(text).not.toContain('boq-same');
    expect(rec.sessions[0]?.requests).toEqual([
      { method: 'GET', host: 'consent.google.com', path: '/ml', fieldNames: [] },
      {
        method: 'POST',
        host: 'consent.google.com',
        path: '/save',
        fieldNames: ['gl', 'hl', 'pc', 'continue', 'x', 'set_eom', 'bl'],
      },
      { method: 'GET', host: 'www.google.com', path: '/travel/flights', fieldNames: [] },
      { method: 'POST', host: 'www.google.com', path: '/log', fieldNames: ['token'] },
    ]);
    expect(rec.sessions.map((s) => s.socs?.value)).toEqual(['socs-reject', 'socs-accept']);
  });
  it('one field differing besides the per-session tokens: when exactly one differs its two values are kept', () => {
    const strip = (s: ResearchSession): ResearchSession => ({
      ...s,
      requests: s.requests.map((r) => ({
        ...r,
        fields: new Map([...r.fields].filter(([k]) => k !== 'x' && k !== 'token')),
      })),
    });
    expect(researchRecord(strip(session('reject')), strip(session('accept'))).differing).toEqual({
      name: 'set_eom',
      reject: 'true',
      accept: 'false',
    });
  });
  it('more than one differing field keeps only their names; none differing, nothing', () => {
    expect(researchRecord(session('reject'), session('accept')).differing).toEqual({
      names: ['set_eom', 'token', 'x'],
    });
    expect(
      researchRecord(session('reject'), { ...session('reject'), choice: 'accept' }).differing,
    ).toBeNull();
  });
  it('observe takes navigations and POSTs to the two hosts only, and survives a bad URL or body', () => {
    expect(observe(request({ url: 'https://www.example.test/' }))).toBeNull();
    expect(observe(request({ url: 'nope' }))).toBeNull();
    expect(observe(request({ url: 'https://www.google.com/x.css', nav: false }))).toBeNull();
    const throwing: RequestLike = {
      ...request({ url: 'https://consent.google.com/save', method: 'POST' }),
      postData: () => {
        throw new Error('no body');
      },
    };
    expect(observe(throwing)?.fields.size).toBe(0);
    const { postData: _p, ...bare } = request({ url: 'https://consent.google.com/save', method: 'POST' });
    expect(observe(bare)?.fields.size).toBe(0);
  });
});

describe('the consent modules’ browser access (grep)', () => {
  it('only consentDriver.ts holds page handles or the capture guard; no consent module imports a browser library', () => {
    const dir = new URL('../src/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.startsWith('consent') && f.endsWith('.ts'));
    expect(files.sort()).toEqual([
      'consentDriver.ts',
      'consentGuard.ts',
      'consentResearch.ts',
      'consentWatch.ts',
    ]);
  });
});
