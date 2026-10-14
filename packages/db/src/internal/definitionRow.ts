import { apiContract, type DefinitionInput, type DefinitionSnapshot, type SearchDefinition } from '@gmt/core';
import {
  isRecord,
  parseWith,
  RowCorrupt,
  readBool,
  readCellKey,
  readDate,
  readIataArray,
  readInt,
  readJson,
  readNullableTime,
  readString,
  readTime,
  readVerificationPolicy,
} from './read.js';

/**
 * The definition fields without the verification policy. // why: the unrefined shape (no save-time cross-field rules);
 * omitting `verification` is allowed because the refinement sits inside that field, not on the object.
 */
const SHAPE_WITHOUT_POLICY = apiContract.definitionShapeSchema.omit({ verification: true });

/**
 * The DefinitionInput fields of a stored row or snapshot. Unknown keys (id, timestamps, resolved space, the confirmed
 * cost) are stripped by the shape schema; callers read those separately.
 */
export function readDefinitionInput(column: string, raw: Record<string, unknown>): DefinitionInput {
  return {
    ...parseWith(column, SHAPE_WITHOUT_POLICY, raw),
    verification: readVerificationPolicy(`${column}.verification`, raw.verification),
  };
}

export interface DefinitionDbRow {
  id: string;
  name: string;
  origins_json: string;
  destinations_json: string;
  window_json: string;
  min_nights: number;
  max_nights: number;
  cabin: string;
  constraints_json: string;
  verification_policy_json: string;
  budget_json: string;
  providers_json: string;
  destination_notes_json: string | null;
  onward_cost_json: string | null;
  schedule_cron: string | null;
  schedule_tz: string;
  confirmed_cost_pence: number | null;
  enabled: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function readDefinition(r: DefinitionDbRow): SearchDefinition {
  const c = 'search_definitions';
  const input = readDefinitionInput(c, {
    name: r.name,
    origins: readJson(`${c}.origins_json`, r.origins_json),
    destinations: readJson(`${c}.destinations_json`, r.destinations_json),
    window: readJson(`${c}.window_json`, r.window_json),
    minNights: r.min_nights,
    maxNights: r.max_nights,
    cabin: r.cabin,
    constraints: readJson(`${c}.constraints_json`, r.constraints_json),
    verification: readJson(`${c}.verification_policy_json`, r.verification_policy_json),
    budget: readJson(`${c}.budget_json`, r.budget_json),
    providers: readJson(`${c}.providers_json`, r.providers_json),
    destinationNotes:
      r.destination_notes_json === null
        ? {}
        : readJson(`${c}.destination_notes_json`, r.destination_notes_json),
    onwardCostPence: r.onward_cost_json === null ? {} : readJson(`${c}.onward_cost_json`, r.onward_cost_json),
    scheduleCron: r.schedule_cron,
    scheduleTz: r.schedule_tz,
    enabled: r.enabled === 1,
  });
  return {
    ...input,
    id: r.id,
    confirmedCostPence: r.confirmed_cost_pence,
    createdAt: readTime(`${c}.created_at`, r.created_at),
    updatedAt: readTime(`${c}.updated_at`, r.updated_at),
    deletedAt: readNullableTime(`${c}.deleted_at`, r.deleted_at),
  };
}

/** A frozen execution snapshot: the definition part through core's schema, the resolved space through the read guards. */
export function readSnapshot(column: string, text: string): DefinitionSnapshot {
  const v = readJson(column, text);
  if (!isRecord(v) || !isRecord(v.resolved) || !Array.isArray(v.droppedAlwaysInclude))
    throw new RowCorrupt(column, 'not a definition snapshot');
  // why: the snapshot-only fields are taken out first and read by their own guards; only DefinitionInput fields reach the schema.
  const {
    id,
    confirmedCostPence: confirmed,
    createdAt,
    updatedAt,
    deletedAt,
    resolved: res,
    resolvedAt,
    windowClamped,
    droppedAlwaysInclude,
    ...fields
  } = v;
  const input = readDefinitionInput(column, fields);
  if (!isRecord(res) || !Array.isArray(droppedAlwaysInclude))
    throw new RowCorrupt(column, 'not a definition snapshot');
  return {
    ...input,
    id: readString(column, id),
    confirmedCostPence: confirmed === null || confirmed === undefined ? null : readInt(column, confirmed),
    createdAt: readTime(column, readString(column, createdAt)),
    updatedAt: readTime(column, readString(column, updatedAt)),
    deletedAt:
      deletedAt === null || deletedAt === undefined ? null : readTime(column, readString(column, deletedAt)),
    resolved: {
      origins: readIataArray(column, res.origins),
      destinations: readIataArray(column, res.destinations),
      departureFrom: readDate(column, readString(column, res.departureFrom)),
      departureTo: readDate(column, readString(column, res.departureTo)),
      minNights: readInt(column, res.minNights),
      maxNights: readInt(column, res.maxNights),
    },
    resolvedAt: readTime(column, readString(column, resolvedAt)),
    windowClamped: readBool(column, windowClamped),
    droppedAlwaysInclude: droppedAlwaysInclude.map((x: unknown) => readCellKey(column, x)),
  };
}
