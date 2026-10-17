import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { asIsoDateTime, fixedClock, systemClock } from '@gmt/core';
import { AppLock, applyMigrations, HEARTBEAT_INTERVAL_MS, MIGRATIONS_DIR, openDatabase } from '@gmt/db';
import { defaultRecordedRoot } from '@gmt/providers';
import { loadRecorded } from '@gmt/providers/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { backupsDirFor } from '../../src/bootstrap/preflight.js';
import {
  EXIT,
  isEntryPoint,
  type RunToolOptions,
  recordingTarget,
  repositoryRoots,
  runTool,
} from '../../src/bootstrap/tool.js';
import { RECORDED_BY } from '../../src/tools/record.js';
import { parseRecordArgs } from '../../src/tools/recordPlan.js';
import { SENTINEL_SA, SENTINEL_TP, silentLog, toolEnv } from '../helpers/env.js';
import { TEST_RECORDED_BY, testRecording } from '../helpers/recording.js';
import { filesUnder, tempDir } from '../helpers/tmp.js';
import { stubVendors } from '../helpers/vendors.js';

/** The nearest repository root (the worktree's own, when run from one). */
function repositoryRoot(): string {
  const [nearest] = repositoryRoots();
  if (nearest === undefined) throw new Error('no repository root above the recorded tree');
  return nearest;
}

const ROUTE = ['--budget', '5', '--route', 'LHR,LGW:JFK,EWR', '--month', '2027-03'];
const DRY = [...ROUTE, '--dry-run'];

afterEach(() => {
  vi.useRealTimers();
});
/** Every file of the committed tree with its size and mtime. */
function committedTree(): string[] {
  return filesUnder(defaultRecordedRoot()).map((p) => {
    const st = statSync(p);
    return `${p} ${st.size} ${st.mtimeMs}`;
  });
}
// why: no test adds, removes or changes a file in the committed tree (prov-wp04b-006); a snapshot, not a fixed list,
// so the guard holds before and after Task 12b commits the recorded tree (prov-wp04b-r3-001)
let committedBefore: string[] = [];
beforeAll(() => {
  committedBefore = committedTree();
});
afterAll(() => {
  expect(committedTree()).toEqual(committedBefore);
});

/** A temp database and a temp recorded tree with the test signature (every runTool test records there, never in the committed tree). */
function harness(dbPath = join(tempDir('gmt-tool-'), 'tool.db'), extra: Record<string, string> = {}) {
  const rec = testRecording();
  const out: string[] = [];
  const err: string[] = [];
  // why: the tool's pino lines (e.g. a lost lock) go to this sink, not the test runner's stderr
  const logDestination = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const opts: RunToolOptions = {
    env: toolEnv(dbPath, extra),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    logDestination,
    recording: rec.recording,
  };
  return { dbPath, root: rec.root, out, err, opts, text: () => out.join('\n'), errors: () => err.join('\n') };
}

function holdLock(dbPath: string, at: 'now' | 'stale', holder: 'app' | 'tool' = 'app'): void {
  const db = openDatabase(dbPath);
  applyMigrations(db, MIGRATIONS_DIR);
  const clock =
    at === 'now' ? systemClock : fixedClock(asIsoDateTime(new Date(Date.now() - 10 * 60_000).toISOString()));
  expect(new AppLock(db, holder, clock, silentLog).acquire({ waitMs: 0 })).toBe('acquired');
  db.close();
}

/** One row of a query, read after the tool has finished with the file. */
function count(dbPath: string, sql: string): unknown {
  const db = openDatabase(dbPath);
  try {
    return db.raw.prepare(sql).get();
  } finally {
    db.close();
  }
}

describe('runTool refusals (spec §5.5, §7, plan decision 20)', () => {
  it('refuses NODE_ENV=test (read through loadConfigFromEnv) before opening anything', async () => {
    const h = harness(undefined, { NODE_ENV: 'test' });
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.refusedTestEnv);
    expect(h.errors()).toContain('tool bootstrap refuses NODE_ENV=test');
    expect(existsSync(h.dbPath)).toBe(false);
  });

  it('reports invalid configuration with 78 and never echoes a value', async () => {
    const h = harness(undefined, { BIND_ADDRESS: '0.0.0.0' });
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.badConfig);
    expect(h.errors()).toContain('invalid configuration');
    expect(h.errors()).not.toContain(SENTINEL_SA);
  });

  it('refuses while the synthetic gate is open with 70, as the plan exit table says (sec-005, ts-012, arch-r3-001)', async () => {
    const dir = tempDir();
    const h = harness(join(dir, 'tool.fixture.db'), { ALLOW_FIXTURE_PROVIDER: 'i-understand-this-is-fake' });
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.refusedTestEnv);
    expect(h.errors()).toContain('synthetic gate is open');
    expect(existsSync(join(dir, 'tool.fixture.db'))).toBe(false);
  });

  it('refuses smoke (WP13) and a missing budget with the usage code', async () => {
    const h = harness();
    expect(await runTool('smoke', [], h.opts)).toBe(EXIT.usage);
    expect(h.errors()).toContain('WP13 adds it');
    expect(await runTool('record', ['--route', 'LHR:JFK', '--month', '2027-03'], h.opts)).toBe(EXIT.usage);
    expect(h.errors()).toContain('--budget is required');
  });

  it.each([
    [{ SEARCHAPI_KEY: '' }, 'needs TRAVELPAYOUTS_TOKEN and SEARCHAPI_KEY'],
    [{ POINT_OF_SALE: 'US' }, 'POINT_OF_SALE=GB'],
  ])('refuses a configuration that cannot record with 78: %j (arch-022, po-009)', async (extra, message) => {
    const h = harness(undefined, extra);
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.badConfig);
    expect(h.errors()).toContain(message);
  });

  it('a fresh app lock refuses with 75 before the backup or any migration (po-008, sec-007)', async () => {
    const h = harness();
    const db = openDatabase(h.dbPath); // a bare table, no migrations: the pre-migration case
    db.raw.exec(
      'CREATE TABLE app_lock (id INTEGER PRIMARY KEY, holder TEXT NOT NULL, heartbeat_at TEXT NOT NULL, acquired_at TEXT NOT NULL)',
    );
    const now = new Date().toISOString();
    db.raw.prepare('INSERT INTO app_lock VALUES (1, ?, ?, ?)').run('app', now, now);
    db.close();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.lockRefused);
    expect(h.errors()).toContain('app_lock is held by app');
    expect(existsSync(backupsDirFor(h.dbPath))).toBe(false);
    expect(
      count(h.dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'"),
    ).toEqual({ n: 0 });
  });

  it('a fresh app lock on a migrated database refuses with 75 and leaves the lock untouched', async () => {
    const h = harness();
    holdLock(h.dbPath, 'now');
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.lockRefused);
    expect(count(h.dbPath, 'SELECT holder FROM app_lock')).toEqual({ holder: 'app' });
  });

  it.skipIf(process.getuid?.() === 0)(
    'refuses with 73 when the data directory is not writable (ts-018)',
    async () => {
      const dir = tempDir();
      chmodSync(dir, 0o500);
      const h = harness(join(dir, 'tool.db'));
      expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
      expect(h.errors()).toContain('is not writable');
    },
  );

  it.skipIf(process.getuid?.() === 0)(
    'refuses with 73 when an existing database sits in a directory that is not writable (arch-r2-001, sec2-001)',
    async () => {
      const dir = tempDir();
      const h = harness(join(dir, 'tool.db'));
      holdLock(h.dbPath, 'stale');
      chmodSync(dir, 0o500);
      expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
      expect(h.errors()).toContain('is not writable');
    },
  );

  it('refuses with 73, scrubbed, when DATABASE_PATH is not a SQLite database: no backup, no lock (r2-ts-005 a)', async () => {
    const h = harness();
    writeFileSync(h.dbPath, 'not a database; long enough to fill a SQLite header page, which this is not');
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
    expect(h.errors()).toContain('cannot read app_lock');
    expect(existsSync(backupsDirFor(h.dbPath))).toBe(false);
  });

  it('refuses with 73 when the migration state cannot be read (r2-ts-005 b)', async () => {
    const h = harness();
    const db = openDatabase(h.dbPath);
    db.raw.exec('CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY)'); // no created_at column
    db.close();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
    expect(h.errors()).toContain('cannot read the migration state');
  });

  it('refuses with 73 when migrations are pending and the backups path is not a directory', async () => {
    const h = harness();
    openDatabase(h.dbPath).close();
    writeFileSync(backupsDirFor(h.dbPath), 'not a directory');
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.preflightImpossible);
    expect(h.errors()).toContain('is not a writable directory');
  });

  it('a failed backup refuses with 74 and leaves the migrations pending (ts-013)', async () => {
    const h = harness();
    openDatabase(h.dbPath).close();
    mkdirSync(backupsDirFor(h.dbPath));
    chmodSync(backupsDirFor(h.dbPath), 0o777); // WP3 refuses a world-writable backups directory
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.backupFailed);
    expect(h.errors()).toContain('backup failed, refusing to migrate');
    expect(
      count(h.dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'"),
    ).toEqual({ n: 0 });
  });

  it('a buildPorts failure returns 1 with no lock taken', async () => {
    const h = harness();
    expect(await runTool('record', DRY, { ...h.opts, migrationsDir: join(tempDir(), 'missing') })).toBe(
      EXIT.failed,
    );
    expect(h.errors()).toContain('tool failed while opening the database');
    expect(count(h.dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'app_lock'")).toEqual({
      n: 0,
    });
  });
});

describe('runTool success paths', () => {
  it('backs up before migrating: the copy has the pre-migration schema, the database is migrated after (ts-013)', async () => {
    const h = harness();
    openDatabase(h.dbPath).close();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
    expect(h.text()).toContain('backup before 3 migration(s)'); // 0000, WP7's 0001 (decision 37) and WP11's 0002 (decision 56)
    const [backup] = readdirSync(backupsDirFor(h.dbPath));
    if (backup === undefined) throw new Error('no backup');
    expect(
      count(
        join(backupsDirFor(h.dbPath), backup),
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'app_lock'",
      ),
    ).toEqual({ n: 0 });
    expect(count(h.dbPath, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'app_lock'")).toEqual({
      n: 1,
    });
  });

  it('dry run: seeds airports, takes the tool lock, prints the plan and budget position, issues no request, creates no execution, releases', async () => {
    const h = harness();
    const seen = stubVendors();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
    const text = h.text();
    expect(text).toMatch(/airports seeded: \d+ rows/);
    expect(text).toContain('tool lock acquired');
    expect(text).toContain('metro from the airports table: LON');
    expect(text).toContain(
      'total: SearchApi 6 calls, ≤5 credits (4 expected); Travelpayouts 21 free calls, ≤61',
    );
    expect(text).toContain(`recording into: ${h.root}`);
    expect(text).toContain(
      'SearchApi window: 0 of 100 used (compare with the dashboard); room 100, this run ≤5',
    );
    expect(text).toContain('Travelpayouts per-run cap (EXECUTION_MAX_FREE_CALLS): 2000');
    expect(text).toContain(
      'SearchApi credits already ledgered to tool runs in this budget window: 0; this run ≤5; --budget 5',
    );
    expect(text).toContain('tool lock released');
    expect(`${text}${h.errors()}`).not.toContain(SENTINEL_SA);
    expect(seen.requests).toEqual([]);
    expect(count(h.dbPath, 'SELECT COUNT(*) AS n FROM provider_requests')).toEqual({ n: 0 });
    expect(count(h.dbPath, 'SELECT COUNT(*) AS n FROM search_executions')).toEqual({ n: 0 });
    expect(count(h.dbPath, 'SELECT COUNT(*) AS n FROM app_lock')).toEqual({ n: 0 });
  });

  it('dry run refuses a plan that does not fit EXECUTION_MAX_FREE_CALLS (ruling 13)', async () => {
    const h = harness(undefined, { EXECUTION_MAX_FREE_CALLS: '57' });
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.badConfig);
    expect(h.errors()).toContain(
      'the plan needs up to 61 Travelpayouts calls but EXECUTION_MAX_FREE_CALLS is 57',
    );
  });

  it('takes over a stale app lock', async () => {
    const h = harness();
    holdLock(h.dbPath, 'stale');
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
  });

  // why: two full recording runs over a real SQLite ledger; under a loaded machine this exceeds Vitest's 5 s default.
  it('a live run through runTool records into the given root under the test signature; a second run needs --confirm-rerun (ts-014, ruling 3, prov-wp04b-006)', async () => {
    const h = harness();
    stubVendors();
    expect(await runTool('record', ROUTE, h.opts)).toBe(EXIT.ok);
    expect(h.text()).toContain('required calls: all as expected');
    expect(h.text()).toContain('ledger: SearchApi 4 credit(s) of budget 5; Travelpayouts 21 free call(s)');
    expect(filesUnder(h.root).filter((f) => f.endsWith('.json') && !f.endsWith('.raw.json'))).toHaveLength(
      29,
    ); // 27 recordings + 2 allowlists
    for (const f of loadRecorded(h.root, 'searchapi', '/api/v1/search'))
      expect(f.recordedBy).toBe(TEST_RECORDED_BY);
    const again = harness(h.dbPath);
    expect(await runTool('record', ROUTE, again.opts)).toBe(EXIT.spendRefused);
    expect(again.errors()).toContain('credits already ledgered to earlier tool runs');
    expect(again.text()).toContain('(a live run needs --confirm-rerun)');
    const confirmed = harness(h.dbPath);
    expect(await runTool('record', [...ROUTE, '--confirm-rerun'], confirmed.opts)).toBe(EXIT.ok);
  }, 30_000);

  it('a live run refuses with 65, before any request, when the SearchApi window has less room than the worst case (cost-wp4b-r2-001)', async () => {
    const h = harness(undefined, { SEARCHAPI_TRIAL_USED: '97' });
    const seen = stubVendors();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
    expect(h.text()).toContain(
      'a live run would be refused: the SearchApi window has room for 3 credit(s) but this run may use 5',
    );
    expect(await runTool('record', [...ROUTE, '--confirm-rerun'], h.opts)).toBe(EXIT.spendRefused);
    expect(h.errors()).toContain('the SearchApi window has room for 3 credit(s)');
    expect(seen.requests).toEqual([]);
  });

  it('a recording that fails closed exits 1 and still prints the calls, the session and the ledger line (r2-ts-004)', async () => {
    const h = harness();
    stubVendors({ echo: 'calendar-parameters' });
    expect(await runTool('record', ROUTE, h.opts)).toBe(EXIT.failed);
    expect(h.errors()).toContain('record:fixtures failed');
    expect(h.text()).toMatch(/session: \S+/);
    expect(h.text()).toContain('ledger: SearchApi 1 credit(s) of budget 5; Travelpayouts 21 free call(s)'); // the refused 200 was billed
    expect(`${h.text()}${h.errors()}`).not.toContain(SENTINEL_SA);
  });
});

describe('where a record run may write (sec2-002 ruling)', () => {
  function bare(extra: Record<string, string> = {}) {
    const h = harness(undefined, extra);
    const { recording: _ignored, ...opts } = h.opts;
    return { ...h, opts };
  }

  it('the committed tree takes only the worked example: another route without --out refuses with 64 before anything is opened', async () => {
    const h = bare();
    expect(
      await runTool(
        'record',
        ['--budget', '5', '--route', 'LHR:JFK', '--month', '2027-03', '--dry-run'],
        h.opts,
      ),
    ).toBe(EXIT.usage);
    expect(h.errors()).toContain(
      'the committed recorded tree holds only the worked example (--route LHR,LGW:JFK,EWR)',
    );
    expect(existsSync(h.dbPath)).toBe(false);
  });

  it('--out inside the repository refuses with 64', async () => {
    const h = bare();
    const inside = join(repositoryRoot(), 'tmp-recordings');
    expect(
      await runTool(
        'record',
        ['--budget', '5', '--route', 'LHR:JFK', '--month', '2027-03', '--out', inside, '--dry-run'],
        h.opts,
      ),
    ).toBe(EXIT.usage);
    expect(h.errors()).toContain('is inside the repository');
    expect(existsSync(inside)).toBe(false);
  });

  it('--out outside the repository records any route into <out>/fixtures/recorded', async () => {
    const h = bare();
    const out = join(tempDir(), 'mine');
    expect(
      await runTool(
        'record',
        ['--budget', '5', '--route', 'LHR:JFK', '--month', '2027-03', '--out', out, '--dry-run'],
        h.opts,
      ),
    ).toBe(EXIT.ok);
    expect(h.text()).toContain(`recording into: ${join(out, 'fixtures', 'recorded')}`);
  });

  it('the worked example without --out writes the committed tree (the dry run names it; nothing is written)', async () => {
    const h = bare();
    expect(await runTool('record', DRY, h.opts)).toBe(EXIT.ok);
    expect(h.text()).toContain(`recording into: ${defaultRecordedRoot()}`);
  });

  it('isEntryPoint compares the unresolved path when realpath fails (arch-r2-006)', () => {
    const missing = join(tempDir(), 'gone.ts');
    expect(isEntryPoint(missing, pathToFileURL(missing).href)).toBe(true);
    expect(isEntryPoint(undefined, pathToFileURL(missing).href)).toBe(false);
  });
});

describe('runTool releases the lock on every exit path (ts-003)', () => {
  function lockRow(dbPath: string): unknown {
    return count(dbPath, 'SELECT COUNT(*) AS n FROM app_lock');
  }

  it('a throwing tool returns 1 with a scrubbed message, and the lock is released', async () => {
    const h = harness();
    const code = await runTool('record', DRY, {
      ...h.opts,
      runners: {
        record: async () => {
          throw new Error(`boom with ${SENTINEL_TP} at https://x.example/p?token=abc`);
        },
      },
    });
    expect(code).toBe(EXIT.failed);
    expect(h.errors()).toContain('tool failed: boom with [redacted] at https://x.example/p');
    expect(h.errors()).not.toContain(SENTINEL_TP);
    expect(lockRow(h.dbPath)).toEqual({ n: 0 });
  });

  it.each(['SIGINT', 'SIGTERM'] as const)(
    '%s aborts the tool, the lock is released and the listeners removed',
    async (sig) => {
      const h = harness();
      const before = process.listenerCount(sig);
      const code = await runTool('record', DRY, {
        ...h.opts,
        runners: {
          record: async (_ports, _cli, ctx) => {
            expect(process.listenerCount(sig)).toBe(before + 1);
            process.emit(sig);
            return ctx.signal.aborted ? 42 : 0;
          },
        },
      });
      expect(code).toBe(42);
      expect(process.listenerCount(sig)).toBe(before);
      expect(lockRow(h.dbPath)).toEqual({ n: 0 });
    },
  );

  it('a second SIGINT only aborts again: the handler stays until the lock is released (r2-ts-005 e)', async () => {
    const h = harness();
    const before = process.listenerCount('SIGINT');
    const code = await runTool('record', DRY, {
      ...h.opts,
      runners: {
        record: async (_ports, _cli, ctx) => {
          process.emit('SIGINT');
          process.emit('SIGINT');
          return process.listenerCount('SIGINT') === before + 1 && ctx.signal.aborted ? 42 : 0;
        },
      },
    });
    expect(code).toBe(42);
    expect(process.listenerCount('SIGINT')).toBe(before);
    expect(lockRow(h.dbPath)).toEqual({ n: 0 });
  });

  it('heartbeats every HEARTBEAT_INTERVAL_MS while the tool runs, not just once', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const h = harness();
    const clock = fixedClock(asIsoDateTime('2026-10-20T09:00:00.000Z'));
    const code = await runTool('record', DRY, {
      ...h.opts,
      clock,
      runners: {
        record: async (ports) => {
          // why: two intervals, so a one-shot timer in place of setInterval fails (ts minor 2)
          const beats: Array<string | undefined> = [];
          for (let i = 0; i < 2; i++) {
            clock.advance(HEARTBEAT_INTERVAL_MS);
            vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
            beats.push(AppLock.inspect(ports.db)?.heartbeatAt);
          }
          return beats.join() === '2026-10-20T09:00:30.000Z,2026-10-20T09:01:00.000Z' ? 0 : 9;
        },
      },
    });
    expect(code).toBe(EXIT.ok);
  });

  it('a lost lock aborts the tool and returns 75 instead of crashing in the timer (arch-014)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const h = harness();
    const code = await runTool('record', DRY, {
      ...h.opts,
      runners: {
        record: async (ports, _cli, ctx) => {
          ports.db.raw
            .prepare("UPDATE app_lock SET holder = 'app', acquired_at = '2000-01-01T00:00:00.000Z'")
            .run();
          vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
          return ctx.signal.aborted ? EXIT.ok : 9;
        },
      },
    });
    expect(code).toBe(EXIT.lockRefused);
    expect(h.errors()).toContain('app_lock lost');
    expect(count(h.dbPath, 'SELECT holder FROM app_lock')).toEqual({ holder: 'app' }); // never deletes another holder's lock
  });

  it('a tool that throws after the lock was lost returns 75 (r2-ts-005 d)', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const h = harness();
    const code = await runTool('record', DRY, {
      ...h.opts,
      runners: {
        record: async (ports) => {
          ports.db.raw
            .prepare("UPDATE app_lock SET holder = 'app', acquired_at = '2000-01-01T00:00:00.000Z'")
            .run();
          vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
          throw new Error('the tool noticed the abort and gave up');
        },
      },
    });
    expect(code).toBe(EXIT.lockRefused);
    expect(h.errors()).toContain('tool failed: the tool noticed the abort and gave up');
  });
});

describe('runRecord through runTool: failed and partial runs (r2-ts-004)', () => {
  it('a run with required calls not as planned exits 1 and reports them without attributing skipped calls to the vendor', async () => {
    const h = harness();
    stubVendors({ calendar: 'no-priced-cell' });
    expect(await runTool('record', ROUTE, h.opts)).toBe(EXIT.failed);
    const text = h.text();
    expect(text).toContain('required calls: NOT all as expected: SA-03, SA-04, SA-05, SA-06');
    expect(text).toContain('chain step 1 → 2 → 3: incomplete');
    expect(text).toContain(
      'over-limit calendar (SA-03): no vendor answer recorded: SA-03 skipped (skipped: calendar SA-02 gave no usable cell; the run must be repeated)',
    );
    expect(text).not.toContain('raise a finding for WP5');
    expect(text).toContain('ledger: SearchApi 1 credit(s) of budget 5; Travelpayouts 21 free call(s)');
  });

  it('a 5xx retried into a 200 prints the deletable non-final attempt file (prov-wp04b-r2-005, prov-wp04b-r3-005)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = harness();
    let failed = false;
    stubVendors({
      failOn: (u) => {
        if (failed || u.searchParams.get('engine') !== 'google_flights_calendar') return undefined;
        failed = true;
        return 'http-500';
      },
    });
    const run = runTool('record', ROUTE, h.opts);
    let done = false;
    run.then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    while (!done) await vi.advanceTimersByTimeAsync(500);
    expect(await run).toBe(EXIT.ok);
    const line = h.out.find((l) =>
      l.startsWith('SA-02: non-final attempt file(s), unbilled, delete before commit (Task 12b step 4): '),
    );
    expect(line).toBeDefined();
    const path = line?.split(': ').at(-1) ?? '';
    expect(JSON.parse(readFileSync(path, 'utf8')).status).toBe(500);
  });

  it('SIGINT during the calendar aborts the run: exit 1, the execution cancelled, the ledger line printed', async () => {
    const h = harness();
    stubVendors({
      onRequest: (u) => {
        if (u.searchParams.get('engine') === 'google_flights_calendar') process.emit('SIGINT');
      },
    });
    expect(await runTool('record', ROUTE, h.opts)).toBe(EXIT.failed);
    expect(h.text()).toContain('SA-02 aborted');
    expect(h.text()).toMatch(/ledger: SearchApi \d credit\(s\) of budget 5/);
    expect(count(h.dbPath, 'SELECT status, error_text AS e FROM search_executions')).toEqual({
      status: 'cancelled',
      e: 'aborted',
    });
  });

  it('--out records live into a fresh directory outside the repository, creating <out>/fixtures/recorded first (prov-wp04b-r3-003)', async () => {
    const h = harness();
    const { recording: _ignored, ...opts } = h.opts;
    const out = join(tempDir(), 'fresh', 'mine');
    stubVendors();
    expect(await runTool('record', [...ROUTE, '--out', out], opts)).toBe(EXIT.ok);
    const root = join(out, 'fixtures', 'recorded');
    expect(loadRecorded(root, 'searchapi', '/api/v1/search').map((f) => f.recordedBy)).toEqual(
      Array(6).fill(RECORDED_BY),
    );
    expect(count(h.dbPath, 'SELECT status FROM search_executions')).toEqual({ status: 'completed' });
  });
});

describe('recordingTarget (sec2-002 ruling, r3-ts-004)', () => {
  const cli = (argv: string[]) => {
    const r = parseRecordArgs(['--budget', '5', '--month', '2027-03', ...argv]);
    if (!r.ok) throw new Error(r.message);
    return r.value;
  };
  const example = ['--route', 'LHR,LGW:JFK,EWR'];
  const other = ['--route', 'LHR:JFK'];

  it('a given target wins unchanged', () => {
    const given = { root: '/tmp/x/fixtures/recorded', recordedBy: TEST_RECORDED_BY };
    expect(recordingTarget(cli(other), given)).toBe(given);
  });
  it('the worked example without --out records the committed tree under RECORDED_BY', () => {
    expect(recordingTarget(cli(example), undefined)).toEqual({
      root: defaultRecordedRoot(),
      recordedBy: RECORDED_BY,
    });
  });
  it('--out outside the repository records <out>/fixtures/recorded under RECORDED_BY', () => {
    const out = join(tempDir(), 'mine');
    expect(recordingTarget(cli([...other, '--out', out]), undefined)).toEqual({
      root: join(out, 'fixtures', 'recorded'),
      recordedBy: RECORDED_BY,
    });
  });
  it.each([
    ['the repository root', () => repositoryRoot()],
    ['a relative path that resolves inside it', () => join(repositoryRoot(), 'apps', '..', 'tmp-rec')],
    [
      'a symlink pointing into it',
      () => {
        const link = join(tempDir(), 'link');
        symlinkSync(repositoryRoot(), link);
        return join(link, 'tmp-rec');
      },
    ],
  ])('--out %s is refused', (_name, out) => {
    expect(recordingTarget(cli([...other, '--out', out()]), undefined)).toEqual({
      refusal: expect.stringContaining('is inside the repository'),
    });
  });
  it.skipIf(
    !existsSync(repositoryRoot().toUpperCase()) || repositoryRoot().toUpperCase() === repositoryRoot(),
  )('--out spelled in another case on a case-insensitive file system is refused (sec minor 1)', () => {
    expect(
      recordingTarget(cli([...other, '--out', join(repositoryRoot().toUpperCase(), 'tmp-rec')]), undefined),
    ).toEqual({ refusal: expect.stringContaining('is inside the repository') });
  });
  it('from a worktree, the enclosing checkout is a repository too, and --out inside it is refused (sec minor 1)', () => {
    const outer = realpathSync(tempDir('gmt-outer-'));
    const inner = join(outer, '.worktrees', 'x');
    const recorded = join(inner, 'packages', 'providers', 'fixtures', 'recorded');
    mkdirSync(recorded, { recursive: true });
    writeFileSync(join(outer, 'pnpm-workspace.yaml'), '');
    writeFileSync(join(inner, 'pnpm-workspace.yaml'), '');
    const roots = repositoryRoots(recorded);
    expect(roots).toEqual([inner, outer]);
    expect(recordingTarget(cli([...other, '--out', join(outer, 'tmp-rec')]), undefined, roots)).toEqual({
      refusal: expect.stringContaining('is inside the repository'),
    });
    const outside = join(tempDir(), 'mine');
    expect(recordingTarget(cli([...other, '--out', outside]), undefined, roots)).toEqual({
      root: join(outside, 'fixtures', 'recorded'),
      recordedBy: RECORDED_BY,
    });
  });
  it('another route without --out is refused', () => {
    expect(recordingTarget(cli(other), undefined)).toEqual({
      refusal: expect.stringContaining('holds only the worked example'),
    });
  });
});
