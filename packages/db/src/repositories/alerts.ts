import { randomUUID } from 'node:crypto';
import {
  type AlertEvent,
  type AlertEventStatus,
  type AlertRule,
  type AlertRuleInput,
  type Clock,
  type IsoDateTime,
  type PriorFiring,
  stripUrlsInText,
} from '@gmt/core';
import type { Db } from '../client.js';
import { ALERT_EVENT_STATUSES, ALERT_RULE_TYPES, RESULT_BASES } from '../internal/enums.js';
import { oneOf, readJson, readTime } from '../internal/read.js';
import { assertInt, assertIsoDateTime, assertNullableInt, RowRejected } from '../internal/validate.js';

interface RuleDbRow {
  id: string;
  definition_id: string;
  type: string;
  threshold_pence: number | null;
  pct: number | null;
  basis: string;
  require_all_verified: number | null;
  cooldown_hours: number;
  enabled: number;
}
interface EventDbRow {
  id: number;
  rule_id: string;
  identity_key: string;
  observation_id: number | null;
  calendar_price_id: number | null;
  dedup_key: string;
  fired_at: string;
  status: string;
  reason: string | null;
  payload_json: string;
}

const toRule = (r: RuleDbRow): AlertRule => ({
  id: r.id,
  definitionId: r.definition_id,
  type: oneOf('alert_rules.type', ALERT_RULE_TYPES, r.type),
  thresholdPence: r.threshold_pence,
  pct: r.pct,
  basis: oneOf('alert_rules.basis', RESULT_BASES, r.basis),
  requireAllVerified: r.require_all_verified === null ? null : r.require_all_verified === 1,
  cooldownHours: r.cooldown_hours,
  enabled: r.enabled === 1,
});
const toEvent = (r: EventDbRow): AlertEvent => ({
  id: r.id,
  ruleId: r.rule_id,
  identityKey: r.identity_key,
  observationId: r.observation_id,
  calendarPriceId: r.calendar_price_id,
  dedupKey: r.dedup_key,
  firedAt: readTime('alert_events.fired_at', r.fired_at),
  status: oneOf('alert_events.status', ALERT_EVENT_STATUSES, r.status),
  reason: r.reason,
  payload: readJson('alert_events.payload_json', r.payload_json),
});
const ruleParams = (r: AlertRuleInput) => ({
  ...r,
  requireAllVerified: r.requireAllVerified === null ? null : r.requireAllVerified ? 1 : 0,
  enabled: r.enabled ? 1 : 0,
});

function validateRule(r: AlertRuleInput): void {
  assertNullableInt('threshold_pence', r.thresholdPence);
  assertNullableInt('pct', r.pct);
  assertInt('cooldown_hours', r.cooldownHours);
  // why: spec §6.8 "requireAllVerified (verified basis only; zod rejects it on calendar basis)"; the repository holds the same line.
  if (r.basis === 'calendar' && r.requireAllVerified !== null)
    throw new RowRejected('require-all-verified', 'requireAllVerified applies to the verified basis only');
}

/** Spec §7 alert rules and events. Evaluation, dedup policy and digests live in core (WP2) and WP11. */
export class AlertsRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Live rules (soft-deleted ones excluded), optionally for one definition. */
  rules(definitionId?: string): AlertRule[] {
    return this.db.raw
      .prepare<Record<string, unknown>, RuleDbRow>(
        'SELECT * FROM alert_rules WHERE deleted_at IS NULL AND (@definitionId IS NULL OR definition_id = @definitionId) ORDER BY id',
      )
      .all({ definitionId: definitionId ?? null })
      .map(toRule);
  }

  /** A live rule; a soft-deleted rule reads as absent. */
  get(id: string): AlertRule | null {
    const r = this.db.raw
      .prepare<[string], RuleDbRow>('SELECT * FROM alert_rules WHERE id = ? AND deleted_at IS NULL')
      .get(id);
    return r === undefined ? null : toRule(r);
  }

  create(input: AlertRuleInput): AlertRule {
    validateRule(input);
    const id = randomUUID();
    this.db.raw
      .prepare(
        `INSERT INTO alert_rules (id, definition_id, type, threshold_pence, pct, basis, require_all_verified, cooldown_hours, enabled) VALUES (@id, @definitionId, @type, @thresholdPence, @pct, @basis, @requireAllVerified, @cooldownHours, @enabled)`,
      )
      .run({ ...ruleParams(input), id });
    return this.mustGet(id);
  }

  update(id: string, patch: Partial<AlertRuleInput>): AlertRule {
    const { id: _id, ...current } = this.mustGet(id);
    const merged: AlertRuleInput = { ...current, ...patch };
    validateRule(merged);
    this.db.raw
      .prepare(
        `UPDATE alert_rules SET definition_id = @definitionId, type = @type, threshold_pence = @thresholdPence, pct = @pct, basis = @basis, require_all_verified = @requireAllVerified, cooldown_hours = @cooldownHours, enabled = @enabled WHERE id = @id AND deleted_at IS NULL`,
      )
      .run({ ...ruleParams(merged), id });
    return this.mustGet(id);
  }

  /** Ruling 12: sets deleted_at once (a second call keeps the first time); events stay. */
  softDelete(id: string): void {
    const exists =
      this.db.raw.prepare('SELECT 1 AS present FROM alert_rules WHERE id = ?').get(id) !== undefined;
    if (!exists) throw new RowRejected('missing', `alert rule ${id} does not exist`);
    this.db.raw
      .prepare('UPDATE alert_rules SET deleted_at = @now WHERE id = @id AND deleted_at IS NULL')
      .run({ id, now: this.clock.now() });
  }

  /** Newest first, filtered by rule or by the rule's definition; events of soft-deleted rules included. */
  events(filter: { ruleId?: string; definitionId?: string; limit: number }): AlertEvent[] {
    return this.db.raw
      .prepare<Record<string, unknown>, EventDbRow>(
        `SELECT ev.* FROM alert_events ev JOIN alert_rules r ON r.id = ev.rule_id
         WHERE (@ruleId IS NULL OR ev.rule_id = @ruleId) AND (@definitionId IS NULL OR r.definition_id = @definitionId)
         ORDER BY ev.fired_at DESC, ev.id DESC LIMIT @limit`,
      )
      .all({ ruleId: filter.ruleId ?? null, definitionId: filter.definitionId ?? null, limit: filter.limit })
      .map(toEvent);
  }

  /**
   * Spec §6.8 suppression input for `isSuppressed`: every **notified** event for the identities since `since`, with the
   * price that fired (from its observation or calendar price). A queued event (its send pending or failed) does
   * not suppress, and neither does a "new" listing (`payload.isNew`), which was never a firing (decision 56).
   */
  priorFirings(ruleId: string, identityKeys: string[], since: IsoDateTime): PriorFiring[] {
    assertIsoDateTime('since', since);
    if (identityKeys.length === 0) return [];
    return this.db.raw
      .prepare<
        Record<string, unknown>,
        { identityKey: string; dedupKey: string; firedAt: string; pricePence: number }
      >(
        `SELECT ev.identity_key AS identityKey, ev.dedup_key AS dedupKey, ev.fired_at AS firedAt, COALESCE(o.price_pence, p.price_pence) AS pricePence
         FROM alert_events ev
         LEFT JOIN price_observations o ON o.id = ev.observation_id
         LEFT JOIN calendar_prices p ON p.id = ev.calendar_price_id
         WHERE ev.rule_id = @ruleId AND ev.status = 'notified' AND ev.fired_at >= @since
           AND coalesce(json_extract(ev.payload_json, '$.isNew'), 0) <> 1
           AND ev.identity_key IN (SELECT value FROM json_each(@keys)) AND COALESCE(o.price_pence, p.price_pence) IS NOT NULL
         ORDER BY ev.fired_at DESC, ev.id DESC`,
      )
      .all({ ruleId, since, keys: JSON.stringify(identityKeys) })
      .map((r) => ({ ...r, firedAt: readTime('alert_events.fired_at', r.firedAt) }));
  }

  /**
   * Decision 56: every event of the rule whose price row was written by the execution (its observation's or calendar
   * price's execution_id), oldest first. The alert runner reads it to find what an earlier pass of the same execution
   * recorded (never repeated) and what it left queued (sent with the next digest).
   */
  eventsForExecution(ruleId: string, executionId: string): AlertEvent[] {
    return this.db.raw
      .prepare<Record<string, unknown>, EventDbRow>(
        `SELECT ev.* FROM alert_events ev
         LEFT JOIN price_observations o ON o.id = ev.observation_id
         LEFT JOIN calendar_prices p ON p.id = ev.calendar_price_id
         WHERE ev.rule_id = @ruleId AND coalesce(o.execution_id, p.execution_id) = @executionId
         ORDER BY ev.id`,
      )
      .all({ ruleId, executionId })
      .map(toEvent);
  }

  /**
   * Decisions 56, 59: moves events on after a send — `notified` when every notifier accepted the digest, `queued` (with
   * the failure in `reason`) when one did not, `suppressed` when a later pass's cooldown judged a queued firing or no
   * email is configured. A field left out of the patch keeps its stored value; a successful retry passes its own reason,
   * fire time and digest id, so the row describes the send that delivered it. One transaction; URLs in `reason`
   * stripped as on insert. Throws when an id does not exist.
   */
  updateEvents(
    ids: readonly number[],
    patch: {
      status: AlertEventStatus;
      reason?: string | null;
      firedAt?: IsoDateTime;
      digestId?: string;
      /** The whole payload, replacing the stored one: a retry records the marks of the send that delivered it. */
      payload?: unknown;
    },
  ): void {
    if (patch.firedAt !== undefined) assertIsoDateTime('fired_at', patch.firedAt);
    const update = this.db.raw.prepare(
      `UPDATE alert_events SET status = @status,
         reason = CASE WHEN @keepReason = 1 THEN reason ELSE @reason END,
         fired_at = coalesce(@firedAt, fired_at),
         payload_json = CASE WHEN @payload IS NULL AND @digestId IS NULL THEN payload_json
           ELSE json_set(coalesce(@payload, payload_json), '$.digestId', coalesce(@digestId, json_extract(coalesce(@payload, payload_json), '$.digestId'))) END
       WHERE id = @id`,
    );
    this.db.transaction(() => {
      for (const id of ids) {
        const changed = update.run({
          id,
          status: patch.status,
          keepReason: patch.reason === undefined ? 1 : 0,
          reason: patch.reason === undefined || patch.reason === null ? null : stripUrlsInText(patch.reason),
          firedAt: patch.firedAt ?? null,
          digestId: patch.digestId ?? null,
          payload: patch.payload === undefined ? null : stripUrlsInText(JSON.stringify(patch.payload)),
        }).changes;
        if (changed !== 1) throw new RowRejected('missing', `alert event ${id} does not exist`);
      }
    });
  }

  /** Spec §5.3: URLs in `payload_json` and `reason` are stored without query string or userinfo. */
  insertEvent(e: Omit<AlertEvent, 'id'>): number {
    assertIsoDateTime('fired_at', e.firedAt);
    return Number(
      this.db.raw
        .prepare(
          `INSERT INTO alert_events (rule_id, identity_key, observation_id, calendar_price_id, dedup_key, fired_at, status, reason, payload_json) VALUES (@ruleId, @identityKey, @observationId, @calendarPriceId, @dedupKey, @firedAt, @status, @reason, @payload)`,
        )
        .run({
          ...e,
          reason: e.reason === null ? null : stripUrlsInText(e.reason),
          payload: stripUrlsInText(JSON.stringify(e.payload)),
        }).lastInsertRowid,
    );
  }

  private mustGet(id: string): AlertRule {
    const r = this.get(id);
    if (r === null) throw new RowRejected('missing', `alert rule ${id} does not exist or is deleted`);
    return r;
  }
}
