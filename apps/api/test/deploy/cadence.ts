// The docs/scheduling.md cadence table, computed by the engine's own estimate and budgetFit (spec §8.2: "from the
// same functions as the estimate"), so the operator's numbers and the app's cap checks cannot drift apart.
// Travelpayouts plans one tile per (origin airport, destination airport, month), never a metro query (decision 34);
// runsPerMonth is the engine's, unrounded (firings in the next 365 days ÷ 12, decision 25).
import { apiContract, asIsoDate, asIsoDateTime, type DefinitionInput, fixedClock } from '@gmt/core';
import { createEngine } from '@gmt/engine';
import { seededPorts } from '../helpers/recording.js';
import { read } from './files.js';

/**
 * The day the table is computed for. why: a relative window spans 7 or 8 calendar months depending on the day it is
 * resolved, and Travelpayouts plans a tile per pair and month, so the doc names the day.
 */
export const CADENCE_DAY = '2026-10-14';

/** The importable example (docs/examples/london-new-york.json) parsed by the create schema, as the engine takes it. */
export function exampleInput(): DefinitionInput {
  return apiContract.definitionCreateRequestSchema.parse(
    JSON.parse(read('docs/examples/london-new-york.json')),
  );
}

export interface CadenceCase {
  label: string;
  plan: 'none' | 'trial' | '40usd';
  definition: DefinitionInput;
}

/** The table's rows: the £0 configuration, the example on SearchApi `40usd` weekly and daily, its maxCells headroom, the trial. */
export function cadenceCases(): CadenceCase[] {
  const example = exampleInput();
  const free: DefinitionInput = {
    ...example,
    providers: {
      discovery: ['travelpayouts'],
      verification: [],
      discoveryRefreshHours: { travelpayouts: 168 },
    },
  };
  return [
    { label: '£0: Travelpayouts only, weekly', plan: 'none', definition: free },
    { label: 'SearchApi `40usd`: both providers, weekly (the example)', plan: '40usd', definition: example },
    {
      label: 'SearchApi `40usd`: both providers, daily (`0 5 * * *`)',
      plan: '40usd',
      definition: { ...example, scheduleCron: '0 5 * * *' },
    },
    {
      label: 'SearchApi `40usd`: both providers, weekly, `maxCells` 200',
      plan: '40usd',
      definition: { ...example, verification: { ...example.verification, maxCells: 200 } },
    },
    { label: 'SearchApi `trial`: both providers, weekly', plan: 'trial', definition: example },
  ];
}

const PROVIDER_LABEL = new Map<string, string>([
  ['travelpayouts', 'Travelpayouts'],
  ['searchapi', 'SearchApi'],
]);
const label = (id: string): string => PROVIDER_LABEL.get(id) ?? id;

function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One case through a real engine over in-memory ports, as the Definitions form's estimate and budget fit are made. */
function computeRow(c: CadenceCase): { cells: string[]; retryFactor: number } {
  // why: WP4b's seededPorts (both providers on sentinel credentials, airports seeded, closed after the test); its
  // raised rate limits change only the estimate's seconds, never its calls or any cap, so the table is the default one.
  const ports = seededPorts(
    c.plan === 'none' ? { SEARCHAPI_KEY: '' } : { SEARCHAPI_PLAN: c.plan },
    fixedClock(asIsoDateTime(`${CADENCE_DAY}T09:00:00.000Z`)),
  );
  const engine = createEngine({ ...ports, notifiers: [] });
  const est = engine.estimate(c.definition, asIsoDate(CADENCE_DAY));
  const fit = engine.budgetFit(c.definition);
  const perRun = est.perProvider.map((p) => {
    const stage = p.stage === 'discovery' ? 'calendar' : 'itinerary search';
    const blocked = p.blocked === null ? '' : ` (refused: over the ${p.blocked} cap)`;
    return `${label(p.providerId)} ${stage} ${thousands(p.planCalls)} → ${thousands(p.calls)}${blocked}`;
  });
  const scopes = new Map(
    fit.perScope
      .filter((s) => s.scope.startsWith('provider-'))
      .map((s) => [s.scope.slice(s.scope.indexOf(':') + 1), s] as const),
  );
  const providers = [...new Set(est.perProvider.map((p) => p.providerId))];
  const monthly = providers.map((id) => {
    const s = scopes.get(id);
    if (s === undefined) return `${label(id)} 0 (scheduled runs leave it out)`;
    return `${label(id)} ${thousands(s.estimated)} of ${s.cap === null ? 'no cap' : thousands(s.cap)}`;
  });
  return {
    cells: [
      c.label,
      perRun.join('; '),
      fit.runsPerMonth.toFixed(2),
      monthly.join('; '),
      fit.fits ? 'yes' : 'no',
    ],
    retryFactor: est.retryFactor,
  };
}

/** The markdown table docs/scheduling.md carries between its cadence-table markers. */
export function renderCadenceTable(): string {
  const rows = cadenceCases().map(computeRow);
  const factor = rows[0]?.retryFactor ?? 1;
  return [
    `| Configuration | Calls a run: planned → with the ${factor} retry factor | Runs a month | Calls a month (budgetFit) of the cap | Fits every cap |`,
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.cells.join(' | ')} |`),
  ].join('\n');
}
