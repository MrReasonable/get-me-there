import { check, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { isIsoTimestamp } from './checks.js';

/**
 * Once-per-cool-down operator notices (spec §2, §8.1 rev 32; cost-015): the engine inserts a key such as
 * `camoufox-cooldown:<until>` before it sends the notice, so a cool-down that outlives several runs notifies once.
 */
export const operatorNoticeKeys = sqliteTable(
  'operator_notice_keys',
  {
    key: text('key').primaryKey(),
    sentAt: text('sent_at').notNull(),
  },
  () => [check('operator_notice_keys_sent_ck', isIsoTimestamp('sent_at'))],
);
