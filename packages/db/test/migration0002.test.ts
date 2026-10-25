import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixedClock } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { applyMigrations, pendingMigrations } from '../src/migrate.js';
import { MIGRATIONS_DIR } from '../src/paths.js';
import { AlertsRepo } from '../src/repositories/alerts.js';
import { DefinitionsRepo } from '../src/repositories/definitions.js';
import { openTracked, sqliteCode, T0, tmpDbPath, tmpDir } from './helpers/db.js';
import { exampleDefinitionInput } from './helpers/factories.js';

/** A copy of the migrations folder that stops at 0001, as an install made before this migration has it. */
function upTo0001(): string {
  const dir = join(tmpDir(), 'drizzle');
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const later = [
    '0002_alert_event_lifecycle',
    '0003_route_history_by_trip',
    '0004_route_history_point_of_sale',
    '0005_camoufox_provider',
    '0006_grid_return_source',
    '0007_catch_up',
    '0008_wp18_error_kind',
  ];
  for (const tag of later) rmSync(join(dir, `${tag}.sql`));
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal: { entries: Array<{ tag: string }> } = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries = journal.entries.filter((e) => !later.includes(e.tag));
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe('migration 0002: alert event lifecycle (decision 56)', () => {
  it("maps 'sent' to 'notified' and 'failed' to 'queued' (saying it is not retried), keeps the rest, and the CHECK refuses the old names", () => {
    const db = openTracked(tmpDbPath());
    applyMigrations(db, upTo0001());
    const definition = new DefinitionsRepo(db, fixedClock(T0)).create(exampleDefinitionInput());
    db.raw
      .prepare(
        `INSERT INTO alert_rules (id, definition_id, type, threshold_pence, basis, cooldown_hours, enabled) VALUES ('r1', ?, 'absolute', 45000, 'calendar', 336, 1)`,
      )
      .run(definition.id);
    const insert = db.raw.prepare(
      `INSERT INTO alert_events (rule_id, identity_key, dedup_key, fired_at, status, reason, payload_json) VALUES ('r1', 'k', 'k|412', ?, ?, ?, '{"isNew":false}')`,
    );
    for (const [status, reason] of [
      ['sent', null],
      ['failed', 'not delivered: connection refused'],
      ['suppressed', 'same price band'],
    ])
      insert.run(T0, status, reason);
    expect(pendingMigrations(db, MIGRATIONS_DIR)).toEqual([
      '0002_alert_event_lifecycle',
      '0003_route_history_by_trip',
      '0004_route_history_point_of_sale',
      '0005_camoufox_provider',
      '0006_grid_return_source',
      '0007_catch_up',
      '0008_wp18_error_kind',
    ]);
    applyMigrations(db, MIGRATIONS_DIR);
    const events = new AlertsRepo(db, fixedClock(T0)).events({ ruleId: 'r1', limit: 10 });
    expect(events.map((e) => [e.id, e.status, e.reason, e.payload]).sort()).toEqual([
      [1, 'notified', null, { isNew: false }],
      [
        2,
        'queued',
        'not delivered: connection refused; migrated from a failed send; not retried',
        { isNew: false },
      ],
      [3, 'suppressed', 'same price band', { isNew: false }],
    ]);
    expect(sqliteCode(() => insert.run(T0, 'sent', null))).toBe('SQLITE_CONSTRAINT_CHECK');
    const indexes = db.raw
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'alert_events' ORDER BY name`,
      )
      .all();
    expect(indexes).toEqual([
      { name: 'alert_events_rule_dedup_idx' },
      { name: 'alert_events_rule_identity_idx' },
    ]);
  });
});
