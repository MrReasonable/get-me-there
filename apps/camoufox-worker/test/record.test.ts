import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config.js';
import { CooldownStore } from '../src/cooldown.js';
import { createDriver, probePage } from '../src/driver.js';
import { buildLaunchOptions, launchOptionsForMeta, prepareLaunch } from '../src/launch.js';
import { acquireLock } from '../src/lock.js';
import {
  assertClean,
  parseRecordArgs,
  type RecordDeps,
  realRecordDeps,
  record,
  stderrLog,
} from '../src/record.js';
import { type EntryContext, EX_CONFIG, EX_UNAVAILABLE } from '../src/run.js';
import { SELECTORS } from '../src/selectors.js';
import { FakeContext } from './support/fakeContext.js';
import { FakePage, n, option, resultsTree, text } from './support/fakePage.js';
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
function written(root: string): string[] {
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
    expect(new CooldownStore({ dir: t.dataDir, botHours: 48, clock: t.timers.clock }).active()?.cause).toBe(
      'off-allowlist',
    );
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
    expect(new CooldownStore({ dir: t.dataDir, botHours: 48, clock: t.timers.clock }).active()).toEqual({
      until: '2026-10-20T05:00:00.000Z',
      cause: 'consent-unhandled',
    });
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
    expect(new CooldownStore({ dir: t.dataDir, botHours: 48, clock: t.timers.clock }).active()?.cause).toBe(
      'consent-unhandled',
    );
  });
  it('rule 2: --stability loads three pages of the same query 30 s apart and records each read-back', async () => {
    const t = setup();
    expect(await record(t.ctx([...Q, '--stability']), cfg, t.deps)).toBe(0);
    expect(written(t.root).filter((f) => f.endsWith('.meta.json'))).toEqual([
      'socs-stability/2026-10-18/1.meta.json',
      'socs-stability/2026-10-18/2.meta.json',
      'socs-stability/2026-10-18/3.meta.json',
    ]);
    expect(t.timers.sleeps.filter((ms) => ms >= 28_000)).toEqual([28_000, 28_000]);
    expect(t.contexts[0]?.added).toHaveLength(3);
  });
  it('rule 2: a read-back other than same leaves SOCS_STABLE false and says an operator ruling is needed', async () => {
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
    expect(SELECTORS.SOCS_STABLE).toBe(false);
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
    expect(new CooldownStore({ dir: t.dataDir, botHours: 48, clock: t.timers.clock }).active()).toBeNull();
  });
  it('rule 3: the probe page has no click method, and another blocked kind cools down as usual', async () => {
    const page = new FakePage(null);
    expect('click' in probePage(createDriver(page, { hops: [], frameUrls: [], refused: null }))).toBe(false);
    const t = setup({
      navigations: [
        {
          hops: ['https://www.google.com/travel/flights?curr=GBP&hl=en-GB&gl=GB'],
          tree: n('document', '', [text('Our systems have detected unusual traffic')]),
        },
      ],
    });
    expect(await record(t.ctx(['--consent-probe']), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(new CooldownStore({ dir: t.dataDir, botHours: 48, clock: t.timers.clock }).active()?.cause).toBe(
      'unusual-traffic',
    );
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
    expect(facts.clicked).toEqual(['tab:Cheapest from <n> British pounds']);
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
            other: [n('listitem', '', [n('link', 'Contact someone@example.test')])],
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
    expect(t.timers.sleeps).toContain(28_000);
    expect(t.out.join()).toMatch(/waiting 28 s for the spacing/);
  });
  it('a standing cool-down refuses before any launch', async () => {
    const t = setup();
    new CooldownStore({ dir: t.dataDir, botHours: 48, clock: t.timers.clock }).start('captcha');
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
    expect(new CooldownStore({ dir: t.dataDir, botHours: 48, clock: t.timers.clock }).active()?.cause).toBe(
      'sign-in',
    );
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
