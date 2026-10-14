import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { CABINS, OUTCOME_STATUSES, PROVIDER_IDS, SOURCE_KINDS, STAGES } from '../internal/enums.js';
import { isInteger, isIsoTimestamp, isNullOrInteger, isOneOf, isPointOfSale } from './checks.js';
import { searchCells } from './searchCells.js';
import { searchExecutions } from './searchExecutions.js';

/**
 * Spec §7 `cell_outcomes`. `reason` never holds a vendor message. Priced, empty and fetched no_data outcomes carry
 * their provenance columns (ruling 5); a cabin-not-offered no_data is the one data-less terminal outcome.
 */
export const cellOutcomes = sqliteTable(
  'cell_outcomes',
  {
    executionId: text('execution_id').notNull(),
    origin: text('origin').notNull(),
    destination: text('destination').notNull(),
    departureDate: text('departure_date').notNull(),
    returnDate: text('return_date').notNull(),
    stage: text('stage').notNull(),
    providerId: text('provider_id').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    fetchedAt: text('fetched_at'),
    minPence: integer('min_pence'),
    cabin: text('cabin'),
    pointOfSale: text('point_of_sale'),
    sourceKind: text('source_kind'),
    reusedFromExecutionId: text('reused_from_execution_id').references(() => searchExecutions.id),
  },
  (t) => [
    primaryKey({
      columns: [t.executionId, t.origin, t.destination, t.departureDate, t.returnDate, t.stage, t.providerId],
    }),
    foreignKey({
      columns: [t.executionId, t.origin, t.destination, t.departureDate, t.returnDate],
      foreignColumns: [
        searchCells.executionId,
        searchCells.origin,
        searchCells.destination,
        searchCells.departureDate,
        searchCells.returnDate,
      ],
    }),
    check('cell_outcomes_status_ck', isOneOf('status', OUTCOME_STATUSES)),
    check('cell_outcomes_stage_ck', isOneOf('stage', STAGES)),
    check('cell_outcomes_provider_ck', isOneOf('provider_id', PROVIDER_IDS)),
    // why: COALESCE / IS keep a NULL reason from satisfying the CHECK (SQLite treats a NULL CHECK result as a pass, arch-r3-003).
    check(
      'cell_outcomes_skip_reason_ck',
      sql.raw(
        "status <> 'skipped' OR COALESCE(reason, '') IN ('not_selected', 'budget', 'provider_disabled', 'departed')",
      ),
    ),
    check('cell_outcomes_attempts_ck', isInteger('attempts')),
    check('cell_outcomes_min_ck', isNullOrInteger('min_pence')),
    check('cell_outcomes_priced_min_ck', sql.raw("(status = 'priced') = (min_pence IS NOT NULL)")),
    check('cell_outcomes_cabin_ck', isOneOf('cabin', CABINS, true)),
    check('cell_outcomes_pos_ck', isPointOfSale('point_of_sale', true)),
    check('cell_outcomes_kind_ck', isOneOf('source_kind', SOURCE_KINDS, true)),
    check('cell_outcomes_fetched_ck', isIsoTimestamp('fetched_at', true)),
    // why: ruling 5 (prov-004). Reuse matches on these columns, so a terminal outcome without them could never be matched or would match wrongly.
    check(
      'cell_outcomes_provenance_ck',
      sql.raw(
        "status NOT IN ('priced', 'empty', 'no_data') OR (status = 'no_data' AND reason IS 'cabin-not-offered') OR " +
          '(fetched_at IS NOT NULL AND cabin IS NOT NULL AND point_of_sale IS NOT NULL AND source_kind IS NOT NULL)',
      ),
    ),
    index('cell_outcomes_stage_provider_status_idx').on(t.executionId, t.stage, t.providerId, t.status),
  ],
);
