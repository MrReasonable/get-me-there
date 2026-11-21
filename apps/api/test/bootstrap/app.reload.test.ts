// Settings plan ruling 6 and Review Focus 1, 4 and 5: a save restarts the app in place. `main` listens for the signals
// once and runs passes of boot and serve: an idle save closes the pass with `closed` = 'reload' and the next pass boots
// with the saved value and a new bootId; a save while a run is in flight answers 'after-runs', holds the engine (a start
// is refused in the words) and restarts after the run's end, whatever the end; two saves give one restart; a second
// boot that fails ends the loop with its code; three passes leave one pair of signal listeners, no timer and no lock;
// SIGTERM after a restart checkpoints and releases once. No secret reaches a log across a restart. Every wait is on an
// event (a pass serving, `closed`, the exit), never a timer.
import { EventEmitter, once } from 'node:events';
import { copyFileSync } from 'node:fs';
import { Agent, request as httpRequest, type IncomingMessage } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { apiContract, type ExecutionStatus, fixedClock, type IsoDateTime, type ProviderId } from '@gmt/core';
import { AppLock, type Db, openDatabase } from '@gmt/db';
import { RELOAD_PENDING_TEXT, type RunWatch } from '@gmt/engine';
import { allowLoopback } from '@gmt/providers/testing';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type BootDeps, bootApp, main, type RunningApp } from '../../src/bootstrap/app.js';
import { BootError } from '../../src/bootstrap/errors.js';
import { assetPaths } from '../../src/bootstrap/paths.js';
import { EXIT } from '../../src/tools/types.js';
import { cleanEnv, silentLog } from '../helpers/env.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { captureLines, T0 } from '../helpers/harness.js';
import { expectNoSecrets, SETTINGS_SECRETS as S } from '../helpers/secrets.js';
import { seeder } from '../helpers/seed.js';
import { fileTempDir, tempDir } from '../helpers/tmp.js';
import { stubVendors } from '../helpers/vendors.js';

/** Each boot reads the full airports table; a loaded runner may take longer than the default 5 s. */
const TIMEOUT_MS = 60_000;

/** The run observer each pass's engine was given (EngineOptions.runWatch), so a test can end a run the engine never ran. */
const watches = vi.hoisted(() => {
  const list: RunWatch[] = [];
  return { list };
});
vi.mock('../../src/bootstrap/engine.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/bootstrap/engine.js')>();
  return {
    ...orig,
    engineFor: (...args: Parameters<typeof orig.engineFor>) => {
      const watch = args[2]?.runWatch;
      if (watch !== undefined) watches.list.push(watch);
      return orig.engineFor(...args);
    },
  };
});

function devEnv(dbPath: string, extra: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'development',
    DATABASE_PATH: dbPath,
    BIND_ADDRESS: '127.0.0.1',
    PORT: '3000',
    LOG_LEVEL: 'info',
    TRAVELPAYOUTS_TOKEN: S.TRAVELPAYOUTS_TOKEN,
    ...extra,
  });
}

let template = '';
beforeAll(async () => {
  template = join(fileTempDir('gmt-reload-seed-'), 'seed.db');
  const env = devEnv(template);
  const { loadBootConfig } = await import('../../src/wiring.js');
  const running = await bootApp({
    config: loadBootConfig(env),
    env,
    clock: fixedClock(T0),
    log: silentLog,
    listen: false,
    assets: assetPaths(),
  });
  await running.close();
}, TIMEOUT_MS);

function seededDb(): string {
  const dbPath = join(tempDir('gmt-reload-'), 's.db');
  copyFileSync(template, dbPath);
  return dbPath;
}

function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * `main` over `env` with no listening, a fixed clock, a captured log, its own signal emitter and exit: `pass(n)`
 * resolves once the n-th pass serves, `exited` with the exit code, `done` when main returns.
 */
function drive(
  env: Record<string, string>,
  bootWrap?: (deps: BootDeps, pass: number) => Promise<RunningApp>,
  listen = false,
) {
  const lines: string[] = [];
  const signals = new EventEmitter();
  const waiting: Array<ReturnType<typeof deferred<RunningApp>>> = [];
  const waiter = (n: number) => {
    while (waiting.length < n) waiting.push(deferred<RunningApp>());
    const w = waiting[n - 1];
    if (w === undefined) throw new Error('no waiter');
    return w;
  };
  const passes: RunningApp[] = [];
  const exitCodes: number[] = [];
  const exited = deferred<number>();
  let boots = 0;
  const done = main(env, {
    exit: (code) => {
      exitCodes.push(code);
      exited.resolve(code);
    },
    signals,
    boot: { listen, clock: fixedClock(T0) },
    logDestination: captureLines(lines),
    ...(bootWrap === undefined
      ? {}
      : {
          bootApp: (deps) => {
            boots += 1;
            return bootWrap(deps, boots);
          },
        }),
    onPass: (r) => {
      passes.push(r);
      waiter(passes.length).resolve(r);
    },
  });
  return {
    lines,
    signals,
    passes,
    exitCodes,
    exited: exited.promise,
    done,
    pass: (n: number) => waiter(n).promise,
  };
}

const HOST = 'localhost:3000';
const request = (r: RunningApp, path: string, method: 'GET' | 'PUT' | 'POST' = 'GET', json?: unknown) =>
  r.app.request(`http://${HOST}${path}`, {
    method,
    headers: {
      host: HOST,
      ...(method === 'GET' ? {} : { 'content-type': 'application/json', 'x-requested-with': 'get-me-there' }),
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
const save = async (r: RunningApp, changes: Record<string, string | null>) => {
  const res = await request(r, '/api/settings', 'PUT', { changes });
  expect(res.status).toBe(200);
  return apiContract.settingsUpdateResponseSchema.parse(await res.json());
};
const bootIdOf = async (r: RunningApp) =>
  z.object({ bootId: z.string() }).parse(await (await request(r, '/api/health')).json()).bootId;

function lockRow(dbPath: string) {
  const db = openDatabase(dbPath);
  try {
    return AppLock.inspect(db);
  } finally {
    db.close();
  }
}

const timers = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
const messages = (lines: string[]) =>
  lines.map((l) => z.object({ msg: z.string() }).parse(JSON.parse(l)).msg);

/** A search with nothing scheduled, on the configured free source. */
function search(r: RunningApp, name: string) {
  const free: ProviderId = 'travelpayouts';
  return r.ports.repos.definitions.create(
    exampleDefinitionInput({
      name,
      enabled: false,
      providers: { discovery: [free], verification: [], discoveryRefreshHours: { [free]: 168 } },
    }),
  );
}

describe('a save restarts the app in place (settings plan ruling 6)', { timeout: TIMEOUT_MS }, () => {
  it('an idle save closes the pass for a restart; the next pass serves the saved value under a new bootId; three passes leave one pair of listeners, no timer and no lock', async () => {
    const dbPath = seededDb();
    const timersBefore = timers();
    const d = drive(devEnv(dbPath));
    const first = await d.pass(1);
    expect(d.signals.listenerCount('SIGTERM')).toBe(1);
    expect(d.signals.listenerCount('SIGINT')).toBe(1);
    const firstId = await bootIdOf(first);
    expect(firstId).toBe(first.bootId);
    expect(await save(first, { FLIGHT_READ_PATIENCE: '20' })).toEqual({ warnings: [], applies: 'now' });
    expect(await first.closed).toBe('reload');

    const second = await d.pass(2);
    expect(second.ports.config.flightReadPatience).toBe(20);
    const secondId = await bootIdOf(second);
    expect(secondId).not.toBe(firstId);
    expect(d.signals.listenerCount('SIGTERM')).toBe(1);
    expect(await save(second, { DISCOVERY_REFRESH_DAYS: '14' })).toEqual({ warnings: [], applies: 'now' });
    expect(await second.closed).toBe('reload');

    const third = await d.pass(3);
    expect(third.ports.config.discoveryRefreshDays).toBe(14);
    expect(third.ports.config.flightReadPatience).toBe(20);
    expect(new Set([firstId, secondId, await bootIdOf(third)]).size).toBe(3);
    expect(d.signals.listenerCount('SIGTERM')).toBe(1);
    expect(d.signals.listenerCount('SIGINT')).toBe(1);

    d.signals.emit('SIGTERM');
    expect(await d.exited).toBe(EXIT.ok);
    await d.done;
    expect(await third.closed).toBe('stopped');
    expect(d.exitCodes).toEqual([EXIT.ok]);
    expect(d.signals.listenerCount('SIGTERM')).toBe(0);
    expect(d.signals.listenerCount('SIGINT')).toBe(0);
    expect(lockRow(dbPath)).toBeNull();
    expect(timers()).toBe(timersBefore);
    expect(messages(d.lines).filter((m) => m === 'restarting with the saved settings')).toHaveLength(2);
  });

  // why: a run that fails ends paused_error (spec §8.1's error table); the others are the succeeded, cancelled,
  // budget-paused and interrupted ends
  it.each([
    'completed',
    'paused_error',
    'cancelled',
    'paused_budget',
    'interrupted',
  ] as const satisfies readonly ExecutionStatus[])(
    'a save while a run is in flight waits for its end (%s): new work is refused in the words, two saves give one restart',
    async (end) => {
      watches.list.length = 0;
      const d = drive(devEnv(seededDb()));
      const first = await d.pass(1);
      const runningSearch = search(first, 'Autumn trip');
      const other = search(first, 'Spring trip');
      const s = seeder(first.ports);
      const startedAt: IsoDateTime = T0;
      const runId = s.execution('E1', { def: runningSearch, status: 'running', startedAt });

      expect(await save(first, { FLIGHT_READ_PATIENCE: '20' })).toMatchObject({ applies: 'after-runs' });
      expect(await save(first, { FLIGHT_READ_PATIENCE: '25' })).toMatchObject({ applies: 'after-runs' });
      const start = await request(first, `/api/definitions/${other.id}/executions`, 'POST', {});
      expect(start.status).toBe(503);
      expect(await start.json()).toMatchObject({
        error: { code: 'reload-pending', message: RELOAD_PENDING_TEXT },
      });
      const watch = watches.list[0];
      if (watch === undefined) throw new Error('the engine was given no run observer');
      // why: a run's settle while another is still in flight restarts nothing
      watch.ended();
      const view = apiContract.settingsViewSchema.parse(await (await request(first, '/api/settings')).json());
      expect(view.pending).not.toBeNull();
      expect(view.values.FLIGHT_READ_PATIENCE).toBe('25');

      first.ports.repos.executions.setStatus(runId, end, { finishedAt: T0 });
      watch.ended();
      expect(await first.closed).toBe('reload');
      const second = await d.pass(2);
      expect(second.ports.config.flightReadPatience).toBe(25);
      d.signals.emit('SIGTERM');
      expect(await d.exited).toBe(EXIT.ok);
      await d.done;
      expect(d.passes).toHaveLength(2);
      expect(messages(d.lines).filter((m) => m === 'restarting with the saved settings')).toHaveLength(1);
    },
  );

  it('SIGTERM after a restart checkpoints and releases the lock once, and exits 0 once', async () => {
    const dbPath = seededDb();
    const d = drive(devEnv(dbPath));
    const first = await d.pass(1);
    await save(first, { FLIGHT_READ_PATIENCE: '20' });
    await first.closed;
    const second = await d.pass(2);
    const checkpoint = vi.spyOn(second.ports.db, 'checkpoint');
    const release = vi.spyOn(AppLock.prototype, 'release');
    d.signals.emit('SIGTERM');
    // why: both listeners stay while the close runs, so a second signal is ignored here rather than taking the
    // platform's default exit before the lock is released
    expect(d.signals.listenerCount('SIGTERM')).toBe(1);
    expect(d.signals.listenerCount('SIGINT')).toBe(1);
    // why: a second signal while the first close runs is the same close
    d.signals.emit('SIGINT');
    d.signals.emit('SIGTERM');
    expect(await d.exited).toBe(EXIT.ok);
    await d.done;
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(d.exitCodes).toEqual([EXIT.ok]);
    expect(lockRow(dbPath)).toBeNull();
    release.mockRestore();
  });

  it('a second boot that fails ends the loop with its own code and the boot-failure log, holding no lock', async () => {
    const dbPath = seededDb();
    const other: { lock: AppLock | null; db: Db | null } = { lock: null, db: null };
    const d = drive(devEnv(dbPath), async (deps, pass) => {
      if (pass === 2) {
        // why: another holder takes the lock between the passes; the next pass takes it without the wait, so refuses
        const db = openDatabase(dbPath);
        other.db = db;
        other.lock = new AppLock(db, 'tool', fixedClock(T0), silentLog);
        expect(other.lock.acquire({ waitMs: 0 })).toBe('acquired');
      }
      return bootApp(deps);
    });
    const first = await d.pass(1);
    await save(first, { FLIGHT_READ_PATIENCE: '20' });
    const failure = await d.done.then(
      () => null,
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(BootError);
    expect(failure instanceof BootError ? failure.exitCode : null).toBe(EXIT.lockRefused);
    expect(messages(d.lines)).toContain('boot failed');
    expect(d.signals.listenerCount('SIGTERM')).toBe(0);
    expect(lockRow(dbPath)?.holder).toBe('tool');
    other.lock?.release();
    // why: the other holder's own handle is closed too; Windows cannot remove a file a handle still holds open
    other.db?.close();
    expect(lockRow(dbPath)).toBeNull();
  });

  it('a real run cancelled through the app restarts it once the engine has written the end', async () => {
    // why: the run's first Travelpayouts call never answers until the run is stopped, so it is in flight on its own
    const reached = deferred<void>();
    stubVendors({ failOn: () => 'hang', onRequest: () => reached.resolve() });
    const d = drive(devEnv(seededDb()));
    const first = await d.pass(1);
    const def = search(first, 'Autumn trip');
    const started = await request(first, `/api/definitions/${def.id}/executions`, 'POST', {});
    expect(started.status).toBe(202);
    const { executionId } = apiContract.startExecutionResponseSchema.parse(await started.json());
    await reached.promise;
    expect(await save(first, { FLIGHT_READ_PATIENCE: '20' })).toEqual({
      warnings: [],
      applies: 'after-runs',
      running: ['Autumn trip'],
    });
    expect((await request(first, `/api/executions/${executionId}/cancel`, 'POST', {})).status).toBe(200);
    expect(await first.closed).toBe('reload');
    const second = await d.pass(2);
    expect(second.ports.repos.executions.get(executionId)?.status).toBe('cancelled');
    expect(second.ports.config.flightReadPatience).toBe(20);
    d.signals.emit('SIGTERM');
    expect(await d.exited).toBe(EXIT.ok);
    await d.done;
  });

  it("a signal during a restart's close ends the loop: the close finishes, no next pass boots, exit 0 once", async () => {
    const dbPath = seededDb();
    const d = drive(devEnv(dbPath));
    const first = await d.pass(1);
    const gate = deferred<void>();
    const shutdown = first.engine.shutdown.bind(first.engine);
    vi.spyOn(first.engine, 'shutdown').mockImplementation(async () => {
      await gate.promise;
      await shutdown();
    });
    expect(await save(first, { FLIGHT_READ_PATIENCE: '20' })).toEqual({ warnings: [], applies: 'now' });
    d.signals.emit('SIGTERM');
    gate.resolve();
    expect(await d.exited).toBe(EXIT.ok);
    await d.done;
    expect(await first.closed).toBe('reload');
    expect(d.passes).toHaveLength(1);
    expect(d.exitCodes).toEqual([EXIT.ok]);
    expect(lockRow(dbPath)).toBeNull();
    expect(messages(d.lines)).not.toContain('restarting with the saved settings');
  });

  it('a tool run inside the app holds the restart until it ends, is named meanwhile, and no tool starts while it waits', async () => {
    const release = deferred<void>();
    const running = deferred<void>();
    const d = drive(devEnv(seededDb()), (deps, pass) =>
      bootApp(
        pass === 1
          ? {
              ...deps,
              // why: a smoke that holds an execution row 'running' outside the engine, as the in-process tools do
              tools: (ports) => ({
                smoke: async () => {
                  const def = ports.repos.definitions.create(
                    exampleDefinitionInput({ name: 'hidden', enabled: false }),
                  );
                  const id = seeder(ports).execution('T1', { def, status: 'running', startedAt: T0 });
                  running.resolve();
                  await release.promise;
                  ports.repos.executions.setStatus(id, 'completed', { finishedAt: T0 });
                  return {
                    exitCode: 0,
                    summary: 'done',
                    lines: [],
                    fixturesWritten: [],
                    searchApiCreditsLedgered: null,
                  };
                },
              }),
            }
          : deps,
      ),
    );
    const first = await d.pass(1);
    const body = { origin: 'LHR', destination: 'JFK', budget: 2 };
    const tool = request(first, '/api/tools/smoke', 'POST', body);
    await running.promise;
    expect(await save(first, { FLIGHT_READ_PATIENCE: '20' })).toEqual({
      warnings: [],
      applies: 'after-runs',
      running: ['Smoke test'],
    });
    const second = await request(first, '/api/tools/smoke', 'POST', body);
    expect(second.status).toBe(503);
    expect(await second.json()).toMatchObject({
      error: { code: 'reload-pending', message: RELOAD_PENDING_TEXT },
    });
    release.resolve();
    expect((await tool).status).toBe(200);
    expect(await first.closed).toBe('reload');
    expect((await d.pass(2)).ports.config.flightReadPatience).toBe(20);
    d.signals.emit('SIGTERM');
    expect(await d.exited).toBe(EXIT.ok);
    await d.done;
  });

  it('a tool asked after the restart has begun, while the pass still closes, is refused in the words and never runs', async () => {
    let ran = 0;
    const d = drive(devEnv(seededDb()), (deps) =>
      bootApp({
        ...deps,
        tools: () => ({
          smoke: async () => {
            ran += 1;
            return {
              exitCode: 0,
              summary: 'done',
              lines: [],
              fixturesWritten: [],
              searchApiCreditsLedgered: null,
            };
          },
        }),
      }),
    );
    const first = await d.pass(1);
    const gate = deferred<void>();
    const shutdown = first.engine.shutdown.bind(first.engine);
    vi.spyOn(first.engine, 'shutdown').mockImplementation(async () => {
      await gate.promise;
      await shutdown();
    });
    expect(await save(first, { FLIGHT_READ_PATIENCE: '20' })).toEqual({ warnings: [], applies: 'now' });
    // why: the restart has begun (its close waits on the gate); nothing waits for runs any more, yet the pass is held
    const view = apiContract.settingsViewSchema.parse(await (await request(first, '/api/settings')).json());
    expect(view.pending).toBeNull();
    const late = await request(first, '/api/tools/smoke', 'POST', {
      origin: 'LHR',
      destination: 'JFK',
      budget: 2,
    });
    expect(late.status).toBe(503);
    expect(await late.json()).toMatchObject({
      error: { code: 'reload-pending', message: RELOAD_PENDING_TEXT },
    });
    expect(ran).toBe(0);
    gate.resolve();
    expect(await first.closed).toBe('reload');
    await d.pass(2);
    d.signals.emit('SIGTERM');
    expect(await d.exited).toBe(EXIT.ok);
    await d.done;
  });

  it('no secret reaches the log across a restart (expectNoSecrets)', async () => {
    const d = drive(devEnv(seededDb(), { SMTP_PASS: '' }));
    const first = await d.pass(1);
    await save(first, {
      SEARCHAPI_KEY: S.SEARCHAPI_KEY,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'alerts@example.com',
      SMTP_PASS: S.SMTP_PASS,
      ALERT_EMAIL_TO: 'operator@example.com',
      ALERT_EMAIL_FROM: 'alerts@example.com',
    });
    await first.closed;
    const second = await d.pass(2);
    expect(second.ports.config.smtp?.pass.reveal()).toBe(S.SMTP_PASS);
    second.ports.log.warn({ detail: `echoed ${S.SMTP_PASS} ${S.SEARCHAPI_KEY}` }, 'probe');
    const view = await (await request(second, '/api/settings')).text();
    d.signals.emit('SIGTERM');
    await d.exited;
    await d.done;
    expectNoSecrets(Object.values(S), { log: d.lines.join(''), 'GET /api/settings': view });
  });
});

/** A port the OS has just handed out and taken back, so no test hard-codes one. */
async function freePort(): Promise<number> {
  const probe = createServer();
  // why: the network guards refuse every lookup, the loopback literal's included, unless a test lets it through
  const undo = allowLoopback(0);
  try {
    probe.listen(0, '127.0.0.1');
    await once(probe, 'listening');
  } finally {
    undo();
  }
  const address = probe.address();
  probe.close();
  await once(probe, 'close');
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

/** One request over real HTTP, its body read whole; `agent` keeps its connection open afterwards when it keeps alive. */
async function call(
  port: number,
  path: string,
  o: { agent: Agent | false; method?: 'GET' | 'PUT'; json?: unknown },
): Promise<{ status: number; body: string; socketClosed: Promise<unknown> }> {
  const body = o.json === undefined ? undefined : JSON.stringify(o.json);
  const req = httpRequest({
    host: '127.0.0.1',
    port,
    path,
    method: o.method ?? 'GET',
    agent: o.agent,
    headers: {
      host: `127.0.0.1:${port}`,
      ...(body === undefined
        ? {}
        : { 'content-type': 'application/json', 'x-requested-with': 'get-me-there' }),
    },
  });
  req.end(body);
  const [res] = await once(req, 'response');
  if (!(res instanceof Object) || !('statusCode' in res)) throw new Error('no response');
  const message: IncomingMessage = res;
  const chunks: Buffer[] = [];
  for await (const chunk of message) chunks.push(Buffer.from(chunk));
  const socket = req.socket;
  return {
    status: message.statusCode ?? 0,
    body: Buffer.concat(chunks).toString('utf8'),
    socketClosed: socket === null || socket.destroyed ? Promise.resolve() : once(socket, 'close'),
  };
}

describe('a save restarts the app in place on a real listener (Review Focus 4: no EADDRINUSE)', {
  timeout: TIMEOUT_MS,
}, () => {
  it('with keep-alive connections open when the save lands, the next pass listens on the same port and answers with a new bootId', async () => {
    const port = await freePort();
    // the listen and this test's own requests reach 127.0.0.1:<port>; nothing else does
    const undoLoopback = allowLoopback(port);
    const d = drive(devEnv(seededDb(), { PORT: String(port) }), undefined, true);
    const first = await d.pass(1);
    expect(first.port).toBe(port);
    // an idle keep-alive connection, and the one the save is sent on, kept alive after its answer
    const idle = new Agent({ keepAlive: true, maxSockets: 1 });
    const saving = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const health = await call(port, '/api/health', { agent: idle });
      expect(health.status).toBe(200);
      const firstId = z.object({ bootId: z.string() }).parse(JSON.parse(health.body)).bootId;
      expect(firstId).toBe(first.bootId);
      expect((await call(port, '/api/health', { agent: saving })).status).toBe(200);
      const saved = await call(port, '/api/settings', {
        agent: saving,
        method: 'PUT',
        json: { changes: { FLIGHT_READ_PATIENCE: '20' } },
      });
      expect(saved.status).toBe(200);
      expect(apiContract.settingsUpdateResponseSchema.parse(JSON.parse(saved.body))).toEqual({
        warnings: [],
        applies: 'now',
      });
      // why: a page asks /api/health again over the connection it saved on; the closing pass must not answer it (a
      // connection kept alive past the close would be served by it, old bootId and all, and a page asking every second
      // would hold the close until the shutdown deadline). Refused, reset or the next pass's answer are all fine.
      const asked = await call(port, '/api/health', { agent: saving }).then(
        (r) => ({ answered: true as const, body: r.body }),
        () => ({ answered: false as const }),
      );
      if (asked.answered)
        expect(z.object({ bootId: z.string() }).parse(JSON.parse(asked.body)).bootId).not.toBe(firstId);
      // the close does not wait on either client: both connections are closed by the app, then the pass ends
      await Promise.all([health.socketClosed, saved.socketClosed]);
      expect(await first.closed).toBe('reload');

      const second = await d.pass(2);
      expect(second.port).toBe(port);
      expect(second.ports.config.flightReadPatience).toBe(20);
      const again = await call(port, '/api/health', { agent: false });
      expect(again.status).toBe(200);
      const secondId = z.object({ bootId: z.string() }).parse(JSON.parse(again.body)).bootId;
      expect(secondId).toBe(second.bootId);
      expect(secondId).not.toBe(firstId);
      expect(d.exitCodes).toEqual([]);
      expect(d.lines.join('')).not.toContain('EADDRINUSE');
    } finally {
      idle.destroy();
      saving.destroy();
      d.signals.emit('SIGTERM');
      await d.exited;
      await d.done;
      undoLoopback();
    }
  });
});
