// A guard over a fresh database, the real budgetConfigFromConfig and real executions whose snapshots carry
// `budget.providerMaxCalls` (WP14 Task 14.7): what the engine builds, so the snapshot rule is tested end to end.
import { fixedClock, parseConfig } from '@gmt/core';
import { budgetConfigFromConfig } from '../../src/budgetConfig.js';
import { SqliteBudgetGuard } from '../../src/budgetGuard.js';
import { freshDb, T0 } from './db.js';

/** The app's env with camoufox on (synthetic key) and the caps the test names. */
export function camoufoxEnv(
  o: {
    camoufoxConfigCap?: number;
    monthlyCap?: number;
    maxFreeCalls?: number;
    executionScrollCap?: number;
    monthlyScrollCap?: number;
  } = {},
): Record<string, string> {
  return {
    NODE_ENV: 'production',
    DATABASE_PATH: '/data/get-me-there.db',
    APP_BASIC_AUTH_USER: 'ian',
    APP_BASIC_AUTH_PASS: 'correct-horse-battery',
    IN_CONTAINER: '1',
    CAMOUFOX_ENABLED: 'true',
    CAMOUFOX_WORKER_URL: 'http://host.docker.internal:8090',
    CAMOUFOX_WORKER_KEY: 'test-camoufox-worker-key-0123456789abcdef',
    CAMOUFOX_EXECUTION_PAGE_CAP: String(o.camoufoxConfigCap ?? 100),
    CAMOUFOX_MONTHLY_PAGE_CAP: String(o.monthlyCap ?? 1500),
    EXECUTION_MAX_FREE_CALLS: String(o.maxFreeCalls ?? 2000),
    CAMOUFOX_EXECUTION_SCROLL_CAP: String(o.executionScrollCap ?? 600),
    CAMOUFOX_MONTHLY_SCROLL_CAP: String(o.monthlyScrollCap ?? 6000),
  };
}

export function configFrom(env: Record<string, string>) {
  const r = parseConfig(env, { realpath: (p) => p });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.config;
}

function build(o: {
  camoufoxConfigCap?: number;
  monthlyCap?: number;
  maxFreeCalls?: number;
  executionScrollCap?: number;
  monthlyScrollCap?: number;
  snapshotCaps: Record<string, Partial<Record<'camoufox', number>>>;
}) {
  const config = configFrom(camoufoxEnv(o));
  const db = freshDb();
  for (const [id, caps] of Object.entries(o.snapshotCaps)) {
    db.raw
      .prepare(
        `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
          verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
         VALUES (@id, 'London to New York', '["LHR"]', '["JFK"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 10, 'economy', '{}',
          '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', '{}', '{"discovery":["camoufox"],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 1, @at, @at)`,
      )
      .run({ id: `d-${id}`, at: T0 });
    const budget = {
      maxCalls: 0,
      maxFreeCalls: config.spend.executionMaxFreeCalls,
      maxCostMicroGbp: 0,
      providerMaxCalls: caps,
    };
    db.raw
      .prepare(
        `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at) VALUES (@id, @definitionId, @snapshot, 'manual', 'running', @at)`,
      )
      .run({ id, definitionId: `d-${id}`, snapshot: JSON.stringify({ budget }), at: T0 });
  }
  return { guard: new SqliteBudgetGuard(db, budgetConfigFromConfig(config), fixedClock(T0)), db };
}

export function guardFor(o: Parameters<typeof build>[0]): SqliteBudgetGuard {
  return build(o).guard;
}

/** The same guard with its ledger rows' scroll counts, for tests that read them (WP15 Task 15.6). */
export function guardWithDb(o: Parameters<typeof build>[0]) {
  const { guard, db } = build(o);
  return {
    g: guard,
    rows: () =>
      db.raw
        .prepare<[], { scrollCount: number | null }>(
          'SELECT scroll_count AS scrollCount FROM provider_requests ORDER BY id',
        )
        .all(),
  };
}

/** The guard and its database (WP15: the ledger's scroll counts). */
export function guardWithLedger(o: Parameters<typeof build>[0]) {
  const { guard, db } = build(o);
  return { g: guard, db };
}
