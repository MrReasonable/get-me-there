import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { parseConfig } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { smokeWorstCase } from '../../src/tools/smokeArgs.js';

// why: WP16b Task 16b.8: `gmt smoke --help` states the spend in words ("up to 4 SearchApi credits and one browser page
// with today's settings"); this pins those figures to the smoke's own worst case at the default settings. The CLI is
// run as a child, so neither package imports the other (decision 72).
const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

describe('gmt smoke --help states the default worst case', { timeout: 60_000 }, () => {
  it('its SearchApi credits and browser pages equal smokeWorstCase with SearchApi and the browser provider on', () => {
    const r = parseConfig(
      {
        DATABASE_PATH: '/tmp/smoke-help.db',
        BIND_ADDRESS: '127.0.0.1',
        SEARCHAPI_KEY: 'sa-key-for-the-help-test',
        CAMOUFOX_ENABLED: 'true',
        CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
        CAMOUFOX_WORKER_KEY: 'k'.repeat(32),
      },
      { realpath: (p) => p },
    );
    if (!r.ok) throw new Error(r.errors.map((e) => e.field).join(', '));
    const worst = smokeWorstCase(r.config);
    const help = spawnSync(
      process.execPath,
      ['--conditions=@gmt/source', '--import', 'tsx', 'apps/cli/src/main.ts', 'smoke', '--help'],
      {
        cwd: REPO,
        encoding: 'utf8',
      },
    );
    expect(help.status).toBe(0);
    const pages = worst.camoufox?.pages ?? 0;
    expect(help.stdout).toContain(
      `spends real calls: up to ${worst.credits} SearchApi credits and ${WORDS[pages]} browser page${pages === 1 ? '' : 's'} with today’s settings`,
    );
  });
});
