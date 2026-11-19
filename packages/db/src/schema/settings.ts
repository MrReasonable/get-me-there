import { check, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isIsoTimestamp } from './checks.js';

/**
 * Settings plan ruling 4 (migration 0014): the settings the Settings page owns, one row per name, under its env name,
 * the value as `.env` would hold it (`''` = unset). No CHECK on the name: the repository validates names through core's
 * owned-name list, so a later version's new name needs no table rebuild.
 */
export const settings = sqliteTable(
  'settings',
  {
    name: text('name').primaryKey(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  () => [check('settings_updated_at_ck', isIsoTimestamp('updated_at'))],
);
