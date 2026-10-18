// WP15 Task 15.10 (fix round 1, TS 11): the grid figures the operator docs state are the estimate's own, for the worked
// example's four airport pairs (8,736 day pairs, 10–21 nights) at the defaults and at a page cap of 312.
import { readFileSync } from 'node:fs';
import { asIata, asIsoDate } from '@gmt/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { estimateStart } from '../src/estimate.js';
import { buildSnapshot } from '../src/snapshot.js';
import { engineWith, stubCamoufox } from './support/camoufox.js';

const doc = (path: string) =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
const setup = doc('docs/setup.md');
const providers = doc('docs/providers.md');

/** The worked example's run estimate at a page cap (the default scroll caps and spacing). */
function estimate(pageCap: number) {
  const e = engineWith([stubCamoufox({ cells: 1, grid: { pageAllowance: pageCap, scrollAllowance: 600 } })], {
    camoufoxConfigCap: pageCap,
  });
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
  const m =
    /reads (\d+) of (\d+) cells this run in (\d+) pages and (\d+) scrolls; a full pass takes (\d+) run/.exec(
      note,
    );
  if (line === undefined || m === null) throw new Error('no camoufox grid line');
  return {
    cells: built.cells.length,
    read: Number(m[1]),
    pages: line.calls,
    scrolls: line.scrolls ?? -1,
    hours: (line.seconds / 3600).toFixed(1),
    runs: Number(m[5]),
  };
}
const n = (x: number) => x.toLocaleString('en-GB');

beforeEach(() => {
  expect.hasAssertions();
});

describe('the grid figures in setup.md §14 and providers.md are the estimate’s', () => {
  it('with the defaults: the pages, scrolls, hours, day pairs read and runs for a full pass', () => {
    const f = estimate(100);
    expect(f.cells).toBe(8736);
    const words = `${f.pages} pages and ${f.scrolls} scrolls, about ${f.hours} hours, reading ${n(f.read)} of the ${n(f.cells)} day pairs, and a full pass takes ${f.runs} runs`;
    expect(setup).toContain(words);
    expect(providers).toContain(words);
  });
  it('with a page cap of 312: one run of 312 pages and no scrolls', () => {
    const f = estimate(312);
    expect([f.pages, f.scrolls, f.runs]).toEqual([312, 0, 1]);
    expect(setup).toContain(`one run of ${f.pages} pages and no scrolls, about ${f.hours} hours`);
    expect(providers).toContain(`one run of ${f.pages} pages, about ${f.hours} hours`);
  });
});
