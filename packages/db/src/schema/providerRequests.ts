import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { PROVIDER_IDS } from '../internal/enums.js';
import { isBool, isInteger, isIsoTimestamp, isNullOrInteger, isOneOf } from './checks.js';
import { searchExecutions } from './searchExecutions.js';

/** Spec §7 `provider_requests`: one row per HTTP attempt (`pending` at reserve) and per cache hit. FX is never ledgered. */
export const providerRequests = sqliteTable(
  'provider_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    providerId: text('provider_id').notNull(),
    executionId: text('execution_id').references(() => searchExecutions.id),
    endpointPath: text('endpoint_path').notNull(),
    tileIndex: integer('tile_index'),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    durationMs: integer('duration_ms'),
    httpStatus: integer('http_status'),
    outcome: text('outcome').notNull(),
    billable: integer('billable'),
    costMicroGbp: integer('cost_micro_gbp').notNull(),
    httpAttempt: integer('http_attempt').notNull(),
    /**
     * Spec §5.3 rev 32 (decision 69): for camoufox, whether the attempt loaded a Google page (the worker's
     * `x-gmt-google-contacted`); `no-page` rows count toward neither page cap. NULL for every other provider.
     */
    pageClass: text('page_class'),
    /**
     * Spec §7 rev 34 (migration 0006): the scroll clicks a camoufox grid page made; NULL on every other row (camoufox
     * list included) and on a grid call that ended with no answer. The scroll caps sum it.
     */
    scrollCount: integer('scroll_count'),
    /**
     * Migration 0008 (WP18, V3/V4): the adapters' own class of a failed call (http-kit's ProviderError kind, or `parse`
     * for a 2xx body an adapter rejected), written where the call is classified; NULL for a call that succeeded and for
     * rows written before 0008. The Status report reads it; it never re-derives a class from the HTTP status.
     */
    errorKind: text('error_kind'),
  },
  (t) => [
    check('provider_requests_provider_ck', isOneOf('provider_id', PROVIDER_IDS)),
    check(
      'provider_requests_outcome_ck',
      isOneOf('outcome', ['pending', 'ok', 'error', 'unknown', 'cache_hit']),
    ),
    check('provider_requests_billable_ck', isBool('billable', true)),
    check('provider_requests_page_class_ck', isOneOf('page_class', ['page', 'no-page'], true)),
    check(
      'provider_requests_scroll_ck',
      sql.raw(
        "scroll_count IS NULL OR (provider_id = 'camoufox' AND typeof(scroll_count) = 'integer' AND scroll_count >= 0)",
      ),
    ),
    check('provider_requests_cost_ck', isInteger('cost_micro_gbp')),
    check('provider_requests_attempt_ck', isInteger('http_attempt')),
    check('provider_requests_tile_ck', isNullOrInteger('tile_index')),
    check('provider_requests_started_ck', isIsoTimestamp('started_at')),
    check('provider_requests_finished_ck', isIsoTimestamp('finished_at', true)),
    // why: sec-002, the SQL twin of assertEndpointPath (GLOB has no length quantifier, so length() caps it).
    check(
      'provider_requests_path_ck',
      sql.raw(
        "endpoint_path GLOB '/*' AND endpoint_path NOT GLOB '//*' AND endpoint_path NOT GLOB '*[^A-Za-z0-9._~/-]*' AND length(endpoint_path) <= 200",
      ),
    ),
    index('provider_requests_provider_idx').on(t.providerId, t.startedAt, t.outcome, t.billable),
    index('provider_requests_execution_idx').on(t.executionId),
  ],
);
