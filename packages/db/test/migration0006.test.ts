// Migration 0006 (spec §7 rev 34; plan decision 70; WP15 Task 15.6): where each calendar price's return date came from,
// the vendor's own price mark, and the scrolls a camoufox grid page made. Synthetic rows only.
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { freshDb, openTracked, T0, tmpDbPath } from './helpers/db.js';
import { migrationsWithout } from './helpers/migrations.js';

beforeEach(() => {
  expect.hasAssertions();
});

const SEED = [
  `INSERT INTO search_definitions (id, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
    verification_policy_json, budget_json, providers_json, schedule_tz, enabled, created_at, updated_at)
   VALUES ('d1', 'London to New York', '["LHR"]', '["JFK"]', '{"kind":"relative","startOffsetDays":7,"lengthDays":182}', 10, 10, 'economy', '{}',
    '{"maxCells":10,"topN":10,"alwaysInclude":[],"expandTop":2,"bookingLinks":true}', '{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}',
    '{"discovery":["travelpayouts"],"verification":[],"discoveryRefreshHours":{}}', 'Europe/London', 1, @at, @at)`,
  `INSERT INTO search_executions (id, definition_id, definition_snapshot_json, trigger, status, created_at) VALUES ('e1', 'd1', '{"budget":{"maxCalls":0,"maxFreeCalls":10,"maxCostMicroGbp":0}}', 'manual', 'completed', @at)`,
];
const price = (provider: string, kind: string, ret: string, extra = '', extraValues = '') =>
  `INSERT INTO calendar_prices (execution_id, provider_id, source_kind, cabin, origin, destination, departure_date, return_date, price_pence,
    price_native_minor, currency_native, fx_converted, point_of_sale, fetched_at, max_age_hours${extra})
   VALUES ('e1', '${provider}', '${kind}', 'economy', 'LHR', 'JFK', '2027-03-14', '${ret}', 45100, 45100, 'GBP', 0, 'GB', @at, 0${extraValues})`;
const request = (provider: string, scrolls: string) =>
  `INSERT INTO provider_requests (provider_id, endpoint_path, started_at, outcome, billable, cost_micro_gbp, http_attempt, scroll_count)
   VALUES ('${provider}', '/v1/page', @at, 'ok', 0, 0, 1, ${scrolls})`;

describe('migration 0006 (spec §7 rev 34)', () => {
  it('backfills return_date_source (asked for camoufox, vendor otherwise), leaves the new columns NULL, and keeps every ledger row', () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, migrationsWithout(['0006_grid_return_source']));
    for (const s of SEED) db.raw.prepare(s).run({ at: T0 });
    db.raw.prepare(price('travelpayouts', 'authorised-cached', '2027-03-24')).run({ at: T0 });
    db.raw.prepare(price('camoufox', 'scraped-self', '2027-03-25')).run({ at: T0 });
    db.raw.prepare(price('searchapi', 'scraped-aggregate', '2027-03-26')).run({ at: T0 });
    // why: fix round 1 (TS 10): ledger rows of two providers, before the column exists
    const before = (provider: string, outcome: string, status: number) =>
      `INSERT INTO provider_requests (provider_id, execution_id, endpoint_path, tile_index, started_at, finished_at, duration_ms, http_status, outcome, billable, cost_micro_gbp, http_attempt)
       VALUES ('${provider}', 'e1', '/x', 3, @at, @at, 120, ${status}, '${outcome}', 0, 0, 1)`;
    db.raw.prepare(before('camoufox', 'ok', 200)).run({ at: T0 });
    db.raw.prepare(before('travelpayouts', 'error', 500)).run({ at: T0 });
    applyMigrations(db, MIGRATIONS_DIR);
    expect(
      db.raw
        .prepare(
          'SELECT provider_id, execution_id, endpoint_path, tile_index, duration_ms, http_status, outcome, http_attempt, scroll_count FROM provider_requests ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        provider_id: 'camoufox',
        execution_id: 'e1',
        endpoint_path: '/x',
        tile_index: 3,
        duration_ms: 120,
        http_status: 200,
        outcome: 'ok',
        http_attempt: 1,
        scroll_count: null,
      },
      {
        provider_id: 'travelpayouts',
        execution_id: 'e1',
        endpoint_path: '/x',
        tile_index: 3,
        duration_ms: 120,
        http_status: 500,
        outcome: 'error',
        http_attempt: 1,
        scroll_count: null,
      },
    ]);
    expect(
      db.raw
        .prepare('SELECT provider_id, return_date_source, vendor_price_mark FROM calendar_prices ORDER BY id')
        .all(),
    ).toEqual([
      { provider_id: 'travelpayouts', return_date_source: 'vendor', vendor_price_mark: null },
      { provider_id: 'camoufox', return_date_source: 'asked', vendor_price_mark: null },
      { provider_id: 'searchapi', return_date_source: 'vendor', vendor_price_mark: null },
    ]);
    expect(db.raw.pragma('foreign_key_check')).toEqual([]);
  });
  it('return_date_source has no default: an insert that does not state it fails', () => {
    const db = freshDb();
    for (const s of SEED) db.raw.prepare(s).run({ at: T0 });
    expect(() =>
      db.raw.prepare(price('travelpayouts', 'authorised-cached', '2027-03-24')).run({ at: T0 }),
    ).toThrow(/NOT NULL/);
  });
  it.each([
    ['camoufox', 'scraped-self', 'grid-cell', "'low'", true],
    ['camoufox', 'scraped-self', 'asked', 'NULL', true],
    ['searchapi', 'scraped-aggregate', 'vendor', "'cheapest'", true],
    ['searchapi', 'scraped-aggregate', 'vendor', "'none'", true],
    ['travelpayouts', 'authorised-cached', 'grid-cell', 'NULL', false],
    ['camoufox', 'scraped-self', 'guessed', 'NULL', false],
    ['camoufox', 'scraped-self', 'grid-cell', "'great'", false],
  ])('%s %s with source %s and mark %s inserts: %s', (provider, kind, source, mark, ok) => {
    const db = freshDb();
    for (const s of SEED) db.raw.prepare(s).run({ at: T0 });
    const run = () =>
      db.raw
        .prepare(
          price(
            provider,
            kind,
            '2027-03-24',
            ', return_date_source, vendor_price_mark',
            `, '${source}', ${mark}`,
          ),
        )
        .run({ at: T0 });
    if (ok) expect(run).not.toThrow();
    else expect(run).toThrow(/CHECK/);
  });
  it('scroll_count: a camoufox row may carry a count of 0 or more; another provider never one', () => {
    const db = freshDb();
    const at = { at: T0 };
    expect(() => db.raw.prepare(request('camoufox', '0')).run(at)).not.toThrow();
    expect(() => db.raw.prepare(request('camoufox', '97')).run(at)).not.toThrow();
    expect(() => db.raw.prepare(request('camoufox', 'NULL')).run(at)).not.toThrow();
    expect(() => db.raw.prepare(request('camoufox', '-1')).run(at)).toThrow(/CHECK/);
    expect(() => db.raw.prepare(request('searchapi', '1')).run(at)).toThrow(/CHECK/);
  });
});
