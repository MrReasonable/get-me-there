// The route-test harness (spec §9 item 5): real ports over an in-memory database (NODE_ENV=test + :memory:, which
// syntheticAllowed admits), the engine, and the fixture provider reached through http-kit's gated inProcessHosts seam
// (buildPorts wires it), so no request leaves the process and no msw is imported here.
import { Writable } from 'node:stream';
import { asIsoDateTime, fixedClock } from '@gmt/core';
import {
  AIRPORTS_DATA_DIR,
  type AirportsDataset,
  loadAirportsDataset,
  MIGRATIONS_DIR,
  seedAirports,
} from '@gmt/db';
import { createEngine, type Engine, LogNotifier } from '@gmt/engine';
import type { Hono } from 'hono';
import { afterEach } from 'vitest';
import { type AppOptions, createApp } from '../../src/app.js';
import { createLogger } from '../../src/logger.js';
import type { AppEnv } from '../../src/routes/types.js';
import { buildPorts, collectSecrets, loadConfigFromEnv, type Ports } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH } from './env.js';

/** The harness clock starts here; every seeded timestamp is relative to it. */
export const T0 = asIsoDateTime('2026-10-14T09:00:00.000Z');
export const HOST = 'localhost:3000';
export const AUTH_USER = 'operator';

/** A stream that appends every written chunk to `lines` (the logger's destination in tests). */
export function captureLines(lines: string[]): Writable {
  return new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
}

export function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS';
  json?: unknown;
  body?: string;
  headers?: Record<string, string>;
  /** false: send no Authorization header. */
  auth?: boolean;
  /** false: do not add Content-Type and X-Requested-With to a mutating request. */
  csrf?: boolean;
}

export interface Harness {
  ports: Ports;
  engine: Engine;
  app: Hono<AppEnv>;
  clock: ReturnType<typeof fixedClock>;
  logLines: string[];
  request(path: string, o?: RequestOptions): Promise<Response>;
  close(): Promise<void>;
}

/** The harness environment: every variable blank (= unset, spec §12), then the test values and the overrides. */
export function harnessEnv(env: Record<string, string> = {}): Record<string, string> {
  return cleanEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    BIND_ADDRESS: '127.0.0.1',
    PORT: '3000',
    APP_BASIC_AUTH_USER: AUTH_USER,
    APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
    // why: the fixture provider is billable at its test cost (spec §5.3), so the harness gives it headroom.
    EXECUTION_MAX_CALLS: '1000',
    MONTHLY_SPEND_CAP_PENCE: '1000',
    LOG_LEVEL: 'debug',
    ...env,
  });
}

/**
 * The airports a route test needs: every airport of the worked example's metros (London, New York), parsed once per
 * test file. why: route tests never run the 5,000-row sanity check (the boot tests seed the full table), and seeding
 * the full table into every in-memory harness made the suite slow enough to time out on a loaded machine (review
 * TS-4); with the metros' members present, metro-code validation and the airports route behave as with the full table.
 */
let dataset: AirportsDataset | undefined;
function routeTestAirports(): AirportsDataset {
  if (dataset !== undefined) return dataset;
  const full = loadAirportsDataset(AIRPORTS_DATA_DIR);
  const keep = new Set([...(full.metros.LON ?? []), ...(full.metros.NYC ?? [])]);
  dataset = { ...full, airports: full.airports.filter((a) => keep.has(a.iata)) };
  return dataset;
}

/** Every harness still open; closed after each test whatever the test did (review TS-8). */
const open: Harness[] = [];
afterEach(async () => {
  for (const h of open.splice(0)) await h.close();
});

export async function createHarness(
  opts: { env?: Record<string, string>; app?: AppOptions } = {},
): Promise<Harness> {
  const config = loadConfigFromEnv(harnessEnv(opts.env));
  const logLines: string[] = [];
  const log = createLogger(config, { destination: captureLines(logLines), secrets: collectSecrets(config) });
  const clock = fixedClock(T0);
  const ports = buildPorts(config, { log, clock, migrationsDir: MIGRATIONS_DIR });
  seedAirports(ports.db, routeTestAirports());
  const engine = createEngine({ ...ports, notifiers: [new LogNotifier(log)] });
  await engine.boot();
  const app = createApp(ports, engine, { webRoot: null, ...opts.app });
  let closed = false;
  const harness: Harness = {
    ports,
    engine,
    app,
    clock,
    logLines,
    request: async (path, o = {}) => {
      const method = o.method ?? (o.json !== undefined ? 'POST' : 'GET');
      const headers = new Headers({ host: HOST, ...o.headers });
      if (o.auth !== false && !headers.has('authorization'))
        headers.set('authorization', basic(AUTH_USER, SENTINEL_AUTH));
      if (method !== 'GET' && o.csrf !== false) {
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
        if (!headers.has('x-requested-with')) headers.set('x-requested-with', 'get-me-there');
      }
      const body = o.json !== undefined ? JSON.stringify(o.json) : o.body;
      return app.request(`http://${HOST}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await engine.shutdown();
      ports.db.close();
    },
  };
  open.push(harness);
  return harness;
}
