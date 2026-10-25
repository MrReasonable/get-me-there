import { readdirSync, readFileSync } from 'node:fs';
import { CONSENT_FIX } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { classifyLanding } from '../src/classify.js';
import { createConsentDriver, headedEnv, NO_DISPLAY, NoDisplay } from '../src/consentDriver.js';
import { decideConsentCaptureRoute } from '../src/consentGuard.js';
import { observe, RESEARCH_NOTE, type ResearchSession, researchRecord } from '../src/consentResearch.js';
import { SOCS_CAPTURE_LIMIT_MS, watchConsentWindow } from '../src/consentWatch.js';
import type { HeadedContextLike, RequestLike } from '../src/driver.js';
import { decideProbeRoute, decideRoute } from '../src/guard.js';
import { buildLaunchOptions } from '../src/launch.js';
import { SELECTORS } from '../src/selectors.js';
import {
  CONSENT_URL,
  consentView,
  fakeConsentDriver,
  LANDING_URL,
  request,
  SOCS,
  view,
} from './support/fakeConsent.js';
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
  it('the headed window gets exactly the groups run.ts passed; with neither on Linux it refuses, naming the capture that works today', () => {
    expect(headedEnv({ DISPLAY: ':0', XAUTHORITY: '/a' }, 'linux')).toEqual({
      DISPLAY: ':0',
      XAUTHORITY: '/a',
    });
    expect(headedEnv({ WAYLAND_DISPLAY: 'w', XDG_RUNTIME_DIR: '/r' }, 'linux')).toEqual({
      WAYLAND_DISPLAY: 'w',
      XDG_RUNTIME_DIR: '/r',
    });
    expect(() => headedEnv({}, 'linux')).toThrow(new NoDisplay());
    expect(() => headedEnv({ XAUTHORITY: '/a', XDG_RUNTIME_DIR: '/r' }, 'linux')).toThrow(NoDisplay);
    // why: W2: until Task 17.5, the fix is core's CONSENT_FIX; no text names a consent command not built yet
    expect(NO_DISPLAY).toContain(CONSENT_FIX.command);
    expect(NO_DISPLAY).toContain(CONSENT_FIX.doc);
    expect(NO_DISPLAY).not.toContain('gmt consent');
    expect(headedEnv({}, 'darwin')).toEqual({});
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
    await d.launchHeaded({ DISPLAY: ':0' });
    expect(displays).toEqual([{ DISPLAY: ':0' }]);
    await expect(d.launchHeaded({ DISPLAY: ':0' })).rejects.toThrow('already open');
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
  it('counts the choice’s submissions (a POST to the consent host’s /save, nothing else) and reports a guard refusal', async () => {
    const c = new HeadedFake();
    c.navigations = [
      // why: the fake routes a navigation's first hop, as context.route sees only that one
      { hops: ['https://www.example.test/x'], tree: { role: 'document', name: '' } },
    ];
    const timers = fakeTimers();
    const d = createConsentDriver({
      platform: 'darwin',
      options: buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' }),
      profileDir: '/tmp/probe-z',
      launch: async () => c,
      log: memoryLog(),
      clock: timers.clock,
      timers,
    });
    await d.launchHeaded({});
    expect([d.consentSaves(), d.refused()]).toEqual([0, null]);
    for (const r of [
      request({ url: 'https://consent.google.com/save', method: 'POST', nav: true }),
      request({ url: 'https://consent.google.com/save', method: 'GET' }),
      request({ url: 'https://consent.google.com/saved', method: 'POST' }),
      request({ url: 'https://www.google.com/save', method: 'POST' }),
      request({ url: 'not a url', method: 'POST' }),
    ])
      c.emitRequest(r);
    expect(d.consentSaves()).toBe(1);
    await expect(d.load('https://www.google.com/travel/flights?hl=en-GB&gl=GB')).rejects.toThrow(
      'blockedbyclient',
    );
    expect(d.refused()).toBe('off-allowlist');
    await d.close();
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
    await expect(d.launchHeaded({})).rejects.toBeInstanceOf(NoDisplay);
    expect(launched).toBe(0);
  });
});

describe('watching the window (the tool only observes)', () => {
  const on = { ...SELECTORS, LANDING_VERIFIED: true };
  it('a consent page, the choice submitted, SOCS set after it, then the window closed: closed, with that SOCS and the settled view after', async () => {
    const d = fakeConsentDriver({ saveAt: 0, socsAt: 1, closeAt: 3 });
    const w = await watchConsentWindow(d, { timers: fakeTimers(), selectors: on });
    expect(w).toMatchObject({
      ended: 'closed',
      firstView: 'consent',
      saves: 1,
      socs: SOCS,
      socsBeforeChoice: false,
      afterView: 'landing',
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
      fakeConsentDriver({ first: view(), after: view(), closeAt: 0, hosts: [['www.google.com']] }),
      { timers: fakeTimers() },
    );
    expect([other.ended, other.firstView, other.saves]).toEqual(['closed', 'other', 0]);
    const landing = await watchConsentWindow(
      fakeConsentDriver({ first: view(), closeAt: 0, hosts: [['www.google.com']] }),
      { timers: fakeTimers(), selectors: on },
    );
    expect(landing.firstView).toBe('landing');
    expect(classifyLanding(consentView(), on).kind).toEqual({ kind: 'blocked', page: 'consent-unhandled' });
  });
  // why: W8 (pa-b1-004): the first view is the settled one, so a challenge drawn after the first load still stops
  it('a challenge that appears on the second snapshot of the first view stops the watch; the settle waits on the injected timers', async () => {
    const challenge = view({ text: { ...view().text, challenge: true } });
    const timers = fakeTimers();
    const w = await watchConsentWindow(fakeConsentDriver({ views: [view(), challenge] }), { timers });
    expect(w).toMatchObject({ ended: 'blocked', blocked: 'captcha', firstFacts: challenge });
    expect(timers.now() - Date.parse('2026-10-18T05:00:00.000Z')).toBe(1000);
  });
  it('a first view that never decides is taken as it stands once the settle bound passes', async () => {
    const timers = fakeTimers();
    const w = await watchConsentWindow(
      fakeConsentDriver({ first: view(), after: view(), hosts: [['www.google.com']], closeAt: 0 }),
      { timers, settleMs: 5000 },
    );
    expect([w.ended, w.firstView]).toEqual(['closed', 'other']);
    // why: snapshots a tick apart until the 5 s bound, then one watch tick before the closed window is read
    expect(timers.now() - Date.parse('2026-10-18T05:00:00.000Z')).toBe(6000);
  });
  // why: CodeRabbit (PR #15): the view reached after consent is classified, the consent host's hops left out
  it('a challenge reached after the choice stops the watch as blocked, never as consent-unhandled', async () => {
    const challengeAfter = view({
      hops: [LANDING_URL, CONSENT_URL, LANDING_URL],
      text: { ...view().text, unusualTraffic: true },
    });
    const w = await watchConsentWindow(
      fakeConsentDriver({ saveAt: 0, socsAt: 0, views: [consentView(), challengeAfter] }),
      { timers: fakeTimers(), selectors: on },
    );
    expect(w).toMatchObject({ ended: 'blocked', blocked: 'unusual-traffic', saves: 1 });
  });
  it('a guard refusal of a main-frame navigation ends the watch as blocked, with its kind', async () => {
    const w = await watchConsentWindow(fakeConsentDriver({ refusedAt: 1, refused: 'sign-in' }), {
      timers: fakeTimers(),
    });
    expect([w.ended, w.blocked]).toEqual(['blocked', 'sign-in']);
  });
  // why: W8 (pa-b1-005): a SOCS there before any choice is not the choice's; only one set or changed after it counts
  it('a SOCS present before the choice is never kept; one changed after it is', async () => {
    const before = await watchConsentWindow(fakeConsentDriver({ socsAt: 0, closeAt: 3 }), {
      timers: fakeTimers(),
    });
    expect([before.socs, before.socsBeforeChoice, before.saves]).toEqual([null, true, 0]);
    const unchanged = await watchConsentWindow(fakeConsentDriver({ socsAt: 0, saveAt: 1, closeAt: 3 }), {
      timers: fakeTimers(),
    });
    expect([unchanged.socs, unchanged.socsBeforeChoice, unchanged.saves]).toEqual([null, true, 1]);
    let tick = 0;
    const d = fakeConsentDriver({ saveAt: 1, closeAt: 4 });
    const changing = {
      ...d,
      mainFrameHosts: () => {
        tick++;
        return d.mainFrameHosts();
      },
      socsCookie: async () => ({ ...SOCS, value: tick > 2 ? 'after' : 'before' }),
    };
    const after = await watchConsentWindow(changing, { timers: fakeTimers() });
    expect([after.socs?.value, after.socsBeforeChoice]).toEqual(['after', true]);
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
  const save = (prompted: string, extra = '') =>
    request({
      url: 'https://consent.google.com/save',
      method: 'POST',
      body: `gl=GB&hl=en-GB&pc=fgc&continue=https%3A%2F%2Fwww.google.com&x=SECRET-${prompted}-x&set_eom=${prompted === 'reject' ? 'true' : 'false'}&bl=boq-same${extra}`,
    });
  const reqs = (prompted: string) => [
    request({ url: 'https://consent.google.com/ml?continue=x' }),
    save(prompted),
    request({ url: 'https://www.google.com/travel/flights?hl=en-GB&gl=GB' }),
    request({ url: 'https://www.gstatic.com/x.js', nav: false }),
    request({
      url: 'https://www.google.com/log',
      method: 'POST',
      nav: false,
      type: 'application/json',
      body: `{"token":"SECRET-${prompted}-t","events":[["SECRET-id"]]}`,
    }),
    request({
      url: 'https://www.google.com/gen_204',
      method: 'POST',
      nav: false,
      body: `atyp=SECRET-${prompted}-form-elsewhere`,
    }),
  ];
  const session = (prompted: 'reject' | 'accept', requests = reqs(prompted)): ResearchSession => ({
    prompted,
    requests: requests.map(observe).filter((r) => r !== null),
    socs: { ...SOCS, value: `socs-${prompted}` },
    socsBeforeChoice: false,
    hosts: ['consent.google.com', 'www.google.com'],
    ended: 'closed',
  });
  it('keeps method, host and path; field names of the consent submission only; a JSON body’s top-level keys only', () => {
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
      {
        method: 'POST',
        host: 'www.google.com',
        path: '/log',
        fieldNames: [],
        body: { contentType: 'application/json', jsonKeys: ['token', 'events'] },
      },
      {
        method: 'POST',
        host: 'www.google.com',
        path: '/gen_204',
        fieldNames: [],
        body: { contentType: 'application/x-www-form-urlencoded', jsonKeys: [] },
      },
    ]);
    expect(rec.sessions.map((s) => [s.prompted, s.socs?.value])).toEqual([
      ['reject', 'socs-reject'],
      ['accept', 'socs-accept'],
    ]);
    expect(rec.note).toBe(RESEARCH_NOTE);
  });
  it('one plain field differing between the two submissions keeps its two values', () => {
    const strip = (s: ResearchSession): ResearchSession => ({
      ...s,
      requests: s.requests.map((r) => ({
        ...r,
        fields: new Map([...r.fields].filter(([k]) => k !== 'x')),
      })),
    });
    expect(researchRecord(strip(session('reject')), strip(session('accept'))).differing).toEqual({
      name: 'set_eom',
      reject: 'true',
      accept: 'false',
    });
  });
  it('more than one differing field keeps only their names; none differing says so', () => {
    expect(researchRecord(session('reject'), session('accept')).differing).toEqual({
      names: ['set_eom', 'x'],
    });
    expect(researchRecord(session('reject'), { ...session('reject'), prompted: 'accept' }).differing).toEqual(
      {
        none: 'the two submissions carry the same values',
      },
    );
  });
  // why: sec-b1-005, pie-b1-005: a token-like field, or a value that is not a short plain token, keeps its name only
  it('a single differing field that is a token’s, or whose value is long or not plain, keeps its name only', () => {
    const one = (name: string, r: string, a: string) =>
      researchRecord(
        session('reject', [
          request({ url: 'https://consent.google.com/save', method: 'POST', body: `${name}=${r}` }),
        ]),
        session('accept', [
          request({ url: 'https://consent.google.com/save', method: 'POST', body: `${name}=${a}` }),
        ]),
      ).differing;
    expect(one('continue', 'a', 'b')).toEqual({ names: ['continue'] });
    expect(one('csrf_token', 'a', 'b')).toEqual({ names: ['csrf_token'] });
    expect(one('choice', 'a'.repeat(65), 'b')).toEqual({ names: ['choice'] });
    expect(one('choice', 'a b', 'b')).toEqual({ names: ['choice'] });
    expect(one('choice', 'reject_all', 'accept_all')).toEqual({
      name: 'choice',
      reject: 'reject_all',
      accept: 'accept_all',
    });
  });
  it('a value is kept only when each session submitted exactly once', () => {
    const twice = [...reqs('reject'), save('reject')];
    expect(researchRecord(session('reject', twice), session('accept')).differing).toEqual({
      none: 'each session needs exactly one consent submission (found 2 and 1)',
    });
    expect(researchRecord(session('reject', []), session('accept')).differing).toEqual({
      none: 'each session needs exactly one consent submission (found 0 and 1)',
    });
  });
  it('a JSON body to the consent host is never parsed as a form', () => {
    const json = observe(
      request({
        url: 'https://consent.google.com/save',
        method: 'POST',
        type: 'application/json',
        body: '{"a":"SECRET"}',
      }),
    );
    expect(json?.fields.size).toBe(0);
    expect(json?.body).toEqual({ contentType: 'application/json', jsonKeys: ['a'] });
    expect(
      observe(
        request({ url: 'https://consent.google.com/save', method: 'POST', type: 'text/plain', body: 'x' }),
      )?.body,
    ).toEqual({
      contentType: 'text/plain',
      jsonKeys: [],
    });
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
    const {
      postData: _p,
      headers: _h,
      ...bare
    } = request({ url: 'https://consent.google.com/save', method: 'POST' });
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
    for (const f of files.filter((x) => x !== 'consentDriver.ts' && x !== 'consentGuard.ts')) {
      const text = readFileSync(new URL(f, dir), 'utf8');
      expect(text, f).not.toMatch(/from '(playwright|camoufox)/);
    }
  });
});
