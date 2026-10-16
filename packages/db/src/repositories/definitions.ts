import { randomUUID } from 'node:crypto';
import type { Clock, DefinitionInput, IsoDateTime, SearchDefinition } from '@gmt/core';
import type { Db } from '../client.js';
import { type DefinitionDbRow, readDefinition } from '../internal/definitionRow.js';
import { assertInt, assertNullableInt, RowRejected } from '../internal/validate.js';

/** Integer rules the repository owns (spec §6.3); shape and range rules are zod's in `api-contract`. */
function validate(d: DefinitionInput): void {
  assertInt('min_nights', d.minNights);
  assertInt('max_nights', d.maxNights);
  assertInt('budget.maxCalls', d.budget.maxCalls);
  assertInt('budget.maxFreeCalls', d.budget.maxFreeCalls);
  assertInt('budget.maxCostMicroGbp', d.budget.maxCostMicroGbp);
  for (const [dest, pence] of Object.entries(d.onwardCostPence))
    if (pence !== undefined) assertInt(`onward cost for ${dest}`, pence);
  if (d.scheduleTz.length === 0)
    throw new RowRejected('schedule-tz', 'schedule_tz is required (spec §7 NOT NULL)');
}

const params = (d: DefinitionInput, updatedAt: IsoDateTime): Record<string, unknown> => ({
  name: d.name,
  origins: JSON.stringify(d.origins),
  destinations: JSON.stringify(d.destinations),
  window: JSON.stringify(d.window),
  minNights: d.minNights,
  maxNights: d.maxNights,
  cabin: d.cabin,
  constraints: JSON.stringify(d.constraints),
  verification: JSON.stringify(d.verification),
  budget: JSON.stringify(d.budget),
  providers: JSON.stringify(d.providers),
  destinationNotes: JSON.stringify(d.destinationNotes),
  onwardCost: JSON.stringify(d.onwardCostPence),
  scheduleCron: d.scheduleCron,
  scheduleTz: d.scheduleTz,
  enabled: d.enabled ? 1 : 0,
  updatedAt,
});

/**
 * Spec §7 `search_definitions`, soft-deleted. `confirmed_cost_pence` and `confirmed_calls` (decision 37) are set together
 * by `create` or `setConfirmed`, never by `update`.
 */
export class DefinitionsRepo {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  /** Decision 14: the create click's confirmation is stored in the same INSERT, so it can never be lost between two writes. */
  create(
    input: DefinitionInput & { confirmedCostPence?: number; confirmedCalls?: number },
  ): SearchDefinition {
    const { confirmedCostPence, confirmedCalls, ...definition } = input;
    validate(definition);
    assertNullableInt('confirmed_cost_pence', confirmedCostPence ?? null);
    assertNullableInt('confirmed_calls', confirmedCalls ?? null);
    const id = randomUUID();
    const now = this.clock.now();
    this.db.raw
      .prepare(
        `INSERT INTO search_definitions (id, created_at, name, origins_json, destinations_json, window_json, min_nights, max_nights, cabin, constraints_json,
          verification_policy_json, budget_json, providers_json, destination_notes_json, onward_cost_json, schedule_cron, schedule_tz, confirmed_cost_pence, confirmed_calls, enabled, updated_at)
         VALUES (@id, @createdAt, @name, @origins, @destinations, @window, @minNights, @maxNights, @cabin, @constraints, @verification, @budget, @providers,
          @destinationNotes, @onwardCost, @scheduleCron, @scheduleTz, @confirmedCostPence, @confirmedCalls, @enabled, @updatedAt)`,
      )
      .run({
        id,
        createdAt: now,
        ...params(definition, now),
        confirmedCostPence: confirmedCostPence ?? null,
        confirmedCalls: confirmedCalls ?? null,
      });
    return this.mustGet(id);
  }

  update(id: string, patch: Partial<DefinitionInput>): SearchDefinition {
    const {
      id: _id,
      confirmedCostPence: _c,
      confirmedCalls: _cc,
      createdAt: _ca,
      updatedAt: _u,
      deletedAt,
      ...current
    } = this.mustGet(id);
    if (deletedAt !== null) throw new RowRejected('deleted', `definition ${id} is deleted`);
    const merged: DefinitionInput = { ...current, ...patch };
    validate(merged);
    this.db.raw
      .prepare(
        `UPDATE search_definitions SET name = @name, origins_json = @origins, destinations_json = @destinations, window_json = @window, min_nights = @minNights,
           max_nights = @maxNights, cabin = @cabin, constraints_json = @constraints, verification_policy_json = @verification, budget_json = @budget,
           providers_json = @providers, destination_notes_json = @destinationNotes, onward_cost_json = @onwardCost, schedule_cron = @scheduleCron,
           schedule_tz = @scheduleTz, enabled = @enabled, updated_at = @updatedAt WHERE id = @id`,
      )
      .run({ id, ...params(merged, this.clock.now()) });
    return this.mustGet(id);
  }

  /** Returns soft-deleted definitions too (history needs them). */
  get(id: string): SearchDefinition | null {
    const r = this.db.raw
      .prepare<[string], DefinitionDbRow>('SELECT * FROM search_definitions WHERE id = ?')
      .get(id);
    return r === undefined ? null : readDefinition(r);
  }

  list(opts: { includeDeleted?: boolean } = {}): SearchDefinition[] {
    return this.db.raw
      .prepare<[number], DefinitionDbRow>(
        'SELECT * FROM search_definitions WHERE (? = 1 OR deleted_at IS NULL) ORDER BY created_at, rowid',
      )
      .all(opts.includeDeleted ? 1 : 0)
      .map(readDefinition);
  }

  /** Spec §7 "Soft-deleted": executions, prices and history keep their foreign keys; the definition is disabled and never scheduled or resumed. */
  softDelete(id: string): void {
    const now = this.clock.now();
    const changes = this.db.raw
      .prepare(
        'UPDATE search_definitions SET deleted_at = @now, enabled = 0, updated_at = @now WHERE id = @id AND deleted_at IS NULL',
      )
      .run({ id, now }).changes;
    if (changes === 0 && this.get(id) === null)
      throw new RowRejected('missing', `definition ${id} does not exist`);
  }

  /**
   * Spec §7, decision 37: the pence and the calls of one explicit operator confirmation, written together in one
   * statement and never recomputed automatically; null clears both.
   */
  setConfirmed(id: string, confirmed: { pence: number; calls: number } | null): void {
    assertNullableInt('confirmed_cost_pence', confirmed?.pence ?? null);
    assertNullableInt('confirmed_calls', confirmed?.calls ?? null);
    if (
      this.db.raw
        .prepare(
          'UPDATE search_definitions SET confirmed_cost_pence = ?, confirmed_calls = ?, updated_at = ? WHERE id = ?',
        )
        .run(confirmed?.pence ?? null, confirmed?.calls ?? null, this.clock.now(), id).changes === 0
    ) {
      throw new RowRejected('missing', `definition ${id} does not exist`);
    }
  }

  private mustGet(id: string): SearchDefinition {
    const d = this.get(id);
    if (d === null) throw new RowRejected('missing', `definition ${id} does not exist`);
    return d;
  }
}
