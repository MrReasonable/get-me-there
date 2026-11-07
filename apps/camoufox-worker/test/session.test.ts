import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANSWER_STATUS,
  asIata,
  asIsoDate,
  type FlightsRequest,
  flagsFor,
  type PageRequest,
  workerAnswerSchema,
  workerRuleSchema,
} from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_COOKIE_NAMES } from '../src/accountCookies.js';
import { CooldownStore } from '../src/cooldown.js';
import { Pacer } from '../src/pacer.js';
import { POLL_MS, STABLE_MS } from '../src/ready.js';
import { Refusal } from '../src/refusal.js';
import { SELECTORS, type Selectors, selectorsFor } from '../src/selectors.js';
import { PageSession } from '../src/session.js';
import { PageSlots } from '../src/slots.js';
import { loadSocs } from '../src/socs.js';
import { FakeContext } from './support/fakeContext.js';
import { descendants, type FakeNode, formNodes, n, option, resultsTree, text } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { SYNTHETIC_ACCEPT, SYNTHETIC_REJECT } from './support/socsValues.js';
import { fakeTimers, flush, T0 } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const SOCS_VALUE = SYNTHETIC_REJECT;
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
    otherOrigins: [],
    otherDestinations: [],
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
    /** The session's log (fix round: the Cheapest step lines). */
    log?: ReturnType<typeof memoryLog>;
    /** Replaces the fake launch (fix round 1: a launch that never resolves). */
    launch?: () => Promise<FakeContext>;
    pollMs?: number;
    /** The capture's value, in place of the stored one (review X1: a value that is not a rejection). */
    socsValue?: string;
    /** The pacer's spacing (default 30 s) and capacity (default 1: CAMOUFOX_PAGES_AT_ONCE). */
    spacing?: number;
    capacity?: number;
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
  const pacer = new Pacer({
    dir: dataDir,
    minSpacingSeconds: o.spacing ?? 30,
    clock,
    ...(o.capacity === undefined ? {} : { capacity: o.capacity }),
  });
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
      socs: { ...loadSocs(dataDir, clock), ...(o.socsValue === undefined ? {} : { value: o.socsValue }) },
      cooldown,
      pacer,
      refusal,
      clock,
      timers,
      // why: a Best-only baseline (the module's verified Cheapest flow off) so each test states the flows it exercises
      selectors: o.selectors ?? { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: false },
      pageTimeoutMs: 90_000,
      log: o.log ?? memoryLog(),
      versions,
      ...(o.pollMs === undefined ? {} : { pollMs: o.pollMs }),
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

// Fake times below include the polls a page needs to show stable links: at the default POLL_MS (500 ms) the third poll
// is the first STABLE_MS (1 s) after the first (ruling of 2026-10-18).
describe('PageSession (spec §2; brief Task 14.4)', () => {
  it('settled results → cells; SOCS set before goto; the read-back ran; pacer released; page closed', async () => {
    const t = setup();
    const r = await t.session.page(REQ);
    expect(r).toEqual({
      answer: {
        kind: 'cells',
        fetchedAt: '2026-10-18T05:00:01.000Z',
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
  it('a Best view settles at a short poll interval, on two matching polls at least STABLE_MS apart (fix round 1, TS 8)', async () => {
    const log = memoryLog();
    const t = setup({ pollMs: 250, log });
    const r = await t.session.page(REQ);
    expect(r.answer.kind).toBe('cells');
    const polls = log.lines.filter((l) => l.msg === 'settle poll').map((l) => l.o);
    const get = (o: object | undefined, k: string): unknown =>
      o === undefined ? undefined : Reflect.get(o, k);
    expect(get(polls.at(-1), 'stable')).toBe(true);
    expect(
      Number(get(polls.at(-1), 'elapsedMs')) - Number(get(polls.at(-5), 'elapsedMs')),
    ).toBeGreaterThanOrEqual(STABLE_MS);
  });
  // why: review X1: every page's consent check reads the value's own mark, so an Accept all cookie is never applied
  it('a capture whose value is not a rejection sets no cookie and loads no page: a browser error before Google', async () => {
    for (const socsValue of [SYNTHETIC_ACCEPT, 'not-a-socs-value']) {
      const t = setup({ socsValue });
      const r = await t.session.page(REQ);
      expect(r.googleContacted).toBe(false);
      expect(r.answer).toMatchObject({ kind: 'browser-error', stage: 'launch' });
      const c = ctx0(t);
      expect(c.added).toEqual([]);
      expect(c.pages.flatMap((p) => p.calls.gotos)).toEqual([]);
      expect(released(t)).toBe(true);
    }
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
      const t = setup({
        selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: false, SOCS_STABLE: stable },
        shape: changeSocs,
      });
      const r = await t.session.page(REQ);
      expect(r.answer).toEqual({
        kind: 'blocked',
        page: 'consent-unhandled',
        cooldownUntil: '2026-10-20T05:00:01.000Z',
        rule: 'socs-read-back',
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
    expect(r.answer).toEqual({
      kind: 'blocked',
      page: 'captcha',
      cooldownUntil: '2026-10-20T05:00:00.000Z',
      rule: 'captcha-frame',
    });
    expect(t.cooldown.active()?.cause).toBe('captcha');
    expect(existsSync(t.profileDir)).toBe(false);
  });
  it('an unrecognised page with SOCS changed keeps unrecognised for the longer, 48 h period', async () => {
    const t = setup({ tree: resultsTree({ form: formNodes({ trip: 'One way' }) }), shape: changeSocs });
    expect((await t.session.page(REQ)).answer).toEqual({
      kind: 'blocked',
      page: 'unrecognised',
      cooldownUntil: '2026-10-20T05:00:01.000Z',
      rule: 'search-form:mismatch',
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
    expect(t.timers.sleeps).toContain(POLL_MS);
  });
  it('a form mismatch → unrecognised, 1 h', async () => {
    const t = setup({ tree: resultsTree({ form: formNodes({ dep: 'Fri, 6 Nov' }) }) });
    expect((await t.session.page(REQ)).answer).toEqual({
      kind: 'blocked',
      page: 'unrecognised',
      cooldownUntil: '2026-10-18T06:00:01.000Z',
      rule: 'search-form:mismatch',
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
    // the polls that show the links stable for STABLE_MS (ruling of 2026-10-18), then exactly the 5 s bound
    expect(t.timers.now() - before).toBe(STABLE_MS + 5000);
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
  // why: decision 70: grid pages need CAMOUFOX_MODE=grid as well as the verified flag (gridPage.test.ts has the flow)
  it('mode grid without the worker’s grid settings → mode-unavailable, nothing opened', async () => {
    const t = setup();
    const grid: PageRequest = {
      mode: 'grid',
      origin: REQ.origin,
      destination: REQ.destination,
      gl: 'GB',
      start: { departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2026-11-15') },
      moves: [],
      reads: [true],
      scrollAllowance: 0,
    };
    expect(await t.session.page(grid)).toEqual({
      answer: { kind: 'mode-unavailable', mode: 'grid' },
      googleContacted: false,
    });
    expect(t.contexts).toEqual([]);
    expect(SELECTORS.GRID_VERIFIED).toBe(true);
  });
  it('a request inside the spacing → spacing, nothing opened', async () => {
    const t = setup();
    await t.session.page(REQ);
    t.clock.advance(5000);
    expect(await t.session.page(REQ)).toEqual({
      answer: { kind: 'spacing', retryAfterSeconds: 22 },
      googleContacted: false,
    });
    expect(ctx0(t).pages).toHaveLength(1);
  });
  // why: final review A-I1: a request that arrives while a page is in flight waits for that page's whole cap and its
  // bounded close (two finally bounds), never only the spacing, so the app's retry does not spend its attempts early
  it('a request while a page is in flight → spacing for the rest of that page’s cap and its close', async () => {
    const t = setup();
    const first = t.session.page(REQ);
    expect(await t.session.page(REQ)).toEqual({
      answer: { kind: 'spacing', retryAfterSeconds: 190 },
      googleContacted: false,
    });
    await first;
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
  // why: spec rev 64: the worker keeps no monthly count: a page loads beside an earlier worker's counts file and leaves
  // it as it is
  it('a page loads beside an earlier worker’s counts file, which it never reads or writes', async () => {
    const t = setup();
    writeFileSync(join(t.dataDir, 'pacer.json'), '{"lastPageAt":"2026-10-18T03:00:00.000Z"}', {
      mode: 0o600,
    });
    writeFileSync(join(t.dataDir, 'monthly.json'), 'garbled', { mode: 0o600 });
    expect((await t.session.page(REQ)).answer.kind).toBe('cells');
    expect(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8')).toBe('garbled');
  });
  // why: decision 75 (Task 17.2): a partly verified entry runs on exactly its own flags, through selectorsFor
  it('linux-arm64 with only the form and results verified: no grid page, no no_data from a no-flights page, no Cheapest click', async () => {
    const partial = selectorsFor('linux-arm64', '152.0.4-beta.28', () => ({
      ...flagsFor('darwin-arm64', '152.0.4-beta.28'),
      GRID_VERIFIED: false,
      NO_FLIGHTS_VERIFIED: false,
      CHEAPEST_FLOW_VERIFIED: false,
    }));
    const grid = setup({ selectors: partial });
    const g = await grid.session.page({
      mode: 'grid',
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      gl: 'GB',
      start: { departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2026-11-15') },
      moves: [],
      reads: [true],
      scrollAllowance: 0,
    });
    expect([g.answer, g.googleContacted, ANSWER_STATUS[g.answer.kind]]).toEqual([
      { kind: 'mode-unavailable', mode: 'grid' },
      false,
      409,
    ]);
    const none = setup({
      selectors: partial,
      tree: n('document', '', [text('No results returned for this search')]),
    });
    // why: with the line unverified the page never reads as settled: not-ready, never a `no-flights` cell (no_data)
    expect((await none.session.page(REQ)).answer).toMatchObject({ kind: 'not-ready' });
    const results = setup({ selectors: partial });
    expect((await results.session.page(REQ)).answer.kind).toBe('cells');
    expect(page0(results).calls.clicks).toEqual([]);
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
      selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: false, VIEW_MORE_ADDS_CHEAPER: true },
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
    expect(r.answer).toEqual({
      kind: 'blocked',
      page: 'captcha',
      cooldownUntil: '2026-10-20T05:00:05.000Z',
      rule: 'captcha-frame',
    });
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

  // why: ruling of 2026-10-18 (the honesty rule): when the Cheapest flow cannot be read, the page's own list is read
  // and the tab's lower price travels to the adapter, which marks the cell partial
  it('a Cheapest tab that cannot be clicked: the list is still read, with the tab price, never a block', async () => {
    const t = setup({
      tree: resultsTree({ tab: 'Cheapest from £443' }),
      selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true },
      shape: (c) => {
        c.onNewPage = (p) => {
          p.onClick = () => {
            throw Object.assign(new Error('locator.click: Timeout'), { name: 'TimeoutError' });
          };
        };
      },
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({
      kind: 'cells',
      cell: { status: 'price', amountMinor: 45100, tabMinor: 44300 },
    });
    expect(t.cooldown.active()).toBeNull();
  });
  it('with the Cheapest flow verified, the tab’s pop-up is closed and the tab clicked', async () => {
    const POP = 'Cheapest from £443 Close dialogue Looking for the lowest fares?';
    const tree = resultsTree({ tab: POP });
    for (const c of descendants([tree]))
      if (c.role === 'tab' && c.name === POP) c.children = [n('button', 'Close dialogue')];
    const t = setup({ tree, selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true } });
    expect((await t.session.page(REQ)).answer.kind).toBe('cells');
    expect(page0(t).calls.clicks).toEqual(['button:Close dialogue', `tab:${POP}`]);
  });

  // why: ruling of 2026-10-18 (the Cheapest flow): after the click the Cheapest view gets its own settle budget,
  // CAMOUFOX_PAGE_TIMEOUT_SECONDS again from the click, within an overall cap of twice that
  const fetching = n('document', '', [text('Fetching results')]);
  const loadingWithTab = () =>
    n('document', '', [
      n('tablist', '', [n('tab', 'Cheapest from £443', [], { selected: true })]),
      text('Fetching results'),
    ]);
  const cheapestView = () => {
    const t = resultsTree({ tab: 'Cheapest from £443' });
    for (const c of descendants([t]))
      if (c.role === 'tab' && c.name === 'Cheapest from £443') c.selected = true;
    // the Cheapest view shows no "N results returned." line
    t.children = (t.children ?? []).filter((c) => !/results returned/.test(c.name ?? ''));
    return t;
  };
  // why: these budgets count polls 2 s apart, so the flow pins that interval (two such polls are STABLE_MS apart)
  const flow = (firstPolls: number, cheapestPolls: number) =>
    setup({
      pollMs: 2000,
      selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true },
      shape: (c) => {
        c.onNewPage = (p) => {
          const g = p.goto.bind(p);
          p.goto = async (u, o) => {
            const r = await g(u, o);
            p.setTrees([...Array(firstPolls).fill(fetching), resultsTree({ tab: 'Cheapest from £443' })]);
            return r;
          };
          p.onClick = (x) => {
            // why: as in the browser, the selected tab stays while the Cheapest view loads
            if (x.role === 'tab')
              p.setTrees([...Array(cheapestPolls).fill(loadingWithTab()), cheapestView()]);
          };
        };
      },
    });
  it('the Cheapest view settles without the results line, on its own budget from the click', async () => {
    // 41 fetching polls (82 s), then the first view settles (84 s); after the click 10 more polls (20 s): over the old
    // single 90 s deadline, within the click's own 90 s
    const t = flow(41, 10);
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({ kind: 'cells', cell: { status: 'price' } });
    expect(page0(t).calls.clicks).toEqual(['tab:Cheapest from £443']);
  });
  it('the overall cap holds: a Cheapest view that never settles ends not-ready within twice the page timeout', async () => {
    const t = flow(41, 1000);
    const r = await t.session.page(REQ);
    expect(r.answer.kind).toBe('not-ready');
    const elapsed = r.answer.kind === 'not-ready' ? r.answer.elapsedMs : -1;
    expect(elapsed).toBeGreaterThan(90_000);
    expect(elapsed).toBeLessThanOrEqual(180_000);
    // why: ruling of 2026-10-18: Cheapest polling ends when only the fallback's reserve is left of the click's 90 s
    // budget; with no list to read the page is not-ready (never unrecognised, never a cool-down)
    expect(elapsed).toBeGreaterThan(84_000 + 90_000 - 20_000 - 5000);
    expect(t.cooldown.active()).toBeNull();
  });

  // why: ruling of 2026-10-18 (the hung rerun): a Cheapest click that never answers is its own 10 s step; the page
  // falls back to the Best view, and the tab's price goes with it (the adapter marks the cell partial)
  it('a Cheapest click that never resolves falls back to the Best view with the tab price, within seconds', async () => {
    const tree = resultsTree({ tab: 'Cheapest from £443' });
    for (const c of descendants([tree]))
      if (c.role === 'tab' && c.name === 'Cheapest from £443') c.clickHang = true;
    const t = setup({ tree, selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true } });
    const before = t.timers.now();
    const pending = t.session.page(REQ);
    for (let i = 0; i < 10; i++) await flush();
    // only the click's own 10 s step bound is pending; it fires first
    t.timers.runOut();
    const r = await pending;
    expect(r.answer).toMatchObject({ kind: 'cells', cell: { status: 'price', tabMinor: 44300 } });
    expect(t.timers.now() - before).toBeLessThan(30_000);
  });
  it('the Cheapest steps and the first Cheapest poll log in order', async () => {
    const lines = memoryLog();
    const t = setup({ selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true }, log: lines });
    expect((await t.session.page(REQ)).answer.kind).toBe('cells');
    expect(
      lines.lines
        .filter((l) => l.msg === 'cheapest step')
        .map((l) => `${String(Reflect.get(l.o, 'step'))}:${String(Reflect.get(l.o, 'phase'))}`),
    ).toEqual([
      'find-popup:start',
      'find-popup:end',
      'find-tab:start',
      'find-tab:end',
      'click-tab:start',
      'click-tab:end',
      'confirm-selected:start',
      'confirm-selected:end',
      // each Cheapest poll is its own bounded step (three polls POLL_MS apart show the links stable for STABLE_MS)
      'cheapest-poll:start',
      'cheapest-poll:end',
      'cheapest-poll:start',
      'cheapest-poll:end',
      'cheapest-poll:start',
      'cheapest-poll:end',
    ]);
  });

  it('a Cheapest click that lands on a challenge page stops with its cool-down, never a fallback', async () => {
    const t = setup({
      selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true },
      shape: (c) => {
        c.onNewPage = (p) => {
          p.onClick = (x) => {
            if (x.role === 'tab')
              p.setTrees([n('document', '', [text('Our systems have detected unusual traffic')])]);
          };
        };
      },
    });
    expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'unusual-traffic' });
    expect(t.cooldown.active()?.cause).toBe('unusual-traffic');
  });

  // why: ruling of 2026-10-18 (the rerun on 51c2992): Cheapest polls that keep overrunning end at the budget, and the
  // server reads the list as it stands with the tab's price (the adapter marks the cell partial)
  it('Cheapest polls that keep timing out fall back to the list with the tab price', async () => {
    const tree = resultsTree({ tab: 'Cheapest from £443' });
    const t = setup({
      tree,
      selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true },
      shape: (c) => {
        c.onNewPage = (p) => {
          p.onClick = (x) => {
            if (x.role === 'tab') x.selectedQueryHang = true;
          };
        };
      },
    });
    const pending = t.session.page(REQ);
    let r: Awaited<typeof pending> | null = null;
    void pending.then((x) => {
      r = x;
    });
    for (let i = 0; i < 80 && r === null; i++) {
      for (let j = 0; j < 5; j++) await flush();
      if (r === null) t.timers.runOut();
    }
    expect(await pending).toMatchObject({
      answer: { kind: 'cells', cell: { status: 'price', tabMinor: 44300 } },
    });
    expect(t.cooldown.active()).toBeNull();
  });
});

// why: the grid runs of 2026-10-26 stopped twice as `blocked:unrecognised` and the app kept only that: the worker logged
// its rule at debug, which the service's log level drops. Every stop now names its rule on the answer, a token the
// protocol bounds, so the app can put it in last_error.
describe('every stop names the rule that made it', () => {
  const currency = (): FakeNode => {
    const tree = resultsTree();
    tree.children = (tree.children ?? []).map((c) =>
      c.name === 'Currency GBP' ? n('button', 'Currency USD') : c,
    );
    return tree;
  };
  const twoDateGrids = (): FakeNode => resultsTree({ extra: [n('button', 'Date grid')] });
  const captcha = (c: FakeContext) => {
    c.navigations = [
      {
        hops: [URL0, LANDED],
        tree: resultsTree(),
        frames: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
      },
    ];
  };
  it.each<[string, Parameters<typeof setup>[0], string, string]>([
    [
      'a form on other dates',
      { tree: resultsTree({ form: formNodes({ dep: 'Fri, 6 Nov' }) }) },
      'unrecognised',
      'search-form:mismatch',
    ],
    ['no search form', { tree: resultsTree({ form: [] }) }, 'unrecognised', 'search-form:absent'],
    ['another currency', { tree: currency() }, 'unrecognised', 'currency'],
    ['two Date grid buttons', { tree: twoDateGrids() }, 'unrecognised', 'date-grid-buttons'],
    ['a reCAPTCHA frame', { shape: captcha }, 'captcha', 'captcha-frame'],
    [
      'an off-allowlist navigation',
      { hops: ['https://www.example.test/'] },
      'off-allowlist',
      'guard-refused:off-allowlist',
    ],
    ['SOCS changed on a settled page', { shape: changeSocs }, 'consent-unhandled', 'socs-read-back'],
    [
      'an account cookie before the page',
      { shape: (c) => c.jar.push({ name: 'SID', value: 'x', domain: '.google.com', path: '/' }) },
      'signed-in',
      'account-cookie',
    ],
  ])('%s: the answer names its page kind and rule', async (_l, o, page, rule) => {
    const t = setup(o);
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({ kind: 'blocked', page, rule });
    expect(workerRuleSchema.safeParse(rule).success).toBe(true);
    // why: the answer as the app's adapter parses it, the rule included
    expect(workerAnswerSchema.safeParse(r.answer).success).toBe(true);
  });
  it('an unread list names its own rule: options that no grammar reads are no-options-read', async () => {
    const t = setup({
      tree: resultsTree({
        top: [n('link', 'From 478 British pounds round trip total. Gibberish')],
        other: [],
      }),
    });
    const r = await t.session.page(REQ);
    expect(r.answer).toMatchObject({ kind: 'blocked', page: 'unrecognised', rule: 'no-options-read' });
  });
});

// Spec revision 55 §2 "The flight-list read" (WP20 Task 20.7): a flights page is a list page under every rule of one
// (the cool-down, the pacer, the GBP check, the Cheapest flow's
// fall-back and no-options-read); only its reader and its answer differ. The names are the fake page's synthetic ones.
describe('PageSession in flights mode (spec rev 55 §2)', () => {
  const FREQ: FlightsRequest = {
    mode: 'flights',
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    departureDate: asIsoDate('2026-11-05'),
    returnDate: asIsoDate('2026-11-15'),
    gl: 'GB',
    airportNames: {
      origin: ['London Heathrow Airport'],
      destination: ['John F Kennedy International Airport'],
      otherOrigins: [],
      otherDestinations: [],
    },
  };
  // The fake page's option (test/support/fakePage.ts): 12:25 → 20:05 the same day, one stop, 12 hrs 40 min.
  const flight = (pounds: number) => ({
    departsLocal: '12:25',
    arrivesLocal: '20:05',
    arrivesDayOffset: 0,
    durationMinutes: 760,
    stops: 1,
    carriers: ['Example Air'],
    operatedBy: null,
    amountMinor: pounds * 100,
  });

  it('a flights page whose options are all another cell’s logs them at debug, with the page’s location (2026-11-03)', async () => {
    const log = memoryLog();
    const t = setup({ log });
    const r = await t.session.page({
      ...FREQ,
      airportNames: { ...FREQ.airportNames, origin: ['London Gatwick Airport'] },
    });
    expect(r.answer).toMatchObject({ kind: 'flights', listed: 'none-for-cell', optionsOtherCell: 2 });
    const skipped = log.lines.filter((l) => l.msg === 'options skipped');
    expect(skipped.map((l) => l.level)).toEqual(['debug']);
    expect(skipped[0]?.o).toMatchObject({
      pointOfSale: 'GB',
      skipped: [{ why: 'other-cell' }, { why: 'other-cell' }],
      more: 0,
    });
  });
  it('a flights page whose options are all the cell’s logs no skipped options', async () => {
    const log = memoryLog();
    const t = setup({ log });
    const r = await t.session.page(FREQ);
    expect(r.answer).toMatchObject({ kind: 'flights', listed: 'flights' });
    expect(log.lines.filter((l) => l.msg === 'options skipped')).toEqual([]);
  });

  it('settled results → a flights answer: the cell’s flights in page order, the minimum, the tab price, no Cheapest view', async () => {
    const t = setup();
    const r = await t.session.page(FREQ);
    expect(r).toEqual({
      answer: {
        kind: 'flights',
        fetchedAt: '2026-10-18T05:00:01.000Z',
        currency: 'GBP',
        pointOfSale: 'GB',
        listed: 'flights',
        flights: [flight(478), flight(451)],
        minMinor: 45_100,
        tabMinor: 45_100,
        cheapestView: null,
        optionsUnparsed: 0,
        optionsOtherCell: 0,
        resultsStated: 2,
        notes: [],
        versions,
      },
      googleContacted: true,
    });
    expect(workerAnswerSchema.safeParse(r.answer).success).toBe(true);
    expect(ANSWER_STATUS[r.answer.kind]).toBe(200);
    // why: the same verified URL form a list page loads (core's pageUrl)
    expect(page0(t).calls.gotos[0]?.url).toBe(URL0);
    expect(page0(t).calls.closed).toBe(1);
    expect(released(t)).toBe(true);
  });
  // why: rule 5 on a flights page: a list the SOCS read-back or the page close could not confirm is never kept as a flights
  // answer (CodeRabbit finding: the `flights` branch of both overrun checks had no test)
  it('a never-resolving SOCS read-back on a flights page → browser-error read, context discarded', async () => {
    const t = setup({ shape: (c) => (c.hangCookiesOn = 1) });
    expect((await t.session.page(FREQ)).answer).toEqual({
      kind: 'browser-error',
      stage: 'read',
      detail: 'SOCS read-back overran',
    });
    expect(ctx0(t).closed).toBe(1);
  });
  it('a page close that never resolves on a flights page → browser-error read, context discarded', async () => {
    const t = setup({ shape: (c) => (c.onNewPage = (p) => (p.closeHangs = true)) });
    expect((await t.session.page(FREQ)).answer).toEqual({
      kind: 'browser-error',
      stage: 'read',
      detail: 'page close overran',
    });
    expect(ctx0(t).closed).toBe(1);
  });
  it('runs every gate a list page runs, in order, before the load: grid gate skipped, cool-down, pacer', async () => {
    // the grid gate does not apply: no grid settings, and the page still loads
    const g = setup();
    expect((await g.session.page(FREQ)).answer.kind).toBe('flights');
    // a cool-down answers before the pacer claims
    const a = setup();
    a.cooldown.start('captcha');
    expect((await a.session.page(FREQ)).answer.kind).toBe('cooling-down');
    expect(a.pacer.claim().ok).toBe(true);
    expect(a.contexts).toEqual([]);
    // a second page inside the spacing opens nothing
    const c = setup();
    expect((await c.session.page(FREQ)).answer.kind).toBe('flights');
    c.clock.advance(5000);
    expect((await c.session.page(FREQ)).answer).toEqual({ kind: 'spacing', retryAfterSeconds: 22 });
    expect(ctx0(c).pages).toHaveLength(1);
  });
  it('a second request during a page answers spacing, nothing more opened', async () => {
    const t = setup();
    const first = t.session.page(FREQ);
    expect((await t.session.page(FREQ)).answer.kind).toBe('spacing');
    expect((await first).answer.kind).toBe('flights');
    expect(ctx0(t).pages).toHaveLength(1);
  });
  it('a page in another currency is blocked unrecognised, rule currency, with its cool-down', async () => {
    const tree = resultsTree();
    tree.children = (tree.children ?? []).map((c) =>
      c.name === 'Currency GBP' ? n('button', 'Currency USD') : c,
    );
    const t = setup({ tree });
    expect((await t.session.page(FREQ)).answer).toMatchObject({
      kind: 'blocked',
      page: 'unrecognised',
      rule: 'currency',
    });
    expect(t.cooldown.active()?.cause).toBe('unrecognised');
  });
  it('options no grammar reads are blocked no-options-read, as in list mode', async () => {
    const t = setup({
      tree: resultsTree({
        top: [n('link', 'From 478 British pounds round trip total. Gibberish')],
        other: [],
      }),
    });
    expect((await t.session.page(FREQ)).answer).toMatchObject({
      kind: 'blocked',
      page: 'unrecognised',
      rule: 'no-options-read',
    });
  });
  it('the Cheapest flow read is named cheapest; a failed one falls back to the Best view, named so, with the tab price', async () => {
    const on = setup({ selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true } });
    expect((await on.session.page(FREQ)).answer).toMatchObject({ kind: 'flights', cheapestView: 'cheapest' });
    const fallback = setup({
      tree: resultsTree({ tab: 'Cheapest from £443' }),
      selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true },
      shape: (c) => {
        c.onNewPage = (p) => {
          p.onClick = () => {
            throw Object.assign(new Error('locator.click: Timeout'), { name: 'TimeoutError' });
          };
        };
      },
    });
    expect((await fallback.session.page(FREQ)).answer).toMatchObject({
      kind: 'flights',
      listed: 'flights',
      cheapestView: 'best-fallback',
      tabMinor: 44_300,
      minMinor: 45_100,
    });
    expect(fallback.cooldown.active()).toBeNull();
  });
  it('a Cheapest view that never settles with no list read is not-ready, as in list mode', async () => {
    const t = setup({
      tree: resultsTree({ tab: 'Cheapest from £443', top: [], other: [] }),
      selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: true },
      shape: (c) => {
        c.onNewPage = (p) => {
          p.onClick = () => {
            throw Object.assign(new Error('locator.click: Timeout'), { name: 'TimeoutError' });
          };
        };
      },
    });
    expect((await t.session.page(FREQ)).answer.kind).toBe('not-ready');
    expect(t.cooldown.active()).toBeNull();
  });
  // why: ruling B8: the session answers Google's no-flights line before any reader runs; on a flights page that answer
  // is a flights answer with listed 'no-flights' (never readFlights' to give)
  it("Google's no-flights line, once verified, is listed 'no-flights' with no flight", async () => {
    const t = setup({
      tree: n('document', '', [text('No results returned for this search')]),
      selectors: { ...SELECTORS, NO_FLIGHTS_VERIFIED: true },
    });
    const r = await t.session.page(FREQ);
    expect(r.answer).toEqual({
      kind: 'flights',
      // why: the no-flights line settles on the first poll (no second poll for stable links)
      fetchedAt: '2026-10-18T05:00:00.000Z',
      currency: 'GBP',
      pointOfSale: 'unknown',
      listed: 'no-flights',
      flights: [],
      minMinor: null,
      tabMinor: null,
      cheapestView: null,
      optionsUnparsed: 0,
      optionsOtherCell: 0,
      resultsStated: null,
      notes: [],
      versions,
    });
    expect(workerAnswerSchema.safeParse(r.answer).success).toBe(true);
  });
  it("every option for another day is listed 'none-for-cell', no cool-down", async () => {
    const t = setup({
      tree: resultsTree({
        top: [option(300, { on: 'Friday, November 6' })],
        other: [option(310, { on: 'Friday, November 6' })],
      }),
    });
    expect((await t.session.page(FREQ)).answer).toMatchObject({
      kind: 'flights',
      listed: 'none-for-cell',
      flights: [],
      minMinor: null,
      optionsOtherCell: 2,
    });
    expect(t.cooldown.active()).toBeNull();
  });
});

// why: WP21 Task 21.3 (spec rev 56 §2, R-zero, A5): `pagesLoaded` is stated only on an answer to a request carrying
// returnLimits on a verified entry; a list, grid or plain flights page carries none, as before
describe('page counts only on a return-phase request (WP21 Task 21.3)', () => {
  it('a list page and a flights page without returnLimits carry no pagesLoaded, with the select flags on', async () => {
    const S = {
      ...SELECTORS,
      CHEAPEST_FLOW_VERIFIED: false,
      RETURN_SELECT_VERIFIED: true,
      BOOKING_SELECT_VERIFIED: true,
    };
    const t = setup({ selectors: S });
    const list = (await t.session.page(REQ)).answer;
    expect(list.kind).toBe('cells');
    expect('pagesLoaded' in list).toBe(false);
    t.clock.advance(30_000);
    const flights = (await t.session.page({ ...REQ, mode: 'flights' })).answer;
    expect(flights.kind).toBe('flights');
    expect('pagesLoaded' in flights).toBe(false);
    expect('returns' in flights).toBe(false);
  });
  it('a blocked list page carries no pagesLoaded either', async () => {
    const t = setup({ tree: n('document', '', [text('please show you are not a robot')]) });
    const a = (await t.session.page(REQ)).answer;
    expect(a).toMatchObject({ kind: 'blocked', page: 'captcha' });
    expect('pagesLoaded' in a).toBe(false);
  });
});

// why: CAMOUFOX_PAGES_AT_ONCE: page sessions side by side, behind the one pacer, the one cool-down and the one refusal
describe('PageSlots (pages at once)', () => {
  /** A setup whose first context's page holds at its load until `open`; `loading` resolves once it waits there. */
  const held = (o: Parameters<typeof setup>[0] = {}) => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    let reached: () => void = () => undefined;
    const loading = new Promise<void>((r) => {
      reached = r;
    });
    const contexts: FakeContext[] = [];
    const t = setup({
      spacing: 0,
      capacity: 2,
      ...o,
      shape: (c) => {
        contexts.push(c);
        o.shape?.(c);
        if (contexts.length !== 1) return;
        c.onNewPage = (p) => {
          const g = p.goto.bind(p);
          p.goto = async (u, opts) => {
            reached();
            await gate;
            return g(u, opts);
          };
        };
      },
    });
    return { t, loading, open: () => open() };
  };
  it('a request goes to an idle session; with every session busy it is answered spacing for the soonest end', async () => {
    const h = held();
    const slots = new PageSlots([h.t.session, h.t.make()]);
    const a = slots.page(REQ);
    await h.loading;
    expect(slots.busySince()).toBe(T0);
    const b = await slots.page(REQ);
    expect(b.answer.kind).toBe('cells');
    expect(h.t.contexts).toHaveLength(2);
    // why: the second session is idle again, so a third request loads there while the first page still waits
    expect((await slots.page(REQ)).answer.kind).toBe('cells');
    // why: the first session alone, busy: the rest of its page's overall cap (twice the 90 s page timeout) and its
    // bounded close, from the page's start at T0
    const alone = new PageSlots([h.t.session]);
    expect(await alone.page(REQ)).toEqual({
      answer: {
        kind: 'spacing',
        retryAfterSeconds: Math.ceil((Date.parse(T0) + 190_000 - h.t.timers.now()) / 1000),
      },
      googleContacted: false,
    });
    h.open();
    expect((await a).answer.kind).toBe('cells');
    expect(slots.busySince()).toBeNull();
    await slots.settled();
  });
  it('a block in one session stops every later page, while the page in flight in another finishes', async () => {
    let launched = 0;
    const h = held({
      shape: (c) => {
        // why: the second context's page meets a challenge frame
        launched += 1;
        if (launched === 2)
          c.navigations = [
            {
              hops: [URL0, LANDED],
              tree: resultsTree(),
              frames: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
            },
          ];
      },
    });
    const slots = new PageSlots([h.t.session, h.t.make()]);
    const a = slots.page(REQ);
    await h.loading;
    expect((await slots.page(REQ)).answer).toMatchObject({ kind: 'blocked', page: 'captcha' });
    expect((await slots.page(REQ)).answer).toMatchObject({ kind: 'cooling-down', cause: 'captcha' });
    h.open();
    expect((await a).answer.kind).toBe('cells');
  });
  // why: CodeRabbit on PR #49: a session closing its page is still busy; a busy answer then waits for the close's bounds
  it('with the only session closing its page, the busy answer waits for the close, not the spacing alone', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let closing: () => void = () => undefined;
    const reachedClose = new Promise<void>((r) => {
      closing = r;
    });
    const t = setup({
      spacing: 0,
      shape: (c) => {
        c.onNewPage = (p) => {
          const close = p.close.bind(p);
          p.close = async () => {
            closing();
            await gate;
            return close();
          };
        };
      },
    });
    const slots = new PageSlots([t.session]);
    const a = slots.page(REQ);
    await reachedClose;
    const busy = await slots.page(REQ);
    // why: three close steps (SOCS read-back, page close, a discard), each under the 5 s finallyMs default
    expect(busy.answer).toEqual({ kind: 'spacing', retryAfterSeconds: 15 });
    release();
    expect((await a).answer.kind).toBe('cells');
  });
  // why: CodeRabbit on PR #49: the stop is visible to every session before its page closes
  it('a stop is recorded before its page closes, so no other session starts a page meanwhile', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let closing: () => void = () => undefined;
    const reachedClose = new Promise<void>((r) => {
      closing = r;
    });
    const t = setup({
      spacing: 0,
      capacity: 2,
      shape: (c) => {
        c.navigations = [
          {
            hops: [URL0, LANDED],
            tree: resultsTree(),
            frames: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
          },
        ];
        c.onNewPage = (p) => {
          const close = p.close.bind(p);
          p.close = async () => {
            closing();
            await gate;
            return close();
          };
        };
      },
    });
    const slots = new PageSlots([t.session, t.make()]);
    const a = slots.page(REQ);
    await reachedClose;
    expect(t.cooldown.active()?.cause).toBe('captcha');
    expect((await slots.page(REQ)).answer).toMatchObject({ kind: 'cooling-down', cause: 'captcha' });
    expect(t.contexts).toHaveLength(1);
    release();
    expect((await a).answer).toMatchObject({ kind: 'blocked', page: 'captcha' });
  });
  // why: CodeRabbit on PR #49: a failed wipe never leaves the session busy, and the profile is not launched again
  // until its removal succeeds
  it('a profile wipe that fails frees the session; the next launch retries the wipe and fails while it cannot', async () => {
    let launched = 0;
    const t = setup({
      shape: (c) => {
        launched += 1;
        if (launched === 1) changeSocs(c);
      },
    });
    writeFileSync(join(t.profileDir, 'prefs.js'), '');
    chmodSync(t.profileDir, 0o500);
    try {
      expect((await t.session.page(REQ)).answer).toMatchObject({
        kind: 'blocked',
        page: 'consent-unhandled',
      });
      expect(t.session.busy()).toBeNull();
      expect(existsSync(t.profileDir)).toBe(true);
      // why: past the consent cool-down (48 h)
      t.clock.advance(49 * 3_600_000);
      expect((await t.session.page(REQ)).answer).toMatchObject({ kind: 'browser-error', stage: 'launch' });
      expect(t.launches.count).toBe(1);
      expect(t.session.busy()).toBeNull();
      chmodSync(t.profileDir, 0o700);
      t.clock.advance(60_000);
      expect((await t.session.page(REQ)).answer.kind).toBe('cells');
      expect(t.launches.count).toBe(2);
    } finally {
      if (existsSync(t.profileDir)) chmodSync(t.profileDir, 0o700);
    }
  });
  it('with every session busy, a cool-down or a grid request is answered as a page answers it, never spacing', async () => {
    const h = held({ capacity: 1 });
    const slots = new PageSlots([h.t.session]);
    const a = slots.page(REQ);
    await h.loading;
    const grid: PageRequest = {
      mode: 'grid',
      origin: REQ.origin,
      destination: REQ.destination,
      gl: 'GB',
      start: { departureDate: REQ.departureDate, returnDate: REQ.returnDate },
      moves: [],
      reads: [true],
      scrollAllowance: 0,
    };
    expect((await slots.page(grid)).answer).toEqual({ kind: 'mode-unavailable', mode: 'grid' });
    h.t.cooldown.start('captcha');
    expect((await slots.page(REQ)).answer).toMatchObject({ kind: 'cooling-down', cause: 'captcha' });
    h.open();
    expect((await a).answer.kind).toBe('cells');
  });
});
