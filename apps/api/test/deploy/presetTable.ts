// The docs/api-limits.md preset table, rendered from core's PLAN_PRESETS and TRAVELPAYOUTS_DEFAULTS (spec §12: "the
// full preset table lives in docs/api-limits.md and the zod schema"), so the doc and the code cannot drift.
import { microGbpToPence, PLAN_PRESETS, type PlanPreset, TRAVELPAYOUTS_DEFAULTS } from '@gmt/core';

interface Row {
  field: keyof PlanPreset;
  unit: 'count' | 'text' | 'microGbp';
  overrides: readonly string[];
  planOnly: boolean;
}

/** One row per preset field, in display order, with the variables that override it (spec §12). */
export const ROWS: readonly Row[] = [
  {
    field: 'monthlyCallCap',
    unit: 'count',
    overrides: ['SEARCHAPI_MONTHLY_CALL_CAP', 'TRAVELPAYOUTS_MONTHLY_CALL_CAP'],
    planOnly: false,
  },
  { field: 'window', unit: 'text', overrides: [], planOnly: false },
  {
    field: 'billingDay',
    unit: 'count',
    overrides: ['SEARCHAPI_BILLING_DAY', 'TRAVELPAYOUTS_BILLING_DAY'],
    planOnly: false,
  },
  {
    field: 'ratePerMinute',
    unit: 'count',
    overrides: ['SEARCHAPI_RATE_PER_MINUTE', 'TRAVELPAYOUTS_RATE_PER_MINUTE'],
    planOnly: false,
  },
  {
    field: 'ratePerHour',
    unit: 'count',
    overrides: ['SEARCHAPI_RATE_PER_HOUR', 'TRAVELPAYOUTS_RATE_PER_HOUR'],
    planOnly: false,
  },
  {
    field: 'concurrency',
    unit: 'count',
    overrides: ['SEARCHAPI_CONCURRENCY', 'TRAVELPAYOUTS_CONCURRENCY'],
    planOnly: false,
  },
  {
    field: 'cacheTtlHours',
    unit: 'count',
    overrides: ['SEARCHAPI_CACHE_TTL_HOURS', 'TRAVELPAYOUTS_CACHE_TTL_HOURS'],
    planOnly: false,
  },
  {
    field: 'costPerCallMicroGbp',
    unit: 'microGbp',
    overrides: ['SEARCHAPI_COST_PER_CALL_MICRO_GBP'],
    planOnly: false,
  },
  {
    field: 'planFixedMicroGbp',
    unit: 'microGbp',
    overrides: ['SEARCHAPI_PLAN_FIXED_PENCE'],
    planOnly: false,
  },
  { field: 'excludedFromSchedule', unit: 'text', overrides: [], planOnly: false },
  {
    field: 'monthlySpendCapMicroGbp',
    unit: 'microGbp',
    overrides: ['MONTHLY_SPEND_CAP_PENCE'],
    planOnly: true,
  },
  { field: 'executionMaxCalls', unit: 'count', overrides: ['EXECUTION_MAX_CALLS'], planOnly: true },
  {
    field: 'executionMaxCostMicroGbp',
    unit: 'microGbp',
    overrides: ['EXECUTION_MAX_COST_PENCE'],
    planOnly: true,
  },
];

/** Travelpayouts' schema defaults by field name. why: a Map over its entries reads a field without a cast. */
const TP_DEFAULTS = new Map<string, unknown>(Object.entries(TRAVELPAYOUTS_DEFAULTS));

function cell(value: unknown, unit: Row['unit']): string {
  if (value === undefined) return '—';
  // why: core's one micro-GBP→pence conversion (decision 49), so the doc rounds as the app does
  if (unit === 'microGbp' && typeof value === 'number') return `${value} µGBP (${microGbpToPence(value)}p)`;
  return String(value);
}

/** The markdown table docs/api-limits.md carries between its preset-table markers. */
export function renderPresetTable(): string {
  const lines = [
    '| Field | Override variable | SearchApi `trial` | SearchApi `40usd` | Travelpayouts (schema defaults) |',
    '|---|---|---|---|---|',
  ];
  for (const r of ROWS) {
    const override =
      r.overrides.length > 0 ? r.overrides.map((v) => `\`${v}\``).join(' / ') : '— (fixed by plan)';
    const tp = r.planOnly ? undefined : TP_DEFAULTS.get(r.field);
    lines.push(
      `| \`${r.field}\` | ${override} | ${cell(PLAN_PRESETS.trial[r.field], r.unit)} | ${cell(PLAN_PRESETS['40usd'][r.field], r.unit)} | ${cell(tp, r.unit)} |`,
    );
  }
  return lines.join('\n');
}
