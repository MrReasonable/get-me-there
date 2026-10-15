import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { CABINS } from '../internal/enums.js';
import { isBool, isInteger, isIsoTimestamp, isNullOrInteger, isOneOf } from './checks.js';

/** Spec §7 `search_definitions`, soft-deleted. JSON columns hold the core sub-objects; reads parse them back through core's schema. */
export const searchDefinitions = sqliteTable(
  'search_definitions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    originsJson: text('origins_json').notNull(),
    destinationsJson: text('destinations_json').notNull(),
    windowJson: text('window_json').notNull(),
    minNights: integer('min_nights').notNull(),
    maxNights: integer('max_nights').notNull(),
    cabin: text('cabin').notNull(),
    constraintsJson: text('constraints_json').notNull(),
    verificationPolicyJson: text('verification_policy_json').notNull(),
    budgetJson: text('budget_json').notNull(),
    providersJson: text('providers_json').notNull(),
    destinationNotesJson: text('destination_notes_json'),
    onwardCostJson: text('onward_cost_json'),
    scheduleCron: text('schedule_cron'),
    scheduleTz: text('schedule_tz').notNull(),
    confirmedCostPence: integer('confirmed_cost_pence'),
    enabled: integer('enabled').notNull(),
    deletedAt: text('deleted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  () => [
    check('search_definitions_cabin_ck', isOneOf('cabin', CABINS)),
    check('search_definitions_min_nights_ck', isInteger('min_nights')),
    check('search_definitions_max_nights_ck', isInteger('max_nights')),
    check('search_definitions_confirmed_ck', isNullOrInteger('confirmed_cost_pence')),
    check('search_definitions_enabled_ck', isBool('enabled')),
    check('search_definitions_created_ck', isIsoTimestamp('created_at')),
    check('search_definitions_updated_ck', isIsoTimestamp('updated_at')),
    check('search_definitions_deleted_ck', isIsoTimestamp('deleted_at', true)),
  ],
);
