import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ALERT_EVENT_STATUSES } from '../internal/enums.js';
import { alertRules } from './alertRules.js';
import { calendarPrices } from './calendarPrices.js';
import { isIsoTimestamp, isOneOf } from './checks.js';
import { priceObservations } from './priceObservations.js';

/** Spec §7 `alert_events`. Kept when their rule is soft-deleted (ruling 12); no cascade. */
export const alertEvents = sqliteTable(
  'alert_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ruleId: text('rule_id')
      .notNull()
      .references(() => alertRules.id),
    identityKey: text('identity_key').notNull(),
    observationId: integer('observation_id').references(() => priceObservations.id),
    calendarPriceId: integer('calendar_price_id').references(() => calendarPrices.id),
    dedupKey: text('dedup_key').notNull(),
    firedAt: text('fired_at').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    payloadJson: text('payload_json').notNull(),
  },
  (t) => [
    index('alert_events_rule_dedup_idx').on(t.ruleId, t.dedupKey, t.firedAt),
    index('alert_events_rule_identity_idx').on(t.ruleId, t.identityKey, t.firedAt),
    check('alert_events_status_ck', isOneOf('status', ALERT_EVENT_STATUSES)),
    check('alert_events_fired_ck', isIsoTimestamp('fired_at')),
  ],
);
