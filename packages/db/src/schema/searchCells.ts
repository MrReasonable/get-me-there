import { check, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { OUTCOME_STATUSES, SELECTION_REASONS } from '../internal/enums.js';
import { isBool, isNullOrInteger, isOneOf } from './checks.js';
import { searchExecutions } from './searchExecutions.js';

/** Spec §7 `search_cells` with the stored roll-ups (spec §6.6). NULL status = no provider or no outcome rows yet. `best_observation_id` gains its FK in Task 3.13. */
export const searchCells = sqliteTable(
  'search_cells',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => searchExecutions.id),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    departureDate: text('departure_date').notNull(),
    returnDate: text('return_date').notNull(),
    discoveryStatus: text('discovery_status'),
    discoveryReason: text('discovery_reason'),
    discoveryMinPence: integer('discovery_min_pence'),
    verificationSelected: integer('verification_selected').notNull().default(0),
    selectionReason: text('selection_reason'),
    verificationStatus: text('verification_status'),
    verificationReason: text('verification_reason'),
    verificationMinPence: integer('verification_min_pence'),
    bestObservationId: integer('best_observation_id'),
  },
  (t) => [
    primaryKey({ columns: [t.executionId, t.origin, t.destination, t.departureDate, t.returnDate] }),
    check('search_cells_discovery_status_ck', isOneOf('discovery_status', OUTCOME_STATUSES, true)),
    check('search_cells_verification_status_ck', isOneOf('verification_status', OUTCOME_STATUSES, true)),
    check('search_cells_selected_ck', isBool('verification_selected')),
    check('search_cells_selection_reason_ck', isOneOf('selection_reason', SELECTION_REASONS, true)),
    check('search_cells_discovery_min_ck', isNullOrInteger('discovery_min_pence')),
    check('search_cells_verification_min_ck', isNullOrInteger('verification_min_pence')),
  ],
);
