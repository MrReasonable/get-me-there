import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { EXECUTION_STATUSES, SKIP_CODES, STAGES } from '../internal/enums.js';
import { ACTIVE_STATUS_SQL, isBool, isInteger, isIsoTimestamp, isOneOf, sqlList } from './checks.js';
import { searchDefinitions } from './searchDefinitions.js';

/**
 * Spec §7 `search_executions` (`trigger`, `created_at`; `started_at` NULL until the run starts).
 * One active parent per definition and one active child per (definition, cell): partial unique indexes.
 * Migration 0007 (spec §7, §8.2 rev 36): `scheduled_for`, `is_catch_up`, `browser_window_end`, `skip_code`, and the
 * firing unique index, so one firing can never start or skip twice. `scheduled_for` is the firing the row stands for:
 * written by a scheduled start, catch-up or skip, and moved to a later firing only by that firing's punctual live-tick
 * resume (decision 83), which can also give a paused manual run one; a catch-up's never moves (History names it).
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
    scheduledFor: text('scheduled_for'),
    isCatchUp: integer('is_catch_up').notNull().default(0),
    browserWindowEnd: text('browser_window_end'),
    skipCode: text('skip_code'),
    pausedAt: text('paused_at'),
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
    check('search_executions_scheduled_for_ck', isIsoTimestamp('scheduled_for', true)),
    check('search_executions_window_end_ck', isIsoTimestamp('browser_window_end', true)),
    check('search_executions_is_catch_up_ck', isBool('is_catch_up')),
    check('search_executions_paused_at_ck', isIsoTimestamp('paused_at', true)),
    // why: a firing is a parent's: a scheduled start or skip carries one, and a live-tick resume re-anchors a paused run
    // (manual or scheduled) to its firing (decision 83); a child never carries one, and a catch-up always does
    check('search_executions_firing_ck', sql.raw('scheduled_for IS NULL OR is_child = 0')),
    check('search_executions_catch_up_ck', sql.raw('is_catch_up = 0 OR scheduled_for IS NOT NULL')),
    check(
      'search_executions_skip_code_ck',
      sql.raw(`skip_code IS NULL OR (status = 'skipped_missed' AND skip_code IN (${sqlList(SKIP_CODES)}))`),
    ),
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
    // why: spec §7 rev 36 — every scheduled start or skip inserts through it (ON CONFLICT … DO NOTHING), so the live
    // tick, the boot and the minute job can never record one firing twice
    uniqueIndex('search_executions_firing_uq')
      .on(t.definitionId, t.scheduledFor)
      .where(sql.raw('is_child = 0 AND scheduled_for IS NOT NULL')),
    // why: review S17 — GET /api/executions/active reads the oldest pass in flight by one index probe
    index('search_executions_in_flight_idx')
      .on(t.createdAt)
      .where(sql.raw("status IN ('pending', 'running')")),
    index('search_executions_definition_started_idx').on(t.definitionId, t.startedAt),
  ],
);
