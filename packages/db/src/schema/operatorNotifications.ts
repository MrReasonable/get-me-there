import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { OPERATOR_MESSAGE_KINDS } from '../internal/enums.js';
import { isIsoTimestamp, isOneOf } from './checks.js';
import { searchDefinitions } from './searchDefinitions.js';
import { searchExecutions } from './searchExecutions.js';

/** Spec §7 `operator_notifications`: dedup per execution and kind, execution-less notices per definition (spec §8.1). */
export const operatorNotifications = sqliteTable(
  'operator_notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(),
    executionId: text('execution_id').references(() => searchExecutions.id),
    definitionId: text('definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    sentAt: text('sent_at').notNull(),
    status: text('status').notNull(),
  },
  (t) => [
    index('operator_notifications_dedup_idx').on(t.kind, t.definitionId, t.executionId),
    check('operator_notifications_kind_ck', isOneOf('kind', OPERATOR_MESSAGE_KINDS)),
    check('operator_notifications_status_ck', isOneOf('status', ['sent', 'failed'])),
    check('operator_notifications_sent_ck', isIsoTimestamp('sent_at')),
  ],
);
