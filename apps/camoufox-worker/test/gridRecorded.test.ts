// The server path over the recorded grid views (decision 61: local-only, skipped visibly when absent; the live run of
// 2026-10-18 on 8885ba8). Each recording's views are rebuilt as a page in their recorded shape (the lines, the cell
// names in their recorded order, the four scroll buttons, the selected range inside the price line's element) and the
// page session's grid flow runs over them with the recording's own query and moves: every page is read, or ends with
// an off-plan note, and is never refused.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIata, GRID_STEP_DAYS, type GridMove, type IsoDate } from '@gmt/core';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CooldownStore } from '../src/cooldown.js';
import { parseCellName, resolveDay } from '../src/gridNames.js';
import { MonthlyCounter } from '../src/monthly.js';
import { Pacer } from '../src/pacer.js';
import { Refusal } from '../src/refusal.js';
import { SELECTORS } from '../src/selectors.js';
import { PageSession } from '../src/session.js';
import { loadSocs } from '../src/socs.js';
import { FakeContext } from './support/fakeContext.js';
import { type FakeNode, formNodes, n, resultsTree, text } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { rangeOf, recordedAnchor } from './support/recordedGrid.js';
import { fakeTimers } from './support/timers.js';
import { tmpDir } from './support/tmp.js';

const ROOT = fileURLToPath(new URL('../fixtures/recorded/', import.meta.url));
const present = recordingsPresentForKind(ROOT, 'grid');

beforeEach(() => {
  expect.hasAssertions();
});

const viewSchema = z
  .object({
    snapshot: z.string(),
    lines: z.object({ texts: z.array(z.string()) }),
    candidates: z.array(z.string().nullable()),
    selectedLines: z.array(z.string()),
  })
  .loose();
const fileSchema = z
  .object({
    recordedAt: z.string(),
    views: z.array(viewSchema),
    moves: z.array(
      z.object({ dir: z.enum(['left', 'right', 'up', 'down']), delta: z.unknown().optional() }).loose(),
    ),
  })
  .loose();

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shown = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()] ?? ''}, ${d.getUTCDate()} ${MONS[d.getUTCMonth()] ?? ''}`;
};

/** One recorded view as the dialog the page shows, in the recorded shape. */
function dialogOf(v: z.infer<typeof viewSchema>): FakeNode {
  const line = (t: string): FakeNode => n('generic', '', [], { text: t });
  // why: the range comes from the stored snapshot's line (this test's reading of a recording; the provider path never
  // parses printed text)
  const range = rangeOf(v.snapshot);
  const price = v.selectedLines[0] ?? '';
  return n('dialog', 'Price insights', [
    n('tablist', '', [n('tab', 'Dates', [], { selected: true }), n('tab', 'Price graph')]),
    n('tabpanel', 'Dates', [
      n('button', 'Scroll left'),
      n('button', 'Scroll right'),
      n('grid', 'Date grid'),
      line(v.lines.texts[0] ?? ''),
      ...v.candidates.map((c) => n('button', c ?? '')),
      line(v.lines.texts[1] ?? ''),
      text('Return'),
      n('button', 'Scroll up'),
      n('button', 'Scroll down'),
      n('generic', '', [text(price)], { text: `${range}${price}` }),
    ]),
  ]);
}

function recordings(): Array<{ file: string; rec: z.infer<typeof fileSchema> }> {
  const out: Array<{ file: string; rec: z.infer<typeof fileSchema> }> = [];
  const dir = join(ROOT, 'grid');
  if (!existsSync(dir)) return out;
  for (const day of readdirSync(dir, { withFileTypes: true }))
    if (day.isDirectory())
      for (const f of readdirSync(join(dir, day.name)))
        if (f.endsWith('.json') && !f.startsWith('0-'))
          out.push({
            file: `${day.name}/${f}`,
            rec: fileSchema.parse(JSON.parse(readFileSync(join(dir, day.name, f), 'utf8'))),
          });
  return out;
}

async function serve(rec: z.infer<typeof fileSchema>) {
  const first = rec.views[0];
  if (first === undefined) throw new Error('no view');
  const anchor = recordedAnchor(first.snapshot, rec.recordedAt);
  const sel = parseCellName(first.candidates.find((c) => c?.endsWith(', selected')) ?? '');
  if (sel === null) throw new Error('no selected cell');
  const dep = resolveDay(sel.dep, anchor);
  const ret = resolveDay(sel.ret, anchor);
  if (dep === null || ret === null) throw new Error('no dates');
  // why: the recording's own moves, up to the first that did not move the page
  const moves: GridMove[] = rec.moves
    .filter((m) => m.delta !== undefined)
    .map((m) => m.dir)
    .slice(0, rec.views.length - 1);
  const dataDir = tmpDir();
  writeFileSync(
    join(dataDir, 'socs.json'),
    JSON.stringify({
      value: 'v',
      domain: '.google.com',
      path: '/',
      expires: 1_800_000_000,
      secure: true,
      sameSite: 'Lax',
      capturedAt: '2026-10-18T04:00:00.000Z',
    }),
    { mode: 0o600 },
  );
  const profileDir = join(dataDir, 'profile');
  mkdirSync(profileDir);
  const timers = fakeTimers();
  let index = 0;
  const session = new PageSession({
    launch: async () => {
      const c = new FakeContext();
      c.navigations = [
        {
          hops: ['https://www.google.com/travel/flights?q=x', 'https://www.google.com/travel/flights/search'],
          tree: resultsTree({
            form: formNodes({ dep: shown(dep), ret: shown(ret) }),
            extra: [n('button', 'Price graph')],
          }),
        },
      ];
      c.onNewPage = (pg) => {
        const show = () => {
          const v = rec.views[Math.min(index, rec.views.length - 1)];
          if (v !== undefined) pg.setTrees([n('document', '', [dialogOf(v)])]);
        };
        pg.onClick = (x) => {
          if (x.role === 'button' && x.name === 'Price graph') show();
          else if (x.role === 'tab') show();
          else if ((x.name ?? '').startsWith('Scroll ')) {
            index++;
            show();
          }
        };
      };
      mkdirSync(profileDir, { recursive: true });
      return c;
    },
    profileDir,
    socs: loadSocs(dataDir, timers.clock),
    cooldown: new CooldownStore({ dir: dataDir, challengeHours: 48, clock: timers.clock }),
    pacer: new Pacer({ dir: dataDir, minSpacingSeconds: 30, clock: timers.clock }),
    monthly: new MonthlyCounter({
      dir: dataDir,
      caps: { pages: 1500, scrolls: 6000, billingDay: 1 },
      clock: timers.clock,
    }),
    refusal: new Refusal({ dir: dataDir, clock: timers.clock }),
    clock: timers.clock,
    timers,
    selectors: { ...SELECTORS, CHEAPEST_FLOW_VERIFIED: false },
    pageTimeoutMs: 90_000,
    log: memoryLog(),
    versions: { selectors: 's', grammar: 'g', camoufoxJs: '0.11.5', binary: 'b' },
    grid: { mode: 'grid', spacingMs: 5000, scrollCap: 30, stepDays: GRID_STEP_DAYS },
  });
  const start: { departureDate: IsoDate; returnDate: IsoDate } = { departureDate: dep, returnDate: ret };
  return session.page({
    mode: 'grid',
    origin: asIata('LHR'),
    destination: asIata('JFK'),
    gl: 'GB',
    start,
    moves,
    reads: [true, ...moves.map(() => true)],
    scrollAllowance: moves.length,
  });
}

describe.skipIf(!present)(
  skipTitle('recorded grid views through the server path (Task 15.4, the live run)', present),
  () => {
    it('a page whose first view is on plan reads every recorded view, complete; one near today ends off-plan as such', async () => {
      const recs = recordings();
      expect(recs.length).toBeGreaterThan(0);
      let onPlan = 0;
      let nearToday = 0;
      for (const { file, rec } of recs) {
        const r = await serve(rec);
        if (r.answer.kind !== 'grid') throw new Error(`${file}: ${JSON.stringify(r.answer)}`);
        for (const v of r.answer.views)
          expect([v.structural, v.unparsed], `${file} view ${v.index}`).toEqual(['ok', 0]);
        // why: TS 3: the step is pinned per recording: a wrong step makes the first move off-plan, and fails here
        const today = rec.recordedAt.slice(0, 10);
        if ((r.answer.views[0]?.departures[0] ?? '') <= today) {
          nearToday++;
          expect(r.answer.ended, file).toBe('off-plan');
          expect(
            r.answer.views.map((v) => v.offPlan),
            file,
          ).toEqual(['near-today']);
        } else {
          onPlan++;
          expect(r.answer.ended, file).toBe('complete');
          expect(r.answer.views, file).toHaveLength(rec.views.length);
          expect(r.answer.views.every((v) => v.offPlan === null)).toBe(true);
        }
        expect(
          r.answer.views.map((v) => v.cells.length),
          file,
        ).toEqual(rec.views.slice(0, r.answer.views.length).map((v) => v.candidates.length));
      }
      expect([onPlan > 0, nearToday > 0]).toEqual([true, true]);
    });
    // why: PA M5: the recorded facts the grammar stands on, pinned on what the server path reads from them
    it('the recorded facts hold: the low mark, a December to January year, a thousands separator, a short view near today', async () => {
      const views = [];
      for (const { rec } of recordings()) {
        const r = await serve(rec);
        if (r.answer.kind === 'grid') views.push(...r.answer.views);
      }
      const cells = views.flatMap((v) => v.cells);
      expect(cells.some((c) => c.mark === 'low')).toBe(true);
      expect(cells.some((c) => c.mark === 'cheapest')).toBe(true);
      expect(
        cells.some(
          (c) =>
            c.departureDate.slice(5, 7) === '12' &&
            c.returnDate.slice(5, 7) === '01' &&
            Number(c.returnDate.slice(0, 4)) === Number(c.departureDate.slice(0, 4)) + 1,
        ),
      ).toBe(true);
      expect(cells.some((c) => c.amountMinor >= 100_000)).toBe(true);
      expect(views.some((v) => v.offPlan === 'near-today' && v.cells.length < 49)).toBe(true);
    });
    // why: fix round 2 (ruling 2): the live 0-night recording (14 → 15 Mar, `up`, 2026-10-19): short views near the
    // diagonal, on plan, holding same-day pairs, and the step up moving the returns back one day
    it('a 0-night page reads its short views near the diagonal, same-day pairs included, and steps up one day', async () => {
      let diagonal = 0;
      for (const { file, rec } of recordings()) {
        const r = await serve(rec);
        if (r.answer.kind !== 'grid') continue;
        const short = r.answer.views.filter(
          (v) =>
            v.offPlan === null &&
            v.cells.length < 49 &&
            v.cells.some((c) => c.departureDate === c.returnDate),
        );
        if (short.length === 0) continue;
        diagonal++;
        for (const v of short) {
          expect(
            v.cells.every((c) => c.returnDate >= c.departureDate),
            file,
          ).toBe(true);
          const possible = v.departures.flatMap((d) => v.returns.filter((x) => x >= d)).length;
          expect(v.cells, file).toHaveLength(possible);
        }
        const [a, b] = r.answer.views;
        if (rec.moves[0]?.dir === 'up' && a !== undefined && b !== undefined) {
          const day = (x: string | undefined) => Date.parse(`${x ?? ''}T00:00:00Z`) / 86_400_000;
          expect(
            [day(b.departures[0]) - day(a.departures[0]), day(b.returns[0]) - day(a.returns[0])],
            file,
          ).toEqual([0, -1]);
          expect(b.cells.length, file).toBeLessThan(a.cells.length);
        }
      }
      expect(diagonal).toBeGreaterThan(0);
    });
  },
);
