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
import { asIsoDateTime, type BlockedPage, CONSENT_FIX } from '@gmt/core';
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
import { RESEARCH_PROMPT } from '../src/researchSession.js';
import { type EntryContext, EX_CONFIG, EX_UNAVAILABLE } from '../src/run.js';
import { SELECTORS } from '../src/selectors.js';
import {
  consentView,
  type FakeConsentDriver,
  fakeConsentDriver,
  request,
  type Script,
  SOCS,
} from './support/fakeConsent.js';
import { FakeContext } from './support/fakeContext.js';
import {
  descendants,
  type FakeNode,
  FakePage,
  formNodes,
  type Navigation,
  n,
  option,
  resultsTree,
  text,
} from './support/fakePage.js';
import { gridTree, plusDays } from './support/gridTree.js';
import { memoryLog } from './support/log.js';
import { SYNTHETIC_REJECT } from './support/socsValues.js';
import { fakeTimers, flush } from './support/timers.js';
import { fakeInstall, tmpDir } from './support/tmp.js';

const KEY = 'synthetic-worker-key-0123456789abcdef';
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
const Q = ['--origin', 'LHR', '--destination', 'JFK', '--depart', '2026-11-05', '--return', '2026-11-15'];
const URL0 =
  'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2026-11-05+returning+2026-11-15&curr=GBP&hl=en-GB&gl=GB';
const LANDED = 'https://www.google.com/travel/flights/search?tfs=x';
const cfg = loadWorkerConfig({ CAMOUFOX_WORKER_KEY: KEY, HOME: '/Users/op' });

function setup(
  o: {
    socs?: boolean;
    navigations?: FakeContext['navigations'];
    launchThrows?: boolean;
    consentDriver?: RecordDeps['consentDriver'];
    platform?: string;
    display?: Record<string, string>;
  } = {},
) {
  const dataDir = tmpDir();
  if (o.socs !== false) writeFileSync(join(dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
  const root = tmpDir();
  const timers = fakeTimers();
  const contexts: FakeContext[] = [];
  const profiles: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: RecordDeps = {
    platform: o.platform ?? 'darwin',
    display: o.display ?? {},
    osArch: 'darwin-arm64',
    bundleSha256: '8b7680a61818245cf4eb0150edab811d4ed937b6723514569e74c3e7df9685bd',
    consentDriver:
      o.consentDriver ??
      (() => {
        throw new Error('this test opens no consent window');
      }),
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
    const code = await record(t.ctx(Q), cfg, t.deps);
    expect(t.err).toEqual([]);
    expect(code).toBe(0);
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
  // why: decision 82 (Task 17.3): every page the recorder loads counts in the worker's own month
  it('each recorded page counts in monthly.json; a page past the cap, or unreadable counts, loads nothing', async () => {
    const t = setup();
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(0);
    expect(JSON.parse(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8'))).toEqual({
      windowStart: '2026-10-01T00:00:00.000Z',
      windowEnd: '2026-11-01T00:00:00.000Z',
      pages: 1,
      scrolls: 0,
    });
    const full = setup();
    expect(await record(full.ctx(Q), { ...cfg, monthlyPageCap: 0 }, full.deps)).toBe(EX_CONFIG);
    expect(full.err.join()).toContain(
      "the worker's monthly page cap (0) is reached until 2026-11-01T00:00:00.000Z",
    );
    expect(full.contexts.flatMap((c) => c.pages)).toEqual([]);
    const garbled = setup();
    writeFileSync(join(garbled.dataDir, 'pacer.json'), '{}', { mode: 0o600 });
    writeFileSync(join(garbled.dataDir, 'monthly.json'), 'x', { mode: 0o600 });
    expect(await record(garbled.ctx(Q), cfg, garbled.deps)).toBe(EX_CONFIG);
    expect(garbled.err.join()).toContain(
      "the worker's monthly counts file is unreadable; rewrite it with pnpm gmt browser counts",
    );
    expect(readFileSync(join(garbled.dataDir, 'monthly.json'), 'utf8')).toBe('x');
  });
  // why: cb-b1-005: a wait for the spacing that crosses the window's end counts the page in the window it loads in
  it('the caps are checked again after the spacing wait: a page loaded in the next window counts there', async () => {
    const t = setup();
    writeFileSync(
      join(t.dataDir, 'monthly.json'),
      JSON.stringify({
        windowStart: '2026-10-01T00:00:00.000Z',
        windowEnd: '2026-11-01T00:00:00.000Z',
        pages: 7,
        scrolls: 0,
      }),
      { mode: 0o600 },
    );
    t.timers.clock.set(asIsoDateTime('2026-10-31T23:59:50.000Z'));
    writeFileSync(join(t.dataDir, 'pacer.json'), JSON.stringify({ lastPageAt: '2026-10-31T23:59:45.000Z' }), {
      mode: 0o600,
    });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(0);
    expect(t.out.join()).toMatch(/waiting \d+ s for the spacing/);
    expect(JSON.parse(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8'))).toMatchObject({
      windowStart: '2026-11-01T00:00:00.000Z',
      pages: 1,
    });
  });
  // why: WP17 Task 17.4: research 17.0c's two headed sessions, observed only, one recording of names and the mark
  describe('--consent-research', () => {
    const body = (choice: string) =>
      `gl=GB&hl=en-GB&x=SECRET-${choice}&set_eom=${choice === 'reject' ? 'true' : 'false'}`;
    const research = (scripts: Script[], o: { platform?: string; display?: Record<string, string> } = {}) => {
      const drivers: FakeConsentDriver[] = [];
      const t = setup({
        ...o,
        consentDriver: (profile, onRequest) => {
          t.profiles.push(profile);
          const d = fakeConsentDriver(scripts[drivers.length] ?? {}, onRequest);
          drivers.push(d);
          return d;
        },
      });
      return { t, drivers };
    };
    const session = (choice: string): Script => ({
      saveAt: 0,
      socsAt: 1,
      closeAt: 3,
      socs: { ...SOCS, value: `socs-${choice}` },
      requests: [
        request({ url: 'https://consent.google.com/ml?continue=x' }),
        request({ url: 'https://consent.google.com/save', method: 'POST', body: body(choice) }),
      ],
    });
    it('records both sessions: names, both SOCS cookies, the differing names, the machine; profiles gone, two pages counted', async () => {
      const { t, drivers } = research([session('reject'), session('accept')]);
      expect(await record(t.ctx(['--consent-research']), cfg, t.deps)).toBe(0);
      expect(written(t.root)).toEqual([
        'consent-research/2026-10-18/1.facts.json',
        'consent-research/2026-10-18/1.meta.json',
      ]);
      const facts = readFileSync(join(t.root, 'consent-research/2026-10-18/1.facts.json'), 'utf8');
      expect(facts).not.toContain('SECRET');
      const rec = JSON.parse(facts);
      expect(rec.differing).toEqual({ names: ['set_eom', 'x'] });
      expect(
        rec.sessions.map((x: { prompted: string; socs: { value: string } }) => [x.prompted, x.socs.value]),
      ).toEqual([
        ['reject', 'socs-reject'],
        ['accept', 'socs-accept'],
      ]);
      // why: pie-b1-006: a recording names the machine and bundle it was made on
      const meta = JSON.parse(readFileSync(join(t.root, 'consent-research/2026-10-18/1.meta.json'), 'utf8'));
      expect([meta.osArch, meta.bundleSha256]).toEqual(['darwin-arm64', t.deps.bundleSha256]);
      expect(t.out.filter((l) => l.startsWith('Session'))).toEqual([
        RESEARCH_PROMPT.reject,
        RESEARCH_PROMPT.accept,
      ]);
      expect(drivers.map((d) => d.loads)).toEqual([
        ['https://www.google.com/travel/flights?hl=en-GB&gl=GB'],
        ['https://www.google.com/travel/flights?hl=en-GB&gl=GB'],
      ]);
      expect(drivers.flatMap((d) => d.displays)).toEqual([{}, {}]);
      expect(drivers.map((d) => d.calls.at(-1))).toEqual(['close', 'close']);
      expect(
        t.profiles.every((p) => p.startsWith(join(t.dataDir, 'probe-research-')) && !existsSync(p)),
      ).toBe(true);
      expect(JSON.parse(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8'))).toMatchObject({ pages: 2 });
    });
    it('Linux: the display run.ts passed reaches the window', async () => {
      const { t, drivers } = research([session('reject'), session('accept')], {
        platform: 'linux',
        display: { DISPLAY: ':0', XAUTHORITY: '/x' },
      });
      expect(await record(t.ctx(['--consent-research']), cfg, t.deps)).toBe(0);
      expect(drivers.flatMap((d) => d.displays)).toEqual([
        { DISPLAY: ':0', XAUTHORITY: '/x' },
        { DISPLAY: ':0', XAUTHORITY: '/x' },
      ]);
    });
    it.each([
      ['no SOCS after the choice', { saveAt: 0, closeAt: 2 }, 'no SOCS was set after the consent choice'],
      [
        'no choice submitted',
        { socsAt: 1, closeAt: 3 },
        'no consent choice was submitted before the window closed',
      ],
      [
        'two submissions',
        { saveAt: 0, saves: 2, socsAt: 1, closeAt: 3 },
        'the consent choice was submitted 2 times',
      ],
      // why: CodeRabbit (PR #15): a window left for 10 minutes records nothing, whatever it read
      ['a timed-out window', { saveAt: 0, socsAt: 1 }, 'the window was left for 10 minutes'],
    ] as const)('%s records nothing, and its profile is gone', async (_w, second, words) => {
      const { t } = research([session('reject'), second]);
      expect(await record(t.ctx(['--consent-research']), cfg, t.deps)).toBe(EX_UNAVAILABLE);
      expect(t.err.join()).toContain(`session accept: ${words}; nothing recorded`);
      expect(written(t.root)).toEqual([]);
      expect(t.profiles.some((p) => existsSync(p))).toBe(false);
    });
    it('a challenge as the first view cools down; an account cookie records nothing', async () => {
      const challenge = research([{ first: consentView(), accountAt: 0 }]);
      expect(await record(challenge.t.ctx(['--consent-research']), cfg, challenge.t.deps)).toBe(
        EX_UNAVAILABLE,
      );
      expect(challenge.t.err.join()).toContain('an account cookie appeared');
      const blocked = research([
        { first: { ...consentView(), text: { ...consentView().text, challenge: true } } },
      ]);
      expect(await record(blocked.t.ctx(['--consent-research']), cfg, blocked.t.deps)).toBe(EX_UNAVAILABLE);
      expect(blocked.t.err.join()).toMatch(/stopped on captcha; cooling down until/);
      for (const r of [challenge, blocked]) expect(written(r.t.root)).toEqual([]);
    });
    // why: CodeRabbit (PR #15): no display refuses before anything is reserved or launched
    it('Linux with no display refuses with 78 before any page is reserved or any window opens', async () => {
      const none = research([session('reject')], { platform: 'linux' });
      expect(await record(none.t.ctx(['--consent-research']), cfg, none.t.deps)).toBe(EX_CONFIG);
      expect(none.t.err.join()).toContain(CONSENT_FIX.command);
      expect(none.drivers).toEqual([]);
      expect(existsSync(join(none.t.dataDir, 'monthly.json'))).toBe(false);
      expect(written(none.t.root)).toEqual([]);
    });
  });
  it('rule 1: every Google-facing run requires a valid SOCS capture; without one nothing launches', async () => {
    const t = setup({ socs: false });
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(EX_CONFIG);
    expect(t.profiles).toEqual([]);
    expect(t.err.join()).toMatch(/pnpm gmt consent/);
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
  it('rule 5: --cheapest clicks the Cheapest tab, --view-more clicks View more, a plain run clicks nothing', async () => {
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
              // why: as in the browser, the selected tab stays while the Cheapest view loads
              const loading = n('document', '', [
                n('tablist', '', [n('tab', 'Cheapest from £443', [], { selected: true })]),
                text('Fetching results'),
              ]);
              if (x.role === 'tab') pg.setTrees([...Array(cheapestPolls).fill(loading), view()]);
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
  // why: ruling of 2026-10-18 (the rerun on 51c2992): a Cheapest poll whose lookup overruns is unsettled, polled again
  const overrunFlow = (overrunPolls: number) => {
    const t = setup();
    const view = (hang: boolean) => {
      const v = resultsTree({ tab: 'Cheapest from £443' });
      for (const c of descendants([v])) {
        if (c.role === 'tab' && c.name === 'Cheapest from £443') c.selected = true;
        // the poll's result-link lookup overruns on these polls (confirm-selected reads the tab and answers)
        if (c.role === 'link') c.countHang = hang;
      }
      v.children = (v.children ?? []).filter((c) => !/results returned/.test(c.name ?? ''));
      return v;
    };
    const deps: RecordDeps = {
      ...t.deps,
      launch: async (prof) => {
        const c = await t.deps.launch(prof);
        if (c instanceof FakeContext)
          c.onNewPage = (pg) => {
            pg.onClick = (x) => {
              if (x.role === 'tab')
                pg.setTrees([
                  ...Array(overrunPolls)
                    .fill(null)
                    .map(() => view(true)),
                  view(false),
                ]);
            };
          };
        return c;
      },
    };
    return { t, deps };
  };
  const drive = async (t: ReturnType<typeof setup>, run: Promise<number>): Promise<number> => {
    let code: number | null = null;
    void run.then((c) => {
      code = c;
    });
    for (let i = 0; i < 80 && code === null; i++) {
      for (let j = 0; j < 5; j++) await flush();
      if (code === null) t.timers.runOut();
    }
    return run;
  };
  it('--cheapest: a first poll that times out and a second that settles produces a recording', async () => {
    const { t, deps } = overrunFlow(1);
    expect(await drive(t, record(t.ctx([...Q, '--cheapest']), cfg, deps))).toBe(0);
    expect(written(t.root)).toContain('cheapest/2026-10-18/1.facts.json');
  });
  it('--cheapest: polls that keep timing out end plainly at the budget, no cool-down, nothing recorded', async () => {
    const { t, deps } = overrunFlow(10_000);
    expect(await drive(t, record(t.ctx([...Q, '--cheapest']), cfg, deps))).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/the Cheapest view did not settle within its budget/);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active(),
    ).toBeNull();
    expect(written(t.root)).toEqual([]);
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
  // why: the final review of 2026-10-18: the stop record is a diagnostic only; a page whose heading shows an account
  // address fails its fail-closed scan, and that must never skip the cool-down or the signed-in refusal
  it('a stop record that cannot be written still leaves the cool-down and the refusal, with a warning', async () => {
    const t = setup({
      navigations: [
        {
          hops: [URL0, LANDED],
          tree: resultsTree({
            extra: [n('button', 'Google Account: Example Person'), n('heading', 'someone@example.test')],
          }),
        },
      ],
    });
    const log = memoryLog();
    expect(await record(t.ctx(Q), cfg, { ...t.deps, log })).toBe(EX_UNAVAILABLE);
    expect(
      new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active()?.cause,
    ).toBe('signed-in');
    expect(new Refusal({ dir: t.dataDir, clock: t.timers.clock }).active()).not.toBeNull();
    expect(written(t.root, { stopped: true })).toEqual([]);
    expect(
      log.lines.filter((l) => l.level === 'warn' && l.msg === 'stop record not written').map((l) => l.o),
    ).toEqual([{ cause: 'signed-in', reason: 'RecordingRefused' }]);
  });
  it('recordings are written 0600 in 0700 directories', async () => {
    const t = setup();
    expect(await record(t.ctx(Q), cfg, t.deps)).toBe(0);
    for (const f of written(t.root)) expect(statSync(join(t.root, f)).mode & 0o777, f).toBe(0o600);
    expect(statSync(join(t.root, 'results', '2026-10-18')).mode & 0o777).toBe(0o700);
  });
});

// The Price graph exploration (observed 2026-10-18): the Best view settled as list mode does, exactly one "Price graph"
// button clicked under its own step, the region that appeared polled until its printed snapshot holds still, and one
// local exploration file written. Synthetic trees only.
describe('record --graph-explore', () => {
  const cooldownOf = (t: ReturnType<typeof setup>) =>
    new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active();
  const dialog = (extra: FakeNode[] = []): FakeNode =>
    n('dialog', 'Price graph', [
      n('heading', 'Price graph'),
      n('tablist', '', [n('tab', 'Dates', [], { selected: true })]),
      n('slider', 'Trip length'),
      n('listbox', '', [n('option', '10 days')]),
      n('button', 'Tuesday, 1 December 2026, 412 British pounds'),
      n('link', 'Learn more', [], { href: 'https://www.google.com/travel/flights/help?tfs=synthetic-query' }),
      ...extra,
    ]);
  const page = (o: { button?: FakeNode[]; extra?: FakeNode[] } = {}): FakeNode =>
    resultsTree({ extra: [...(o.button ?? [n('button', 'Price graph')]), ...(o.extra ?? [])] });
  /** One month of the Dates tab: a grid of priced day cells and the day buttons (synthetic names). */
  const month = (m: string, extra: FakeNode[] = []): FakeNode[] => [
    n('grid', `${m} 2027`, [
      n('gridcell', `Sunday, 14 ${m} 2027, from £462`),
      n('gridcell', `Monday, 15 ${m} 2027, from £470`),
    ]),
    n('button', `Choose 14 ${m}`),
    ...extra,
  ];
  /**
   * The dialog the 2026-10-18 recording saw ("Price insights": a tablist, the stay buttons, a "Price graph" region,
   * the scroll and closing buttons), synthetic names and children; with `dates`, the Dates tab's panel instead.
   */
  const insights = (
    o: { dates?: FakeNode[]; chart?: FakeNode[]; scroll?: boolean; extra?: FakeNode[] } = {},
  ) =>
    n('dialog', 'Price insights', [
      n('tablist', '', [
        n('tab', 'Dates', [], { selected: o.dates !== undefined }),
        n('tab', 'Price graph', [], { selected: o.dates === undefined }),
      ]),
      text('10-day trip'),
      n('button', 'Reduce your stay by one day'),
      n('button', 'Extend your stay by one day'),
      ...(o.dates === undefined
        ? [text('Sun 14 Mar - Wed 24 Mar From £462'), n('region', 'Price graph', o.chart ?? [])]
        : [n('tabpanel', 'Dates', o.dates)]),
      ...(o.scroll === false ? [] : [n('button', 'Scroll forwards'), n('button', 'Scroll backwards')]),
      n('button', 'Cancel'),
      n('button', 'OK'),
      ...(o.extra ?? []),
    ]);
  /**
   * A run whose Price graph click shows `after` (the trees successive polls see); the Dates tab's click shows `dates`
   * and Scroll forwards shows `scrolled`.
   */
  const graphRun = (
    after: FakeNode[],
    o: {
      button?: FakeNode[];
      onClick?: (p: FakePage) => void;
      dates?: FakeNode[];
      scrolled?: FakeNode[];
    } = {},
  ) => {
    const t = setup({ navigations: [{ hops: [URL0, LANDED], tree: page(o) }] });
    const deps: RecordDeps = {
      ...t.deps,
      launch: async (prof) => {
        const c = await t.deps.launch(prof);
        if (c instanceof FakeContext)
          c.onNewPage = (pg) => {
            pg.onClick = (x) => {
              if (x.role === 'button' && x.name === 'Price graph') {
                if (o.onClick !== undefined) o.onClick(pg);
                else pg.setTrees(after);
              } else if (x.role === 'tab' && x.name === 'Dates')
                pg.setTrees(o.dates ?? [page({ extra: [insights({ dates: month('March') })] })]);
              else if (x.name === 'Scroll forwards')
                pg.setTrees(o.scrolled ?? [page({ extra: [insights({ dates: month('April') })] })]);
            };
          };
        return c;
      },
    };
    return { t, deps };
  };
  const recOf = (t: ReturnType<typeof setup>) =>
    JSON.parse(readFileSync(join(t.root, 'graph-explore/2026-10-18/1.json'), 'utf8'));
  const drive = async (t: ReturnType<typeof setup>, run: Promise<number>): Promise<number> => {
    let code: number | null = null;
    void run.then((c) => {
      code = c;
    });
    for (let i = 0; i < 80 && code === null; i++) {
      for (let j = 0; j < 5; j++) await flush();
      if (code === null) t.timers.runOut();
    }
    return run;
  };
  const G = [...Q, '--graph-explore'];

  it('parses --graph-explore with the same query arguments', () => {
    expect(parseRecordArgs(G)).toMatchObject({ kind: 'graph-explore', pages: 1 });
    expect(() => parseRecordArgs([...G, '--cheapest'])).toThrow(/--graph-explore/);
  });
  it('clicks the one Price graph button, polls the dialog that appeared until it holds still, and writes one 0600 exploration file', async () => {
    const { t, deps } = graphRun([page(), page({ extra: [dialog()] })]);
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    // why: the Dates tab's click shows a panel with Scroll forwards, clicked once
    expect(t.contexts[0]?.pages[0]?.calls.clicks).toEqual([
      'button:Price graph',
      'tab:Dates',
      'button:Scroll forwards',
    ]);
    // why: SOCS is set before the page and read back after it, as for every kind
    expect(t.contexts[0]?.added).toHaveLength(1);
    expect(written(t.root)).toEqual(['graph-explore/2026-10-18/1.json']);
    const file = join(t.root, 'graph-explore/2026-10-18/1.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(t.root, 'graph-explore', '2026-10-18')).mode & 0o777).toBe(0o700);
    const text = readFileSync(file, 'utf8');
    const rec = JSON.parse(text);
    expect(rec).toMatchObject({
      kind: 'graph-explore',
      recordedBy: 'camoufox-worker record',
      region: { role: 'dialog', name: 'Price graph', appeared: true },
      clicked: ['button:Price graph', 'tab:Dates', 'button:Scroll forwards'],
      socsReadBack: 'same',
      landing: 'https://www.google.com/travel/flights/search',
      classification: { kind: 'results' },
    });
    expect(rec.snapshot).toContain('- dialog "Price graph":');
    expect(rec.snapshot).toContain('- slider "Trip length"');
    expect(rec.snapshot).not.toContain('Top departing flights');
    expect(rec.controls).toEqual([
      { role: 'button', name: 'Tuesday, 1 December 2026, 412 British pounds' },
      { role: 'tab', name: 'Dates' },
      { role: 'slider', name: 'Trip length' },
      { role: 'option', name: '10 days' },
      { role: 'link', name: 'Learn more' },
    ]);
    expect(Object.keys(rec.timings).sort()).toEqual([
      'click',
      'dates',
      'goto',
      'graph',
      'read',
      'scroll',
      'settle',
    ]);
    // why: this dialog holds no chart region
    expect(rec.chart).toBeNull();
    expect(rec.polls).toBeGreaterThanOrEqual(2);
    // why: no query string is written: the landing, the hops and the snapshot's link targets keep their paths only
    expect(text).not.toContain('tfs=');
    expect(text).not.toMatch(/https?:\/\/[^\s"]*\?/);
    expect(rec.snapshot).toContain('/url: https://www.google.com/travel/flights/help');
    expect(cooldownOf(t)).toBeNull();
  });
  it('the snapshot must hold still across two polls 2 s apart: a dialog still changing is polled again', async () => {
    const loading = page({ extra: [dialog([text('Loading prices')])] });
    const { t, deps } = graphRun([page(), loading, page({ extra: [dialog()] })]);
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    const rec = JSON.parse(readFileSync(join(t.root, 'graph-explore/2026-10-18/1.json'), 'utf8'));
    expect(rec.snapshot).not.toContain('Loading prices');
    expect(rec.polls).toBeGreaterThanOrEqual(3);
    expect(t.timers.sleeps.filter((ms) => ms === 2000).length).toBeGreaterThanOrEqual(2);
  });
  it('a region that was already there before the click is not the one that appeared', async () => {
    const before = n('region', 'Price insights', [n('button', 'Old insight')]);
    const { t, deps } = graphRun([page({ extra: [before, dialog()] })], {
      button: [n('button', 'Price graph'), before],
    });
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    const rec = JSON.parse(readFileSync(join(t.root, 'graph-explore/2026-10-18/1.json'), 'utf8'));
    expect(rec.region).toEqual({ role: 'dialog', name: 'Price graph', appeared: true });
  });
  it('when no dialog or region appears, the main landmark is recorded', async () => {
    const { t, deps } = graphRun([page()]);
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    const rec = JSON.parse(readFileSync(join(t.root, 'graph-explore/2026-10-18/1.json'), 'utf8'));
    expect(rec.region).toEqual({ role: 'main', name: '', appeared: false });
    expect(rec.snapshot).toContain('Top departing flights');
  });
  it.each([
    ['no Price graph button', []],
    ['two Price graph buttons', [n('button', 'Price graph'), n('button', 'Price graph')]],
  ])(
    '%s ends plainly at the find-graph-button step: no click, no cool-down, nothing written',
    async (_l, button) => {
      const { t, deps } = graphRun([page()], { button });
      expect(await record(t.ctx(G), cfg, deps)).toBe(EX_CONFIG);
      expect(t.err.join()).toMatch(/Price graph.*find-graph-button/);
      expect(t.contexts[0]?.pages[0]?.calls.clicks).toEqual([]);
      expect(cooldownOf(t)).toBeNull();
      expect(written(t.root, { stopped: true })).toEqual([]);
    },
  );
  it('a click that never answers ends at the click-graph step within its own timeout, with no cool-down', async () => {
    const { t, deps } = graphRun([page()], { button: [n('button', 'Price graph', [], { clickHang: true })] });
    expect(await drive(t, record(t.ctx(G), cfg, deps))).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/click-graph \(timed-out\)/);
    expect(cooldownOf(t)).toBeNull();
    expect(written(t.root, { stopped: true })).toEqual([]);
  });
  it('logs each step at debug as the Cheapest flow does', async () => {
    const { t, deps } = graphRun([page({ extra: [dialog()] })]);
    const log = memoryLog();
    expect(await record(t.ctx(G), cfg, { ...deps, log })).toBe(0);
    const steps = log.lines
      .filter((l) => l.msg === 'graph step')
      .map((l) => [Reflect.get(l.o, 'step'), Reflect.get(l.o, 'phase')]);
    expect(steps.slice(0, 6)).toEqual([
      ['find-graph-button', 'start'],
      ['find-graph-button', 'end'],
      ['list-regions', 'start'],
      ['list-regions', 'end'],
      ['click-graph', 'start'],
      ['click-graph', 'end'],
    ]);
    expect(steps).toContainEqual(['graph-poll', 'end']);
    expect(steps.at(-1)).toEqual(['read-scrolled-cells', 'end']);
  });
  it('a graph that never holds still ends plainly at the graph-settle step, within the page budget, with no cool-down', async () => {
    let i = 0;
    const { t, deps } = graphRun([], {
      onClick: (pg) =>
        pg.setTrees(Array.from({ length: 200 }, () => page({ extra: [dialog([text(`Loading ${i++}`)])] }))),
    });
    const before = t.timers.now();
    expect(await record(t.ctx(G), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/Price graph did not settle.*graph-settle/);
    expect(t.timers.now() - before).toBeLessThanOrEqual(180_000);
    expect(cooldownOf(t)).toBeNull();
    expect(written(t.root, { stopped: true })).toEqual([]);
  });
  it('a captcha after the click is that stop: the classifier decides, 48 h, nothing recorded', async () => {
    const { t, deps } = graphRun([n('document', '', [text('Our systems have detected unusual traffic')])]);
    expect(await record(t.ctx(G), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('unusual-traffic');
    expect(written(t.root)).toEqual([]);
    const stops = written(t.root, { stopped: true });
    expect(stops).toEqual(['stopped/2026-10-18/1.facts.json']);
    const stop = JSON.parse(readFileSync(join(t.root, stops[0] ?? ''), 'utf8'));
    expect(stop).toMatchObject({ kind: 'graph-explore', clicked: ['button:Price graph'] });
  });
  it('a signed-in account control after the click sets the refusal', async () => {
    const { t, deps } = graphRun([
      page({ extra: [dialog(), n('button', 'Google Account: Example Person')] }),
    ]);
    expect(await record(t.ctx(G), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('signed-in');
    expect(new Refusal({ dir: t.dataDir, clock: t.timers.clock }).active()).not.toBeNull();
  });
  it('a SOCS the click changes is consent-unhandled: the profile is wiped and no exploration is written', async () => {
    const { t, deps } = graphRun([], {
      onClick: (pg) => pg.setTrees([page({ extra: [dialog()] })]),
    });
    const wrapped: RecordDeps = {
      ...deps,
      launch: async (p) => {
        const c = await deps.launch(p);
        if (c instanceof FakeContext) {
          const shape = c.onNewPage;
          c.onNewPage = (pg) => {
            shape(pg);
            const click = pg.onClick;
            pg.onClick = (x) => {
              click(x);
              c.jar = c.jar.map((k) => (k.name === 'SOCS' ? { ...k, value: 'accepted-by-click' } : k));
            };
          };
        }
        return c;
      },
    };
    expect(await record(t.ctx(G), cfg, wrapped)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('consent-unhandled');
    expect(existsSync(profileDir(t.dataDir))).toBe(false);
    expect(written(t.root).filter((f) => f.startsWith('graph-explore/') && f.endsWith('/1.json'))).toEqual(
      [],
    );
  });
  it.each([
    ['an e-mail address', 'Contact someone@example.test'],
    ['an account name', 'Google Account: Example Person'],
  ])('a snapshot holding %s is refused: nothing written', async (_l, bad) => {
    const { t, deps } = graphRun([page({ extra: [dialog([text(bad)])] })]);
    expect(await record(t.ctx(G), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/nothing written/);
    expect(written(t.root)).toEqual([]);
  });
  it('the observed dialog: the chart region\u2019s text and elements, the Dates tab settled and read, then one scroll forwards', async () => {
    const chart = [
      n('generic', '', [], { ariaLabel: null, text: '£462' }),
      n('img', 'Bar for 14 March', [], { ariaLabel: 'Bar for 14 March' }),
    ];
    const { t, deps } = graphRun([page({ extra: [insights({ chart })] })]);
    const log = memoryLog();
    expect(await record(t.ctx(G), cfg, { ...deps, log })).toBe(0);
    expect(t.contexts[0]?.pages[0]?.calls.clicks).toEqual([
      'button:Price graph',
      'tab:Dates',
      'button:Scroll forwards',
    ]);
    const rec = recOf(t);
    expect(rec.region).toEqual({ role: 'dialog', name: 'Price insights', appeared: true });
    expect(rec.clicked).toEqual(['button:Price graph', 'tab:Dates', 'button:Scroll forwards']);
    // why: text and attributes only, never HTML
    expect(rec.chart).toEqual({
      text: '£462',
      ariaLabel: 'Price graph',
      count: 2,
      imgCount: 1,
      buttonCount: 0,
      elements: [
        { role: 'generic', ariaLabel: null },
        { role: 'img', ariaLabel: 'Bar for 14 March' },
      ],
    });
    expect(rec.dates.panel).toEqual({ found: 1, index: 0 });
    expect(rec.dates.snapshot).toContain('- tabpanel "Dates":');
    expect(rec.dates.snapshot).toContain('gridcell "Sunday, 14 March 2027, from £462"');
    expect(rec.dates.cells).toEqual([
      { role: 'button', name: 'Choose 14 March' },
      { role: 'gridcell', name: 'Sunday, 14 March 2027, from £462' },
      { role: 'gridcell', name: 'Monday, 15 March 2027, from £470' },
    ]);
    expect(rec.dates.polls).toBeGreaterThanOrEqual(2);
    expect(rec.scrollButtons).toBe(1);
    expect(rec.scrolled.snapshot).toContain('gridcell "Sunday, 14 April 2027, from £462"');
    expect(rec.scrolled.cells).toContainEqual({ role: 'gridcell', name: 'Monday, 15 April 2027, from £470' });
    expect(Object.keys(rec.timings).sort()).toEqual([
      'click',
      'dates',
      'goto',
      'graph',
      'read',
      'scroll',
      'settle',
    ]);
    const steps = log.lines
      .filter((l) => l.msg === 'graph step' && Reflect.get(l.o, 'phase') === 'end')
      .map((l) => Reflect.get(l.o, 'step'));
    expect([...new Set(steps)]).toEqual([
      'find-graph-button',
      'list-regions',
      'click-graph',
      'graph-poll',
      'read-controls',
      'chart-find',
      'chart-text',
      'chart-summary',
      'chart-elements',
      'find-dates-tab',
      'click-dates-tab',
      'dates-poll',
      'read-dates-cells',
      'find-scroll-forwards',
      'click-scroll-forwards',
      'scroll-poll',
      'read-scrolled-cells',
    ]);
  });
  it('without a chart region the chart is null, and without a Dates tab the dates are skipped and counted', async () => {
    const noTabs = n('dialog', 'Price insights', [n('button', 'OK')]);
    const { t, deps } = graphRun([page({ extra: [noTabs] })]);
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect([rec.chart, rec.dates, rec.datesTabs, rec.scrolled]).toEqual([null, null, 0, null]);
    expect(rec.clicked).toEqual(['button:Price graph']);
  });
  it('a Dates panel without a Scroll forwards button is recorded unscrolled, the count kept', async () => {
    const { t, deps } = graphRun([page({ extra: [insights({ scroll: false })] })], {
      dates: [page({ extra: [insights({ dates: month('March'), scroll: false })] })],
    });
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect([rec.scrollButtons, rec.scrolled, rec.clicked]).toEqual([
      0,
      null,
      ['button:Price graph', 'tab:Dates'],
    ]);
    expect(rec.dates.cells).toHaveLength(3);
    expect(Object.keys(rec.timings)).not.toContain('scroll');
  });
  // why: ruling of 2026-10-18 (the run on 802e405): an exploration step that overruns is recorded and the run goes on
  it('a chart text read that never answers is recorded as timed out after its 10 s, and the Dates phase still runs', async () => {
    const region = insights();
    for (const x of descendants([region])) if (x.role === 'region') x.innerTextHang = true;
    const { t, deps } = graphRun([page({ extra: [region] })]);
    expect(await drive(t, record(t.ctx(G), cfg, deps))).toBe(0);
    const rec = recOf(t);
    expect(rec.chart).toMatchObject({ timedOut: true, text: null, ariaLabel: 'Price graph', count: 0 });
    expect(rec.chart.skipped).toEqual([{ step: 'chart-text', reason: 'timed-out', timedOut: true }]);
    expect(rec.clicked).toEqual(['button:Price graph', 'tab:Dates', 'button:Scroll forwards']);
    expect(rec.dates.cells).toHaveLength(3);
    expect(rec.scrolled.cells).toHaveLength(3);
    expect(cooldownOf(t)).toBeNull();
  });
  it('a chart element read that never answers keeps the summary (aria-label, img and button counts)', async () => {
    const chart = [n('img', 'Bar', [], { hang: true }), n('button', 'Previous')];
    const { t, deps } = graphRun([page({ extra: [insights({ chart })] })]);
    expect(await drive(t, record(t.ctx(G), cfg, deps))).toBe(0);
    const rec = recOf(t);
    expect(rec.chart).toMatchObject({
      timedOut: true,
      ariaLabel: 'Price graph',
      count: 2,
      imgCount: 1,
      buttonCount: 1,
      elements: null,
    });
    expect(rec.chart.skipped).toEqual([{ step: 'chart-elements', reason: 'timed-out', timedOut: true }]);
    expect(rec.dates).not.toBeNull();
  });
  it('a Scroll forwards click that never answers is recorded as timed out, and the file is still written', async () => {
    const { t, deps } = graphRun([page({ extra: [insights()] })], {
      dates: [
        page({
          extra: [
            n('dialog', 'Price insights', [
              n('tablist', '', [n('tab', 'Dates', [], { selected: true })]),
              n('tabpanel', 'Dates', month('March')),
              n('button', 'Scroll forwards', [], { clickHang: true }),
            ]),
          ],
        }),
      ],
    });
    expect(await drive(t, record(t.ctx(G), cfg, deps))).toBe(0);
    const rec = recOf(t);
    expect(rec.scrollButtons).toBe(1);
    expect(rec.scrolled).toEqual({ step: 'click-scroll-forwards', reason: 'timed-out', timedOut: true });
    expect(rec.dates.cells).toHaveLength(3);
    expect(cooldownOf(t)).toBeNull();
  });
  it('a Dates panel that never holds still is recorded as such at the dates-settle step; no scroll, no cool-down', async () => {
    let i = 0;
    const { t, deps } = graphRun([page({ extra: [insights()] })], {
      dates: Array.from({ length: 200 }, () =>
        page({ extra: [insights({ dates: month('March', [text(`Loading ${i++}`)]) })] }),
      ),
    });
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect(rec.dates).toEqual({ step: 'dates-settle', reason: 'timed-out', timedOut: true });
    expect(rec.scrolled).toBeNull();
    expect(rec.clicked).toEqual(['button:Price graph', 'tab:Dates']);
    expect(cooldownOf(t)).toBeNull();
  });
  it.each([
    ['the Dates panel', 'dates'],
    ['the scrolled panel', 'scrolled'],
  ] as const)('an e-mail address in %s is refused: nothing written', async (_l, where) => {
    const bad = [
      page({ extra: [insights({ dates: month('May', [text('Contact someone@example.test')]) })] }),
    ];
    const { t, deps } = graphRun(
      [page({ extra: [insights()] })],
      where === 'dates' ? { dates: bad } : { scrolled: bad },
    );
    expect(await record(t.ctx(G), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/e-mail address; nothing written/);
    expect(written(t.root)).toEqual([]);
  });
  it('an account name in the chart text is refused: nothing written', async () => {
    const chart = [n('generic', '', [], { text: 'Google Account: Example Person' })];
    const { t, deps } = graphRun([page({ extra: [insights({ chart })] })]);
    expect(await record(t.ctx(G), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/account name; nothing written/);
    expect(written(t.root)).toEqual([]);
  });
  it('a results page showing no flights has no graph to explore: refused plainly, nothing clicked', async () => {
    const t = setup({
      navigations: [
        {
          hops: [URL0, LANDED],
          tree: n('document', '', [...formNodes(), text('No flights found'), n('main', '')]),
        },
      ],
    });
    expect(await record(t.ctx(G), cfg, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/no flights/);
    expect(t.contexts[0]?.pages[0]?.calls.clicks).toEqual([]);
    expect(cooldownOf(t)).toBeNull();
  });
});

// WP15 Task 15.1: the recorder's --grid (rulings of 2026-10-18). One page, the Price graph and Dates clicks, then the
// named moves, each at least 5 s after the last, each view counted only once its lines change and then hold still.
// Synthetic trees in recording 2's shape (test/support/gridTree.ts).
describe('record --grid', () => {
  const cooldownOf = (t: ReturnType<typeof setup>) =>
    new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active();
  const G = [...Q, '--grid'];
  const results = (): FakeNode => resultsTree({ extra: [n('button', 'Price graph')] });
  // why: with the dialog open the results list is hidden, as recording 2's classification showed (PA-01)
  const dialogPage = (g: FakeNode): FakeNode => n('document', '', [...formNodes(), g]);
  interface Run {
    /** The trees each view shows, by the view's first departure and first return. */
    view?: (depart: string, ret: string) => FakeNode[];
    /** Called on every scroll click with the time it happened. */
    onScroll?: (dir: string, at: number) => void;
    /** Step of a scroll, in days (the synthetic hypothesis). */
    step?: number;
    pollMs?: number;
  }
  const gridRun = (o: Run = {}) => {
    const t = setup({ navigations: [{ hops: [URL0, LANDED], tree: results() }] });
    const step = o.step ?? 7;
    let at = { depart: '2027-03-11', ret: '2027-03-21' };
    const show = (pg: FakePage) =>
      pg.setTrees(o.view?.(at.depart, at.ret) ?? [dialogPage(gridTree({ depart: at.depart, ret: at.ret }))]);
    const deps: RecordDeps = {
      ...t.deps,
      ...(o.pollMs === undefined ? {} : { pollMs: o.pollMs }),
      launch: async (prof) => {
        const c = await t.deps.launch(prof);
        if (c instanceof FakeContext)
          c.onNewPage = (pg) => {
            pg.onClick = (x) => {
              if (x.role === 'button' && x.name === 'Price graph')
                pg.setTrees([dialogPage(gridTree({ ...at, tab: 'graph' }))]);
              else if (x.role === 'tab' && x.name === 'Dates') show(pg);
              else if (x.role === 'button' && (x.name ?? '').startsWith('Scroll ')) {
                const dir = (x.name ?? '').slice(7);
                o.onScroll?.(dir, t.timers.now());
                const dd = dir === 'right' ? step : dir === 'left' ? -step : 0;
                const dr = dir === 'down' ? step : dir === 'up' ? -step : 0;
                at = { depart: plusDays(at.depart, dd), ret: plusDays(at.ret, dr) };
                show(pg);
              }
            };
          };
        return c;
      },
    };
    return { t, deps };
  };
  const recOf = (t: ReturnType<typeof setup>) =>
    JSON.parse(readFileSync(join(t.root, 'grid/2026-10-18/1.json'), 'utf8'));

  it('parses --grid and --moves, and refuses bad moves before any launch', () => {
    expect(parseRecordArgs(G)).toMatchObject({ kind: 'grid', moves: ['right', 'down', 'left', 'up'] });
    expect(parseRecordArgs([...G, '--moves', 'right,right'])).toMatchObject({ moves: ['right', 'right'] });
    expect(parseRecordArgs(Q).moves).toEqual([]);
    for (const bad of [
      [...G, '--moves', 'sideways'],
      [...G, '--moves', Array(13).fill('right').join(',')],
      [...Q, '--moves', 'right'],
      [...G, '--cheapest'],
      [...G, '--moves'],
    ])
      expect(() => parseRecordArgs(bad), bad.join(' ')).toThrow(/--moves|--grid|needs a value/);
  });
  it('clicks Price graph, Dates and each scroll 5 s apart, and records every view, move delta and timing', async () => {
    const scrolls: number[] = [];
    const { t, deps } = gridRun({ onScroll: (_d, at) => scrolls.push(at) });
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    expect(t.contexts[0]?.pages[0]?.calls.clicks).toEqual([
      'button:Price graph',
      'tab:Dates',
      'button:Scroll right',
      'button:Scroll down',
      'button:Scroll left',
      'button:Scroll up',
    ]);
    for (let i = 1; i < scrolls.length; i++)
      expect((scrolls[i] ?? 0) - (scrolls[i - 1] ?? 0)).toBeGreaterThanOrEqual(5000);
    expect(written(t.root)).toEqual(['grid/2026-10-18/1.json']);
    const file = join(t.root, 'grid/2026-10-18/1.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/https?:\/\/[^\s"]*\?/);
    const rec = recOf(t);
    expect(rec).toMatchObject({
      kind: 'grid',
      // why: WP17 Task 17.8: an exploration names the entry and bundle it was recorded under, as a recording's meta does
      osArch: 'darwin-arm64',
      bundleSha256: '8b7680a61818245cf4eb0150edab811d4ed937b6723514569e74c3e7df9685bd',
      socsReadBack: 'same',
      window: [1280, 900],
      clicked: [
        'button:Price graph',
        'tab:Dates',
        'button:Scroll right',
        'button:Scroll down',
        'button:Scroll left',
        'button:Scroll up',
      ],
      results: { cheapestTabName: 'Cheapest from 451 British pounds', listMinimumPounds: 451 },
    });
    expect(rec.views).toHaveLength(5);
    const v0 = rec.views[0];
    expect(v0.candidates).toHaveLength(49);
    expect(v0.candidates[0]).toMatch(/, 11 Mar to 21 Mar$/);
    expect(v0.lines.texts).toEqual([
      '0000Thu 11 MarFri 12 MarSat 13 MarSun 14 MarMon 15 MarTue 16 MarWed 17 Mar0000',
      '0000Sun 21 MarMon 22 MarTue 23 MarWed 24 MarThu 25 MarFri 26 MarSat 27 Mar0000',
    ]);
    expect(v0.labels.count).toBe(14);
    expect(v0.datesGrid).toEqual({ dialog: 1, datesSelected: 1, grid: 1, scrollButtons: 4 });
    expect(v0.selectedLines).toEqual([`£${v0.candidates[24].match(/^£(\d+)/)?.[1]} · Round trip`]);
    expect(v0.snapshot).toContain('- tabpanel "Dates":');
    expect(rec.moves.map((m: { dir: string; delta: unknown }) => [m.dir, m.delta])).toEqual([
      ['right', { departures: 7, returns: 0 }],
      ['down', { departures: 0, returns: 7 }],
      ['left', { departures: -7, returns: 0 }],
      ['up', { departures: 0, returns: -7 }],
    ]);
    expect(Object.keys(rec.moves[0]).sort()).toEqual([
      'clickMs',
      'delta',
      'dir',
      'polls',
      'readMs',
      'settleMs',
    ]);
    expect(cooldownOf(t)).toBeNull();
  });
  // why: the recordings of 2026-10-18: one scroll moves one day, and the page rotates its elements after a scroll
  it('measures a one-day step from rotated lines', async () => {
    let n0 = 0;
    const { t, deps } = gridRun({
      step: 1,
      view: (d, r) => [dialogPage(gridTree({ depart: d, ret: r, rotate: n0++ * 6 }))],
    });
    expect(await record(t.ctx([...G, '--moves', 'right,down']), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect(rec.views[1].lines.texts[0]).toMatch(/^0000Thu 18 Mar/);
    expect(rec.moves.map((m: { delta: unknown }) => m.delta)).toEqual([
      { departures: 1, returns: 0 },
      { departures: 0, returns: 1 },
    ]);
  });
  it('a view after a scroll counts only once its lines change, then hold for two polls (12 s polls fit the move budget)', async () => {
    let calls = 0;
    const { t, deps } = gridRun({
      pollMs: 12_000,
      view: (d, r) => {
        calls++;
        if (calls === 1) return [dialogPage(gridTree({ depart: d, ret: r }))];
        // why: the old view stays for two more polls after the click, then the moved one shows
        const old = dialogPage(gridTree({ depart: plusDays(d, -7), ret: r }));
        return [old, old, dialogPage(gridTree({ depart: d, ret: r }))];
      },
    });
    expect(await record(t.ctx([...G, '--moves', 'right']), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect(rec.moves[0]).toMatchObject({ dir: 'right', delta: { departures: 7, returns: 0 } });
    expect(rec.moves[0].polls).toBeGreaterThanOrEqual(4);
  });
  it('a view that has not changed by the end of its move budget is recorded timed out; the file is still written', async () => {
    let calls = 0;
    const { t, deps } = gridRun({
      pollMs: 12_000,
      view: (d, r) => {
        calls++;
        const same = dialogPage(gridTree({ depart: '2027-03-11', ret: '2027-03-21' }));
        return calls === 1 ? [same] : [same, same, same, same, dialogPage(gridTree({ depart: d, ret: r }))];
      },
    });
    expect(await record(t.ctx([...G, '--moves', 'right,down']), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect(rec.moves).toEqual([{ dir: 'right', step: 'move-1-settle', reason: 'timed-out', timedOut: true }]);
    expect(rec.views).toHaveLength(1);
    expect(t.contexts[0]?.pages[0]?.calls.clicks).not.toContain('button:Scroll down');
    expect(cooldownOf(t)).toBeNull();
  });
  // why: the darwin-x64 recordings of 2026-10-26 (grid 3 and 4) held views taken before their cells had drawn (spec §2
  // rev 46): the recorder waits as the provider does, and records a view still drawing at its bound as it is, marked
  it('a view whose cells draw late is recorded once whole, marked drawn', async () => {
    let calls = 0;
    const { t, deps } = gridRun({
      step: 1,
      view: (d, r) => {
        calls++;
        const whole = dialogPage(gridTree({ depart: d, ret: r }));
        if (calls === 1) return [whole];
        // why: one cell short, fewer than the four scroll buttons, so a count that kept them in would miss it
        const part = dialogPage(
          gridTree({
            depart: d,
            ret: r,
            undrawn: (dd, rr) => dd === plusDays(d, 6) && rr === plusDays(r, 6),
          }),
        );
        return [part, part, part, whole];
      },
    });
    expect(await record(t.ctx([...G, '--moves', 'right']), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect(
      rec.views.map((v: { candidates: unknown[]; drawn: boolean }) => [v.candidates.length, v.drawn]),
    ).toEqual([
      [49, true],
      [49, true],
    ]);
    expect(rec.moves[0].polls).toBeGreaterThanOrEqual(5);
  });
  it('a view still drawing at its bound is recorded as it is, marked not drawn; the next move still runs', async () => {
    let calls = 0;
    const { t, deps } = gridRun({
      pollMs: 12_000,
      view: (d, r) => {
        calls++;
        return [dialogPage(gridTree({ depart: d, ret: r, ...(calls === 2 ? { undrawn: () => true } : {}) }))];
      },
    });
    expect(await record(t.ctx([...G, '--moves', 'right,down']), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect(
      rec.views.map((v: { candidates: unknown[]; drawn: boolean }) => [v.candidates.length, v.drawn]),
    ).toEqual([
      [49, true],
      [0, false],
      [49, true],
    ]);
    expect(rec.moves.map((m: { dir: string; delta: unknown }) => [m.dir, m.delta])).toEqual([
      ['right', { departures: 7, returns: 0 }],
      ['down', { departures: 0, returns: 7 }],
    ]);
    expect(rec.moves[0].polls).toBeGreaterThan(2);
  });
  it('a challenge after a scroll is that stop with its cool-down; only the stop record is written', async () => {
    let calls = 0;
    const { t, deps } = gridRun({
      view: (d, r) =>
        ++calls === 1
          ? [dialogPage(gridTree({ depart: d, ret: r }))]
          : [n('document', '', [text('Our systems have detected unusual traffic')])],
    });
    expect(await record(t.ctx(G), cfg, deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('unusual-traffic');
    expect(written(t.root)).toEqual([]);
    expect(written(t.root, { stopped: true })).toEqual(['stopped/2026-10-18/1.facts.json']);
  });
  it('a panel that is not the dates-grid view is recorded and no scroll is tried', async () => {
    const { t, deps } = gridRun({
      view: (d, r) => [dialogPage(gridTree({ depart: d, ret: r, scroll: false }))],
    });
    expect(await record(t.ctx(G), cfg, deps)).toBe(0);
    const rec = recOf(t);
    expect(rec.views[0].datesGrid.scrollButtons).toBe(0);
    expect(rec.moves).toEqual([{ dir: 'right', skipped: 'not-dates-grid' }]);
    expect(t.contexts[0]?.pages[0]?.calls.clicks).toEqual(['button:Price graph', 'tab:Dates']);
  });
  it('a panel holding an e-mail address is refused: nothing written', async () => {
    const { t, deps } = gridRun({
      view: (d, r) => [dialogPage(gridTree({ depart: d, ret: r, extra: [text('someone@example.test')] }))],
    });
    expect(await record(t.ctx(G), cfg, deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/e-mail address; nothing written/);
    expect(written(t.root)).toEqual([]);
  });
  it('logs each step as "grid step"', async () => {
    const { t, deps } = gridRun();
    const log = memoryLog();
    expect(await record(t.ctx([...G, '--moves', 'right']), cfg, { ...deps, log })).toBe(0);
    const ends = log.lines
      .filter((l) => l.msg === 'grid step' && Reflect.get(l.o, 'phase') === 'end')
      .map((l) => Reflect.get(l.o, 'step'));
    expect([...new Set(ends)]).toEqual([
      'read-results',
      'find-graph-button',
      'click-graph',
      'dialog-poll',
      'find-dates-tab',
      'click-dates-tab',
      'dates-poll',
      'read-view',
      'find-scroll',
      'click-scroll',
      'move-1-poll',
    ]);
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
    expect(parseRecordArgs(['--consent-probe'])).toEqual({
      kind: 'consent-probe',
      request: null,
      pages: 1,
      moves: [],
    });
    expect(parseRecordArgs([...Q, '--stability']).pages).toBe(3);
    expect(parseRecordArgs([...Q, '--no-flights']).kind).toBe('no-flights');
  });
});

describe('the real recorder dependencies (no launch)', () => {
  it('use the system clock, two-second polls, the prepared entry’s selectors and stderr JSON lines', () => {
    const f = fakeInstall('darwin-arm64');
    const prepared = prepareLaunch({
      platform: 'darwin',
      arch: 'arm64',
      installDirSet: f.root,
      dataDir: tmpDir(),
      home: f.home,
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
      osArch: 'darwin-arm64',
      bundleSha256: '8b7680a61818245cf4eb0150edab811d4ed937b6723514569e74c3e7df9685bd',
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
    const f = fakeInstall('darwin-arm64');
    const prepared = prepareLaunch({
      platform: 'darwin',
      arch: 'arm64',
      installDirSet: f.root,
      dataDir: tmpDir(),
      home: f.home,
      path: '/p',
      tmp: '/t',
    });
    const lines: string[] = [];
    realRecordDeps(prepared, (l) => lines.push(l), true).log.debug({ a: 1 }, 'x');
    expect(lines).toHaveLength(1);
  });
});

// why: WP17 Task 17.8: the landing view earns LANDING_VERIFIED on the entries recorded headless, where no person
// clicks a consent page: the worker's own profile, SOCS set, the landing page (no query) read with the hypothesis on
describe('record --landing (Task 17.8)', () => {
  const LANDING = 'https://www.google.com/travel/flights?hl=en-GB&gl=GB';
  const landingTree = () =>
    n('document', 'Google Flights', [
      n('heading', 'Flights'),
      n('heading', 'Find cheap flights'),
      ...formNodes(),
    ]);
  const unverified = { ...SELECTORS, LANDING_VERIFIED: false };
  const cooldownOf = (t: ReturnType<typeof setup>) =>
    new CooldownStore({ dir: t.dataDir, challengeHours: 48, clock: t.timers.clock }).active();
  it('parses with no query, one page', () => {
    expect(parseRecordArgs(['--landing'])).toEqual({ kind: 'landing', request: null, pages: 1, moves: [] });
    expect(() => parseRecordArgs(['--landing', '--grid'])).toThrow(/at most one of .*--landing/);
  });
  it('loads the landing page with SOCS set, clicks nothing and records the view, the flag still off', async () => {
    const t = setup({ navigations: [{ hops: [LANDING], tree: landingTree() }] });
    const code = await record(t.ctx(['--landing']), cfg, { ...t.deps, selectors: unverified });
    expect(t.err).toEqual([]);
    expect(code).toBe(0);
    expect(written(t.root)).toEqual(['landing/2026-10-18/1.facts.json', 'landing/2026-10-18/1.meta.json']);
    const c = t.contexts[0];
    expect(c?.added[0]?.[0]?.name).toBe('SOCS');
    expect(c?.pages[0]?.calls.gotos.map((g) => g.url)).toEqual([LANDING]);
    expect(c?.pages[0]?.calls.clicks).toEqual([]);
    const facts = JSON.parse(readFileSync(join(t.root, 'landing/2026-10-18/1.facts.json'), 'utf8'));
    expect(facts).toMatchObject({
      kind: 'landing',
      landing: LANDING,
      hops: [LANDING],
      clicked: [],
      headings: ['Flights', 'Find cheap flights'],
      socsReadBack: 'same',
      page: { text: { landingHeading: true }, resultLinks: 0, dateGridButtons: 0, cheapestTabs: [] },
    });
    const meta = JSON.parse(readFileSync(join(t.root, 'landing/2026-10-18/1.meta.json'), 'utf8'));
    expect(meta).toMatchObject({ kind: 'landing', osArch: 'darwin-arm64', socsReadBack: 'same' });
    expect(t.out.join()).toContain('recorded ');
    expect(cooldownOf(t)).toBeNull();
    expect(JSON.parse(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8')).pages).toBe(1);
  });
  it('a view the landing rule never recognises is what appeared: unrecorded, no pause, the flag stays off', async () => {
    const t = setup({ navigations: [{ hops: [LANDING], tree: resultsTree() }] });
    expect(await record(t.ctx(['--landing']), cfg, { ...t.deps, selectors: unverified })).toBe(0);
    expect(written(t.root)).toEqual(['landing/unrecorded.meta.json']);
    const u = JSON.parse(readFileSync(join(t.root, 'landing/unrecorded.meta.json'), 'utf8'));
    expect(u.appeared).toMatchObject({ kind: 'landing', landing: LANDING, hops: [LANDING] });
    expect(u.appeared.headings).toEqual(['Top departing flights', 'Other departing flights']);
    expect(u.appeared.page.resultLinks).toBe(2);
    expect(t.out.join()).toMatch(/LANDING_VERIFIED stays false/);
    expect(cooldownOf(t)).toBeNull();
  });
  it('a consent page is the stop it always is: the pause, the profile wiped, nothing recorded as the landing', async () => {
    const t = setup({
      navigations: [
        {
          hops: [LANDING, 'https://consent.google.com/ml?continue=x'],
          tree: n('document', '', [n('heading', 'Before you continue to Google')]),
        },
      ],
    });
    expect(await record(t.ctx(['--landing']), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    // why: as on every kind, a consent stop is recorded as the failure it is, never as a view
    expect(written(t.root)).toEqual(['landing/2026-10-18/1.facts.json', 'landing/2026-10-18/1.meta.json']);
    expect(JSON.parse(readFileSync(join(t.root, 'landing/2026-10-18/1.facts.json'), 'utf8'))).toMatchObject({
      failure: 'consent-unhandled',
    });
    expect(cooldownOf(t)?.cause).toBe('consent-unhandled');
    expect(existsSync(t.profiles[0] ?? '')).toBe(false);
  });
  it('a challenge on the landing page stops and pauses', async () => {
    const t = setup({
      navigations: [{ hops: [LANDING], tree: n('document', '', [text("I'm not a robot")]) }],
    });
    expect(await record(t.ctx(['--landing']), cfg, t.deps)).toBe(EX_UNAVAILABLE);
    expect(cooldownOf(t)?.cause).toBe('captcha');
    expect(written(t.root)).toEqual([]);
    // why: the stop record keeps what the classifier saw on that view
    const stop = JSON.parse(readFileSync(join(t.root, 'stopped/2026-10-18/1.facts.json'), 'utf8'));
    expect(stop).toMatchObject({ cause: 'captcha', rule: 'challenge-text', resultLinks: 0 });
  });
  it('a read that fails other than by the deadline ends the recording with that error, writing nothing', async () => {
    const t = setup({ navigations: [{ hops: [LANDING], tree: landingTree() }] });
    const deps: RecordDeps = {
      ...t.deps,
      launch: async (p) => {
        const c = await t.deps.launch(p);
        if (c instanceof FakeContext)
          c.onNewPage = (pg) => {
            const role = pg.getByRole.bind(pg);
            let calls = 0;
            pg.getByRole = (...a: Parameters<FakePage['getByRole']>) => {
              calls++;
              if (calls === 1) throw new Error('the page went away');
              return role(...a);
            };
          };
        return c;
      },
    };
    expect(await record(t.ctx(['--landing']), cfg, deps)).not.toBe(0);
    expect(t.err.join()).toContain('the page went away');
    expect(written(t.root)).toEqual([]);
    expect(cooldownOf(t)).toBeNull();
  });
});
