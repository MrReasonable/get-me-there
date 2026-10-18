import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildLaunchOptions } from '../src/launch.js';
import { acquireLock } from '../src/lock.js';
import { type MainDeps, type RunningWorker, startWorker } from '../src/main.js';
import { Refusal } from '../src/refusal.js';
import { type EntryContext, EX_CONFIG, EX_SOFTWARE } from '../src/run.js';
import { SELECTORS } from '../src/selectors.js';
import { FakeContext } from './support/fakeContext.js';
import { resultsTree } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const KEY = 'synthetic-worker-key-0123456789abcdef';
const CAPTURE = {
  value: 'synthetic-socs',
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
  },
};
const URL0 =
  'https://www.google.com/travel/flights?q=Flights+from+LHR+to+JFK+on+2026-11-05+returning+2026-11-15&curr=GBP&hl=en-GB&gl=GB';

function setup(o: { socs?: boolean; deps?: Partial<MainDeps>; shape?: (c: FakeContext) => void } = {}) {
  const dataDir = tmpDir();
  if (o.socs !== false) writeFileSync(join(dataDir, 'socs.json'), JSON.stringify(CAPTURE), { mode: 0o600 });
  const out: string[] = [];
  const err: string[] = [];
  const ctx: EntryContext = {
    env: { CAMOUFOX_WORKER_KEY: KEY, HOME: '/Users/op' },
    dataDir,
    args: [],
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  const contexts: FakeContext[] = [];
  let shutdown: () => void = () => undefined;
  const timers = fakeTimers();
  const deps: MainDeps = {
    platform: 'darwin',
    clock: timers.clock,
    timers,
    log: memoryLog(),
    selectors: { ...SELECTORS, FORM_VERIFIED: true },
    prepare: () => ({
      options: buildLaunchOptions({ ffMajor: 152, home: '/h', path: '/p', tmp: '/t' }),
      install: { installDir: '/i', bundleDir: '/b', build: '152.0.4-beta.28', ffMajor: 152, created: [] },
      camoufoxJs: '0.11.5',
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
    ...o.deps,
  };
  return { dataDir, ctx, out, err, contexts, deps, shutdown: () => shutdown() };
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
  it('non-macOS exits 78 with the macOS message', async () => {
    const t = setup({ deps: { platform: 'linux' } });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/supports macOS only/);
  });
  it('FORM_VERIFIED false exits 78, launching nothing', async () => {
    const t = setup({ deps: { selectors: { ...SELECTORS, FORM_VERIFIED: false } } });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/FORM_VERIFIED/);
    expect(t.contexts).toEqual([]);
    expect(() => acquireLock(t.dataDir).release()).not.toThrow();
  });
  it('a start-check failure exits 78 naming the check', async () => {
    const t = setup({
      deps: {
        prepare: () => {
          throw new Error('CAMOUFOX_BINARY_BUILD is 152.0.4-beta.28 but …');
        },
      },
    });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/install layout and pins: CAMOUFOX_BINARY_BUILD/);
  });
  it('bad settings exit 78', async () => {
    const t = setup();
    expect(await startWorker({ ...t.ctx, env: { HOME: '/h' } }, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/settings: .*CAMOUFOX_WORKER_KEY/);
  });
  it('a held lock exits 78 naming the pid', async () => {
    const t = setup();
    acquireLock(t.dataDir, { pid: process.pid });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(new RegExp(`pid ${process.pid}`));
  });
  it('a missing SOCS capture exits 78', async () => {
    const t = setup({ socs: false });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/SOCS capture/);
  });
  it('an account cookie in the profile exits 78 and closes the browser', async () => {
    const t = setup({
      shape: (c) => c.jar.push({ name: 'SID', value: 'x', domain: '.google.com', path: '/' }),
    });
    expect(await startWorker(t.ctx, t.deps)).toBe(EX_CONFIG);
    expect(t.err.join()).toMatch(/account cookies \(SID\)/);
    expect(t.contexts[0]?.closed).toBe(1);
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
    expect(await s.json()).toMatchObject({
      ok: true,
      flags: { FORM_VERIFIED: true },
      accountCookie: { found: false },
      socsCapturedAt: CAPTURE.capturedAt,
      cooldownHours: 48,
      pageTimeoutSeconds: 90,
      lastPageAt: '2026-10-18T05:00:00.000Z',
    });
    t.shutdown();
    expect(await w.done).toBe(0);
    expect(() => acquireLock(t.dataDir).release()).not.toThrow();
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
