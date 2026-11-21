// Spec §5.5, §9 item 5: one test spawning the real bootstrap with a real production environment.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiContract, asIata, asIsoDate, asIsoDateTime, FIXTURE_OPT_IN_PHRASE, systemClock } from '@gmt/core';
import { type CalendarPriceInsert, MIGRATIONS_DIR } from '@gmt/db';
import { fixtureProvider } from '@gmt/providers';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLogger } from '../../src/logger.js';
import { buildPorts, loadConfigFromEnv } from '../../src/wiring.js';
import { cleanEnv, SENTINEL_AUTH } from '../helpers/env.js';
import { tempDir } from '../helpers/tmp.js';

// why: the spawned process must see a real production environment, not vitest's NODE_ENV=test, so the env is built
// from scratch (cleanEnv blanks every variable spec §12 names) rather than copied from this process.
const apiRoot = fileURLToPath(new URL('../..', import.meta.url));
/** How long the probe process may take, how long the child may take to listen, and the two tests' budgets. */
const PROBE_TIMEOUT_MS = 20_000;
const LISTEN_TIMEOUT_MS = 45_000;
const BOOT_TEST_TIMEOUT_MS = 90_000;
const REFUSAL_TEST_TIMEOUT_MS = 60_000;
const ENTRY = ['--conditions=@gmt/source', '--import', 'tsx', 'src/bootstrap/start.ts'];

/** A free port. why: listen without a host, because the network guards refuse even a lookup of 127.0.0.1. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => {
      const a = s.address();
      if (a !== null && typeof a === 'object') {
        const port = a.port;
        s.close(() => resolve(port));
      } else reject(new Error('no port'));
    });
  });
}

/** Resolves with the first output line matching `pattern`; rejects with all output if the child exits first. */
function waitForLine(child: ChildProcess, pattern: RegExp, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${pattern}:\n${out}`)), timeoutMs);
    const onData = (chunk: Buffer) => {
      out += chunk.toString('utf8');
      const line = out.split('\n').find((l) => pattern.test(l));
      if (line !== undefined) {
        clearTimeout(timer);
        resolve(line);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`bootstrap exited with ${code} before ${pattern}:\n${out}`));
    });
  });
}

/** Resolves once `pattern` has matched `count` output lines in all; rejects with all output if the child exits first. */
function waitForLines(child: ChildProcess, pattern: RegExp, count: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${count} × ${pattern}:\n${out}`)),
      timeoutMs,
    );
    const onData = (chunk: Buffer) => {
      out += chunk.toString('utf8');
      if (out.split('\n').filter((l) => pattern.test(l)).length >= count) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`bootstrap exited with ${code} before ${count} × ${pattern}:\n${out}`));
    });
  });
}

/** A request to the spawned app from a separate node process (see `probe`), with a JSON body when one is given. */
function send(
  url: string,
  authorization: string,
  method: 'PUT',
  body: unknown,
): { status: number; body: unknown } {
  const init = {
    method,
    headers: {
      authorization,
      'content-type': 'application/json',
      'x-requested-with': 'get-me-there',
    },
    body: JSON.stringify(body),
  };
  const script = `const r = await fetch(${JSON.stringify(url)}, ${JSON.stringify(init)}); process.stdout.write(JSON.stringify({ status: r.status, body: await r.json() }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    // why: the probe is this node binary by its own path, so it needs nothing from this process's environment
    env: {},
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  return z.object({ status: z.number(), body: z.unknown() }).parse(JSON.parse(r.stdout));
}

/**
 * GET from the spawned app in a separate node process. why: this process's fetch is answered by WP4's network guards
 * (every request is a stray), so the probe runs where nothing is intercepted, on a numeric loopback address.
 */
function probe(url: string, authorization: string): { status: number; body: unknown } {
  const script = `const r = await fetch(${JSON.stringify(url)}, { headers: { authorization: ${JSON.stringify(authorization)} } }); process.stdout.write(JSON.stringify({ status: r.status, body: await r.json() }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    // why: the probe is this node binary by its own path, so it needs nothing from this process's environment
    env: {},
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
  });
  const out = z.object({ status: z.number(), body: z.unknown() }).parse(JSON.parse(r.stdout));
  return out;
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once('exit', (code) => resolve(code)));
}

/** A synthetic row the repository must refuse outside the gate (spec §5.5). */
function syntheticCalendarRow(): CalendarPriceInsert {
  return {
    providerId: 'fixture',
    sourceKind: 'synthetic',
    cabin: 'economy',
    cell: {
      origin: asIata('LHR'),
      destination: asIata('JFK'),
      departureDate: asIsoDate('2027-03-14'),
      returnDate: asIsoDate('2027-03-28'),
    },
    pricePence: 41_200,
    priceNativeMinor: 41_200,
    currencyNative: 'GBP',
    fx: { converted: false },
    pointOfSale: 'unknown',
    fetchedAt: asIsoDateTime('2026-10-14T09:00:00.000Z'),
    providerObservedAt: null,
    maxAgeHours: 0,
    vendorLink: null,
    reusedFromExecutionId: null,
    returnDateSource: 'vendor',
    vendorPriceMark: null,
  };
}

describe('production boot lacks fixture (spec §5.5, §9 item 5)', () => {
  it(
    'the real bootstrap under NODE_ENV=production never offers or accepts synthetic data',
    async () => {
      const dir = tempDir('gmt-spawn-');
      const port = await freePort();
      // why: the strongest negative case: the opt-in phrase is set, the path ends in .fixture.db and we are not in a
      // container, so NODE_ENV=production is the only thing standing between us and synthetic data.
      const env = cleanEnv({
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'production',
        DATABASE_PATH: join(dir, 'prod.fixture.db'),
        PORT: String(port),
        BIND_ADDRESS: '127.0.0.1',
        ALLOWED_HOSTS: `127.0.0.1:${port}`,
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
        ALLOW_FIXTURE_PROVIDER: FIXTURE_OPT_IN_PHRASE,
        LOG_LEVEL: 'info',
      });
      const child = spawn(process.execPath, ENTRY, { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
      try {
        await waitForLine(child, /"msg":"listening"/, LISTEN_TIMEOUT_MS);
        const auth = Buffer.from(`operator:${SENTINEL_AUTH}`).toString('base64');
        const res = probe(`http://127.0.0.1:${port}/api/providers`, `Basic ${auth}`);
        expect(res.status).toBe(200);
        const body = apiContract.providersResponseSchema.parse(res.body);
        expect(body.providers.map((p) => p.providerId)).not.toContain('fixture');
        expect(body.synthetic).toBe(false);
      } finally {
        child.kill('SIGTERM');
      }
      expect(await waitForExit(child)).toBe(0);

      // Same environment and file, in this process: the gates hold outside the server too.
      const config = loadConfigFromEnv(env);
      const log = createLogger({ logLevel: 'error' });
      const ports = buildPorts(config, { log, migrationsDir: MIGRATIONS_DIR });
      try {
        expect(ports.providers.map((p) => p.id)).not.toContain('fixture');
        expect(() =>
          fixtureProvider({ http: ports.http, log, clock: systemClock, config, costMicroGbp: 0 }),
        ).toThrow();
        // why: match the message so a foreign-key failure cannot satisfy the assertion by accident.
        expect(() => ports.repos.calendarPrices.insert('spawn-test', [syntheticCalendarRow()])).toThrow(
          /synthetic/i,
        );
      } finally {
        ports.db.close();
      }
    },
    BOOT_TEST_TIMEOUT_MS,
  );

  it(
    'a save restarts the real process in place: the next pass listens on the same port with a new boot id and the saved value (settings plan ruling 6)',
    async () => {
      const dir = tempDir('gmt-spawn-');
      const port = await freePort();
      const env = cleanEnv({
        NODE_ENV: 'production',
        DATABASE_PATH: join(dir, 'reload.db'),
        PORT: String(port),
        BIND_ADDRESS: '127.0.0.1',
        ALLOWED_HOSTS: `127.0.0.1:${port}`,
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
        LOG_LEVEL: 'info',
      });
      const child = spawn(process.execPath, ENTRY, { cwd: apiRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const auth = `Basic ${Buffer.from(`operator:${SENTINEL_AUTH}`).toString('base64')}`;
      const base = `http://127.0.0.1:${port}/api`;
      const health = z.object({ bootId: z.string() });
      const twice = waitForLines(child, /"msg":"listening"/, 2, LISTEN_TIMEOUT_MS * 2);
      // why: awaited below; a failure before then must not also surface as an unhandled rejection when the child exits
      twice.catch(() => undefined);
      try {
        await waitForLine(child, /"msg":"listening"/, LISTEN_TIMEOUT_MS);
        const before = health.parse(probe(`${base}/health`, auth).body).bootId;
        const saved = send(`${base}/settings`, auth, 'PUT', { changes: { FLIGHT_READ_PATIENCE: '20' } });
        expect(saved).toEqual({ status: 200, body: { warnings: [], applies: 'now' } });
        await twice;
        const after = probe(`${base}/health`, auth);
        expect(after.status).toBe(200);
        expect(health.parse(after.body).bootId).not.toBe(before);
        const view = apiContract.settingsViewSchema.parse(probe(`${base}/settings`, auth).body);
        expect(view.values.FLIGHT_READ_PATIENCE).toBe('20');
      } finally {
        child.kill('SIGTERM');
      }
      expect(await waitForExit(child)).toBe(0);
    },
    BOOT_TEST_TIMEOUT_MS * 2,
  );

  it(
    'refuses NODE_ENV=test with exit code 70 and bad config with 78 (plan exit-code table)',
    async () => {
      const dir = tempDir('gmt-spawn-');
      const base = {
        PATH: process.env.PATH ?? '',
        BIND_ADDRESS: '127.0.0.1',
        APP_BASIC_AUTH_USER: 'operator',
        APP_BASIC_AUTH_PASS: SENTINEL_AUTH,
      };
      const run = (env: Record<string, string>) =>
        waitForExit(
          spawn(process.execPath, ENTRY, {
            cwd: apiRoot,
            env: cleanEnv({ ...base, ...env }),
            stdio: 'ignore',
          }),
        );
      expect(await run({ NODE_ENV: 'test', DATABASE_PATH: join(dir, 'x.test.db') })).toBe(70);
      expect(
        await run({ NODE_ENV: 'production', DATABASE_PATH: join(dir, 'x.db'), PORT: 'not-a-port' }),
      ).toBe(78);
    },
    REFUSAL_TEST_TIMEOUT_MS,
  );
});
