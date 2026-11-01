// `record --select-outbound` (WP21 Task 21.0) over the fake browser: the served sequence (the Best view settled, the
// form checked, the Cheapest flow), the first pick's selection, the list page loaded again, the served sequence again
// and a second pick's selection, each document-loading step spaced by the pacer's re-claim, the month reserved for the
// worst case and settled to the documents loaded. Synthetic trees only; no value here comes from a recording.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate, type BlockedPage, CAMOUFOX_BUILDS } from '@gmt/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as budget from '../src/budget.js';
import { loadWorkerConfig } from '../src/config.js';
import { CooldownStore } from '../src/cooldown.js';
import { createDriver, type Driver, type FrameLike, type RequestLike } from '../src/driver.js';
import { buildLaunchOptions, launchOptionsForMeta } from '../src/launch.js';
import { Pacer } from '../src/pacer.js';
import { RECORD_SELECT_PAGES, type RecordDeps, record } from '../src/record.js';
import { recordSelectOutbound, selectOutboundCapMs, selectReturnCapMs } from '../src/recordSelect.js';
import { type EntryContext, EX_CONFIG, EX_UNAVAILABLE } from '../src/run.js';
import { SELECTORS } from '../src/selectors.js';
import { DeadlineExceeded } from '../src/timers.js';
import { FakeContext } from './support/fakeContext.js';
import {
  descendants,
  type FakeNode,
  FakePage,
  formNodes,
  n,
  optionName,
  resultsTree,
  returnOptionName,
  text,
  viewMore,
} from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { SYNTHETIC_REJECT } from './support/socsValues.js';
import { fakeTimers } from './support/timers.js';

// why: the cap's wiring through record() into pageBudget is observed on the real function (a pass-through spy)
vi.mock('../src/budget.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/budget.js')>();
  return { ...real, pageBudget: vi.fn(real.pageBudget) };
});

import { tmpDir } from './support/tmp.js';

const KEY = 'synthetic-worker-key-0123456789abcdef';
const CAPTURE = {
  value: SYNTHETIC_REJECT,
  domain: '.google.com',
  path: '/',
  expires: 1_800_000_000,
  secure: true,
  sameSite: 'Lax',
  capturedAt: '2026-10-18T04:00:00.000Z',
};
const Q = ['--origin', 'LHR', '--destination', 'JFK', '--depart', '2026-11-05', '--return', '2026-11-15'];
const SELECT = ['--select-outbound', ...Q];
const URL0 =
  'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2026-11-05+returning+2026-11-15&curr=GBP&hl=en-GB&gl=GB';
const LANDED = 'https://www.google.com/travel/flights/search?tfs=x';
const cfg = loadWorkerConfig({ CAMOUFOX_WORKER_KEY: KEY, HOME: '/Users/op' });

// The Best view's options, in page order: another day's cheaper option, a name the grammar cannot read, the cheapest on
// the day (a long journey: the recorder picks by price; the limits are production's), two at the next price (page order
// breaks the tie), and a dearer one.
const OTHER_DAY = optionName(300, { on: 'Friday, November 6' });
const UNPARSABLE =
  'From 350 British pounds round trip total. A sentence this grammar does not read. Select flight';
const P451 = optionName(451, { duration: '26 hrs 40 min' });
const P478 = optionName(478, { duration: '10 hrs' });
const P478B = optionName(478, { duration: '10 hrs', carrier: 'QQ Atlantic' });
const P520 = optionName(520, { duration: '11 hrs 40 min' });
const OUT = [OTHER_DAY, UNPARSABLE, P451, P478, P478B, P520];
const TAB = 'Cheapest from 451 British pounds';
const RET1 = [
  returnOptionName({ pounds: 451 }),
  returnOptionName({ pounds: 470, carrier: 'QQ Air' }),
  returnOptionName({ pounds: 512 }),
];
const RET2 = [
  returnOptionName({ pounds: 478 }),
  returnOptionName({ pounds: 490, carrier: 'QQ Air' }),
  returnOptionName({ pounds: 530 }),
];

const items = (names: readonly string[]): FakeNode[] => names.map((x) => n('listitem', '', [n('link', x)]));
const bestTree = (names: readonly string[] = OUT): FakeNode =>
  resultsTree({ tab: TAB, top: items(names.slice(0, 2)), other: items(names.slice(2)) });
/** The Cheapest view: the same options, the tab selected, no results line (as the 2026-10-18 recordings showed). */
const cheapestTree = (names: readonly string[] = OUT): FakeNode => {
  const v = bestTree(names);
  for (const c of descendants([v])) if (c.role === 'tab' && c.name === TAB) c.selected = true;
  v.children = (v.children ?? []).filter((c) => !/results returned/.test(c.name ?? ''));
  return v;
};
/** The view after a selection, in the hypothesis form: its heading, the return options, View more, no outbound list. */
const returnTree = (names: readonly string[], extra: FakeNode[] = []): FakeNode =>
  n('document', 'Google Flights', [
    n('tablist', '', [n('tab', 'Best'), n('tab', TAB)]),
    n('main', '', [n('heading', 'Returning flights'), n('list', '', items(names)), ...extra]),
    viewMore(),
    n('button', 'Currency GBP'),
  ]);

const BLOCKED: ReadonlyArray<readonly [string, BlockedPage, string, () => FakeNode]> = [
  [
    'captcha',
    'captcha',
    'challenge-text',
    () => n('document', '', [text('Please confirm you are not a robot')]),
  ],
  [
    'consent',
    'consent-unhandled',
    'consent-heading',
    () => n('document', '', [n('heading', 'Before you continue to Google')]),
  ],
  ['sign-in', 'sign-in', 'sign-in-heading', () => n('document', '', [n('heading', 'Sign in')])],
  [
    'account',
    'signed-in',
    'account-control',
    () => resultsTree({ extra: [n('button', 'Google Account: Example Person')] }),
  ],
  [
    'unusual-traffic',
    'unusual-traffic',
    'unusual-traffic-text',
    () => n('document', '', [text('Our systems have detected unusual traffic')]),
  ],
];

interface Script {
  /** What the page shows after the n-th goto (1-based). */
  afterGoto?: (n: number) => FakeNode[];
  /** What a click on a link (by name) changes; return null to leave the view as it is. */
  onLink?: (name: string, ctx: FakeContext, page: FakePage) => FakeNode[] | null;
  onTab?: (n: number, page: FakePage) => FakeNode[];
  /** Each selection loads a new document (a main-frame navigation the route lets through). */
  documentPerSelection?: boolean;
}

const mainFrame: FrameLike = { url: () => LANDED, parentFrame: () => null };
const navigation = (url: string): RequestLike => ({
  url: () => url,
  method: () => 'GET',
  isNavigationRequest: () => true,
  redirectedFrom: () => null,
  frame: () => mainFrame,
});

/** The default script: Best, Cheapest, the first return view after three unchanged polls, Best again, the second. */
const DEFAULT: Script = {
  afterGoto: () => [bestTree()],
  onTab: () => [cheapestTree()],
  onLink: (name) =>
    name === P451
      ? [cheapestTree(), cheapestTree(), cheapestTree(), returnTree(RET1)]
      : name === P478
        ? [returnTree(RET2)]
        : null,
};

/** The deps with each new page shaped further, after the script's own shaping. */
function withPage(t: ReturnType<typeof setup>, shape: (pg: FakePage) => void): RecordDeps {
  return {
    ...t.deps,
    launch: async (p) => {
      const c = await t.deps.launch(p);
      if (c instanceof FakeContext) {
        const first = c.onNewPage;
        c.onNewPage = (pg) => {
          first(pg);
          shape(pg);
        };
      }
      return c;
    },
  };
}

function setup(script: Script = DEFAULT) {
  const dataDir = tmpDir();
  writeFileSync(join(dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
  const root = tmpDir();
  const timers = fakeTimers();
  const contexts: FakeContext[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const events: string[] = [];
  /** What monthly.json and pacer.json held at each goto and each link click. */
  const seen: Array<{ at: string; pages: number | null; lastPageAt: string | null }> = [];
  const peek = (at: string) => {
    const read = (f: string): Record<string, unknown> | null => {
      try {
        return JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
      } catch {
        return null;
      }
    };
    const m = read('monthly.json');
    const p = read('pacer.json');
    seen.push({
      at,
      pages: typeof m?.pages === 'number' ? m.pages : null,
      lastPageAt: typeof p?.lastPageAt === 'string' ? p.lastPageAt : null,
    });
  };
  const log = memoryLog();
  const deps: RecordDeps = {
    platform: 'darwin',
    display: {},
    osArch: 'darwin-arm64',
    bundleSha256: CAMOUFOX_BUILDS['darwin-arm64'].sha256,
    consentDriver: () => {
      throw new Error('this test opens no consent window');
    },
    clock: timers.clock,
    timers,
    log,
    launch: async () => {
      const c = new FakeContext();
      c.navigations = [{ hops: [URL0, LANDED], tree: resultsTree() }];
      const cookies = c.cookies.bind(c);
      c.cookies = (u) => {
        events.push('cookies');
        return cookies(u);
      };
      c.onNewPage = (pg) => {
        let gotos = 0;
        let tabs = 0;
        const goto = pg.goto.bind(pg);
        pg.goto = async (u, o) => {
          gotos += 1;
          peek(`goto-${gotos}`);
          events.push('goto');
          const r = await goto(u, o);
          pg.setTrees(script.afterGoto?.(gotos) ?? [bestTree()]);
          return r;
        };
        const close = pg.close.bind(pg);
        pg.close = () => {
          events.push('close');
          return close();
        };
        pg.onClick = (x) => {
          events.push(`click:${x.role ?? ''}`);
          if (x.role === 'tab') {
            tabs += 1;
            pg.setTrees(script.onTab?.(tabs, pg) ?? [cheapestTree()]);
          }
          if (x.role === 'link') {
            peek(`link-${x.name ?? ''}`);
            if (script.documentPerSelection === true) void c.routeRequest(navigation(`${LANDED}&select`));
            const next = script.onLink?.(x.name ?? '', c, pg) ?? null;
            if (next !== null) pg.setTrees(next);
          }
        };
      };
      contexts.push(c);
      return c;
    },
    launchOptions: launchOptionsForMeta(
      buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' }),
    ),
    binary: '152.0.4-beta.28',
    root,
    pollMs: 2000,
    selectors: SELECTORS,
    pid: 4242,
    isAlive: () => true,
  };
  const ctx = (args: string[]): EntryContext => ({
    env: {},
    dataDir,
    args,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  const facts = () => JSON.parse(readFileSync(join(root, 'select-outbound/2026-10-18/1.facts.json'), 'utf8'));
  const meta = () => JSON.parse(readFileSync(join(root, 'select-outbound/2026-10-18/1.meta.json'), 'utf8'));
  const months = () => JSON.parse(readFileSync(join(dataDir, 'monthly.json'), 'utf8')).pages;
  const cooldown = () =>
    new CooldownStore({ dir: dataDir, challengeHours: 48, clock: timers.clock }).active();
  return {
    dataDir,
    root,
    timers,
    contexts,
    out,
    err,
    events,
    seen,
    log,
    deps,
    ctx,
    facts,
    meta,
    months,
    cooldown,
  };
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('record --select-outbound: the served sequence, two selections and a fresh load (WP21 Task 21.0)', () => {
  it('records the Best and Cheapest views, both picks, and what each step showed', async () => {
    const t = setup();
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    expect(t.err).toEqual([]);
    const f = t.facts();
    expect(f.kind).toBe('select-outbound');
    for (const view of [f.best, f.cheapest]) {
      expect(Object.keys(view).sort()).toEqual(['form', 'headings', 'list', 'names', 'page', 'settle']);
      expect(view.names).toEqual(OUT);
      expect(view.list.names).toEqual(OUT);
      expect(view.form).toMatchObject({ departure: 'Thu, 5 Nov', return: 'Sun, 15 Nov' });
    }
    expect(f.best.page.dateGridButtons).toBe(1);
    expect(f.cheapest.settle.cheapestSelected).toBe(true);
    expect(f.cheapestView).toBe('cheapest');
    expect(f.clicked).toEqual(['tab:Cheapest', `link:${P451}`, 'goto', 'tab:Cheapest', `link:${P478}`]);
    // why: the cheapest on the departure day, then the next-cheapest; another day's and the unreadable are never picks
    expect(f.picks).toEqual([
      { name: P451, linkIndex: 2 },
      { name: P478, linkIndex: 3 },
    ]);
    expect(f.steps.map((s: { step: string }) => s.step)).toEqual([
      'first-selection',
      'reload',
      'second-selection',
    ]);
    const [first, reload, second] = f.steps;
    // why: the controller's ruling after recording 2: each selection is the link focused, then Enter; never a click
    expect([first.activation, reload.activation, second.activation]).toEqual([
      'keyboard',
      undefined,
      'keyboard',
    ]);
    const calls = t.contexts[0]?.pages[0]?.calls;
    expect(calls?.presses).toEqual([`Enter:link:${P451}`, `Enter:link:${P478}`]);
    expect(calls?.focuses).toEqual([`link:${P451}`, `link:${P478}`]);
    expect(calls?.clicks.filter((c) => c.startsWith('link:'))).toEqual([]);
    expect(first.after).toMatchObject({
      url: 'https://www.google.com/travel/flights/search',
      urlChanged: false,
      documentLoadsBefore: 1,
      documentLoads: 1,
      changedFromPreClick: true,
      classification: { kind: 'results', rule: 'returns' },
      names: RET1,
      list: { names: RET1, viewMore: true },
      linkNames: RET1,
      headings: ['Returning flights'],
      tabNames: ['Best', TAB],
      settled: true,
      // why: three unchanged polls and two of the return view, 2 s apart, from the click; the spacing apart
      stepMs: 8000,
      waitMs: 24_000,
    });
    expect(first.after.buttonNames).toContain('View more flights');
    expect(first.after.page.text.returnHeading).toBe(true);
    expect(first.after.form).toBeNull();
    expect(reload.after).toMatchObject({
      view: 'cheapest',
      documentLoadsBefore: 1,
      documentLoads: 2,
      changedFromPreClick: true,
      names: OUT,
      list: { names: OUT, viewMore: true },
      settled: true,
      waitMs: 20_000,
    });
    expect(reload.after.page.cheapestTabs).toEqual([{ name: TAB, inTablist: true, selected: true }]);
    expect(second.after).toMatchObject({
      documentLoadsBefore: 2,
      documentLoads: 2,
      changedFromPreClick: true,
      names: RET2,
      list: { names: RET2, viewMore: true },
      settled: true,
      stepMs: 2000,
      waitMs: 24_000,
    });
    expect(f.socsReadBack).toBe('same');
  });
  // why: ruling D7: six page periods (the first view, its Cheapest flow, a selection, the reload's view, its Cheapest
  // flow, a selection) and three spacings
  it('the page budget is 6 page timeouts and 3 spacings: 630,000 ms at the defaults', () => {
    expect(selectOutboundCapMs(90_000, 30_000)).toBe(630_000);
    expect(selectOutboundCapMs(180_000, 0)).toBe(1_080_000);
    expect(cfg.pageTimeoutSeconds * 1000).toBe(90_000);
    expect(cfg.minSpacingSeconds * 1000).toBe(30_000);
  });
  it('claims RECORD_SELECT_PAGES before the first load and settles to the documents loaded', async () => {
    expect(RECORD_SELECT_PAGES).toBe(4);
    const doc = setup({ ...DEFAULT, documentPerSelection: true });
    expect(await record(doc.ctx(SELECT), cfg, doc.deps)).toBe(0);
    expect(doc.seen[0]).toMatchObject({ at: 'goto-1', pages: 4 });
    expect(doc.months()).toBe(4);
    const [first, reload, second] = doc.facts().steps;
    expect([first.after.documentLoads, reload.after.documentLoads, second.after.documentLoads]).toEqual([
      2, 3, 4,
    ]);
    const inApp = setup();
    expect(await record(inApp.ctx(SELECT), cfg, inApp.deps)).toBe(0);
    expect(inApp.months()).toBe(2);
  });
  it('re-claims the pacer before each selection and the reload: its last start moves each time', async () => {
    const t = setup();
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const at = (k: string) => t.seen.find((s) => s.at === k)?.lastPageAt ?? null;
    const starts = [at('goto-1'), at(`link-${P451}`), at('goto-2'), at(`link-${P478}`)];
    // why: the first goto runs after the claim recorded its start; each later document-loading step re-claimed
    expect(starts).toEqual([
      '2026-10-18T05:00:00.000Z',
      '2026-10-18T05:00:28.000Z',
      '2026-10-18T05:00:56.000Z',
      '2026-10-18T05:01:24.000Z',
    ]);
  });
  it('the meta names the kind, the entry, the bundle and the documents loaded; the file is 0600', async () => {
    const t = setup();
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    expect(t.meta()).toMatchObject({
      kind: 'select-outbound',
      osArch: 'darwin-arm64',
      bundleSha256: CAMOUFOX_BUILDS['darwin-arm64'].sha256,
      documentLoads: 2,
    });
    const file = join(t.root, 'select-outbound/2026-10-18/1.facts.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const all = readFileSync(file, 'utf8') + JSON.stringify(t.meta());
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(SYNTHETIC_REJECT);
  });
  it('a --results and a --cheapest recording’s meta carry documentLoads too', async () => {
    for (const [args, kind] of [
      [Q, 'results'],
      [[...Q, '--cheapest'], 'cheapest'],
    ] as const) {
      const t = setup({});
      expect(await record(t.ctx([...args]), cfg, t.deps)).toBe(0);
      const m = JSON.parse(readFileSync(join(t.root, `${kind}/2026-10-18/1.meta.json`), 'utf8'));
      expect(m.documentLoads, kind).toBe(1);
    }
  });
  it('nothing is written when a page holds the worker key (the fail-closed scan)', async () => {
    const t = setup({
      ...DEFAULT,
      onLink: (name) => (name === P451 ? [returnTree(RET1, [n('heading', KEY)])] : null),
    });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/nothing written/);
  });
  it('the console output names counts, booleans and rule words only', async () => {
    const t = setup();
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const lines = [...t.out, ...t.err];
    const summary = lines.filter((l) => l.startsWith('select-outbound:'));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatch(/^select-outbound:[ a-z0-9;:=-]+$/);
    const all = lines.join('\n');
    for (const word of [
      'https://',
      'British pounds',
      'Example Air',
      'QQ',
      'Cheapest from',
      'View more',
      'Returning',
    ])
      expect(all).not.toContain(word);
  });
  it('the SOCS read-back and the page close run after the whole interaction', async () => {
    const t = setup();
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const lastClick = t.events.lastIndexOf('click:link');
    const readBack = t.events.lastIndexOf('cookies');
    expect(lastClick).toBeGreaterThan(0);
    expect(readBack).toBeGreaterThan(lastClick);
    expect(t.events.indexOf('close')).toBeGreaterThan(readBack);
  });
});

describe('record --select-outbound: steps that do not complete end the page plainly', () => {
  it('two links of the pick’s name: selectFailed find-outbound:ambiguous, no after, nothing more', async () => {
    const twice = [OTHER_DAY, UNPARSABLE, P451, P451, P478, P520];
    const t = setup({ afterGoto: () => [bestTree(twice)], onTab: () => [cheapestTree(twice)] });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const f = t.facts();
    expect(f.steps).toEqual([
      {
        step: 'first-selection',
        selectFailed: 'find-outbound:ambiguous',
        waitMs: 24_000,
        target: expect.objectContaining({ matches: 2 }),
      },
    ]);
    expect(f.clicked).toEqual(['tab:Cheapest']);
    expect(t.cooldown()).toBeNull();
  });
  it('a view that never changes from the Cheapest view: settled false, changed false, the last read, then the end', async () => {
    const t = setup({ ...DEFAULT, onLink: () => null });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const f = t.facts();
    expect(f.steps).toHaveLength(1);
    // why: the controller's ruling after recording 2: an Enter that changes nothing within the step is no-activation
    expect(f.steps[0]).toMatchObject({
      selectFailed: 'press-outbound:no-activation',
      activation: 'keyboard',
    });
    expect(f.steps[0].after).toMatchObject({
      settled: false,
      changedFromPreClick: false,
      names: OUT,
      linkNames: OUT,
      documentLoads: 1,
    });
    expect(f.clicked).toEqual(['tab:Cheapest', `link:${P451}`]);
    expect(t.contexts[0]?.pages[0]?.calls.gotos).toHaveLength(1);
    expect(t.cooldown()).toBeNull();
    // why: the page stays within its budget (the step's own deadline, then the bounded last read)
    expect(t.timers.now() - Date.parse('2026-10-18T05:00:00.000Z')).toBeLessThanOrEqual(630_000 + 10_000);
  });
  it('a re-claim that runs out of its own budget records waitTimedOut and ends plainly (never not-ready)', async () => {
    const t = setup({
      ...DEFAULT,
      onTab: () => {
        // why: another process recorded a start ten minutes ahead, so the spacing outlasts the step's wait budget
        writeFileSync(
          join(t.dataDir, 'pacer.json'),
          JSON.stringify({ lastPageAt: '2026-10-18T05:10:00.000Z' }),
          {
            mode: 0o600,
          },
        );
        return [cheapestTree()];
      },
    });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    expect(t.facts().steps).toEqual([{ step: 'first-selection', waitTimedOut: true, waitMs: 0 }]);
    expect(t.facts().clicked).toEqual(['tab:Cheapest']);
    expect(t.err.join()).not.toMatch(/did not settle/);
  });
});

describe('record --select-outbound: a blocked kind after any click or the reload is a stop', () => {
  const STEPS = ['first-selection', 'reload', 'second-selection'] as const;
  const cases = STEPS.flatMap((step) =>
    BLOCKED.map(([name, page, rule, tree]) => ({ step, name, page, rule, tree })),
  );
  it.each(cases)('$name after the $step: its cool-down and rule', async ({ step, page, rule, tree }) => {
    const t = setup({
      afterGoto: (k) => (step === 'reload' && k === 2 ? [tree()] : [bestTree()]),
      onTab: () => [cheapestTree()],
      onLink: (name) =>
        name === P451
          ? step === 'first-selection'
            ? [tree()]
            : [returnTree(RET1)]
          : name === P478 && step === 'second-selection'
            ? [tree()]
            : null,
    });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(t.cooldown()?.cause).toBe(page);
    const decision = t.log.lines.find((l) => l.msg === 'classifier decision');
    expect(decision?.o).toMatchObject({ cause: page, rule });
    expect(t.err.join()).toMatch(/the work stops for an operator ruling/);
    // why: the stop met the step named, after exactly the clicks and loads before it
    expect(t.events.filter((e) => e === 'click:link')).toHaveLength(step === 'second-selection' ? 2 : 1);
    expect(t.events.filter((e) => e === 'goto')).toHaveLength(step === 'first-selection' ? 1 : 2);
  });
});

describe('record --select-outbound: the served sequence’s other ends, and the later steps’ (WP21 Task 21.0)', () => {
  const fetching = () => n('document', '', [text('Fetching results')]);
  it('a blocked first view is the stop it always is', async () => {
    const t = setup({ afterGoto: () => [n('document', '', [text('Please confirm you are not a robot')])] });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(t.cooldown()?.cause).toBe('captcha');
  });
  it('Google’s no-flights line on the first view: recorded, nothing selected', async () => {
    const t = setup({ afterGoto: () => [n('document', '', [text('No results returned for this search')])] });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const f = t.facts();
    expect(f).toMatchObject({ picks: [], cheapest: null, cheapestView: null, clicked: [] });
    expect(f.steps).toEqual([{ step: 'first-selection', selectFailed: 'no-flights' }]);
    expect(t.out.find((l) => l.startsWith('select-outbound:'))).toBe(
      'select-outbound: first view 0 links; picks 0; first-selection select-failed no-flights',
    );
  });
  it('a search form that is not the request’s is unrecognised, as the session’s', async () => {
    const t = setup({ afterGoto: () => [resultsTree({ tab: TAB, form: formNodes({ adults: '2' }) })] });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(t.log.lines.find((l) => l.msg === 'classifier decision')?.o).toMatchObject({
      cause: 'unrecognised',
      rule: 'search-form:mismatch',
    });
  });
  it('with the Cheapest flow unverified, the Best view is read and its pick selected', async () => {
    const t = setup();
    const deps = { ...t.deps, selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: false } };
    expect(await record(t.ctx(SELECT), cfg, deps)).toBe(0);
    const f = t.facts();
    expect(f).toMatchObject({ cheapest: null, cheapestView: null });
    expect(f.clicked).toEqual([`link:${P451}`, 'goto', `link:${P478}`]);
  });
  it('a Cheapest flow whose tab click fails falls back to the Best view, as the session does', async () => {
    const t = setup({
      ...DEFAULT,
      onTab: () => {
        throw Object.assign(new Error('locator.click: Timeout'), { name: 'TimeoutError' });
      },
    });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const f = t.facts();
    expect(f.cheapestView).toBe('best-fallback');
    expect(f.picks[0]).toEqual({ name: P451, linkIndex: 2 });
    expect(f.steps[1].after.view).toBe('best-fallback');
  });
  it('a challenge after the Cheapest tab’s click is that stop', async () => {
    const t = setup({
      ...DEFAULT,
      onTab: () => [n('document', '', [text('Please confirm you are not a robot')])],
    });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(t.cooldown()?.cause).toBe('captcha');
  });
  it('no option on the departure day: nothing selected', async () => {
    const other = [OTHER_DAY, UNPARSABLE];
    const t = setup({ afterGoto: () => [bestTree(other)], onTab: () => [cheapestTree(other)] });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    expect(t.facts()).toMatchObject({
      picks: [],
      steps: [{ step: 'first-selection', selectFailed: 'no-pick' }],
    });
  });
  it('a reloaded view with no other option on the day: the second selection has no pick', async () => {
    const t = setup({
      ...DEFAULT,
      onTab: (k) => [cheapestTree(k === 1 ? OUT : [OTHER_DAY, P451])],
    });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const f = t.facts();
    expect(f.picks).toEqual([{ name: P451, linkIndex: 2 }]);
    expect(f.steps.at(-1)).toEqual({ step: 'second-selection', selectFailed: 'no-pick' });
  });
  it('a reload that never settles: settled false with the last read, then the end', async () => {
    const t = setup({ ...DEFAULT, afterGoto: (k) => (k === 1 ? [bestTree()] : [fetching()]) });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const f = t.facts();
    expect(f.steps.map((s: { step: string }) => s.step)).toEqual(['first-selection', 'reload']);
    expect(f.steps[1].after).toMatchObject({
      settled: false,
      documentLoads: 2,
      classification: { kind: 'blocked' },
    });
    expect(f.steps[1].after.settle.fetching).toBe(true);
  });
  it('Google’s no-flights line after the reload: recorded, no second selection', async () => {
    const t = setup({
      ...DEFAULT,
      afterGoto: (k) =>
        k === 1 ? [bestTree()] : [n('document', '', [text('No results returned for this search')])],
    });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const f = t.facts();
    expect(f.steps[1].after).toMatchObject({
      settled: true,
      classification: { kind: 'no-flights' },
      view: 'best',
    });
    expect(f.steps).toHaveLength(2);
  });
  it('a reload the guard refuses is that stop', async () => {
    const t = setup();
    const deps: RecordDeps = {
      ...t.deps,
      launch: async (p) => {
        const c = await t.deps.launch(p);
        if (c instanceof FakeContext) {
          const shape = c.onNewPage;
          c.onNewPage = (pg) => {
            shape(pg);
            const goto = pg.goto.bind(pg);
            let k = 0;
            pg.goto = async (u, o) => {
              k += 1;
              if (k === 2 && (await c.routeRequest(navigation('https://www.example.test/'))) === 'aborted')
                throw new Error('NS_ERROR_FAILURE: navigation aborted (blockedbyclient)');
              return goto(u, o);
            };
          };
        }
        return c;
      },
    };
    expect(await record(t.ctx(SELECT), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(t.cooldown()?.cause).toBe('off-allowlist');
  });
  it('a spacing wait past its budget before the reload records waitTimedOut there', async () => {
    const t = setup({
      ...DEFAULT,
      onLink: (name) => {
        writeFileSync(
          join(t.dataDir, 'pacer.json'),
          JSON.stringify({ lastPageAt: '2026-10-18T05:10:00.000Z' }),
          {
            mode: 0o600,
          },
        );
        return name === P451 ? [returnTree(RET1)] : null;
      },
    });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    expect(t.facts().steps.at(-1)).toEqual({ step: 'reload', waitTimedOut: true, waitMs: 0 });
  });
  it('an Enter that never answers ends the step as select-failed press-outbound:timed-out', async () => {
    const hang = () => {
      const v = cheapestTree();
      for (const c of descendants([v])) if (c.role === 'link' && c.name === P451) c.pressHang = true;
      return v;
    };
    const t = setup({ ...DEFAULT, onTab: () => [hang()] });
    // why: the click never answers, so nothing moves fake time: the test awaits the click step's start line (an event),
    // then runs out its own bound
    let clickStarted: () => void = () => undefined;
    const clicking = new Promise<void>((r) => {
      clickStarted = r;
    });
    const log = t.deps.log;
    const deps: RecordDeps = {
      ...t.deps,
      log: {
        ...log,
        debug: (o: object, msg?: string) => {
          log.debug(o, msg);
          if (msg === 'select-outbound step' && Reflect.get(o, 'step') === 'press-outbound') clickStarted();
        },
      },
    };
    const run = record(t.ctx(SELECT), cfg, deps);
    await clicking;
    t.timers.runOut();
    expect(await run).toBe(0);
    expect(t.facts().steps).toEqual([
      {
        step: 'first-selection',
        selectFailed: 'press-outbound:timed-out',
        activation: 'keyboard',
        waitMs: 24_000,
        target: expect.objectContaining({ matches: 1, visible: true }),
      },
    ]);
  });
});

describe('record --select-outbound: review fixes (WP21 Task 21.0)', () => {
  it('passes the cap of 6 page timeouts and 3 spacings to the page budget (630,000 ms at the defaults)', async () => {
    const t = setup();
    vi.mocked(budget.pageBudget).mockClear();
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    expect(vi.mocked(budget.pageBudget).mock.calls.map((c) => [c[1], c[3]])).toEqual([[90_000, 630_000]]);
    // why: every other kind keeps its own cap (twice the page timeout for a results page)
    vi.mocked(budget.pageBudget).mockClear();
    const r = setup({});
    expect(await record(r.ctx(Q), cfg, r.deps)).toBe(0);
    expect(vi.mocked(budget.pageBudget).mock.calls.map((c) => [c[1], c[3]])).toEqual([[90_000, 180_000]]);
  });
  it('with 3 pages left it is refused before anything: no launch, no load, no pacer start, the counts unchanged', async () => {
    const t = setup();
    const counts = JSON.stringify({
      windowStart: '2026-10-01T00:00:00.000Z',
      windowEnd: '2026-11-01T00:00:00.000Z',
      pages: 1497,
      scrolls: 0,
    });
    writeFileSync(join(t.dataDir, 'monthly.json'), counts, { mode: 0o600 });
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toContain(
      "the worker's monthly page cap leaves fewer than the 4 pages this recording may load",
    );
    expect(t.contexts).toEqual([]);
    expect(t.seen).toEqual([]);
    expect(existsSync(join(t.dataDir, 'pacer.json'))).toBe(false);
    expect(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8')).toBe(counts);
  });
  it('is refused on an entry whose View more click the session makes, before anything loads', async () => {
    const t = setup();
    const deps = { ...t.deps, selectors: { ...SELECTORS, VIEW_MORE_ADDS_CHEAPER: true } };
    expect(await record(t.ctx(SELECT), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toContain('VIEW_MORE_ADDS_CHEAPER');
    expect(t.contexts).toEqual([]);
    expect(existsSync(join(t.dataDir, 'monthly.json'))).toBe(false);
  });
  it('a research read that overruns its own bound keeps a settled view settled', async () => {
    // why: the return view's Best tab never answers a name read: only tabNames reads it, after the settle
    const slowTab = () => {
      const v = returnTree(RET1);
      for (const c of descendants([v])) if (c.role === 'tab' && c.name === 'Best') c.hang = true;
      return v;
    };
    const t = setup({
      ...DEFAULT,
      onLink: (name) => (name === P451 ? [slowTab()] : name === P478 ? [returnTree(RET2)] : null),
    });
    let tabsRead: () => void = () => undefined;
    const reading = new Promise<void>((r) => {
      tabsRead = r;
    });
    const deps = withPage(t, (pg) => {
      const byRole = pg.getByRole.bind(pg);
      pg.getByRole = (role, o) => {
        const l = byRole(role, o);
        // why: the research's tab-name read is the one unnamed tab query that reads each tab (readFacts only counts)
        if (role === 'tab' && o === undefined) {
          const nth = l.nth.bind(l);
          l.nth = (i) => {
            tabsRead();
            return nth(i);
          };
        }
        return l;
      };
    });
    const run = record(t.ctx(SELECT), cfg, deps);
    await reading;
    t.timers.runOut();
    expect(await run).toBe(0);
    const first = t.facts().steps[0];
    expect(first.after).toMatchObject({ settled: true, readsOverran: true, tabNames: null, names: RET1 });
    expect(t.facts().steps.map((s: { step: string }) => s.step)).toEqual([
      'first-selection',
      'reload',
      'second-selection',
    ]);
  });
  it('a pre-click read that never answers leaves urlChanged and changedFromPreClick unknown, never true', async () => {
    // why: a total-form link only the return pattern reads: its count hangs on the pre-click read alone
    const TOTAL = returnOptionName({ pounds: 999 });
    const hanging: FakeNode[] = [];
    const withTotal = () => {
      const v = cheapestTree();
      const link = n('link', TOTAL, [], { countHang: true });
      hanging.push(link);
      for (const c of descendants([v]))
        if (c.role === 'list') {
          c.children = [...(c.children ?? []), n('listitem', '', [link])];
          break;
        }
      return v;
    };
    const t = setup({ ...DEFAULT, onTab: () => [withTotal()] });
    let preRead: () => void = () => undefined;
    const reading = new Promise<void>((r) => {
      preRead = r;
    });
    let reads = 0;
    const deps = withPage(t, (pg) => {
      const byRole = pg.getByRole.bind(pg);
      pg.getByRole = (role, o) => {
        const l = byRole(role, o);
        if (role !== 'main') return l;
        const inner = l.getByRole.bind(l);
        l.getByRole = (r, oo) => {
          if (oo?.name === SELECTORS.returns.resultLink) {
            reads += 1;
            if (reads === 1) preRead();
            // why: the last read after the step's deadline answers
            else for (const c of hanging) c.countHang = false;
          }
          return inner(r, oo);
        };
        return l;
      };
    });
    const run = record(t.ctx(SELECT), cfg, deps);
    await reading;
    t.timers.runOut();
    expect(await run).toBe(0);
    const [first] = t.facts().steps;
    expect(first.after).toMatchObject({ settled: false, urlChanged: null, changedFromPreClick: null });
    expect(t.facts().clicked).toEqual(['tab:Cheapest']);
  });
});

// why: recording 1 (2026-11-01) timed out on the outbound's click; the recorder now records the target before it and
// the click's failure word after it
describe('record --select-outbound: the target and the click’s failure (WP21 Task 21.0, after recording 1)', () => {
  it('records the target’s probe before each selection', async () => {
    const t = setup();
    expect(await record(t.ctx(SELECT), cfg, t.deps)).toBe(0);
    const [first, , second] = t.facts().steps;
    for (const s of [first, second])
      expect(s.target).toEqual({
        matches: 1,
        box: { width: 100, height: 40 },
        visible: true,
        enabled: true,
        hit: {
          tag: 'a',
          role: 'link',
          relation: 'self',
          inViewport: true,
          sameRow: true,
          coversTarget: true,
          pointerEvents: 'auto',
          position: 'static',
        },
        probeOverran: false,
      });
  });
  it('a click Playwright refuses records the call log’s reason as one word, and the page ends plainly', async () => {
    const intercepted = () => {
      const v = cheapestTree();
      for (const c of descendants([v]))
        if (c.role === 'link' && c.name === P451)
          c.hit = {
            tag: 'div',
            role: null,
            relation: 'other',
            inViewport: true,
            sameRow: true,
            coversTarget: true,
            pointerEvents: 'auto',
            position: 'absolute',
          };
      return v;
    };
    const t = setup({ ...DEFAULT, onTab: () => [intercepted()] });
    const deps = withPage(t, (pg) => {
      const click = pg.onClick;
      pg.onClick = (x) => {
        click(x);
        if (x.role === 'link')
          throw Object.assign(
            new Error(
              'locator.click: Timeout 9000ms exceeded.\nCall log:\n  - <div>…</div> intercepts pointer events',
            ),
            { name: 'TimeoutError' },
          );
      };
    });
    expect(await record(t.ctx(SELECT), cfg, deps)).toBe(0);
    const [first] = t.facts().steps;
    expect(first).toMatchObject({
      step: 'first-selection',
      selectFailed: 'press-outbound:failed',
      activation: 'keyboard',
      clickFailure: 'intercepted',
      target: { matches: 1, hit: { relation: 'other' } },
    });
    expect(t.facts().steps).toHaveLength(1);
    expect(t.out.find((l) => l.startsWith('select-outbound:'))).toContain(
      'first-selection select-failed press-outbound:failed intercepted',
    );
  });
});

// why: review of the keyboard activation (Low): an activation that the step's deadline cuts short still records which
// activation ran, through the unsettled path; driven on recordSelectOutbound directly, with the driver's activation
// replaced by one that reports the link found, then meets the deadline
describe('recordSelectOutbound: the activation recorded through the deadline path', () => {
  it('a press the step deadline ends records activation keyboard and no-activation', async () => {
    const timers = fakeTimers();
    const dir = tmpDir();
    const page = new FakePage(null);
    page.setUrl(LANDED);
    page.setTrees([bestTree()]);
    page.onClick = (x) => {
      if (x.role === 'tab') page.setTrees([cheapestTree()]);
    };
    const guard = { hops: [], frameUrls: [], refused: null, documentLoads: 1 };
    const real = createDriver(page, guard, SELECTORS);
    const driver: Driver = {
      ...real,
      clickOutbound: async (_name, _d, _o, onActivate) => {
        onActivate?.();
        throw new DeadlineExceeded();
      },
    };
    const pacer = new Pacer({ dir, minSpacingSeconds: 30, clock: timers.clock });
    pacer.claim();
    const out = await recordSelectOutbound({
      driver,
      page,
      guard,
      budget: budget.pageBudget(timers, 90_000, timers.now(), 630_000),
      pageStart: timers.now(),
      deps: { timers, log: memoryLog(), pollMs: 2000, selectors: SELECTORS },
      returnsS: { ...SELECTORS, RETURN_SELECT_VERIFIED: true },
      pacer,
      pageMs: 90_000,
      url: URL0,
      request: { departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2026-11-15') },
      stepMs: {},
      clicked: [],
      stop: () => Promise.reject(new Error('no stop expected')),
    });
    expect(out.kind).toBe('read');
    const steps = out.kind === 'read' ? out.data.steps : null;
    expect(steps).toEqual([
      expect.objectContaining({
        step: 'first-selection',
        activation: 'keyboard',
        selectFailed: 'press-outbound:no-activation',
        after: expect.objectContaining({ settled: false, changedFromPreClick: false }),
      }),
    ]);
  });
});

// why: Ian's ruling of 2026-11-01 (read the booking options): `record --select-return` selects the outbound as
// --select-outbound does, then the cheapest return on the return date, and records the booking view after it; it
// activates nothing on the booking view
describe('record --select-return: the return selected, the booking view recorded', () => {
  const SELECT_RETURN = ['--select-return', ...Q];
  const RET_OTHER_DAY = returnOptionName({ pounds: 300, on: 'Monday, November 16', priceForm: 'from' });
  const RET_CHEAP = returnOptionName({ pounds: 451, priceForm: 'from' });
  const RET_TIE = returnOptionName({ pounds: 451, carrier: 'QQ Air', priceForm: 'from' });
  const RET_DEAR = returnOptionName({ pounds: 470, priceForm: 'from' });
  const RETURNS = [RET_DEAR, RET_OTHER_DAY, RET_CHEAP, RET_TIE];
  const booking = (): FakeNode =>
    n('document', 'Google Flights', [
      n('main', '', [
        n('heading', 'Booking options', [], { level: 2 }),
        n('list', '', [
          n('listitem', '', [
            n('link', 'Book with QQ Air', [], { href: 'https://www.example-airline.test/' }),
          ]),
          n('listitem', '', [
            n('link', 'Book with QQ Atlantic', [], { href: 'https://www.example-airline.test/2' }),
          ]),
        ]),
        n('button', 'More booking options'),
      ]),
    ]);
  const script = (o: { onReturn?: () => FakeNode[] | null } = {}): Script => ({
    afterGoto: () => [bestTree()],
    onTab: () => [cheapestTree()],
    onLink: (name) =>
      name === P451
        ? [returnTree(RETURNS)]
        : name === RET_CHEAP
          ? (o.onReturn ?? (() => [booking()]))()
          : null,
  });
  const facts = (t: ReturnType<typeof setup>) =>
    JSON.parse(readFileSync(join(t.root, 'select-return/2026-10-18/1.facts.json'), 'utf8'));
  it('selects the cheapest return on the return date by keyboard and records the booking view, activating nothing on it', async () => {
    const t = setup(script());
    expect(await record(t.ctx(SELECT_RETURN), cfg, t.deps)).toBe(0);
    expect(t.err).toEqual([]);
    const f = facts(t);
    expect(f.kind).toBe('select-return');
    // why: another day's cheaper return is never a pick; the tie goes to page order
    expect(f.picks).toEqual([
      { name: P451, linkIndex: 2 },
      { name: RET_CHEAP, linkIndex: 2 },
    ]);
    expect(f.steps.map((s: { step: string }) => s.step)).toEqual(['first-selection', 'return-selection']);
    const ret = f.steps[1];
    expect(ret).toMatchObject({
      activation: 'keyboard',
      target: { matches: 1, visible: true },
      after: {
        settled: true,
        changedFromPreClick: true,
        documentLoadsBefore: 1,
        documentLoads: 1,
        classification: { kind: 'blocked', rule: 'booking-view' },
        headings: ['Booking options'],
        linkNames: ['Book with QQ Air', 'Book with QQ Atlantic'],
        booking: {
          headingLevels: [0, 1, 0, 0, 0, 0],
          roleCounts: { link: 2, button: 1, listitem: 2, list: 1, heading: 1, dialog: 0 },
        },
      },
    });
    expect(ret.after.buttonNames).toContain('More booking options');
    const calls = t.contexts[0]?.pages[0]?.calls;
    expect(calls?.presses).toEqual([`Enter:link:${P451}`, `Enter:link:${RET_CHEAP}`]);
    expect(calls?.clicks.filter((c) => !c.startsWith('tab:'))).toEqual([]);
    expect(f.clicked).toEqual(['tab:Cheapest', `link:${P451}`, `link:${RET_CHEAP}`]);
    expect(
      JSON.parse(readFileSync(join(t.root, 'select-return/2026-10-18/1.meta.json'), 'utf8')),
    ).toMatchObject({
      kind: 'select-return',
      documentLoads: 1,
    });
  });
  it('claims 3 pages before the first load and settles to the documents loaded', async () => {
    const t = setup(script());
    expect(await record(t.ctx(SELECT_RETURN), cfg, t.deps)).toBe(0);
    expect(t.seen[0]).toMatchObject({ at: 'goto-1', pages: 3 });
    expect(t.months()).toBe(1);
    const doc = setup({ ...script(), documentPerSelection: true });
    expect(await record(doc.ctx(SELECT_RETURN), cfg, doc.deps)).toBe(0);
    expect(doc.months()).toBe(3);
  });
  it('passes a cap of 4 page timeouts and 2 spacings (420,000 ms) to the page budget', async () => {
    const t = setup(script());
    vi.mocked(budget.pageBudget).mockClear();
    expect(await record(t.ctx(SELECT_RETURN), cfg, t.deps)).toBe(0);
    expect(vi.mocked(budget.pageBudget).mock.calls.map((c) => [c[1], c[3]])).toEqual([[90_000, 420_000]]);
    expect(selectReturnCapMs(90_000, 30_000)).toBe(420_000);
  });
  it('with 2 pages left it is refused before anything loads', async () => {
    const t = setup(script());
    writeFileSync(
      join(t.dataDir, 'monthly.json'),
      JSON.stringify({
        windowStart: '2026-10-01T00:00:00.000Z',
        windowEnd: '2026-11-01T00:00:00.000Z',
        pages: 1498,
        scrolls: 0,
      }),
      { mode: 0o600 },
    );
    expect(await record(t.ctx(SELECT_RETURN), cfg, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toContain(
      "the worker's monthly page cap leaves fewer than the 3 pages this recording may load",
    );
    expect(t.contexts).toEqual([]);
  });
  it('an Enter on the return that changes nothing within the step is press-return:no-activation', async () => {
    const t = setup(script({ onReturn: () => null }));
    expect(await record(t.ctx(SELECT_RETURN), cfg, t.deps)).toBe(0);
    expect(facts(t).steps[1]).toMatchObject({
      step: 'return-selection',
      activation: 'keyboard',
      selectFailed: 'press-return:no-activation',
      after: { settled: false, changedFromPreClick: false },
    });
  });
  it('a challenge after the return’s activation is that stop', async () => {
    const t = setup(
      script({ onReturn: () => [n('document', '', [text('Please confirm you are not a robot')])] }),
    );
    expect(await record(t.ctx(SELECT_RETURN), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(t.cooldown()?.cause).toBe('captcha');
  });
  it('no return on the return date: the return selection has no pick, and nothing more is activated', async () => {
    const t = setup({
      ...script(),
      onLink: (name) => (name === P451 ? [returnTree([RET_OTHER_DAY])] : null),
    });
    expect(await record(t.ctx(SELECT_RETURN), cfg, t.deps)).toBe(0);
    expect(facts(t).steps.at(-1)).toEqual({ step: 'return-selection', selectFailed: 'no-pick' });
    expect(t.contexts[0]?.pages[0]?.calls.presses).toEqual([`Enter:link:${P451}`]);
  });
});
