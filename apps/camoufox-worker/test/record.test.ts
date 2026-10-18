import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { BlockedPage } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';
import { CooldownStore } from '../src/cooldown.js';
import { createDriver, probePage } from '../src/driver.js';
import { buildLaunchOptions, launchOptionsForMeta, prepareLaunch } from '../src/launch.js';
import { acquireLock } from '../src/lock.js';
import { debugLogging } from '../src/log.js';
import { profileDir } from '../src/paths.js';
import {
  assertClean,
  parseRecordArgs,
  type RecordDeps,
  realRecordDeps,
  record,
  stderrLog,
} from '../src/record.js';
import { Refusal } from '../src/refusal.js';
import { type EntryContext, EX_CONFIG, EX_UNAVAILABLE } from '../src/run.js';
import { SELECTORS } from '../src/selectors.js';
import { FakeContext } from './support/fakeContext.js';
import { descendants, FakePage, type Navigation, n, option, resultsTree, text } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { fakeTimers } from './support/timers.js';
import { fakeInstall, tmpDir } from './support/tmp.js';

const KEY = 'synthetic-worker-key-0123456789abcdef';
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
const Q = ['--origin', 'LHR', '--destination', 'JFK', '--depart', '2026-11-05', '--return', '2026-11-15'];
const URL0 =
  'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2026-11-05+returning+2026-11-15&curr=GBP&hl=en-GB&gl=GB';
const LANDED = 'https://www.google.com/travel/flights/search?tfs=x';
const cfg = loadWorkerConfig({ CAMOUFOX_WORKER_KEY: KEY, HOME: '/Users/op' });

function setup(o: { socs?: boolean; navigations?: FakeContext['navigations']; launchThrows?: boolean } = {}) {
  const dataDir = tmpDir();
  if (o.socs !== false) writeFileSync(join(dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
  const root = tmpDir();
  const timers = fakeTimers();
  const contexts: FakeContext[] = [];
  const profiles: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: RecordDeps = {
    clock: timers.clock,
    timers,
    log: memoryLog(),
    launch: async (profile) => {
      profiles.push(profile);
      if (o.launchThrows === true) throw new Error('launch failed');
      mkdirSync(profile, { recursive: true });
      const c = new FakeContext();
      c.navigations = o.navigations ?? [{ hops: [URL0, LANDED], tree: resultsTree() }];
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
  return { dataDir, root, timers, contexts, profiles, out, err, deps, ctx };
}
/** Files written under the root; stop records (`stopped/`) only when asked, since "nothing written" means recordings. */
function written(root: string, o: { stopped?: boolean } = {}): string[] {
  return writtenAll(root).filter((f) => o.stopped === true || !f.startsWith('stopped/'));
}
function writtenAll(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }))
      e.isDirectory() ? walk(join(d, e.name), `${rel}${e.name}/`) : out.push(`${rel}${e.name}`);
  };
  if (existsSync(root)) walk(root, '');
  return out.sort();
}

beforeEach(() => {
  expect.hasAssertions();
});

describe('the recorder (brief Task 14.2 rules)', () => {
  it('rule 1: sets SOCS before the page, lands on the allowlist and writes facts and meta (names, never ARIA text)', async () => {
    const t = setup();
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(0);
    expect(written(t.root)).toEqual(['results/2026-10-18/1.facts.json', 'results/2026-10-18/1.meta.json']);
    const c = t.contexts[0];
    if (c === undefined) throw new Error('no context');
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
    expect(c.pages[0]?.calls.gotos[0]?.url).toBe(URL0);
    const factsText = readFileSync(join(t.root, 'results/2026-10-18/1.facts.json'), 'utf8');
    const facts = JSON.parse(factsText);
    const meta = JSON.parse(readFileSync(join(t.root, 'results/2026-10-18/1.meta.json'), 'utf8'));
    expect(facts.names).toHaveLength(2);
    expect(facts.landing).toBe(LANDED);
    expect(facts.hops).toEqual([URL0, LANDED]);
    expect(facts.socsReadBack).toBe('same');
    expect(facts.clicked).toEqual([]);
    expect(meta).toMatchObject({
      recordedBy: 'camoufox-worker record',
      kind: 'results',
      socsReadBack: 'same',
      versions: { camoufoxJs: '0.11.5', binary: '152.0.4-beta.28' },
    });
    expect('env' in meta.launchOptions).toBe(false);
    expect(meta.contentSha256).toBe(createHash('sha256').update(factsText).digest('hex'));
    expect(factsText).not.toContain(SOCS_VALUE);
    expect(factsText).not.toMatch(/- (link|tab|button) "/);
  });
  it('rule 1: every Google-facing run requires a valid SOCS capture; without one nothing launches', async () => {
    const t = setup({ socs: false });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_CONFIG);
    expect(t.profiles).toEqual([]);
    expect(t.err.join()).toMatch(/capture-socs/);
  });
  it('rule 1: an off-allowlist hop records nothing and cools down', async () => {
    const t = setup({ navigations: [{ hops: [URL0, 'https://www.example.test/x'], tree: resultsTree() }] });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(written(t.root)).toEqual([]);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active()?.cause,
    ).toBe('off-allowlist');
  });
  it('rule 1: a consent landing is recorded as the failure it is, starts the 48 h cool-down and stops the session', async () => {
    const t = setup({
      navigations: [
        {
          hops: [URL0, 'https://consent.google.com/ml?continue=x'],
          tree: n('document', '', [n('heading', 'Before you continue to Google')]),
        },
      ],
    });
    expect(await record(t.ctx([...Q, '--pages', '2']), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(written(t.root)).toEqual(['results/2026-10-18/1.facts.json', 'results/2026-10-18/1.meta.json']);
    const facts = JSON.parse(readFileSync(join(t.root, 'results/2026-10-18/1.facts.json'), 'utf8'));
    expect(facts).toEqual({
      failure: 'consent-unhandled',
      landing: 'https://consent.google.com/ml',
      hops: ['https://www.google.com/travel/flights', 'https://consent.google.com/ml'],
      socsReadBack: 'same',
    });
    expect(new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active()).toEqual(
      {
        until: '2026-10-20T05:00:00.000Z',
        cause: 'consent-unhandled',
      },
    );
    expect(t.contexts[0]?.pages).toHaveLength(1);
    expect(t.err.join()).toMatch(/operator ruling/);
  });
  it('rule 1: a SOCS rewritten by the page is a consent-unhandled stop', async () => {
    const t = setup();
    const r = record(t.ctx(Q), cfg, {
      ...t.deps,
      launch: async (p) => {
        const c = await t.deps.launch(p);
        if (c instanceof FakeContext)
          c.afterGoto = (jar) => jar.map((x) => (x.name === 'SOCS' ? { ...x, value: 'accepted' } : x));
        return c;
      },
    });
    expect(await r).toBe(EX_UNAVAILABLE);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active()?.cause,
    ).toBe('consent-unhandled');
  });
  it('rule 2: --stability loads three pages of the same query 30 s apart and records each read-back', async () => {
    const t = setup();
    expect(await record(t.ctx([...Q, '--stability']), cfg, t.deps)).toBe(0);
    expect(written(t.root).filter((f) => f.endsWith('.meta.json'))).toEqual([
      'socs-stability/2026-10-18/1.meta.json',
      'socs-stability/2026-10-18/2.meta.json',
      'socs-stability/2026-10-18/3.meta.json',
    ]);
    // why: each page spends one 2 s stability poll (ruling of 2026-10-18), so the spacing waits 30 − 2 − 2 = 26 s
    expect(t.timers.sleeps.filter((ms) => ms >= 26_000)).toEqual([26_000, 26_000]);
    expect(t.contexts[0]?.added).toHaveLength(3);
  });
  it('rule 2: a read-back other than same says SOCS_STABLE needs an operator ruling', async () => {
    const t = setup();
    let page = 0;
    const r = await record(t.ctx([...Q, '--stability']), cfg, {
      ...t.deps,
      launch: async (p) => {
        const c = await t.deps.launch(p);
        if (c instanceof FakeContext)
          c.afterGoto = (jar) => (++page === 2 ? jar.filter((x) => x.name !== 'SOCS') : jar);
        return c;
      },
    });
    expect(r).toBe(EX_UNAVAILABLE);
    expect(t.err.join()).toMatch(/operator ruling/);
  });
  it('rule 3: the consent probe uses a throwaway profile, no SOCS, the probe guard and no click; it starts no cool-down and deletes its profile', async () => {
    const t = setup({
      navigations: [
        {
          hops: [
            'https://www.google.com/travel/flights?curr=GBP&hl=en-GB&gl=GB',
            'https://consent.google.com/ml?continue=x',
          ],
          tree: n('document', '', [
            n('heading', 'Before you continue to Google'),
            n('button', 'Reject all'),
            n('button', 'Accept all'),
          ]),
        },
      ],
    });
    expect(await record(t.ctx(['--consent-probe']), cfg, t.deps)).toBe(0);
    expect(t.profiles).toHaveLength(1);
    expect(t.profiles[0]).toMatch(/\/probe-\d+-4242$/);
    expect(existsSync(t.profiles[0] ?? '')).toBe(false);
    expect(t.contexts[0]?.added).toEqual([]);
    expect(t.contexts[0]?.pages[0]?.calls.clicks).toEqual([]);
    expect(written(t.root)).toEqual([
      'consent-probe/2026-10-18/1.facts.json',
      'consent-probe/2026-10-18/1.meta.json',
    ]);
    const facts = JSON.parse(readFileSync(join(t.root, 'consent-probe/2026-10-18/1.facts.json'), 'utf8'));
    expect(facts.page.text.consentHeading).toBe(true);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active(),
    ).toBeNull();
  });
  it('rule 3: the probe page has no click method, and another blocked kind cools down as usual', async () => {
    const page = new FakePage(null);
    const probe = probePage(createDriver(page, { hops: [], frameUrls: [], refused: null }));
    expect('click' in probe).toBe(false);
    expect('clickCheapest' in probe).toBe(false);
    const t = setup({
      navigations: [
        {
          hops: ['https://www.google.com/travel/flights?curr=GBP&hl=en-GB&gl=GB'],
          tree: n('document', '', [text('Our systems have detected unusual traffic')]),
        },
      ],
    });
    expect(await record(t.ctx(['--consent-probe']), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active()?.cause,
    ).toBe('unusual-traffic');
    expect(existsSync(t.profiles[0] ?? '')).toBe(false);
  });
  it('rule 3: the probe deletes its profile when the launch throws', async () => {
    const t = setup({ launchThrows: true });
    expect(await record(t.ctx(['--consent-probe']), cfg, t.deps)).not.toBe(0);
    expect(existsSync(t.profiles[0] ?? '')).toBe(false);
  });
  it('rule 4: --no-flights without a recognisable line writes no-flights/unrecorded.meta.json', async () => {
    const t = setup();
    expect(await record(t.ctx([...Q, '--no-flights']), cfg, t.deps)).toBe(0);
    expect(written(t.root)).toEqual(['no-flights/unrecorded.meta.json']);
    expect(SELECTORS.NO_FLIGHTS_VERIFIED).toBe(false);
  });
  it('rule 4: --no-flights with the line records the page', async () => {
    const t = setup({
      navigations: [
        { hops: [URL0, LANDED], tree: n('document', '', [text('No results returned for this search')]) },
      ],
    });
    expect(await record(t.ctx([...Q, '--no-flights']), cfg, t.deps)).toBe(0);
    expect(written(t.root)).toEqual([
      'no-flights/2026-10-18/1.facts.json',
      'no-flights/2026-10-18/1.meta.json',
    ]);
  });
  it('rule 5: --cheapest clicks the Cheapest tab, --view-more clicks View more, a plain run clicks nothing; --grid is refused', async () => {
    const a = setup();
    expect(await record(a.ctx([...Q, '--cheapest']), cfg, a.deps)).toBe(0);
    expect(a.contexts[0]?.pages[0]?.calls.clicks).toEqual(['tab:Cheapest from 451 British pounds']);
    const facts = JSON.parse(readFileSync(join(a.root, 'cheapest/2026-10-18/1.facts.json'), 'utf8'));
    expect(facts.clicked).toEqual(['tab:Cheapest']);
    const b = setup();
    expect(await record(b.ctx([...Q, '--view-more']), cfg, b.deps)).toBe(0);
    expect(b.contexts[0]?.pages[0]?.calls.clicks).toEqual(['button:View more flights']);
    const c = setup();
    expect(await record(c.ctx(Q), cfg, c.deps)).toBe(0);
    expect(c.contexts[0]?.pages[0]?.calls.clicks).toEqual([]);
    const g = setup();
    expect(await record(g.ctx([...Q, '--grid']), cfg, g.deps)).toBe(EX_CONFIG);
    expect(g.profiles).toEqual([]);
  });
  // why: ruling of 2026-10-18: the Cheapest tab's information pop-up is closed through its own button, then the tab
  it('--cheapest closes the tab’s pop-up, clicks the tab, settles again and records what it clicked', async () => {
    const POP = 'Cheapest from £443 Close dialogue Looking for the lowest fares?';
    const tree = resultsTree({ tab: POP });
    for (const c of descendants([tree]))
      if (c.role === 'tab' && c.name === POP) c.children = [n('button', 'Close dialogue')];
    const t = setup({ navigations: [{ hops: [URL0, LANDED], tree }] });
    expect(await record(t.ctx([...Q, '--cheapest']), cfg, t.deps)).toBe(0);
    expect(t.contexts[0]?.pages[0]?.calls.clicks).toEqual(['button:Close dialogue', `tab:${POP}`]);
    const facts = JSON.parse(readFileSync(join(t.root, 'cheapest/2026-10-18/1.facts.json'), 'utf8'));
    expect(facts.clicked).toEqual(['button:Close dialogue', 'tab:Cheapest']);
  });
  // why: ruling of 2026-10-18: the Cheapest view settles on its selected tab (no results line), on its own budget
  // from the click, within twice the page timeout
  const cheapestFlow = (firstPolls: number, cheapestPolls: number) => {
    const t = setup();
    const fetching = n('document', '', [text('Fetching results')]);
    const view = () => {
      const v = resultsTree({ tab: 'Cheapest from £443' });
      for (const c of descendants([v]))
        if (c.role === 'tab' && c.name === 'Cheapest from £443') c.selected = true;
      v.children = (v.children ?? []).filter((c) => !/results returned/.test(c.name ?? ''));
      return v;
    };
    const deps: RecordDeps = {
      ...t.deps,
      launch: async (prof) => {
        const c = await t.deps.launch(prof);
        if (c instanceof FakeContext)
          c.onNewPage = (pg) => {
            const g = pg.goto.bind(pg);
            pg.goto = async (u, o) => {
              const r = await g(u, o);
              pg.setTrees([...Array(firstPolls).fill(fetching), resultsTree({ tab: 'Cheapest from £443' })]);
              return r;
            };
            pg.onClick = (x) => {
              if (x.role === 'tab') pg.setTrees([...Array(cheapestPolls).fill(fetching), view()]);
            };
          };
        return c;
      },
    };
    return { t, deps };
  };
  it('--cheapest: the Cheapest view settles without the results line, on its own budget from the click', async () => {
    const { t, deps } = cheapestFlow(41, 10);
    expect(await record(t.ctx([...Q, '--cheapest']), cfg, deps)).toBe(0);
    expect(written(t.root)).toContain('cheapest/2026-10-18/1.facts.json');
  });
  it('--cheapest: a Cheapest view that never settles ends at the cap, nothing written, no cool-down', async () => {
    const { t, deps } = cheapestFlow(41, 1000);
    const before = t.timers.now();
    expect(await record(t.ctx([...Q, '--cheapest']), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/did not settle/);
    expect(written(t.root)).toEqual([]);
    expect(t.timers.now() - before).toBeLessThanOrEqual(180_000 + 10_000);
  });
  it('--cheapest whose tab cannot be clicked refuses plainly, with no cool-down', async () => {
    const t = setup();
    const deps: RecordDeps = {
      ...t.deps,
      launch: async (p) => {
        const c = await t.deps.launch(p);
        if (c instanceof FakeContext)
          c.onNewPage = (pg) => {
            pg.onClick = () => {
              throw Object.assign(new Error('locator.click: Timeout'), { name: 'TimeoutError' });
            };
          };
        return c;
      },
    };
    expect(await record(t.ctx([...Q, '--cheapest']), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/the Cheapest tab could not be clicked/);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active(),
    ).toBeNull();
    expect(written(t.root)).toEqual([]);
  });
  it('rule 6: nothing is written when the facts hold the key, the SOCS value, an account name or an e-mail address', async () => {
    for (const bad of [KEY, SOCS_VALUE, 'Google Account: Example', 'someone@example.test'])
      expect(() => assertClean(`{"x":"${bad}"}`, [KEY, SOCS_VALUE])).toThrow(/nothing written/);
    expect(() => assertClean('{"x":"clean"}', [KEY, ''])).not.toThrow();
    const t = setup({
      navigations: [
        {
          hops: [URL0, LANDED],
          tree: resultsTree({
            top: [option(478)],
            other: [
              n('listitem', '', [
                n('link', 'From 9 British pounds round trip total. Contact someone@example.test'),
              ]),
            ],
          }),
        },
      ],
    });
    expect(await record(t.ctx(Q), cfg, t.deps)).not.toBe(0);
    expect(written(t.root)).toEqual([]);
  });
  it('rule 6: --pages at most 3; refuses while the worker’s lock is held', async () => {
    const t = setup();
    expect(await record(t.ctx([...Q, '--pages', '4']), cfg, t.deps)).toBe(EX_CONFIG);
    acquireLock(t.dataDir, { pid: 9999 });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/pid 9999/);
    expect(t.profiles).toEqual([]);
  });
  it('rule 6: the spacing applies across recorder runs (the shared persisted pacer)', async () => {
    const t = setup();
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(0);
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(0);
    expect(t.timers.sleeps).toContain(26_000);
    expect(t.out.join()).toMatch(/waiting 26 s for the spacing/);
  });
  it('a standing cool-down refuses before any launch', async () => {
    const t = setup();
    new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).start('captcha');
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(t.profiles).toEqual([]);
  });
  it('an account cookie in the profile stops before any page and cools down', async () => {
    const t = setup();
    const r = await record(t.ctx(Q), cfg, {
      ...t.deps,
      launch: async (p) => {
        const c = await t.deps.launch(p);
        if (c instanceof FakeContext)
          c.jar.push({ name: 'SID', value: 'x', domain: '.google.com', path: '/' });
        return c;
      },
    });
    expect(r).toBe(EX_UNAVAILABLE);
    expect(t.contexts[0]?.pages).toEqual([]);
    expect(t.err.join()).toMatch(/SID/);
  });
  it('a page that never settles is refused at the page deadline', async () => {
    const t = setup({
      navigations: [{ hops: [URL0, LANDED], tree: n('document', '', [text('Fetching results')]) }],
    });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/did not settle/);
  });
  it('a navigation the guard refuses is that kind', async () => {
    const t = setup({ navigations: [{ hops: ['https://accounts.google.com/ServiceLogin'] }] });
    const r = await record(t.ctx(Q), cfg, {
      ...t.deps,
      launch: async (p) => {
        const c = await t.deps.launch(p);
        return c;
      },
    });
    expect(r).toBe(EX_UNAVAILABLE);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active()?.cause,
    ).toBe('sign-in');
  });
});

// Fix round 1 (sec I2, I3, M4, M6; prov-int I2, I3, I4): the recorder applies the server's stop rules to the shared
// profile, reads SOCS back after its clicks, classifies every re-poll, and never exempts --no-flights.
describe('the recorder under the server’s stop rules (fix round 1)', () => {
  const cooldownOf = (t: ReturnType<typeof setup>) =>
    new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active();
  const withContext = (t: ReturnType<typeof setup>, shape: (c: FakeContext) => void): RecordDeps => ({
    ...t.deps,
    launch: async (p) => {
      const c = await t.deps.launch(p);
      if (c instanceof FakeContext) shape(c);
      return c;
    },
  });
  it('a standing signed-in refusal refuses before any launch, naming clear-signed-in', async () => {
    const t = setup();
    new Refusal({ dir: t.dataDir, clock: t.timers.clock }).set('a signed-in account control');
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(t.profiles).toEqual([]);
    expect(t.err.join()).toMatch(/clear-signed-in/);
  });
  it('an account cookie sets the persisted signed-in refusal', async () => {
    const t = setup();
    const r = await record(
      t.ctx(Q),
      cfg,
      withContext(t, (c) => c.jar.push({ name: 'SID', value: 'x', domain: '.google.com', path: '/' })),
    );
    expect(r).toBe(EX_UNAVAILABLE);
    expect(new Refusal({ dir: t.dataDir, clock: t.timers.clock }).active()).not.toBeNull();
    expect(existsSync(profileDir(t.dataDir))).toBe(true);
  });
  it('a signed-in page sets the persisted signed-in refusal', async () => {
    const t = setup({
      navigations: [
        {
          hops: [URL0, LANDED],
          tree: resultsTree({ extra: [n('button', 'Google Account: Example Person')] }),
        },
      ],
    });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('signed-in');
    expect(new Refusal({ dir: t.dataDir, clock: t.timers.clock }).active()).not.toBeNull();
  });
  it('a consent landing wipes the shared profile', async () => {
    const t = setup({
      navigations: [
        {
          hops: [URL0, 'https://consent.google.com/ml?continue=x'],
          tree: n('document', '', [n('heading', 'Before you continue to Google')]),
        },
      ],
    });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(existsSync(profileDir(t.dataDir))).toBe(false);
    expect(t.contexts[0]?.closed).toBeGreaterThanOrEqual(1);
  });
  it('a SOCS rewritten by the page wipes the shared profile', async () => {
    const t = setup();
    const deps = withContext(t, (c) => {
      c.afterGoto = (jar) => jar.map((x) => (x.name === 'SOCS' ? { ...x, value: 'accepted' } : x));
    });
    expect(await record(t.ctx(Q), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(existsSync(profileDir(t.dataDir))).toBe(false);
  });
  it('--cheapest: a SOCS the click changes is read back after the click: consent-unhandled, wiped, nothing recorded as cheapest', async () => {
    const t = setup();
    const deps = withContext(t, (c) => {
      c.onNewPage = (p) => {
        p.onClick = () => {
          c.jar = c.jar.map((x) => (x.name === 'SOCS' ? { ...x, value: 'accepted-by-click' } : x));
        };
      };
    });
    expect(await record(t.ctx([...Q, '--cheapest']), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('consent-unhandled');
    expect(existsSync(profileDir(t.dataDir))).toBe(false);
    const facts = written(t.root).filter((f) => f.endsWith('.facts.json'));
    for (const f of facts)
      expect(JSON.parse(readFileSync(join(t.root, f), 'utf8')).failure, f).toBe('consent-unhandled');
  });
  it('--cheapest: a captcha after the click is that stop: 48 h, nothing written', async () => {
    const t = setup();
    const deps = withContext(t, (c) => {
      c.onNewPage = (p) => {
        p.onClick = () =>
          p.setTrees([n('document', '', [text('Our systems have detected unusual traffic')])]);
      };
    });
    expect(await record(t.ctx([...Q, '--cheapest']), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('unusual-traffic');
    expect(written(t.root)).toEqual([]);
  });
  it('one deadline covers the load and the clicks: a click past it is the deadline refusal, not a crash', async () => {
    const fetching = n('document', '', [text('Fetching results')]);
    const t = setup({ navigations: [{ hops: [URL0, LANDED], tree: resultsTree() }] });
    const deps = withContext(t, (c) => {
      c.onNewPage = (p) => {
        const g = p.goto.bind(p);
        p.goto = async (u, o) => {
          const r = await g(u, o);
          // why: 44 polls of 2 s (88 s) to settle, then the click needs more polls than the 90 s deadline leaves
          p.setTrees([...Array(44).fill(fetching), resultsTree()]);
          return r;
        };
        p.onClick = () => p.setTrees([...Array(5).fill(fetching), resultsTree()]);
      };
    });
    expect(await record(t.ctx([...Q, '--cheapest']), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/did not settle within CAMOUFOX_PAGE_TIMEOUT_SECONDS/);
    expect(written(t.root)).toEqual([]);
  });
  it('an off-allowlist hop that arrives after the last settling poll records nothing and cools down', async () => {
    const t = setup();
    const deps = withContext(t, (c) => {
      c.onNewPage = (p) => {
        const byRole = p.getByRole.bind(p);
        let fired = false;
        p.getByRole = (role, o) => {
          if (role === 'textbox' && !fired) {
            fired = true;
            p.emitFrameNavigated({ url: () => 'https://www.example.test/late', parentFrame: () => null });
          }
          return byRole(role, o);
        };
      };
    });
    expect(await record(t.ctx(Q), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(written(t.root)).toEqual([]);
    expect(cooldownOf(t)?.cause).toBe('off-allowlist');
  });
  it('--no-flights: an off-allowlist landing is refused like any other (no exemption)', async () => {
    const t = setup({ navigations: [{ hops: [URL0, 'https://www.example.test/x'], tree: resultsTree() }] });
    expect(await record(t.ctx([...Q, '--no-flights']), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(written(t.root)).toEqual([]);
    expect(cooldownOf(t)?.cause).toBe('off-allowlist');
  });
  it('--no-flights: a page that never settles writes unrecorded.meta.json from what appeared and exits 0', async () => {
    const t = setup({
      navigations: [
        {
          hops: [URL0, LANDED],
          tree: n('document', '', [n('heading', 'Sorry, nothing matched these dates')]),
        },
      ],
    });
    expect(await record(t.ctx([...Q, '--no-flights']), cfg, t.deps)).toBe(0);
    expect(written(t.root)).toEqual(['no-flights/unrecorded.meta.json']);
    const u = JSON.parse(readFileSync(join(t.root, 'no-flights/unrecorded.meta.json'), 'utf8'));
    // why: what appeared is the page facts and its headings, never printed text (rule 6)
    expect(u.appeared.headings).toEqual(['Sorry, nothing matched these dates']);
    expect(t.out.join()).toMatch(/NO_FLIGHTS_VERIFIED stays false/);
  });
  it('a read-back that never answers writes nothing and refuses', async () => {
    const t = setup();
    // why: cookies() call 0 is the account check, call 1 the read-back after the page
    const deps = withContext(t, (c) => (c.hangCookiesOn = 1));
    expect(await record(t.ctx(Q), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/read-back overran/);
    expect(written(t.root)).toEqual([]);
  });
  // why: fix round 2 (re-review N1, CodeRabbit): a stop keeps its cool-down, refusal and wipe when the read-back then
  // overruns, as the server's does; only a page that met no stop is refused for the overrun
  it.each([
    [
      'captcha',
      {
        hops: [URL0, LANDED],
        tree: resultsTree(),
        frames: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
      },
    ],
    [
      'unusual-traffic',
      { hops: [URL0, LANDED], tree: n('document', '', [text('Our systems have detected unusual traffic')]) },
    ],
    ['sign-in', { hops: [URL0, 'https://accounts.google.com/ServiceLogin'] }],
    [
      'signed-in',
      { hops: [URL0, LANDED], tree: resultsTree({ extra: [n('button', 'Google Account: Example Person')] }) },
    ],
    [
      'consent-unhandled',
      {
        hops: [URL0, 'https://consent.google.com/ml?continue=x'],
        tree: n('document', '', [n('heading', 'Before you continue to Google')]),
      },
    ],
    ['off-allowlist', { hops: [URL0, 'https://www.example.test/x'], tree: resultsTree() }],
  ] satisfies Array<[BlockedPage, Navigation]>)(
    'a %s stop whose read-back overruns still cools down by its cause',
    async (cause, nav) => {
      const t = setup({ navigations: [nav] });
      const deps = withContext(t, (c) => (c.hangCookiesOn = 1));
      expect(await record(t.ctx(Q), cfg, deps)).toBe(EX_UNAVAILABLE);
      expect(cooldownOf(t)).toEqual({ until: '2026-10-20T05:00:05.000Z', cause });
      expect(new Refusal({ dir: t.dataDir, clock: t.timers.clock }).active() !== null).toBe(
        cause === 'signed-in',
      );
      expect(existsSync(profileDir(t.dataDir))).toBe(cause !== 'consent-unhandled');
      expect(t.contexts[0]?.closed).toBeGreaterThanOrEqual(1);
    },
  );
  it('an account-cookie stop whose read-back overruns sets the refusal and cools down', async () => {
    const t = setup();
    const deps = withContext(t, (c) => {
      c.jar.push({ name: 'SID', value: 'x', domain: '.google.com', path: '/' });
      c.hangCookiesOn = 1;
    });
    expect(await record(t.ctx(Q), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('signed-in');
    expect(new Refusal({ dir: t.dataDir, clock: t.timers.clock }).active()).not.toBeNull();
  });
  it('a read-back overrun on a page with no stop closes the context and refuses', async () => {
    const t = setup();
    const deps = withContext(t, (c) => (c.hangCookiesOn = 1));
    expect(await record(t.ctx(Q), cfg, deps)).toBe(EX_CONFIG);
    expect(cooldownOf(t)).toBeNull();
    expect(t.contexts[0]?.closed).toBeGreaterThanOrEqual(1);
  });
  it('a captcha page whose SOCS also changed keeps captcha, and the profile is wiped', async () => {
    const t = setup({
      navigations: [
        {
          hops: [URL0, LANDED],
          tree: resultsTree(),
          frames: ['https://www.google.com/recaptcha/api2/anchor?k=x'],
        },
      ],
    });
    const deps = withContext(t, (c) => {
      c.afterGoto = (jar) => jar.map((x) => (x.name === 'SOCS' ? { ...x, value: 'accepted' } : x));
    });
    expect(await record(t.ctx(Q), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('captcha');
    expect(existsSync(profileDir(t.dataDir))).toBe(false);
  });
  // why: fix round 2 (re-review N4): directories and files an earlier recording made 0755/0644 are tightened at start
  it('existing recording directories become 0700 and their files 0600 when the recorder starts', async () => {
    const t = setup();
    const old = join(t.root, 'cheapest', '2026-10-01');
    mkdirSync(old, { recursive: true, mode: 0o755 });
    chmodSync(join(t.root, 'cheapest'), 0o755);
    chmodSync(old, 0o755);
    writeFileSync(join(old, '1.facts.json'), '{}', { mode: 0o644 });
    writeFileSync(join(t.root, 'cheapest', '.gitkeep'), '', { mode: 0o644 });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(0);
    expect(statSync(join(t.root, 'cheapest')).mode & 0o777).toBe(0o700);
    expect(statSync(old).mode & 0o777).toBe(0o700);
    expect(statSync(join(old, '1.facts.json')).mode & 0o777).toBe(0o600);
  });
  // why: diagnostics of 2026-10-18: every stop writes the facts the classifier saw (host and path only, never a query),
  // names the rule that fired, and logs the decision at debug
  it('a stop writes a stopped record without any query string, naming the rule, 0600', async () => {
    const t = setup({
      navigations: [
        {
          hops: [`${URL0}&x=secret-query`, `${LANDED}&more=secret-query`],
          tree: resultsTree(),
          frames: ['https://www.google.com/recaptcha/api2/anchor?k=secret-query'],
        },
      ],
    });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    const files = written(t.root, { stopped: true }).filter((f) => f.startsWith('stopped/'));
    expect(files).toEqual(['stopped/2026-10-18/1.facts.json']);
    const text = readFileSync(join(t.root, files[0] ?? ''), 'utf8');
    expect(text).not.toContain('secret-query');
    expect(text).not.toContain('?');
    expect(text).not.toMatch(/<html|<div/i);
    expect(statSync(join(t.root, files[0] ?? '')).mode & 0o777).toBe(0o600);
    const rec = JSON.parse(text);
    expect(rec).toMatchObject({
      cause: 'captcha',
      rule: 'captcha-frame',
      kind: 'results',
      url: 'www.google.com/travel/flights/search',
      hops: ['www.google.com/travel/flights', 'www.google.com/travel/flights/search'],
      frameUrls: expect.arrayContaining(['www.google.com/recaptcha/api2/anchor']),
      text: { challenge: false },
      accountControl: false,
      cheapestTabs: [{ name: 'Cheapest from 451 British pounds', inTablist: true }],
      dateGridButtons: 1,
      resultLinks: 2,
      clicked: [],
      socsReadBack: 'same',
    });
    expect(rec.settle).toMatchObject({ resultsReturned: true });
    expect(Array.isArray(rec.headings)).toBe(true);
  });
  it('a stop logs the classifier decision at debug: cause, rule, elapsed ms since the page started', async () => {
    // a page that settles but carries no Date grid button: unrecognised, by the date-grid rule
    const tree = resultsTree();
    tree.children = (tree.children ?? []).filter((c) => c.name !== 'Date grid');
    const t = setup({ navigations: [{ hops: [URL0, LANDED], tree }] });
    const log = memoryLog();
    expect(await record(t.ctx(Q), cfg, { ...t.deps, log })).toBe(EX_UNAVAILABLE);
    const decisions = log.lines.filter((l) => l.msg === 'classifier decision').map((l) => l.o);
    expect(decisions).toEqual([{ cause: 'unrecognised', rule: 'date-grid-buttons', elapsedMs: 2000 }]);
    const rec = JSON.parse(readFileSync(join(t.root, 'stopped/2026-10-18/1.facts.json'), 'utf8'));
    expect(rec).toMatchObject({ cause: 'unrecognised', rule: 'date-grid-buttons', dateGridButtons: 0 });
  });
  it('a stop with no page (an account cookie) still writes its record and decision', async () => {
    const t = setup();
    const log = memoryLog();
    const deps: RecordDeps = {
      ...t.deps,
      log,
      launch: async (p) => {
        const c = await t.deps.launch(p);
        if (c instanceof FakeContext)
          c.jar.push({ name: 'SID', value: 'x', domain: '.google.com', path: '/' });
        return c;
      },
    };
    expect(await record(t.ctx(Q), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(JSON.parse(readFileSync(join(t.root, 'stopped/2026-10-18/1.facts.json'), 'utf8'))).toMatchObject({
      cause: 'signed-in',
      rule: 'account-cookie',
    });
    expect(log.lines.filter((l) => l.msg === 'classifier decision').map((l) => l.o)).toMatchObject([
      { cause: 'signed-in', rule: 'account-cookie' },
    ]);
  });
  it('recordings are written 0600 in 0700 directories', async () => {
    const t = setup();
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(0);
    for (const f of written(t.root)) expect(statSync(join(t.root, f)).mode & 0o777, f).toBe(0o600);
    expect(statSync(join(t.root, 'results', '2026-10-18')).mode & 0o777).toBe(0o700);
  });
});

describe('parseRecordArgs', () => {
  it.each([
    [['--origin'], /needs a value/],
    [['--bogus'], /unknown argument/],
    [[...Q, '--cheapest', '--view-more'], /at most one/],
    [[...Q, '--pages', 'x'], /--pages/],
    [['--origin', 'L1', '--destination', 'JFK', '--depart', '2026-11-05', '--return', '2026-11-15'], /IATA/],
    [
      ['--origin', 'LHR', '--destination', 'JFK', '--depart', '2026-11-15', '--return', '2026-11-05'],
      /return after/,
    ],
  ])('refuses %j', (args, re) => {
    expect(() => parseRecordArgs(args)).toThrow(re);
  });
  it('defaults to one results page; the probe needs no query; stability defaults to three pages', () => {
    expect(parseRecordArgs(Q)).toMatchObject({ kind: 'results', pages: 1 });
    expect(parseRecordArgs(['--consent-probe'])).toEqual({ kind: 'consent-probe', request: null, pages: 1 });
    expect(parseRecordArgs([...Q, '--stability']).pages).toBe(3);
    expect(parseRecordArgs([...Q, '--no-flights']).kind).toBe('no-flights');
  });
});

describe('the real recorder dependencies (no launch)', () => {
  it('use the system clock, two-second polls, the module selectors and stderr JSON lines', () => {
    const f = fakeInstall({ version: '152.0.4', build: 'beta.28' });
    const prepared = prepareLaunch({
      platform: 'darwin',
      installDir: f.installDir,
      pinnedBuild: '152.0.4-beta.28',
      installDirOverride: undefined,
      home: '/h',
      path: '/p',
      tmp: '/t',
    });
    const lines: string[] = [];
    const d = realRecordDeps(prepared, (l) => lines.push(l));
    expect(d).toMatchObject({
      pollMs: 2000,
      selectors: SELECTORS,
      binary: '152.0.4-beta.28',
      pid: process.pid,
    });
    expect('env' in d.launchOptions).toBe(false);
    d.log.debug({ a: 1 });
    d.log.info({ a: 1 });
    d.log.child({}).warn({ host: 'www.example.test' }, 'navigation refused');
    stderrLog((l) => lines.push(l)).error({ x: 1 }, 'boom');
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { level: 'warn', msg: 'navigation refused', host: 'www.example.test' },
      { level: 'error', msg: 'boom', x: 1 },
    ]);
  });
});

// why: ruling of 2026-10-18: a refused path is diagnosable without a code change, by CAMOUFOX_LOG_DEBUG=true in worker.env
describe('stderrLog debug lines', () => {
  it('prints debug lines only when asked', () => {
    const on: string[] = [];
    const off: string[] = [];
    stderrLog((l) => on.push(l), true).debug({ path: '/_/OtherUi/x' }, 'navigation refused (path)');
    stderrLog((l) => off.push(l)).debug({ path: '/_/OtherUi/x' }, 'navigation refused (path)');
    expect(on.map((l) => JSON.parse(l))).toEqual([
      { level: 'debug', msg: 'navigation refused (path)', path: '/_/OtherUi/x' },
    ]);
    expect(off).toEqual([]);
  });
  it('debugLogging reads CAMOUFOX_LOG_DEBUG=true only', () => {
    expect([undefined, '', 'false', '1', 'true'].map((v) => debugLogging({ CAMOUFOX_LOG_DEBUG: v }))).toEqual(
      [false, false, false, false, true],
    );
  });
  it('the real recorder dependencies take the switch', () => {
    const f = fakeInstall({ version: '152.0.4', build: 'beta.28' });
    const prepared = prepareLaunch({
      platform: 'darwin',
      installDir: f.installDir,
      pinnedBuild: '152.0.4-beta.28',
      installDirOverride: undefined,
      home: '/h',
      path: '/p',
      tmp: '/t',
    });
    const lines: string[] = [];
    realRecordDeps(prepared, (l) => lines.push(l), true).log.debug({ a: 1 }, 'x');
    expect(lines).toHaveLength(1);
  });
});
