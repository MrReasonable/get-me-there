import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSENT_FIX, effectiveSharedSettings, flagsFor, workerStatusSchema } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AwakeEnd, AwakeKeeper } from '../src/awake.js';
import { InstallRefused } from '../src/install.js';
import { buildLaunchOptions } from '../src/launch.js';
import { acquireLock } from '../src/lock.js';
import { type MainDeps, type RunningWorker, startWorker } from '../src/main.js';
import { Refusal } from '../src/refusal.js';
import { type EntryContext, EX_CONFIG, EX_SOFTWARE } from '../src/run.js';
import { FakeContext } from './support/fakeContext.js';
import { resultsTree } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { SYNTHETIC_REJECT } from './support/socsValues.js';
import { fakeTimers } from './support/timers.js';
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
const BODY = {
  mode: 'list',
  origin: 'LHR',
  destination: 'JFK',
  departureDate: '2026-11-05',
  returnDate: '2026-11-15',
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

function setup(
  o: {
    socs?: boolean;
    deps?: Partial<MainDeps>;
    shape?: (c: FakeContext) => void;
    env?: Record<string, string>;
  } = {},
) {
  const dataDir = tmpDir();
  if (o.socs !== false) writeFileSync(join(dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
  const out: string[] = [];
  const err: string[] = [];
  const ctx: EntryContext = {
    env: { CAMOUFOX_WORKER_KEY: KEY, HOME: '/Users/op', ...o.env },
    dataDir,
    args: [],
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  const contexts: FakeContext[] = [];
  let shutdown: () => void = () => undefined;
  const timers = fakeTimers();
  // why: spec §2 "The keep-awake lease": a fake spawn, so no test runs the platform's hold
  const holds: Array<{ args: readonly string[]; killed: boolean; end: (e: AwakeEnd) => void }> = [];
  const keepAwake = new AwakeKeeper({
    platform: 'darwin',
    pid: 4242,
    log: memoryLog(),
    now: () => timers.now(),
    later: () => () => undefined,
    spawn: (_command, args, end) => {
      const h = { args, killed: false, end };
      holds.push(h);
      return {
        kill: () => {
          h.killed = true;
        },
      };
    },
    findOnPath: () => null,
  });
  const deps: MainDeps = {
    platform: 'darwin',
    arch: 'arm64',
    clock: timers.clock,
    timers,
    log: memoryLog(),
    prepare: () => ({
      options: buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' }),
      install: { installDir: '/i', bundleDir: '/b', build: '152.0.4-beta.28', ffMajor: 152 },
      camoufoxJs: '0.11.5',
      osArch: 'darwin-arm64',
    }),
    launch: async () => {
      const c = new FakeContext();
      c.navigations = [{ hops: [URL0, 'https://www.google.com/travel/flights/search'], tree: resultsTree() }];
      o.shape?.(c);
      contexts.push(c);
      return c;
    },
    onShutdown: (h) => {
      shutdown = h;
    },
    port: 0,
    pid: 4242,
    keepAwake,
    ...o.deps,
  };
  return { dataDir, ctx, out, err, contexts, deps, holds, shutdown: () => shutdown() };
}
async function running(t: ReturnType<typeof setup>): Promise<RunningWorker> {
  const w = await startWorker(t.ctx, t.deps);
  if (typeof w === 'number') throw new Error(`refused: ${t.err.join()}`);
  return w;
}
const post = (w: RunningWorker) =>
  fetch(`http://127.0.0.1:${w.port}/v1/page`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-gmt-worker-key': KEY },
    body: JSON.stringify(BODY),
  });

beforeEach(() => {
  expect.hasAssertions();
});

describe('the worker’s start checks and shutdown (brief Task 14.5)', () => {
  /** The refusal file the CLI and the app's status read: `{ reason, at }` only, 0600. */
  const refusalFile = (t: ReturnType<typeof setup>): unknown => {
    const f = join(t.dataDir, 'start-refusal.json');
    if (!existsSync(f)) return null;
    expect(statSync(f).mode & 0o777).toBe(0o600);
    return JSON.parse(readFileSync(f, 'utf8'));
  };
  const AT = '2026-10-18T05:00:00.000Z';
  it('Windows exits 78 as flags-unset, writing the refusal file, launching nothing', async () => {
    const t = setup({ deps: { platform: 'win32', arch: 'x64' } });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toContain('flags-unset: this machine has no verified browser build yet');
    expect(refusalFile(t)).toEqual({ reason: 'flags-unset', at: AT });
    expect(t.contexts).toEqual([]);
  });
  it('a machine with no pinned entry (Linux on ia32) exits 78 as flags-unset before any launch', async () => {
    const t = setup({ deps: { platform: 'linux', arch: 'ia32' } });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(refusalFile(t)).toEqual({ reason: 'flags-unset', at: AT });
    expect(t.contexts).toEqual([]);
    expect(() => acquireLock(t.dataDir).release()).not.toThrow();
  });
  it.each([
    ['layout', new InstallRefused('layout', 'no Camoufox install at /i: run pnpm gmt setup')],
    [
      'build-mismatch',
      new InstallRefused(
        'build-mismatch',
        'the installed Camoufox is 153.0.1-beta.30 but …',
        '153.0.1-beta.30',
      ),
    ],
  ])(
    'a %s refusal exits 78 with its file, the layout’s own words and core’s fix, launching nothing',
    async (reason, e) => {
      const t = setup({
        deps: {
          prepare: () => {
            throw e;
          },
        },
      });
      expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
      expect(refusalFile(t)).toEqual({ reason, at: AT });
      expect(t.err.join()).toContain(`${reason}: `);
      expect(t.err.join()).toContain(`(${e.message})`);
      expect(t.contexts).toEqual([]);
    },
  );
  // why: W1 (dev-b1-003): every exit 78 leaves a refusal file, so status and start explain it and a refused agent is
  // booted out; one of the worker's own settings or files is `config`, its words on stderr
  it('another error from the preparation (the camoufox-js pin) exits 78 naming the check, leaving a config refusal', async () => {
    const t = setup({
      deps: {
        prepare: () => {
          throw new Error('camoufox-js is 0.11.6; this worker is verified against 0.11.5 only');
        },
      },
    });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/install layout and pins: camoufox-js is 0\.11\.6/);
    expect(refusalFile(t)).toEqual({ reason: 'config', at: AT });
  });
  it('bad settings exit 78, leaving a config refusal', async () => {
    const t = setup();
    expect(await startWorker({ ...t.ctx, env: { HOME: '/h' } }, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/settings: .*CAMOUFOX_WORKER_KEY/);
    expect(refusalFile(t)).toEqual({ reason: 'config', at: AT });
  });
  it('a held lock exits 78 as locked, its own lock left in place', async () => {
    const t = setup();
    acquireLock(t.dataDir, { pid: process.pid });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toContain('locked: another worker holds the lock; fix: pnpm gmt restart');
    expect(refusalFile(t)).toEqual({ reason: 'locked', at: AT });
    expect(readFileSync(join(t.dataDir, 'worker.lock'), 'utf8')).toBe(String(process.pid));
  });
  it('no consent record, an unreadable one, or a voided one exits 78 with its reason; an expired one too', async () => {
    const missing = setup({ socs: false });
    expect(await startWorker(missing.ctx, missing.deps)).toBe(EX_CONFIG);
    expect(refusalFile(missing)).toEqual({ reason: 'consent-missing', at: AT });
    expect(missing.err.join()).toContain(
      `consent-missing: no consent record: capture one; fix: ${CONSENT_FIX.command}`,
    );
    const garbled = setup({ socs: false });
    writeFileSync(join(garbled.dataDir, 'socs.json'), '{', { mode: 0o600 });
    expect(await startWorker(garbled.ctx, garbled.deps)).toBe(EX_CONFIG);
    expect(refusalFile(garbled)).toEqual({ reason: 'consent-missing', at: AT });
    const voided = setup({ socs: false });
    writeFileSync(join(voided.dataDir, 'socs.json'), JSON.stringify({ consent: 'voided', voidedAt: AT }), {
      mode: 0o600,
    });
    expect(await startWorker(voided.ctx, voided.deps)).toBe(EX_CONFIG);
    expect(refusalFile(voided)).toEqual({ reason: 'consent-voided', at: AT });
    const expired = setup({ socs: false });
    writeFileSync(
      join(expired.dataDir, 'socs.json'),
      JSON.stringify({ ...CAPTURE, expires: 1_760_000_000 }),
      {
        mode: 0o600,
      },
    );
    expect(await startWorker(expired.ctx, expired.deps)).toBe(EX_CONFIG);
    expect(refusalFile(expired)).toEqual({ reason: 'consent-expired', at: AT });
    for (const t of [missing, garbled, voided, expired]) expect(t.contexts).toEqual([]);
  });
  // why: CodeRabbit (PR #15), pa-b1-006: the start and `check` share core's rule; the record is refused as itself
  it('a not-shown record is refused as consent-not-shown: this worker serves pages with a captured rejection only', async () => {
    const t = setup({ socs: false });
    writeFileSync(join(t.dataDir, 'socs.json'), JSON.stringify({ consent: 'not-shown', checkedAt: AT }), {
      mode: 0o600,
    });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(refusalFile(t)).toEqual({ reason: 'consent-not-shown', at: AT });
    expect(t.err.join()).toContain(`fix: ${CONSENT_FIX.command}`);
    expect(t.contexts).toEqual([]);
  });
  // why: spec rev 64: the worker keeps no monthly count: an earlier worker's counts file, readable or not, beside its
  // pacer file neither stops the start nor changes
  it('starts beside an earlier worker’s pacer and counts files, and leaves the counts file as it is', async () => {
    const t = setup();
    // why: the earlier page an hour back, so the spacing has passed and the page loads
    const earlier = new Date(Date.parse(AT) - 3_600_000).toISOString();
    writeFileSync(join(t.dataDir, 'pacer.json'), JSON.stringify({ lastPageAt: earlier }), { mode: 0o600 });
    writeFileSync(join(t.dataDir, 'monthly.json'), '{', { mode: 0o600 });
    const w = await running(t);
    expect((await post(w)).status).toBe(200);
    expect(readFileSync(join(t.dataDir, 'monthly.json'), 'utf8')).toBe('{');
    t.shutdown();
    await w.done;
  });
  it('an account cookie in the profile exits 78 as signed-in and closes the browser', async () => {
    const t = setup({
      shape: (c) => c.jar.push({ name: 'SID', value: 'x', domain: '.google.com', path: '/' }),
    });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/signed-in: the profile holds Google account cookies \(SID\)/);
    expect(refusalFile(t)).toEqual({ reason: 'signed-in', at: AT });
    expect(t.contexts[0]?.closed).toBe(1);
  });
  it('a successful start removes a refusal file left by an earlier one, and the file never holds text or secrets', async () => {
    const t = setup();
    writeFileSync(join(t.dataDir, 'start-refusal.json'), JSON.stringify({ reason: 'layout', at: AT }), {
      mode: 0o600,
    });
    const w = await running(t);
    expect(refusalFile(t)).toBeNull();
    t.shutdown();
    await w.done;
    const r = setup({ socs: false });
    await startWorker(r.ctx, r.deps);
    const text = readFileSync(join(r.dataDir, 'start-refusal.json'), 'utf8');
    expect(Object.keys(JSON.parse(text))).toEqual(['reason', 'at']);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('capture');
  });
  it('a launch failure exits 78', async () => {
    const t = setup({
      deps: {
        launch: async () => {
          throw new Error('Juggler failed');
        },
      },
    });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/launch: Juggler failed/);
  });
  it('serves a page and a live status; SIGTERM stops it with exit 0 and releases the lock', async () => {
    const t = setup();
    const w = await running(t);
    const r = await post(w);
    expect(r.status).toBe(200);
    const s = await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } });
    const body: unknown = await s.json();
    expect(body).toMatchObject({
      ok: true,
      accountCookie: { found: false },
      socsCapturedAt: CAPTURE.capturedAt,
      cooldownHours: 48,
      pageTimeoutSeconds: 90,
      lastPageAt: '2026-10-18T05:00:00.000Z',
      // why: decision 75: the running entry, its build and its flags; the consent record and what bounds its expiry
      osArch: 'darwin-arm64',
      build: '152.0.4-beta.28',
      flags: flagsFor('darwin-arm64', '152.0.4-beta.28'),
      consent: { kind: 'socs', expiresAt: '2027-01-15T08:00:00.000Z', boundedBy: 'cookie' },
    });
    // why: WP21 Task 21.3: /v1/status reports the return-select and booking-select flags, true on this entry
    expect(body).toMatchObject({ flags: { RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true } });
    expect(workerStatusSchema.safeParse(body).success).toBe(true);
    t.shutdown();
    expect(await w.done).toBe(0);
    expect(() => acquireLock(t.dataDir).release()).not.toThrow();
  });
  it('POST /v1/awake holds the machine awake, the status reports it, and SIGTERM ends the hold', async () => {
    const t = setup();
    const w = await running(t);
    const statusOf = async (): Promise<unknown> =>
      (await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } })).json();
    expect(await statusOf()).toMatchObject({ awake: { held: false, until: null, mechanism: 'caffeinate' } });
    const r = await fetch(`http://127.0.0.1:${w.port}/v1/awake`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gmt-worker-key': KEY },
      body: JSON.stringify({ seconds: 300 }),
    });
    const held = { held: true, until: '2026-10-18T05:05:00.000Z', mechanism: 'caffeinate' };
    expect(await r.json()).toEqual(held);
    expect(await statusOf()).toMatchObject({ awake: held });
    expect(t.holds.map((h) => [h.args, h.killed])).toEqual([
      [['-i', '-s', '-w', '4242', '-t', '300'], false],
    ]);
    t.shutdown();
    expect(await w.done).toBe(0);
    expect(t.holds.map((h) => h.killed)).toEqual([true]);
  });
  it('the status reports the worker’s effective shared settings (spec §12), worker.env lines and defaults alike', async () => {
    const t = setup({ env: { CAMOUFOX_COOLDOWN_HOURS: '72', POINT_OF_SALE: 'US' } });
    const w = await running(t);
    const s = await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } });
    const body: unknown = await s.json();
    expect(body).toMatchObject({
      sharedSettings: effectiveSharedSettings({ CAMOUFOX_COOLDOWN_HOURS: '72', POINT_OF_SALE: 'US' }),
    });
    expect(workerStatusSchema.safeParse(body).success).toBe(true);
    t.shutdown();
    await w.done;
  });
  it('the status read stays clear of the pacer: the persisted last-page time is unchanged (decision 76)', async () => {
    const t = setup();
    const at = '2026-10-18T04:59:00.000Z';
    writeFileSync(join(t.dataDir, 'pacer.json'), JSON.stringify({ lastPageAt: at }), { mode: 0o600 });
    const before = readFileSync(join(t.dataDir, 'pacer.json'), 'utf8');
    const w = await running(t);
    for (let i = 0; i < 3; i++) {
      const s = await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } });
      expect(await s.json()).toMatchObject({ lastPageAt: at });
    }
    expect(readFileSync(join(t.dataDir, 'pacer.json'), 'utf8')).toBe(before);
    t.shutdown();
    await w.done;
  });
  // why: decision 82: the month's calling apps, reported and never refused
  it('the status reports the calendar month’s app instances; a second one is reported, not refused', async () => {
    const t = setup();
    const w = await running(t);
    const read = async (instance: string) =>
      (
        await fetch(`http://127.0.0.1:${w.port}/v1/status`, {
          headers: { 'x-gmt-worker-key': KEY, 'x-gmt-app-instance': instance },
        })
      ).json();
    const first: unknown = await read('a'.repeat(64));
    expect(first).toMatchObject({
      ok: true,
      appInstances: { windowStart: '2026-10-01T00:00:00.000Z', count: 1 },
    });
    expect(first).not.toHaveProperty('monthly');
    expect(await read('b'.repeat(64))).toMatchObject({ appInstances: { count: 2 } });
    expect((await post(w)).status).toBe(200);
    t.shutdown();
    await w.done;
  });
  it('the status carries every field core’s shared full fixture has (Task 16a.5), and parses under workerStatusSchema', async () => {
    const t = setup({ env: { CAMOUFOX_MODE: 'grid' } });
    const w = await running(t);
    const body: unknown = await (
      await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } })
    ).json();
    // why: the repository root found upwards, so the read works from Stryker's sandbox copy of this package too
    let root = dirname(fileURLToPath(import.meta.url));
    // why: CodeRabbit (PR #15): the search stops at the file system's root with a message, never loops there
    while (!existsSync(join(root, 'pnpm-workspace.yaml'))) {
      if (dirname(root) === root)
        throw new Error('no pnpm-workspace.yaml above this test: run it inside the checkout');
      root = dirname(root);
    }
    const full: unknown = JSON.parse(
      readFileSync(join(root, 'packages', 'core', 'test', 'camoufox', 'worker-status-full.json'), 'utf8'),
    );
    const keys = (o: unknown): string[] => (typeof o === 'object' && o !== null ? Object.keys(o).sort() : []);
    expect(keys(body)).toEqual(keys(full));
    expect(workerStatusSchema.safeParse(body).success).toBe(true);
    expect(workerStatusSchema.safeParse(full).success).toBe(true);
    t.shutdown();
    await w.done;
  });
  it('in grid mode the status reports the worker’s scroll cap and spacing, for the app’s preflight (CA 9)', async () => {
    const status = async (env: Record<string, string>) => {
      const t = setup({ env });
      const w = await running(t);
      const s = await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } });
      const body: unknown = await s.json();
      t.shutdown();
      await w.done;
      return body;
    };
    expect(
      await status({
        CAMOUFOX_MODE: 'grid',
        CAMOUFOX_GRID_SCROLL_CAP: '20',
        CAMOUFOX_GRID_SCROLL_SPACING_SECONDS: '9',
      }),
    ).toMatchObject({ gridScrollCap: 20, gridScrollSpacingSeconds: 9 });
    expect(await status({})).toMatchObject({ gridScrollCap: null, gridScrollSpacingSeconds: null });
  });
  // why: fix round 1 (prov-int M7): after a wipe a status poll must not wait on a cold launch past the app's timeout
  it('a status poll whose relaunch hangs answers 500 within its bound, and the worker keeps serving', async () => {
    let launches = 0;
    const t = setup({
      deps: {
        launch: async () => {
          launches++;
          if (launches > 1) return new Promise(() => undefined);
          const c = new FakeContext();
          c.navigations = [
            { hops: [URL0, 'https://www.google.com/travel/flights/search'], tree: resultsTree() },
          ];
          // why: Google rewrites SOCS on the first page, so the session wipes the profile and drops the context
          c.afterGoto = (jar) => jar.map((x) => (x.name === 'SOCS' ? { ...x, value: 'changed' } : x));
          return c;
        },
      },
    });
    const w = await running(t);
    expect((await post(w)).status).toBe(423);
    const s = await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } });
    expect(s.status).toBe(500);
    expect(launches).toBe(2);
    t.shutdown();
    expect(await w.done).toBe(0);
  });
  it('SIGTERM mid-page answers that page, then exits 0', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const t = setup({
      shape: (c) =>
        (c.onNewPage = (p) => {
          const g = p.goto.bind(p);
          p.goto = async (u, o) => {
            await gate;
            return g(u, o);
          };
        }),
    });
    const w = await running(t);
    const pending = post(w);
    for (let i = 0; i < 50 && t.contexts[0]?.pages.length !== 1; i++)
      await new Promise((r) => setImmediate(r));
    t.shutdown();
    open();
    expect((await pending).status).toBe(200);
    expect(await w.done).toBe(0);
  });
  // why: CAMOUFOX_PAGES_AT_ONCE: N page sessions, each over its own browser and profile, behind the one pacer
  describe('pages at once', () => {
    /** A launch per profile whose pages hold at their load until `open`; `loading` resolves once `n` pages wait there. */
    const gated = (n: number) => {
      let open: () => void = () => undefined;
      const gate = new Promise<void>((r) => {
        open = r;
      });
      let reached: () => void = () => undefined;
      const loading = new Promise<void>((r) => {
        reached = r;
      });
      let waiting = 0;
      const profiles: string[] = [];
      const contexts: FakeContext[] = [];
      const launch: MainDeps['launch'] = async (_options, profile) => {
        profiles.push(profile);
        const c = new FakeContext();
        c.navigations = [
          { hops: [URL0, 'https://www.google.com/travel/flights/search'], tree: resultsTree() },
        ];
        c.onNewPage = (p) => {
          const g = p.goto.bind(p);
          p.goto = async (u, o) => {
            waiting += 1;
            if (waiting === n) reached();
            await gate;
            return g(u, o);
          };
        };
        contexts.push(c);
        return c;
      };
      return { launch, profiles, contexts, loading, open: () => open() };
    };
    it('two pages load at once, each in its own browser and profile; a third request then is answered spacing', async () => {
      const g = gated(2);
      const t = setup({
        env: { CAMOUFOX_PAGES_AT_ONCE: '2', CAMOUFOX_MIN_SPACING_SECONDS: '0' },
        deps: { launch: g.launch },
      });
      const w = await running(t);
      // why: the first session launches at the start (the account-cookie check); the second on its first page
      expect(g.profiles).toEqual([join(t.dataDir, 'profile')]);
      const a = post(w);
      const b = post(w);
      await g.loading;
      expect(g.profiles).toEqual([join(t.dataDir, 'profile'), join(t.dataDir, 'profile-1')]);
      expect(statSync(join(t.dataDir, 'profile-1')).mode & 0o777).toBe(0o700);
      const c = await post(w);
      expect(c.status).toBe(429);
      const body: unknown = await c.json();
      // why: the wait is the rest of the soonest page's overall cap (twice the 90 s page timeout) and its close
      expect(body).toMatchObject({ kind: 'spacing', retryAfterSeconds: 190 });
      expect(c.headers.get('retry-after')).toBe('190');
      const s: unknown = await (
        await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } })
      ).json();
      expect(s).toMatchObject({ busySince: AT, sharedSettings: { CAMOUFOX_PAGES_AT_ONCE: '2' } });
      g.open();
      expect([(await a).status, (await b).status]).toEqual([200, 200]);
      expect(g.contexts.map((x) => x.pages.length)).toEqual([1, 1]);
      t.shutdown();
      expect(await w.done).toBe(0);
    });
    it('by default one page at a time: a second request while the first loads is answered spacing, nothing more launched', async () => {
      const g = gated(1);
      const t = setup({ env: { CAMOUFOX_MIN_SPACING_SECONDS: '0' }, deps: { launch: g.launch } });
      const w = await running(t);
      const a = post(w);
      await g.loading;
      expect((await post(w)).status).toBe(429);
      expect(g.profiles).toEqual([join(t.dataDir, 'profile')]);
      expect(existsSync(join(t.dataDir, 'profile-1'))).toBe(false);
      g.open();
      expect((await a).status).toBe(200);
      t.shutdown();
      await w.done;
    });
    it('SIGTERM with two pages in flight answers both, then closes both browsers and exits 0', async () => {
      const g = gated(2);
      const t = setup({
        env: { CAMOUFOX_PAGES_AT_ONCE: '2', CAMOUFOX_MIN_SPACING_SECONDS: '0' },
        deps: { launch: g.launch },
      });
      const w = await running(t);
      const a = post(w);
      const b = post(w);
      await g.loading;
      t.shutdown();
      g.open();
      expect([(await a).status, (await b).status]).toEqual([200, 200]);
      expect(await w.done).toBe(0);
      expect(g.contexts.map((x) => x.closed)).toEqual([1, 1]);
    });
    it('with a page spacing, the second page waits for it from the first one’s start, whichever session is free', async () => {
      const g = gated(1);
      const t = setup({ env: { CAMOUFOX_PAGES_AT_ONCE: '2' }, deps: { launch: g.launch } });
      const w = await running(t);
      const a = post(w);
      await g.loading;
      const r = await post(w);
      expect(r.status).toBe(429);
      expect(await r.json()).toMatchObject({ kind: 'spacing', retryAfterSeconds: 28 });
      expect(g.profiles).toHaveLength(1);
      g.open();
      expect((await a).status).toBe(200);
      t.shutdown();
      await w.done;
    });
  });
  it('a cool-down store read error answers its page, then exits 70', async () => {
    const t = setup();
    const w = await running(t);
    mkdirSync(join(t.dataDir, 'cooldown.json'));
    expect((await post(w)).status).toBe(502);
    expect(await w.done).toBe(EX_SOFTWARE);
  });
  it('a standing signed-in refusal starts the server answering cooling-down only, without launching', async () => {
    const t = setup();
    new Refusal({ dir: t.dataDir, clock: t.deps.clock }).set('signed-in control');
    const w = await running(t);
    expect(t.contexts).toEqual([]);
    const r = await post(w);
    expect(r.status).toBe(423);
    expect(await r.json()).toMatchObject({ kind: 'cooling-down', cause: 'signed-in' });
    const s = await (
      await fetch(`http://127.0.0.1:${w.port}/v1/status`, { headers: { 'x-gmt-worker-key': KEY } })
    ).json();
    expect(s).toMatchObject({ ok: false, signedInRefusal: true });
    expect(t.out.join()).toMatch(/cooling-down only/);
    t.shutdown();
    expect(await w.done).toBe(0);
  });
  it('a port already in use fails the start and releases the lock', async () => {
    const a = setup();
    const w = await running(a);
    const b = setup({ deps: { port: w.port } });
    await expect(startWorker(b.ctx, b.deps)).rejects.toThrow(/EADDRINUSE/);
    expect(() => acquireLock(b.dataDir).release()).not.toThrow();
    a.shutdown();
    await w.done;
  });
});
