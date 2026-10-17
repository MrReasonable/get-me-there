// Spec §8.2 cadence arithmetic: docs/scheduling.md's table is generated from the engine's estimate and budgetFit.
import { describe, expect, it } from 'vitest';
import { renderCadenceTable } from './cadence.js';
import { between, read } from './files.js';

// why: ruling 11: each case estimates the example definition over every pair and month (about 2 s unloaded); 30 s
// keeps a loaded runner a slow pass.
describe('docs/scheduling.md cadence table (spec §8.2; decisions 25, 34)', { timeout: 30_000 }, () => {
  it('matches the table the engine computes for the example on the day the doc names', () => {
    const doc = read('docs/scheduling.md');
    expect(doc.replace(/\s+/g, ' ')).toContain('computed for a definition saved on 14 October 2026');
    const table = between(doc, '<!-- cadence-table:start -->\n', '\n<!-- cadence-table:end -->');
    expect(table).toBe(renderCadenceTable());
  }, 60_000);

  it('Travelpayouts plans one free call per airport pair and month (2 × 2 pairs × 7 months), and runs a month stay unrounded', () => {
    const table = renderCadenceTable();
    expect(table).toContain('| £0: Travelpayouts only, weekly | Travelpayouts calendar 28 → 34 | 4.33 |');
    expect(table).toContain('| SearchApi `40usd`: both providers, daily (`0 5 * * *`) |');
    expect(table).toContain('| 30.42 |');
  }, 60_000);

  it('names each SearchApi plan by its preset id, as docs/api-limits.md does, never by a price (CodeRabbit batch 3)', () => {
    const table = renderCadenceTable();
    expect(table).not.toContain('$40');
    const labels = [...table.matchAll(/^\| ([^|]+) \|/gm)].map((m) => m[1]?.trim() ?? '').slice(2);
    expect(labels.filter((l) => l.startsWith('SearchApi `40usd`:'))).toHaveLength(3);
    expect(read('docs/api-limits.md')).toContain('SearchApi `40usd`');
  }, 60_000);
});
