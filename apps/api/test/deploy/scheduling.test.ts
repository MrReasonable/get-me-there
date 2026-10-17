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

  it('the spec §8.2 £0 row states the monthly Travelpayouts calls the budget fit computes (CodeRabbit batch 3)', () => {
    const monthly = /\| £0: Travelpayouts only, weekly \|[^\n]*\| Travelpayouts ([\d,]+) of /.exec(
      renderCadenceTable(),
    )?.[1];
    const spec = read('docs/superpowers/specs/2026-10-14-flight-price-optimiser-design.md');
    // why: PR #3 review — each step asserts what it needs, so a missing row or cell fails naming it, not as a TypeError
    const row = spec.split('\n').find((l) => l.startsWith('| £0 Travelpayouts, `month` tiles |'));
    expect(monthly, 'the generated £0 row states its monthly Travelpayouts calls').toMatch(/^[\d,]+$/);
    expect(row, 'spec §8.2 has the £0 Travelpayouts row').toBeDefined();
    const cell = row?.split(' | ')[2];
    expect(cell, 'the £0 row has a per-month cell').toBeDefined();
    expect(cell?.split(' (')[0]).toBe(`~${monthly}`);
  }, 60_000);

  it('names each SearchApi plan by its preset id, as docs/api-limits.md does, never by a price (CodeRabbit batch 3)', () => {
    const table = renderCadenceTable();
    expect(table).not.toContain('$40');
    // why: PR #3 review — rows are picked by their label, never by their position in the table
    const plans = [...table.matchAll(/^\| (SearchApi [^|:]+):/gm)].map((m) => m[1]);
    expect(plans).toEqual([
      'SearchApi `40usd`',
      'SearchApi `40usd`',
      'SearchApi `40usd`',
      'SearchApi `trial`',
    ]);
    expect(read('docs/api-limits.md')).toContain('SearchApi `40usd`');
  }, 60_000);
});
