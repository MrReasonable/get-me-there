// WP15 Task 15.10 (fix round 1, TS 11): the grid figures the operator docs state are the estimate's own, for the worked
// example's four airport pairs (8,736 day pairs, 10–21 nights) at the defaults (spec rev 65: no page or scroll cap a
// run, so one run reads them all).
import { readFileSync } from 'node:fs';
import { asIata, asIsoDate, parseConfig } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { estimateStart } from '../src/estimate.js';
import { buildSnapshot } from '../src/snapshot.js';
import { engineWith, realCamoufox } from './support/camoufox.js';

const doc = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
const setup = doc('docs/setup.md');
const providers = doc('docs/providers.md');

/** The worked example's run estimate at the defaults (the scroll cap and spacing). */
function estimate() {
  // why: re-review N3: the real adapter, with the grid settings as the app's config gives them (wiring.ts's mapping)
  const parsed = parseConfig(
    {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      BIND_ADDRESS: '127.0.0.1',
      CAMOUFOX_ENABLED: 'true',
      CAMOUFOX_WORKER_URL: 'http://127.0.0.1:8090',
      CAMOUFOX_WORKER_KEY: 'test-camoufox-worker-key-0123456789abcdef',
      CAMOUFOX_MODE: 'grid',
    },
    { realpath: (p) => p },
  );
  const cf = parsed.ok ? parsed.config.providers.camoufox : null;
  if (cf === null) throw new Error('config');
  const real = realCamoufox([], 1, {
    scrollCap: cf.gridScrollCap,
    scrollSpacingSeconds: cf.gridScrollSpacingSeconds,
    pageTimeoutSeconds: cf.pageTimeoutSeconds,
  });
  const e = engineWith([real]);
  const def = e.ctx.repos.definitions.update(e.definition.id, {
    window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2027-05-02') },
    minNights: 10,
    maxNights: 21,
    origins: [asIata('LHR'), asIata('LGW')],
    destinations: [asIata('JFK'), asIata('EWR')],
  });
  const built = buildSnapshot(e.ctx, def);
  const est = estimateStart(e.ctx, built.snapshot, built.cells, null);
  const line = est.perProvider.find((p) => p.providerId === 'camoufox');
  const note = est.assumptions.find((a) => a.startsWith('camoufox grid mode reads')) ?? '';
  const m = /reads (\d+) cells in (\d+) pages and (\d+) scrolls/.exec(note);
  if (line === undefined || m === null) throw new Error('no camoufox grid line');
  return {
    cells: built.cells.length,
    read: Number(m[1]),
    pages: line.calls,
    scrolls: line.scrolls ?? -1,
    hours: (line.seconds / 3600).toFixed(1),
  };
}
const n = (x: number) => x.toLocaleString('en-GB');

beforeEach(() => {
  expect.hasAssertions();
});

describe('the grid figures in setup.md §14 and providers.md are the estimate’s', () => {
  it('with the defaults: one run reads every day pair, a page a block and no scroll', () => {
    const f = estimate();
    expect([f.cells, f.read, f.pages, f.scrolls]).toEqual([8736, 8736, 312, 0]);
    const words = `one run of ${f.pages} pages and no scrolls, about ${f.hours} hours, reading all ${n(f.cells)} day pairs`;
    expect(setup).toContain(words);
    expect(providers).toContain(words);
  });
});
