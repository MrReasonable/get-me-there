import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { ALERT_RULE_TYPES, RESULT_BASES } from '../internal/enums.js';
import { isBool, isInteger, isIsoTimestamp, isNullOrInteger, isOneOf } from './checks.js';
import { searchDefinitions } from './searchDefinitions.js';

/** Spec §7 `alert_rules` (`cooldown_hours` default 336, deliberately not the weekly cadence). Soft-deleted (ruling 12). */
export const alertRules = sqliteTable(
  'alert_rules',
  {
    id: text('id').primaryKey(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    type: text('type').notNull(),
    thresholdPence: integer('threshold_pence'),
    pct: integer('pct'),
    basis: text('basis').notNull(),
    requireAllVerified: integer('require_all_verified'),
    cooldownHours: integer('cooldown_hours').notNull().default(336),
    enabled: integer('enabled').notNull(),
    deletedAt: text('deleted_at'),
  },
  () => [
    check('alert_rules_type_ck', isOneOf('type', ALERT_RULE_TYPES)),
    check('alert_rules_basis_ck', isOneOf('basis', RESULT_BASES)),
    check('alert_rules_threshold_ck', isNullOrInteger('threshold_pence')),
    check('alert_rules_pct_ck', isNullOrInteger('pct')),
    check('alert_rules_cooldown_ck', isInteger('cooldown_hours')),
    check('alert_rules_require_ck', isBool('require_all_verified', true)),
    check('alert_rules_enabled_ck', isBool('enabled')),
    check('alert_rules_deleted_ck', isIsoTimestamp('deleted_at', true)),
  ],
);
