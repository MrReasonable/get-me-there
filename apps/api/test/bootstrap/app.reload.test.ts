// Settings plan ruling 6 and Review Focus 1, 4 and 5: a save restarts the app in place. `main` listens for the signals
// once and runs passes of boot and serve: an idle save closes the pass with `closed` = 'reload' and the next pass boots
// with the saved value and a new bootId; a save while a run is in flight answers 'after-runs', holds the engine (a start
// is refused in the words) and restarts after the run's end, whatever the end; two saves give one restart; a second
// boot that fails ends the loop with its code; three passes leave one pair of signal listeners, no timer and no lock;
// SIGTERM after a restart checkpoints and releases once. No secret reaches a log across a restart. Every wait is on an
// event (a pass serving, `closed`, the exit), never a timer.
import { EventEmitter } from 'node:events';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiContract, type ExecutionStatus, fixedClock, type IsoDateTime, type ProviderId } from '@gmt/core';
import { AppLock, openDatabase } from '@gmt/db';
import { RELOAD_PENDING_TEXT, type RunWatch } from '@gmt/engine';
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
    boot: { listen: false, clock: fixedClock(T0) },
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
    // why: a second signal while the first close runs is the same close
    d.signals.emit('SIGINT');
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
    const other: { lock: AppLock | null } = { lock: null };
    const d = drive(devEnv(dbPath), async (deps, pass) => {
      if (pass === 2) {
        // why: another holder takes the lock between the passes; the next pass takes it without the wait, so refuses
        const db = openDatabase(dbPath);
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
    expect(lockRow(dbPath)).toBeNull();
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
