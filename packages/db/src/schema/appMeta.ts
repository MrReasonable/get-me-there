import { sql } from 'drizzle-orm';
import { check, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isOneOf } from './checks.js';

/** The keys `app_meta` holds (migration 0007): one fact about this database per key. */
export const APP_META_KEYS = ['app_instance_id', 'app_instance_path'] as const;

/**
 * Spec §7 `app_meta` (decision 82): facts about this database itself, one row per key. `app_instance_id` is a random id
 * kept with `app_instance_path`, the database's absolute path when the id was made: opened at that path again (a
 * restart, a container recreate, whose path is always /data/…), it is the same app; opened at another path (a copy, a
 * move, a backup restored into a second app) it is a second ledger and gets a new id.
 */
export const appMeta = sqliteTable(
  'app_meta',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
  },
  () => [
    check('app_meta_key_ck', isOneOf('key', APP_META_KEYS)),
    check('app_meta_value_ck', sql.raw('length(value) BETWEEN 1 AND 4096')),
  ],
);
