// Spec §12 and §13: docs/api-limits.md carries the full preset table, generated from the code.
import { PLAN_PRESETS, TRAVELPAYOUTS_DEFAULTS } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { ALL_VARS } from '../helpers/env.js';
import { between, read } from './files.js';
import { ROWS, renderPresetTable } from './presetTable.js';

describe('docs/api-limits.md preset table (spec §12)', () => {
  it('covers every preset field of every plan and every Travelpayouts default', () => {
    const fields = ROWS.map((r) => r.field).sort();
    expect(fields).toEqual(Object.keys(PLAN_PRESETS.trial).sort());
    expect(fields).toEqual(Object.keys(PLAN_PRESETS['40usd']).sort());
    for (const key of Object.keys(TRAVELPAYOUTS_DEFAULTS)) expect(fields).toContain(key);
  });

  it('names only override variables the config reads (WP4b ALL_VARS)', () => {
    const known: readonly string[] = ALL_VARS;
    for (const name of ROWS.flatMap((r) => r.overrides)) expect(known).toContain(name);
  });

  it('matches the table rendered from PLAN_PRESETS and TRAVELPAYOUTS_DEFAULTS', () => {
    const doc = between(
      read('docs/api-limits.md'),
      '<!-- preset-table:start -->\n',
      '\n<!-- preset-table:end -->',
    );
    expect(doc).toBe(renderPresetTable());
  });
});
