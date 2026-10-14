import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isIsoTimestamp, isOneOf } from './checks.js';

/** Spec §7 `app_lock`: one row (id = 1); liveness judged by heartbeat age. */
export const appLock = sqliteTable(
  'app_lock',
  {
    id: integer('id').primaryKey(),
    holder: text('holder').notNull(),
    heartbeatAt: text('heartbeat_at').notNull(),
    acquiredAt: text('acquired_at').notNull(),
  },
  () => [
    check('app_lock_singleton_ck', sql.raw('id = 1')),
    check('app_lock_holder_ck', isOneOf('holder', ['app', 'tool'])),
    check('app_lock_heartbeat_ck', isIsoTimestamp('heartbeat_at')),
    check('app_lock_acquired_ck', isIsoTimestamp('acquired_at')),
  ],
);
