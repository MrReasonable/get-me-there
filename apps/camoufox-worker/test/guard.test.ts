import { beforeEach, describe, expect, it } from 'vitest';
import type { FrameLike, RequestLike } from '../src/driver.js';
import {
  decideProbeRoute,
  decideRoute,
  installGuard,
  installProbeGuard,
  onAllowlist,
  refusalKind,
} from '../src/guard.js';
import { FakeContext } from './support/fakeContext.js';
import { FakePage } from './support/fakePage.js';
import { memoryLog } from './support/log.js';

const log = memoryLog();
const logs = log.lines;
const main: FrameLike = { url: () => 'x', parentFrame: () => null };
const sub: FrameLike = { url: () => 'y', parentFrame: () => main };
const req = (
  url: string,
  o: { nav?: boolean; from?: RequestLike | null; frame?: FrameLike; noFrame?: boolean; method?: string } = {},
): RequestLike => ({
  url: () => url,
  method: () => o.method ?? 'GET',
  isNavigationRequest: () => o.nav ?? true,
  redirectedFrom: () => o.from ?? null,
  frame: () => {
    if (o.noFrame === true) throw new Error('Service Worker requests do not have an associated frame');
    return o.frame ?? main;
  },
});

beforeEach(() => {
  expect.hasAssertions();
  logs.length = 0;
});

describe('decideRoute (brief §6 allowlist)', () => {
  it.each([
    'https://www.google.com/travel/flights',
    'https://www.google.com/travel/flights?q=x',
    'https://www.google.com/travel/flights/search?tfs=x',
  ])('%s continues', (u) => {
    expect(decideRoute(u, true)).toEqual({ action: 'continue' });
  });
  it.each([
    ['https://www.google.com/travel/flightsevil', 'off-allowlist'],
    ['http://www.google.com/travel/flights', 'off-allowlist'],
    ['https://www.google.com/search?q=x', 'off-allowlist'],
    ['https://consent.google.com/ml?continue=x', 'consent-unhandled'],
    ['https://accounts.google.com/ServiceLogin', 'sign-in'],
    ['https://www.example.test/', 'off-allowlist'],
    ['not a url', 'off-allowlist'],
    // why: fix round 1 (TS I1, sec M2): another host with the results path, and a port or user on the right host
    ['https://www.example.test/travel/flights', 'off-allowlist'],
    ['https://google.com/travel/flights', 'off-allowlist'],
    ['https://www.google.com.evil.test/travel/flights', 'off-allowlist'],
    ['https://www.google.com:8443/travel/flights', 'off-allowlist'],
    ['https://user@www.google.com/travel/flights', 'off-allowlist'],
    ['https://u:p@www.google.com/travel/flights', 'off-allowlist'],
  ])('%s is aborted as %s', (u, kind) => {
    expect(decideRoute(u, true)).toEqual({ action: 'abort', kind });
  });
  it('a subresource to any host continues', () => {
    expect(decideRoute('https://www.example.test/app.js', false)).toEqual({ action: 'continue' });
    expect(decideRoute('https://consent.google.com/x.js', false)).toEqual({ action: 'continue' });
  });
  it('the helpers agree', () => {
    expect(onAllowlist('https://www.google.com/travel/flights/x')).toBe(true);
    expect(refusalKind('https://consent.google.com/')).toBe('consent-unhandled');
    expect(refusalKind('nope')).toBe('off-allowlist');
  });
});

describe('decideProbeRoute (the recorder’s consent probe only)', () => {
  // why: fix round 1 (sec M3): the probe reads the consent page; it can never reach the endpoint that records a choice
  it('refuses a POST to consent.google.com and its /save path by any method', () => {
    expect(decideProbeRoute('https://consent.google.com/ml', true, 'POST')).toEqual({
      action: 'abort',
      kind: 'consent-unhandled',
    });
    for (const u of [
      'https://consent.google.com/save',
      'https://consent.google.com/save?x=1',
      'https://consent.google.com/save/x',
    ])
      expect(decideProbeRoute(u, true, 'GET'), u).toEqual({ action: 'abort', kind: 'consent-unhandled' });
    expect(decideProbeRoute('https://consent.google.com:8443/ml', true, 'GET')).toEqual({
      action: 'abort',
      kind: 'consent-unhandled',
    });
  });
  it('also admits https://consent.google.com/ documents and nothing else', () => {
    expect(decideProbeRoute('https://consent.google.com/ml?continue=x', true)).toEqual({
      action: 'continue',
    });
    expect(decideProbeRoute('http://consent.google.com/ml', true)).toEqual({
      action: 'abort',
      kind: 'consent-unhandled',
    });
    expect(decideProbeRoute('https://accounts.google.com/', true)).toEqual({
      action: 'abort',
      kind: 'sign-in',
    });
    expect(decideProbeRoute('https://www.google.com/travel/flights', true)).toEqual({ action: 'continue' });
    expect(decideProbeRoute('not a url', true)).toEqual({ action: 'abort', kind: 'off-allowlist' });
  });
});

describe('installGuard (ruling 3: route, framenavigated and request guards)', () => {
  it('registers context.route(**/*), page.on(framenavigated) and context.on(request), once per context', async () => {
    const ctx = new FakeContext();
    const page = new FakePage(ctx);
    await installGuard(ctx, page, log);
    await installGuard(ctx, new FakePage(ctx), log);
    expect(ctx.routes.map((r) => r.url)).toEqual(['**/*']);
    expect(ctx.requestListeners).toHaveLength(1);
  });
  it('records a redirect chain through consent.google.com as hops (TS2-04)', async () => {
    const ctx = new FakeContext();
    const state = await installGuard(ctx, new FakePage(ctx), log);
    const first = req('https://www.google.com/travel/flights?q=x');
    const consent = req('https://consent.google.com/ml', { from: first });
    ctx.emitRequest(req('https://www.google.com/travel/flights/search', { from: consent }));
    expect(state.hops).toEqual([
      'https://www.google.com/travel/flights?q=x',
      'https://consent.google.com/ml',
      'https://www.google.com/travel/flights/search',
    ]);
  });
  it('ignores subresources, puts sub-frame navigations in frameUrls, and tolerates a frameless request', async () => {
    const ctx = new FakeContext();
    const page = new FakePage(ctx);
    const state = await installGuard(ctx, page, log);
    ctx.emitRequest(req('https://www.example.test/x.js', { nav: false }));
    ctx.emitRequest(req('https://www.google.com/recaptcha/api2/anchor', { frame: sub }));
    ctx.emitRequest(req('https://www.google.com/travel/flights', { noFrame: true }));
    ctx.emitRequest(req('https://www.google.com/travel/flights', { noFrame: true }));
    expect(state.hops).toEqual(['https://www.google.com/travel/flights']);
    expect(state.frameUrls).toEqual(['https://www.google.com/recaptcha/api2/anchor']);
  });
  it('framenavigated adds the main frame’s final URL as a hop and a sub-frame’s to frameUrls', async () => {
    const ctx = new FakeContext();
    const page = new FakePage(ctx, {
      hops: ['https://www.google.com/travel/flights?q=x'],
      frames: ['https://www.google.com/recaptcha/x'],
    });
    const state = await installGuard(ctx, page, log);
    await page.goto('https://www.google.com/travel/flights?q=x');
    expect(state.hops).toEqual(['https://www.google.com/travel/flights?q=x']);
    expect(state.frameUrls).toContain('https://www.google.com/recaptcha/x');
  });
  it('a sub-frame framenavigated goes to frameUrls, a repeated main-frame URL is one hop', async () => {
    const ctx = new FakeContext();
    const page = new FakePage(ctx);
    const state = await installGuard(ctx, page, log);
    page.emitFrameNavigated(sub);
    page.emitFrameNavigated(main);
    page.emitFrameNavigated(main);
    expect(state).toMatchObject({ hops: ['x'], frameUrls: ['y'] });
  });
  it('the route aborts an off-allowlist navigation with blockedbyclient, records the refusal and logs the host only', async () => {
    const ctx = new FakeContext();
    const page = new FakePage(ctx, { hops: ['https://www.example.test/?q=secret'] });
    const state = await installGuard(ctx, page, log);
    await expect(page.goto('https://www.example.test/?q=secret')).rejects.toThrow(/blockedbyclient/);
    expect(state.refused).toBe('off-allowlist');
    expect(JSON.stringify(logs)).not.toContain('secret');
    expect(logs.map((l) => l.o)).toEqual([{ kind: 'off-allowlist', host: 'www.example.test' }]);
  });
  it('the refusal keeps the first kind and the next page starts clean', async () => {
    const ctx = new FakeContext();
    const state = await installGuard(ctx, new FakePage(ctx), log);
    await ctx.routeRequest(req('https://consent.google.com/ml'));
    await ctx.routeRequest(req('https://accounts.google.com/'));
    await ctx.routeRequest(req('not a url'));
    expect(state.refused).toBe('consent-unhandled');
    const next = await installGuard(ctx, new FakePage(ctx), log);
    expect(next).toEqual({ hops: [], frameUrls: [], refused: null });
  });
  // why: fix round 1 (prov-int M6): a refused sub-frame never names the page; only a main-frame refusal does
  it('a refused sub-frame navigation is aborted but leaves refused null; a main-frame one sets it', async () => {
    const ctx = new FakeContext();
    const state = await installGuard(ctx, new FakePage(ctx), log);
    expect(await ctx.routeRequest(req('https://www.example.test/frame', { frame: sub }))).toBe('aborted');
    expect(state.refused).toBeNull();
    expect(await ctx.routeRequest(req('https://consent.google.com/ml'))).toBe('aborted');
    expect(state.refused).toBe('consent-unhandled');
  });
  it('a frameless navigation refusal counts as the main frame’s (fail closed)', async () => {
    const ctx = new FakeContext();
    const state = await installGuard(ctx, new FakePage(ctx), log);
    await ctx.routeRequest(req('https://www.example.test/', { noFrame: true }));
    expect(state.refused).toBe('off-allowlist');
  });
  it('the probe guard refuses a POST navigation to the consent host', async () => {
    const ctx = new FakeContext();
    const state = await installProbeGuard(ctx, new FakePage(ctx), log);
    expect(await ctx.routeRequest(req('https://consent.google.com/save', { method: 'POST' }))).toBe(
      'aborted',
    );
    expect(state.refused).toBe('consent-unhandled');
  });
  it('the probe guard admits the consent page', async () => {
    const ctx = new FakeContext();
    const page = new FakePage(ctx, { hops: ['https://consent.google.com/ml?continue=x'] });
    const state = await installProbeGuard(ctx, page, log);
    await page.goto('https://consent.google.com/ml?continue=x');
    expect(state.refused).toBeNull();
    expect(state.hops).toEqual(['https://consent.google.com/ml?continue=x']);
  });
});
