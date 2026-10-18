import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, asIsoDate, type PageRequest } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_COOKIE_NAMES } from '../src/accountCookies.js';
import { CooldownStore } from '../src/cooldown.js';
import { Pacer } from '../src/pacer.js';
import { Refusal } from '../src/refusal.js';
import { SELECTORS, type Selectors } from '../src/selectors.js';
import { PageSession } from '../src/session.js';
import { loadSocs } from '../src/socs.js';
import { FakeContext } from './support/fakeContext.js';
import { type FakeNode, formNodes, n, option, resultsTree, text } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { fakeTimers, flush } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const SOCS_VALUE = 'synthetic-socs-rejection-value';
const CAPTURE = {
  value: SOCS_VALUE,
  domain: '.google.com',
  path: '/',
  expires: 1_800_000_000,
  secure: true,
  sameSite: 'Lax',
  capturedAt: '2026-10-18T04:00:00.000Z',
};
const REQ: PageRequest = {
  mode: 'list',
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureDate: asIsoDate('2026-11-05'),
  returnDate: asIsoDate('2026-11-15'),
  gl: 'GB',
  airportNames: {
    origin: ['London Heathrow Airport'],
    destination: ['John F Kennedy International Airport'],
  },
};
const URL0 =
  'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2026-11-05+returning+2026-11-15&curr=GBP&hl=en-GB&gl=GB';
const LANDED = 'https://www.google.com/travel/flights/search?tfs=x';
const versions = { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' };

function setup(
  o: {
    tree?: FakeNode;
    trees?: FakeNode[];
    hops?: string[];
    selectors?: Selectors;
    shape?: (c: FakeContext) => void;
    /** Replaces the fake launch (fix round 1: a launch that never resolves). */
    launch?: () => Promise<FakeContext>;
  } = {},
) {
  const dataDir = tmpDir();
  writeFileSync(join(dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
  const profileDir = join(dataDir, 'profile');
  mkdirSync(profileDir);
  const timers = fakeTimers();
  const clock = timers.clock;
  const contexts: FakeContext[] = [];
  const cooldown = new CooldownStore({ dir: dataDir, challengeHours: 48, clock });
  const pacer = new Pacer({ dir: dataDir, minSpacingSeconds: 30, clock });
  const refusal = new Refusal({ dir: dataDir, clock });
  const launches = { count: 0 };
  const make = (): PageSession =>
    new PageSession({
      launch: async () => {
        launches.count++;
        if (o.launch !== undefined) return o.launch();
        const c = new FakeContext();
        c.navigations = [{ hops: o.hops ?? [URL0, LANDED], tree: o.tree ?? resultsTree() }];
        if (o.trees !== undefined)
          c.onNewPage = (p) => {
            const trees = o.trees ?? [];
            const original = p.goto.bind(p);
            p.goto = async (u, opts) => {
              const r = await original(u, opts);
              p.setTrees(trees);
              return r;
            };
          };
        o.shape?.(c);
        contexts.push(c);
        mkdirSync(profileDir, { recursive: true });
        return c;
      },
      profileDir,
      socs: loadSocs(dataDir, clock),
      cooldown,
      pacer,
      refusal,
      clock,
      timers,
      selectors: o.selectors ?? SELECTORS,
      pageTimeoutMs: 90_000,
      log: memoryLog(),
      versions,
    });
  return {
    dataDir,
    profileDir,
    timers,
    clock,
    contexts,
    cooldown,
    pacer,
    refusal,
    launches,
    session: make(),
    make,
  };
}
type Setup = ReturnType<typeof setup>;
/** The pacer was released: a claim after the spacing succeeds. */
function released(t: Setup): boolean {
  t.clock.advance(30_000);
  const c = t.pacer.claim();
  t.pacer.release();
  return c.ok;
}
const ctx0 = (t: Setup): FakeContext => {
  const c = t.contexts[0];
  if (c === undefined) throw new Error('no context launched');
  return c;
};
const page0 = (t: Setup) => {
  const p = ctx0(t).pages[0];
  if (p === undefined) throw new Error('no page opened');
  return p;
};
const changeSocs = (c: FakeContext) => {
  c.afterGoto = (jar) => jar.map((x) => (x.name === 'SOCS' ? { ...x, value: 'an-accept-value' } : x));
};

beforeEach(() => {
  expect.hasAssertions();
});

// Fake times below include the one extra 2 s poll a page needs to show stable links (ruling of 2026-10-18).
describe('PageSession (spec §2; brief Task 14.4)', () => {
  it('settled results → cells; SOCS set before goto; the read-back ran; pacer released; page closed', async () => {
    const t = setup();
    const r = await t.session.page(REQ);
    expect(r).toEqual({
      answer: {
        kind: 'cells',
        fetchedAt: '2026-10-18T05:00:02.000Z',
        currency: 'GBP',
        pointOfSale: 'GB',
        notes: [],
        versions,
        cell: {
          status: 'price',
          amountMinor: 45100,
          tabMinor: 45100,
          optionsUnparsed: 0,
          optionsOtherCell: 0,
          returnDateFrom: 'query-and-form',
        },
      },
      googleContacted: true,
    });
    const c = ctx0(t);
    expect(c.added).toEqual([
      [
        {
          name: 'SOCS',
          value: SOCS_VALUE,
          domain: '.google.com',
          path: '/',
          expires: 1_800_000_000,
          secure: true,
          sameSite: 'Lax',
          httpOnly: false,
        },
      ],
    ]);
    expect(c.cookieCalls).toHaveLength(2);
    expect(page0(t).calls.gotos[0]?.url).toBe(URL0);
    expect(page0(t).calls.closed).toBe(1);
    expect(page0(t).calls.clicks).toEqual([]);
    expect(released(t)).toBe(true);
  });
  it('two pages in a row, each preceded by addCookies with SOCS', async () => {
    const t = setup();
    expect((await t.session.page(REQ)).answer.kind).toBe('cells');
    t.clock.advance(30_000);
    expect((await t.session.page(REQ)).answer.kind).toBe('cells');
    expect(ctx0(t).added).toHaveLength(2);
    expect(t.contexts).toHaveLength(1);
  });
  it.each([false, true])(
    'SOCS changed after a settled page → consent-unhandled, profile wiped (SOCS_STABLE %s)',
    async (stable) => {
      const t = setup({ selectors: { ...SELECTORS, SOCS_STABLE: stable }, shape: changeSocs });
      const r = await t.session.page(REQ);
      expect(r.answer).toEqual({
        kind: 'blocked',
        page: 'consent-unhandled',
        cooldownUntil: '2026-10-20T05:00:02.000Z',
      });
      expect(r.googleContacted).toBe(true);
      expect(existsSync(t.profileDir)).toBe(false);
      expect(ctx0(t).closed).toBe(1);
      expect(released(t)).toBe(true);
    },
  );
  it('SOCS missing after a settled page → consent-unhandled', async () => {
    const t = setup({ shape: (c) => (c.afterGoto = (jar) => jar.filter((x) => x.name !== 'SOCS')) });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'consent-unhandled' });
  });
  it('a CAPTCHA frame, and SOCS changed on the same page → captcha kept, cool-down cause captcha, profile wiped', async () => {
    const t = setup({
      shape: (c) => {
        changeSocs(c);
        c.navigations = [
          {
            hops: [URL0, LANDED],
            tree: resultsTree(),
            frames: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
          },
        ];
      },
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toEqual({ kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' });
    expect(t.cooldown.active()?.cause).toBe('captcha');
    expect(existsSync(t.profileDir)).toBe(false);
  });
  it('an unrecognised page with SOCS changed keeps unrecognised for the longer, 48 h period', async () => {
    const t = setup({ tree: resultsTree({ form: formNodes({ trip: 'One way' }) }), shape: changeSocs });
    expect((await t.session.page(REQ)).answer).toEqual({
      kind: 'blocked',
      page: 'unrecognised',
      cooldownUntil: '2026-10-20T05:00:02.000Z',
    });
    expect(t.cooldown.active()?.cause).toBe('unrecognised');
  });
  it('a consent hop (302) to consent.google.com ending on results → consent-unhandled, nothing clicked', async () => {
    const t = setup({ hops: [URL0, 'https://consent.google.com/ml?continue=x', LANDED] });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'consent-unhandled' });
    expect(page0(t).calls.clicks).toEqual([]);
    expect(existsSync(t.profileDir)).toBe(false);
  });
  it('an accounts.google.com hop → sign-in', async () => {
    const t = setup({ hops: [URL0, 'https://accounts.google.com/ServiceLogin'] });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'sign-in' });
  });
  it('a navigation the route aborts is that page’s kind, Google contacted, read-back run', async () => {
    const t = setup({ hops: ['https://www.example.test/'] });
    const r = await t.session.page({ ...REQ });
    expect(r).toMatchObject({ answer: { kind: 'blocked', page: 'off-allowlist' }, googleContacted: true });
    expect(ctx0(t).cookieCalls).toHaveLength(2);
  });
  it('a signed-in control → signed-in, refusal persisted; a new session over the same directory answers cooling-down without opening', async () => {
    const t = setup({ tree: resultsTree({ extra: [n('button', 'Google Account: Example Person')] }) });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'signed-in' });
    expect(t.refusal.active()?.reason).toMatch(/signed-in/);
    const again = t.make();
    t.clock.advance(49 * 3_600_000);
    const r = await again.page(REQ);
    expect(r.answer).toMatchObject({ kind: 'cooling-down', cause: 'signed-in' });
    expect(r.googleContacted).toBe(false);
    expect(t.contexts).toHaveLength(1);
  });
  it.each([...ACCOUNT_COOKIE_NAMES])(
    'the account cookie %s before the page → signed-in, nothing opened',
    async (name) => {
      const t = setup({ shape: (c) => c.jar.push({ name, value: 'x', domain: '.google.com', path: '/' }) });
      const r = await t.session.page(REQ);
      expect(r).toMatchObject({ answer: { kind: 'blocked', page: 'signed-in' }, googleContacted: false });
      expect(ctx0(t).pages).toEqual([]);
      expect(t.refusal.active()).not.toBeNull();
    },
  );
  it('facts never settling → not-ready at the fake deadline, no cool-down, pacer released', async () => {
    const t = setup({ tree: n('document', '', [text('Fetching results')]) });
    const r = await t.session.page(REQ);
    expect(r).toEqual({ answer: { kind: 'not-ready', elapsedMs: 90_000 }, googleContacted: true });
    expect(t.cooldown.active()).toBeNull();
    expect(released(t)).toBe(true);
  });
  it('settles after polling', async () => {
    const t = setup({ trees: [n('document', '', [text('Fetching results')]), resultsTree()] });
    expect((await t.session.page(REQ)).answer.kind).toBe('cells');
    expect(t.timers.sleeps).toContain(2000);
  });
  it('a form mismatch → unrecognised, 1 h', async () => {
    const t = setup({ tree: resultsTree({ form: formNodes({ dep: 'Fri, 6 Nov' }) }) });
    expect((await t.session.page(REQ)).answer).toEqual({
      kind: 'blocked',
      page: 'unrecognised',
      cooldownUntil: '2026-10-18T06:00:02.000Z',
    });
  });
  it('an absent form → unrecognised', async () => {
    const t = setup({ tree: resultsTree({ form: [] }) });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'unrecognised' });
  });
  it('another currency → unrecognised; only another cell’s option → none-for-cell', async () => {
    const a = setup({
      tree: resultsTree({
        extra: [],
        top: [option(478)],
        other: [option(300, { on: 'Friday, November 6' })],
      }),
    });
    expect((await a.session.page(REQ)).answer.kind).toBe('cells');
    // why: fix round 1 (prov I1): only another cell's option is a cell issue (none-for-cell), never a block
    const b = setup({ tree: resultsTree({ top: [option(300, { on: 'Friday, November 6' })], other: [] }) });
    expect((await b.session.page(REQ)).answer).toMatchObject({
      kind: 'cells',
      cell: { status: 'none-for-cell' },
    });
    const tree = resultsTree();
    tree.children = (tree.children ?? []).map((c) =>
      c.name === 'Currency GBP' ? n('button', 'Currency USD') : c,
    );
    const c = setup({ tree });
    expect((await c.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'unrecognised' });
  });
  it('a no-flights page, once verified, is cells no-flights', async () => {
    const t = setup({
      tree: n('document', '', [text('No results returned for this search')]),
      selectors: { ...SELECTORS, NO_FLIGHTS_VERIFIED: true },
    });
    expect((await t.session.page(REQ)).answer).toMatchObject({
      kind: 'cells',
      cell: { status: 'no-flights' },
    });
  });
  it('addCookies throws → browser-error launch, Google not contacted', async () => {
    const t = setup({ shape: (c) => (c.addCookiesThrows = true) });
    expect(await t.session.page(REQ)).toEqual({
      answer: { kind: 'browser-error', stage: 'launch', detail: 'addCookies failed' },
      googleContacted: false,
    });
    expect(released(t)).toBe(true);
  });
  it('newPage throws → browser-error launch', async () => {
    const t = setup({ shape: (c) => (c.newPageThrows = true) });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'browser-error', stage: 'launch' });
  });
  it('goto throws → browser-error navigate, Google contacted, read-back ran', async () => {
    const t = setup({
      shape: (c) =>
        (c.navigations = [
          { hops: [URL0], throws: 'NS_ERROR_NET_RESET at https://www.google.com/x?secret=1' },
        ]),
    });
    const r = await t.session.page(REQ);
    expect(r).toMatchObject({ answer: { kind: 'browser-error', stage: 'navigate' }, googleContacted: true });
    expect(JSON.stringify(r)).not.toContain('secret=1');
    expect(ctx0(t).cookieCalls).toHaveLength(2);
  });
  it('readFacts throws after navigation → browser-error read, read-back ran', async () => {
    const t = setup({
      shape: (c) =>
        (c.onNewPage = (p) => {
          p.url = () => {
            throw new Error('page crashed');
          };
        }),
    });
    expect((await t.session.page(REQ)).answer).toEqual({
      kind: 'browser-error',
      stage: 'read',
      detail: 'page crashed',
    });
    expect(ctx0(t).cookieCalls).toHaveLength(2);
  });
  it('a never-resolving readFacts → not-ready, and nothing goes unhandled after the page closes', async () => {
    const spy = vi.fn();
    process.on('unhandledRejection', spy);
    try {
      const t = setup({
        shape: (c) => {
          const original = c.newPage.bind(c);
          c.newPage = async () => {
            const p = await original();
            const g = p.goto.bind(p);
            p.goto = async (u, o) => {
              const r = await g(u, o);
              if ('hangAll' in p) p.hangAll = true;
              return r;
            };
            return p;
          };
        },
      });
      const pending = t.session.page(REQ);
      for (let i = 0; i < 5; i++) await flush();
      t.timers.runOut();
      const r = await pending;
      expect(r.answer.kind).toBe('not-ready');
      for (let i = 0; i < 3; i++) await flush();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', spy);
    }
  });
  it('a never-resolving read-back cookies() in the finally → bounded at 5 s, context discarded, browser-error read', async () => {
    const t = setup({ shape: (c) => (c.hangCookiesOn = 1) });
    const before = t.timers.now();
    const r = await t.session.page(REQ);
    expect(r.answer).toEqual({ kind: 'browser-error', stage: 'read', detail: 'SOCS read-back overran' });
    // why: fix round 1 (TS M1): the bound is exactly 5 s of fake time, not merely at least that
    // the 2 s stability poll (ruling of 2026-10-18), then exactly the 5 s bound
    expect(t.timers.now() - before).toBe(2000 + 5000);
    expect(ctx0(t).closed).toBe(1);
    t.clock.advance(30_000);
    await t.session.page(REQ);
    expect(t.contexts).toHaveLength(2);
  });
  it('a page close that never resolves discards the context and replaces cells with browser-error read', async () => {
    const t = setup({ shape: (c) => (c.onNewPage = (p) => (p.closeHangs = true)) });
    expect((await t.session.page(REQ)).answer).toEqual({
      kind: 'browser-error',
      stage: 'read',
      detail: 'page close overran',
    });
    // why: fix round 1 (TS I4): the context really is discarded, and the next page relaunches
    expect(ctx0(t).closed).toBe(1);
    t.clock.advance(30_000);
    await t.session.page(REQ);
    expect(t.contexts).toHaveLength(2);
  });
  it('close() throws after a block → the block answer stands, pacer released', async () => {
    const t = setup({
      hops: [URL0, 'https://accounts.google.com/x'],
      shape: (c) => (c.onNewPage = (p) => (p.closeThrows = true)),
    });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'sign-in' });
    expect(released(t)).toBe(true);
  });
  it('the cool-down store throws on read → browser-error read, fatal', async () => {
    const t = setup();
    mkdirSync(join(t.dataDir, 'cooldown.json'));
    expect(await t.session.page(REQ)).toEqual({
      answer: {
        kind: 'browser-error',
        stage: 'read',
        detail: expect.stringMatching(/cool-down store unreadable/),
      },
      googleContacted: false,
      fatal: true,
    });
  });
  it('mode grid → mode-unavailable, nothing opened; GRID_VERIFIED is false', async () => {
    const t = setup();
    expect(await t.session.page({ ...REQ, mode: 'grid' })).toEqual({
      answer: { kind: 'mode-unavailable', mode: 'grid' },
      googleContacted: false,
    });
    expect(t.contexts).toEqual([]);
    expect(SELECTORS.GRID_VERIFIED).toBe(false);
  });
  it('a request inside the spacing → spacing, nothing opened', async () => {
    const t = setup();
    await t.session.page(REQ);
    t.clock.advance(5000);
    expect(await t.session.page(REQ)).toEqual({
      answer: { kind: 'spacing', retryAfterSeconds: 21 },
      googleContacted: false,
    });
    expect(ctx0(t).pages).toHaveLength(1);
  });
  it('an active cool-down → cooling-down, nothing opened', async () => {
    const t = setup();
    t.cooldown.start('captcha');
    expect(await t.session.page(REQ)).toEqual({
      answer: { kind: 'cooling-down', cause: 'captcha', cooldownUntil: '2026-10-20T05:00:00.000Z' },
      googleContacted: false,
    });
    expect(t.contexts).toEqual([]);
  });
  it('with CHEAPEST_FLOW_VERIFIED injected true the Cheapest tab is clicked once; false, nothing is clicked', async () => {
    const on = setup({ selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true } });
    expect((await on.session.page(REQ)).answer.kind).toBe('cells');
    expect(page0(on).calls.clicks).toEqual(['tab:Cheapest from 451 British pounds']);
    const off = setup();
    await off.session.page(REQ);
    expect(page0(off).calls.clicks).toEqual([]);
  });
  it('a page that turns into a block after a verified click is that block', async () => {
    const t = setup({
      selectors: { ...SELECTORS, VIEW_MORE_ADDS_CHEAPER: true },
      shape: (c) =>
        (c.onNewPage = (p) => {
          p.onClick = () =>
            p.setTrees([n('document', '', [text('Our systems have detected unusual traffic')])]);
        }),
    });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'unusual-traffic' });
    expect(page0(t).calls.clicks).toEqual(['button:View more flights']);
  });
  it('busy() names the page in flight', async () => {
    const t = setup();
    expect(t.session.busy()).toBeNull();
    const p = t.session.page(REQ);
    expect(t.session.busy()).toBe('2026-10-18T05:00:00.000Z');
    await p;
    expect(t.session.busy()).toBeNull();
  });

  // why: fix round 1 (prov-int I1): every call before the page opens races the page deadline; a hang never wedges the
  // worker, and the context is discarded so the next page relaunches
  it.each([
    ['addCookies', (c: FakeContext) => (c.addCookiesHangs = true)],
    ['the account-cookie read', (c: FakeContext) => (c.hangCookiesOn = 0)],
    ['newPage', (c: FakeContext) => (c.newPageHangs = true)],
    ['the guard’s route registration', (c: FakeContext) => (c.routeHangs = true)],
  ])(
    'a never-resolving %s → not-ready at the deadline, Google not contacted, pacer released, relaunched next',
    async (_n, hang) => {
      let first = true;
      const t = setup({
        shape: (c) => {
          if (first) hang(c);
          first = false;
        },
      });
      const pending = t.session.page(REQ);
      for (let i = 0; i < 5; i++) await flush();
      t.timers.runOut();
      const r = await pending;
      expect(r).toEqual({ answer: { kind: 'not-ready', elapsedMs: 90_000 }, googleContacted: false });
      expect(ctx0(t).closed).toBe(1);
      expect(released(t)).toBe(true);
      t.clock.advance(30_000);
      expect((await t.session.page(REQ)).answer.kind).toBe('cells');
      expect(t.contexts).toHaveLength(2);
    },
  );
  it('a never-resolving launch → not-ready at the deadline, pacer released', async () => {
    const t = setup({ launch: () => new Promise(() => undefined) });
    const pending = t.session.page(REQ);
    for (let i = 0; i < 5; i++) await flush();
    t.timers.runOut();
    expect((await pending).answer.kind).toBe('not-ready');
    expect(released(t)).toBe(true);
  });
  it('an error before goto discards the context (the next page relaunches)', async () => {
    let first = true;
    const t = setup({
      shape: (c) => {
        if (first) c.newPageThrows = true;
        first = false;
      },
    });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'browser-error', stage: 'launch' });
    t.clock.advance(30_000);
    expect((await t.session.page(REQ)).answer.kind).toBe('cells');
    expect(t.contexts).toHaveLength(2);
  });
  // why: fix round 1 (prov-int M7): one launch however many callers arrive together
  it('currentContext is memoised on the launch promise: two concurrent callers launch once', async () => {
    const t = setup();
    const [a, b] = await Promise.all([t.session.currentContext(), t.session.currentContext()]);
    expect(a).toBe(b);
    expect(t.launches.count).toBe(1);
  });
  // why: fix round 1 (TS I3): a block whose read-back then hangs keeps its cool-down
  it('a captcha page whose SOCS read-back hangs → captcha, 48 h, context discarded', async () => {
    const t = setup({
      shape: (c) => {
        c.hangCookiesOn = 1;
        c.navigations = [
          {
            hops: [URL0, LANDED],
            tree: resultsTree(),
            frames: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
          },
        ];
      },
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toEqual({ kind: 'blocked', page: 'captcha', cooldownUntil: '2026-10-20T05:00:05.000Z' });
    expect(t.cooldown.active()?.cause).toBe('captcha');
    expect(ctx0(t).closed).toBe(1);
  });
  // why: fix round 1 (TS M2): the deadline itself closes the page, before the finally's close
  it('at expiry the page is closed by the deadline (before the finally runs)', async () => {
    const t = setup({ tree: n('document', '', [text('Fetching results')]) });
    let closedAtExpiry = -1;
    const pending = t.session.page(REQ);
    for (let i = 0; i < 5; i++) await flush();
    const p = page0(t);
    const fire = t.timers.runOut.bind(t.timers);
    fire();
    closedAtExpiry = p.calls.closed;
    await pending;
    expect(closedAtExpiry).toBeGreaterThanOrEqual(1);
  });
  // why: fix round 1 (TS M3): clear-signed-in owns the wipe of a signed-in profile; the page never wipes it
  it('a signed-in stop leaves the profile directory in place', async () => {
    const t = setup({ tree: resultsTree({ extra: [n('button', 'Google Account: Example Person')] }) });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'signed-in' });
    expect(existsSync(t.profileDir)).toBe(true);
  });
  // why: fix round 1 (prov I1): every option for another cell is a cell issue, never a block
  it('every option for another cell → cells none-for-cell with the counts, no cool-down', async () => {
    const t = setup({
      tree: resultsTree({
        top: [option(300, { on: 'Friday, November 6' })],
        other: [option(310, { on: 'Friday, November 6' })],
      }),
    });
    expect((await t.session.page(REQ)).answer).toMatchObject({
      kind: 'cells',
      pointOfSale: 'GB',
      cell: { status: 'none-for-cell', optionsOtherCell: 2, optionsUnparsed: 0 },
    });
    expect(t.cooldown.active()).toBeNull();
  });
});
