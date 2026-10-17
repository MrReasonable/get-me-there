import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { applyMigrations, pendingMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { RoutePriceHistoryRepo } from '../src/repositories/routePriceHistory.js';
import { openTracked, sqliteCode, T0, tmpDbPath, tmpDir } from './helpers/db.js';

const TAG = '0003_route_history_by_trip';

/** A copy of the migrations folder that stops at 0002, as an install made before this migration has it. */
function upTo0002(): string {
  const dir = join(tmpDir(), 'drizzle');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  rmSync(join(dir, `${TAG}.sql`));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => e.tag !== TAG);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0003: route price history keyed by trip (ruling 6, spec §7 rev 28)', () => {
  it('keeps every existing row with NULL trip dates, adds the trip key, and refuses half a trip', () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, upTo0002());
    const insertOld = db.raw.prepare(
      `INSERT INTO route_price_history (origin, destination, cabin, provider_id, date, lowest_price_pence, fetched_at) VALUES ('LHR', 'JFK', 'unknown', 'searchapi', ?, ?, ?)`,
    );
    insertOld.run('2026-09-01', 48_000, T0);
    insertOld.run('2026-09-02', 47_500, T0);
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([TAG]);
    applyMigrations(db, MIGRATIONS_DIR);
    const rows = db.raw
      .prepare(
        'SELECT origin, destination, departure_date, return_date, cabin, provider_id, date, lowest_price_pence, fetched_at FROM route_price_history ORDER BY date',
      )
      .all();
    expect(rows).toEqual([
      {
        origin: 'LHR',
        destination: 'JFK',
        departure_date: null,
        return_date: null,
        cabin: 'unknown',
        provider_id: 'searchapi',
        date: '2026-09-01',
        lowest_price_pence: 48_000,
        fetched_at: T0,
      },
      expect.objectContaining({ departure_date: null, date: '2026-09-02', lowest_price_pence: 47_500 }),
    ]);
    // why: a new write for a known trip sits beside the migrated rows; the old series is "trip unknown", never merged.
    const repo = new RoutePriceHistoryRepo(db, { allowSynthetic: false });
    repo.upsert([
      {
        origin: asIata('LHR'),
        destination: asIata('JFK'),
        trip: { departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2026-11-15') },
        cabin: 'economy',
        providerId: 'searchapi',
        date: asIsoDate('2026-09-01'),
        lowestPricePence: 46_000,
        currency: 'GBP',
        fetchedAt: T0,
      },
    ]);
    expect(repo.series(asIata('LHR'), asIata('JFK'), 'searchapi', 'unknown').map((s) => s.trip)).toEqual([
      null,
    ]);
    expect(repo.series(asIata('LHR'), asIata('JFK'), 'searchapi', 'economy').map((s) => s.trip)).toEqual([
      { departureDate: '2026-11-05', returnDate: '2026-11-15' },
    ]);
    expect(
      sqliteCode(() =>
        db.raw
          .prepare(
            `INSERT INTO route_price_history (origin, destination, departure_date, return_date, cabin, provider_id, date, lowest_price_pence, fetched_at) VALUES ('LHR', 'JFK', '2026-11-05', NULL, 'economy', 'searchapi', '2026-09-03', 1, ?)`,
          )
          .run(T0),
      ),
    ).toBe('SQLITE_CONSTRAINT_CHECK');
    const indexes = db.raw
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'route_price_history' AND sql IS NOT NULL`,
      )
      .all();
    expect(indexes).toEqual([{ name: 'route_price_history_trip_uq' }]);
  });
});
