// The Price graph exploration's pure parts: which region appeared, the query stripping and the write's last check.
// Synthetic values only.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CONTROLS_PER_ROLE, readCells } from '../src/dialogSettle.js';
import { createDriver } from '../src/driver.js';
import { appeared, exploreGraph, type RegionRef, stripSnapshotQueries } from '../src/graph.js';
import { writeGraphExplore } from '../src/recordWrite.js';
import { SELECTORS } from '../src/selectors.js';
import {
  type FakeNode,
  FakePage,
  n,
  RESULTS_URL,
  resultsTree,
  shrinkAfterCount,
} from './support/fakePage.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

beforeEach(() => {
  expect.hasAssertions();
});

const r = (role: RegionRef['role'], name: string, index = 0): RegionRef => ({ role, index, name });

describe('appeared', () => {
  it('is the first region beyond what was there before, counting repeats', () => {
    expect(appeared([], [r('dialog', 'Price graph')])).toEqual(r('dialog', 'Price graph'));
    expect(appeared([r('region', 'A')], [r('region', 'A')])).toBeNull();
    expect(appeared([r('region', 'A')], [r('region', 'A'), r('region', 'A', 1)])).toEqual(
      r('region', 'A', 1),
    );
    expect(appeared([r('region', 'A')], [r('dialog', 'A')])).toEqual(r('dialog', 'A'));
    expect(appeared([r('region', 'A'), r('region', 'B', 1)], [r('region', 'B')])).toBeNull();
  });
});

// why: the exploration lists the controls inside the region that appeared, at most MAX_CONTROLS_PER_ROLE of a role by
// name and the rest counted (synthetic trees only)
describe('exploreGraph over a synthetic page', () => {
  async function explore(dialog: FakeNode) {
    const page = new FakePage(null);
    page.setUrl(RESULTS_URL);
    const button = n('button', 'Price graph');
    page.setTrees([resultsTree({ extra: [button] })]);
    page.onClick = (x) => {
      if (x === button) page.setTrees([resultsTree({ extra: [button, dialog] })]);
    };
    const timers = fakeTimers();
    const driver = createDriver(page, {
      hops: [],
      frameUrls: [],
      refused: null,
      documentLoads: 0,
      documentStarts: 0,
      activationGate: false,
      gateRefusals: 0,
      reservation: null,
      held: null,
    });
    const out = await exploreGraph(driver, page, timers.deadline(180_000), {
      timers,
      pollMs: 2000,
      S: SELECTORS,
      steps: { timers },
      clicked: [],
    });
    if (out.kind !== 'explored') throw new Error(out.kind);
    return out;
  }
  const many = (role: string, k: number): FakeNode[] =>
    Array.from({ length: k }, (_, i) => n(role, `${role} ${i}`));
  it('names at most MAX_CONTROLS_PER_ROLE controls of a role and counts the rest, for that role only', async () => {
    const out = await explore(
      n('dialog', 'Price graph', [
        ...many('button', MAX_CONTROLS_PER_ROLE + 2),
        ...many('tab', MAX_CONTROLS_PER_ROLE),
        n('slider', 'Trip length'),
      ]),
    );
    expect(out.unnamed).toEqual({ button: 2 });
    const controls = Array.isArray(out.controls) ? out.controls : [];
    expect(controls.filter((c) => c.role === 'button')).toHaveLength(MAX_CONTROLS_PER_ROLE);
    expect(controls.filter((c) => c.role === 'tab')).toHaveLength(MAX_CONTROLS_PER_ROLE);
    expect(controls.at(-1)).toEqual({ role: 'slider', name: 'Trip length' });
  });
  it('a region that appeared with no name is recorded with an empty name', async () => {
    const out = await explore(n('dialog', '', [n('slider', 'Trip length')], { ariaLabel: null, text: null }));
    expect(out.region).toEqual({ role: 'dialog', name: '', appeared: true });
  });
});

describe('stripSnapshotQueries', () => {
  it('drops the query and fragment of every /url: line and every absolute URL, and nothing else', () => {
    const before = [
      '- dialog "Price graph":',
      '  - link "Learn more":',
      '    - /url: /travel/flights/help?tfs=abc&hl=en#top',
      '    - /url: https://www.google.com/x?y=1',
      '  - text: see https://www.google.com/travel/flights?q=z and http://example.test/a#b too',
      '  - button "Why? Prices vary"',
    ].join('\n');
    expect(stripSnapshotQueries(before)).toBe(
      [
        '- dialog "Price graph":',
        '  - link "Learn more":',
        '    - /url: /travel/flights/help',
        '    - /url: https://www.google.com/x',
        '  - text: see https://www.google.com/travel/flights and http://example.test/a too',
        '  - button "Why? Prices vary"',
      ].join('\n'),
    );
  });
});

describe('writeGraphExplore', () => {
  it('refuses a URL that still carries a query, and writes numbered files otherwise', () => {
    const root = tmpDir();
    expect(() => writeGraphExplore(root, '2026-10-18', { a: 'https://www.google.com/x?q=1' }, [])).toThrow(
      /query string; nothing written/,
    );
    expect(writeGraphExplore(root, '2026-10-18', { a: 1 }, [])).toBe(
      join(root, 'graph-explore/2026-10-18/1.json'),
    );
    expect(writeGraphExplore(root, '2026-10-18', { a: 2 }, [])).toBe(
      join(root, 'graph-explore/2026-10-18/2.json'),
    );
    expect(readdirSync(join(root, 'graph-explore/2026-10-18')).sort()).toEqual(['1.json', '2.json']);
  });
});

// why: WP21 Task 21.3 fix round 2: the dialog's panel re-renders on every scroll; its names are read in one page call,
// so a cell gone after the count holds no read (raced against the fake's first waiting read, an event)
describe('readCells (fix round 2)', () => {
  it('answers the buttons and cells the panel held at once, buttons first; a name over the cap is null', async () => {
    const long = 'x'.repeat(SELECTORS.maxNameLength + 1);
    const panel = n('tabpanel', 'Dates', [
      n('gridcell', 'Cell 1'),
      ...['B1', 'B2', 'B3', long, 'B5'].map((x) => n('button', x)),
      n('gridcell', 'Cell 2', [], { ariaLabel: null, text: null }),
    ]);
    const page = new FakePage(null);
    page.setTrees([n('document', '', [panel])]);
    page.url();
    const hung = shrinkAfterCount(page, panel, { whenCount: 5, keep: 3 });
    const read = readCells(page.getByRole('tabpanel').nth(0), fakeTimers().deadline(10_000), SELECTORS);
    read.catch(() => undefined);
    const out = await Promise.race([read, hung]);
    await page.close();
    expect(out).toEqual([
      ...['B1', 'B2', 'B3', null, 'B5'].map((name) => ({ role: 'button', name })),
      { role: 'gridcell', name: 'Cell 1' },
      { role: 'gridcell', name: null },
    ]);
  });
  it('names at most MAX_CONTROLS_PER_ROLE of one role', async () => {
    const panel = n(
      'tabpanel',
      'Dates',
      Array.from({ length: MAX_CONTROLS_PER_ROLE + 1 }, (_, i) => n('gridcell', `C${i}`)),
    );
    const page = new FakePage(null);
    page.setTrees([n('document', '', [panel])]);
    page.url();
    const out = await readCells(page.getByRole('tabpanel').nth(0), fakeTimers().deadline(10_000), SELECTORS);
    expect(out).toHaveLength(MAX_CONTROLS_PER_ROLE);
    expect(out.at(-1)).toEqual({ role: 'gridcell', name: `C${MAX_CONTROLS_PER_ROLE - 1}` });
  });
});
