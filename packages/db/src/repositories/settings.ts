import { type IsoDateTime, ownedNameSchema, type SettingRow } from '@gmt/core';
import type { Db } from '../client.js';
import { RowRejected } from '../internal/validate.js';

/**
 * Settings plan rulings 2 and 4 (migration 0014): the Settings page's stored settings, one row per owned name. Rows are
 * written only by the page's save and by a boot's imports; values are kept as `.env` keeps them (`''` = unset).
 */
export class SettingsRepo {
  constructor(private readonly db: Db) {}

  /**
   * Every stored setting, in name order. why: a row under a name this version does not own (written by a later version
   * before a downgrade) is left out rather than refused, so a stored row never stops the app booting.
   */
  all(): SettingRow[] {
    const out: SettingRow[] = [];
    for (const row of this.db.raw
      .prepare<[], { name: string; value: string }>('SELECT name, value FROM settings ORDER BY name')
      .all()) {
      const name = ownedNameSchema.safeParse(row.name);
      if (name.success) out.push({ name: name.data, value: row.value });
    }
    return out;
  }

  /**
   * Writes each row (insert or replace its value and time) in one transaction. A name the page does not own is refused
   * before anything is written, naming the rule, never the value.
   */
  write(rows: readonly SettingRow[], at: IsoDateTime): void {
    for (const row of rows)
      if (!ownedNameSchema.safeParse(row.name).success)
        throw new RowRejected('settings.name', 'not a setting the Settings page owns');
    const put = this.db.raw.prepare(
      `INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    this.db.transaction(() => {
      for (const row of rows) put.run(row.name, row.value, at);
    });
  }
}
