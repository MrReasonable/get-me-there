import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { EXECUTION_STATUSES, STAGES } from '../internal/enums.js';
import { ACTIVE_STATUS_SQL, isBool, isInteger, isIsoTimestamp, isOneOf } from './checks.js';
import { searchDefinitions } from './searchDefinitions.js';

/**
 * Spec §7 `search_executions` (`trigger`, `created_at`; `started_at` NULL until the run starts).
 * One active parent per definition and one active child per (definition, cell): partial unique indexes.
 */
export const searchExecutions = sqliteTable(
  'search_executions',
  {
    id: text('id').primaryKey(),
    definitionId: text('definition_id')
      .notNull()
      .references(() => searchDefinitions.id),
    isChild: integer('is_child').notNull().default(0),
    childOrigin: text('child_origin'),
    childDestination: text('child_destination'),
    childDepartureDate: text('child_departure_date'),
    childReturnDate: text('child_return_date'),
    definitionSnapshotJson: text('definition_snapshot_json').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull(),
    stage: text('stage'),
    estimateJson: text('estimate_json'),
    cancelRequested: integer('cancel_requested').notNull().default(0),
    resumeAfter: text('resume_after'),
    autoResumeCount: integer('auto_resume_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    errorText: text('error_text'),
  },
  (t) => [
    check('search_executions_status_ck', isOneOf('status', EXECUTION_STATUSES)),
    check('search_executions_trigger_ck', isOneOf('trigger', ['manual', 'schedule', 'tool'])),
    check('search_executions_stage_ck', isOneOf('stage', STAGES, true)),
    check('search_executions_is_child_ck', isBool('is_child')),
    check('search_executions_cancel_ck', isBool('cancel_requested')),
    check('search_executions_resume_count_ck', isInteger('auto_resume_count')),
    check('search_executions_created_ck', isIsoTimestamp('created_at')),
    check('search_executions_started_ck', isIsoTimestamp('started_at', true)),
    check('search_executions_finished_ck', isIsoTimestamp('finished_at', true)),
    check('search_executions_resume_after_ck', isIsoTimestamp('resume_after', true)),
    check(
      'search_executions_child_cell_ck',
      sql.raw(
        '(is_child = 0 AND child_origin IS NULL AND child_destination IS NULL AND child_departure_date IS NULL AND child_return_date IS NULL) OR ' +
          '(is_child = 1 AND child_origin IS NOT NULL AND child_destination IS NOT NULL AND child_departure_date IS NOT NULL AND child_return_date IS NOT NULL)',
      ),
    ),
    uniqueIndex('search_executions_active_parent_uq')
      .on(t.definitionId)
      .where(sql.raw(`is_child = 0 AND status IN (${ACTIVE_STATUS_SQL})`)),
    uniqueIndex('search_executions_active_child_uq')
      .on(t.definitionId, t.childOrigin, t.childDestination, t.childDepartureDate, t.childReturnDate)
      .where(sql.raw(`is_child = 1 AND status IN (${ACTIVE_STATUS_SQL})`)),
    index('search_executions_definition_started_idx').on(t.definitionId, t.startedAt),
  ],
);
