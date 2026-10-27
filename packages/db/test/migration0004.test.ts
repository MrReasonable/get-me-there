import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, asIsoDate } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { applyMigrations, pendingMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { RoutePriceHistoryRepo } from '../src/repositories/routePriceHistory.js';
import { openTracked, sqliteCode, T0, tmpDbPath, tmpDir } from './helpers/db.js';

const TAG = '0004_route_history_point_of_sale';
const LATER = '0005_camoufox_provider';
const NEWEST = '0006_grid_return_source';
const LAST = '0007_catch_up';
const FINAL = '0008_wp18_error_kind';
const WP19 = '0009_wp19_latest_price_idx';
const AIRPORT_KIND = '0010_airport_kind';

/** A copy of the migrations folder that stops before 0004, as an install made before this migration has it. */
function before0004(): string {
  const dir = join(tmpDir(), 'drizzle');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  for (const tag of [TAG, LATER, NEWEST, LAST, FINAL, WP19, AIRPORT_KIND]) rmSync(join(dir, `${tag}.sql`));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter(
    (e) => ![TAG, LATER, NEWEST, LAST, FINAL, WP19, AIRPORT_KIND].includes(e.tag),
  );
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const point = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  trip: { departureDate: asIsoDate('2026-11-05'), returnDate: asIsoDate('2026-11-15') },
  cabin: 'economy' as const,
  providerId: 'searchapi' as const,
  date: asIsoDate('2026-09-01'),
  lowestPricePence: 46_000,
  currency: 'GBP',
  fetchedAt: T0,
};

// why: CodeRabbit batch 3 — a route price-history point carried provider, source kind and fetch time but neither its
// point of sale nor an FX status, so it lacked the provenance every price carries (spec §3). The point of sale is
// stored per point (rows from before this migration read 'unknown', which is what is known of them), and the FX
// status is always "not converted", because only vendor-stated GBP points are stored.
describe('migration 0004: route price-history points carry their point of sale (spec §3, §7 rev 29)', () => {
  it("keeps every existing row as point of sale 'unknown' and refuses a value that is not a country code", () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, before0004());
    db.raw
      .prepare(
        `INSERT INTO route_price_history (origin, destination, departure_date, return_date, cabin, provider_id, date, lowest_price_pence, fetched_at) VALUES ('LHR', 'JFK', '2026-11-05', '2026-11-15', 'economy', 'searchapi', '2026-09-01', 48000, ?)`,
      )
      .run(T0);
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([
      TAG,
      LATER,
      NEWEST,
      LAST,
      FINAL,
      WP19,
      AIRPORT_KIND,
    ]);
    applyMigrations(db, MIGRATIONS_DIR);
    const repo = new RoutePriceHistoryRepo(db, { allowSynthetic: false });
    const [old] = repo.series(asIata('LHR'), asIata('JFK'), 'searchapi', 'economy');
    expect(old?.points).toEqual([
      expect.objectContaining({ pricePence: 48_000, pointOfSale: 'unknown', fx: { converted: false } }),
    ]);
    for (const bad of ['gb', 'GBR', ''])
      expect(
        sqliteCode(() =>
          db.raw
            .prepare(
              `INSERT INTO route_price_history (origin, destination, departure_date, return_date, cabin, provider_id, date, lowest_price_pence, fetched_at, point_of_sale) VALUES ('LHR', 'JFK', '2026-11-05', '2026-11-15', 'economy', 'searchapi', '2026-09-02', 1, ?, ?)`,
            )
            .run(T0, bad),
        ),
        bad,
      ).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it('a new point stores and returns its point of sale, an upsert refreshes it, and the FX status is always false', () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, MIGRATIONS_DIR);
    const repo = new RoutePriceHistoryRepo(db, { allowSynthetic: false });
    repo.upsert([{ ...point, pointOfSale: 'GB' }]);
    expect(repo.series(asIata('LHR'), asIata('JFK'), 'searchapi', 'economy')[0]?.points).toEqual([
      {
        date: '2026-09-01',
        pricePence: 46_000,
        currency: 'GBP',
        fetchedAt: T0,
        providerId: 'searchapi',
        sourceKind: 'scraped-search',
        pointOfSale: 'GB',
        fx: { converted: false },
      },
    ]);
    repo.upsert([{ ...point, pointOfSale: 'unknown' }]);
    expect(repo.series(asIata('LHR'), asIata('JFK'), 'searchapi', 'economy')[0]?.points[0]?.pointOfSale).toBe(
      'unknown',
    );
    expect(() => repo.upsert([{ ...point, pointOfSale: 'gbr' }])).toThrow(/point_of_sale/);
  });
});
