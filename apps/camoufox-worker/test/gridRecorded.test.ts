// The server path over the recorded grid views (decision 61: local-only, skipped visibly when absent; the live run of
// 2026-10-18 on 8885ba8). Each recording's views are rebuilt as a page in their recorded shape (the lines, the cell
// names in their recorded order, the four scroll buttons, the selected range inside the price line's element) and the
// page session's grid flow runs over them with the recording's own query and moves: every page is read, or ends with
// an off-plan note, and is never refused.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIata, CAMOUFOX_BUILDS, GRID_STEP_DAYS, type GridMove, type IsoDate, OS_ARCHES } from '@gmt/core';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CooldownStore } from '../src/cooldown.js';
import { parseCellName, parseUnpricedCellName, resolveDay } from '../src/gridNames.js';
import { changeKeyOf, stillDrawing } from '../src/gridView.js';
import { MonthlyCounter } from '../src/monthly.js';
import { Pacer } from '../src/pacer.js';
import { Refusal } from '../src/refusal.js';
import { type Selectors, selectorsFor } from '../src/selectors.js';
import { PageSession } from '../src/session.js';
import { loadSocs } from '../src/socs.js';
import { FakeContext } from './support/fakeContext.js';
import { type FakeNode, formNodes, n, resultsTree, text } from './support/fakePage.js';
import { memoryLog } from './support/log.js';
import { rangeOf, recordedAnchor, superseded } from './support/recordedGrid.js';
import { SYNTHETIC_REJECT } from './support/socsValues.js';
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
    // why: WP17 Task 17.8 names the entry in every grid recording; the earlier ones were made on entries whose
    // GRID_VERIFIED is set (darwin-arm64 on 2026-10-18, the two Linux entries on 2026-10-26)
    osArch: z.enum(OS_ARCHES).default('darwin-arm64'),
    versions: z.object({ binary: z.string() }).loose().optional(),
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

function allRecordings(): Array<{ file: string; rec: z.infer<typeof fileSchema> }> {
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
const entrySelectors = (rec: z.infer<typeof fileSchema>): Selectors =>
  selectorsFor(rec.osArch, rec.versions?.binary ?? CAMOUFOX_BUILDS[rec.osArch].build);
/**
 * WP17 Task 17.8: the server path is held to these recordings only on entries whose GRID_VERIFIED is set; the recorded
 * suite keeps that flag false where a recording shows a refused view.
 */
const recordings = () => {
  const all = allRecordings();
  // why: spec §2 rev 46: a recording that settle supersedes (darwin-x64's grid 3 and 4) is held to the checks below
  // that a view still drawing is waited on or refused, not to these
  return all.filter(
    ({ rec }) =>
      entrySelectors(rec).GRID_VERIFIED &&
      !superseded(
        rec,
        all.map((o) => o.rec),
        anchorOf(rec),
      ),
  );
};

type View = z.infer<typeof viewSchema>;
/**
 * Serves a recording's views through the page session. `drawnLater` gives, by view index, what the page shows once
 * that view has finished drawing: the recorded view holds still for three polls first (two more than the two-poll
 * settle needs), then the later one shows.
 */
/**
 * The view that names the query: the first holding a selected cell. Why: the darwin-x64 recordings of 2026-10-26:
 * grid 4's first view had drawn no cell, and a scroll never moves the selection (every recording keeps it).
 */
function queryView(rec: z.infer<typeof fileSchema>): View {
  const first = rec.views.find((v) => v.candidates.some((c) => c?.endsWith(', selected')));
  if (first === undefined) throw new Error('no view names a selected cell');
  return first;
}
const anchorOf = (rec: z.infer<typeof fileSchema>): IsoDate =>
  recordedAnchor(queryView(rec).snapshot, rec.recordedAt);
async function serve(
  rec: z.infer<typeof fileSchema>,
  drawnLater = new Map<number, View>(),
  log = memoryLog(),
  flags: Partial<Selectors> = {},
) {
  const first = queryView(rec);
  const anchor = anchorOf(rec);
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
      // why: since review X1 only a value that reads as a rejection is loaded (this suite runs only where recordings are)
      value: SYNTHETIC_REJECT,
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
          const at = Math.min(index, rec.views.length - 1);
          const v = rec.views[at];
          const later = drawnLater.get(at);
          const tree = (x: View) => n('document', '', [dialogOf(x)]);
          if (v !== undefined)
            pg.setTrees(later === undefined ? [tree(v)] : [tree(v), tree(v), tree(v), tree(later)]);
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
    // why: each recording is served under its own entry's flags (the unpriced cells only where that entry earned them)
    selectors: { ...entrySelectors(rec), CHEAPEST_FLOW_VERIFIED: false, ...flags },
    pageTimeoutMs: 90_000,
    log,
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
      const cells = views.flatMap((v) => v.cells).flatMap((c) => (c.status === 'price' ? [c] : []));
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

// why: the darwin-x64 recordings of 2026-10-26 (grid 3 and 4): a view held still across two polls before all its
// cells had drawn (42 of 49 after grid 3's first scroll, none in grid 4's first view). Spec §2 rev 46: a view is taken
// only once every cell its lines call for has drawn, bounded by its settle's bound, after which it is refused as it is
// today, never priced partly.
describe.skipIf(!present)(
  skipTitle('recorded grid views taken before their cells had drawn (spec §2 rev 46)', present),
  () => {
    /** Each recording holding a view whose lines call for more cells than it names, with those views' indexes. */
    const drawing = () =>
      allRecordings().flatMap(({ file, rec }) => {
        const anchor = anchorOf(rec);
        const idx = rec.views.flatMap((v, i) =>
          stillDrawing(v.lines.texts, v.candidates.length, anchor) ? [i] : [],
        );
        return idx.length === 0 ? [] : [{ file, rec, idx }];
      });
    const settleName = (i: number): string => (i === 0 ? 'dates' : `move-${i}`);
    it('such a view is waited on to its bound and refused as it is: no view is priced partly', async () => {
      const recs = drawing();
      expect(recs.length).toBeGreaterThan(0);
      for (const { file, rec, idx } of recs) {
        const log = memoryLog();
        const r = await serve(rec, new Map(), log);
        if (r.answer.kind === 'grid')
          for (const v of r.answer.views) {
            const called = v.departures.flatMap((d) => v.returns.filter((x) => x >= d)).length;
            const whole = v.structural === 'ok' && v.cells.length === called;
            const refused = v.structural === 'unparsed' && v.cells.length === 0;
            expect(whole || refused, `${file} view ${v.index}`).toBe(true);
          }
        else expect(r.answer, file).toMatchObject({ kind: 'blocked', page: 'unrecognised' });
        // why: the old rule took the view on its second poll; every poll of it now finds it still drawing
        const polls = log.lines
          .filter((l) => l.msg === 'dialog poll' && Reflect.get(l.o, 'view') === settleName(idx[0] ?? 0))
          .map((l) => Reflect.get(l.o, 'drawing'));
        expect(polls.length, file).toBeGreaterThan(2);
        expect(new Set(polls), file).toEqual(new Set([true]));
      }
    });
    it('once the same dates have drawn whole (the entry’s own whole view of them), each page is read whole', async () => {
      let paired = 0;
      for (const { file, rec, idx } of drawing()) {
        const later = new Map<number, View>();
        for (const i of idx) {
          const key = changeKeyOf({ lines: rec.views[i]?.lines.texts ?? [] });
          const whole = allRecordings()
            .filter((o) => o.rec.osArch === rec.osArch)
            .flatMap((o) =>
              o.rec.views.filter(
                (w) =>
                  changeKeyOf({ lines: w.lines.texts }) === key &&
                  !stillDrawing(w.lines.texts, w.candidates.length, anchorOf(o.rec)),
              ),
            )[0];
          if (whole !== undefined) later.set(i, whole);
        }
        if (later.size !== idx.length) continue;
        paired++;
        const r = await serve(rec, later);
        if (r.answer.kind !== 'grid') throw new Error(`${file}: ${JSON.stringify(r.answer)}`);
        expect(r.answer.ended, file).toBe('complete');
        expect(r.answer.views, file).toHaveLength(rec.views.length);
        for (const v of r.answer.views) {
          const called = v.departures.flatMap((d) => v.returns.filter((x) => x >= d)).length;
          expect([v.structural, v.unparsed, v.cells.length], `${file} view ${v.index}`).toEqual([
            'ok',
            0,
            called,
          ]);
        }
      }
      expect(paired).toBeGreaterThan(0);
    });
  },
);

// why: spec §2 "Cells by name": grid/2026-10-26/7 and 8, a sparse route on the operator's Mac (darwin-arm64), whose
// views hold pairs Google shows without a price, each a button named "no flights, <d> <Mon> to <d> <Mon>" or
// "price unknown, <d> <Mon> to <d> <Mon>". The operator's first run of 2026-10-26 refused every such view (its cells
// were unparsed and a whole departure day named no price, failing the set check), so nothing was priced
describe.skipIf(!present)(
  skipTitle('recorded grid views holding unpriced cells (spec §2 "Cells by name")', present),
  () => {
    const sparse = () =>
      allRecordings().filter(({ rec }) =>
        rec.views.some((v) => v.candidates.some((c) => c !== null && parseUnpricedCellName(c) !== null)),
      );
    it('each view is read whole: every pair priced, no flights or price unknown, as its cell names it', async () => {
      const recs = sparse();
      expect(recs.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const { file, rec } of recs) {
        expect(entrySelectors(rec).GRID_UNPRICED_VERIFIED, file).toBe(true);
        const log = memoryLog();
        const r = await serve(rec, new Map(), log);
        if (r.answer.kind !== 'grid') throw new Error(`${file}: ${JSON.stringify(r.answer)}`);
        expect(r.answer.ended, file).toBe('complete');
        expect(r.answer.views, file).toHaveLength(rec.views.length);
        for (const [i, v] of r.answer.views.entries()) {
          const called = v.departures.flatMap((d) => v.returns.filter((x) => x >= d)).length;
          expect([v.structural, v.unparsed, v.cells.length], `${file} view ${i}`).toEqual(['ok', 0, called]);
          const names = rec.views[i]?.candidates ?? [];
          // why: every cell's status is its own name's words, never inferred from a neighbour or a weekday
          const dm = (iso: string): string =>
            `${Number(iso.slice(8, 10))} ${MONS[Number(iso.slice(5, 7)) - 1] ?? ''}`;
          for (const c of v.cells) {
            const pair = `${dm(c.departureDate)} to ${dm(c.returnDate)}`;
            const own = names.filter(
              (nm) => nm !== null && (nm.endsWith(pair) || nm.endsWith(`${pair}, selected`)),
            );
            const want =
              c.status === 'price'
                ? own.length === 1 && (own[0] ?? '').startsWith('£')
                : own.length === 1 &&
                  own[0] === `${c.status === 'no-flights' ? 'no flights' : 'price unknown'}, ${pair}`;
            expect(want, `${file} view ${i} ${pair}`).toBe(true);
            seen.add(c.status);
          }
          expect(v.cells.filter((c) => c.status !== 'price')).toHaveLength(
            names.filter((nm) => nm !== null && !nm.startsWith('£')).length,
          );
        }
        // why: the unpriced cells are buttons, so the view names every cell: no poll of it waits as still drawing
        const drawing = log.lines
          .filter((l) => l.msg === 'dialog poll' && Reflect.get(l.o, 'stable') === true)
          .map((l) => Reflect.get(l.o, 'drawing'));
        expect(drawing.length, file).toBeGreaterThan(0);
        expect(new Set(drawing), file).toEqual(new Set([false]));
      }
      expect([...seen].sort()).toEqual(['no-flights', 'price', 'price-unknown']);
    });
    // why: grid/2026-10-27/1 holds one unpriced cell, in its third view only. Without the flag an unpriced name is never
    // read as a cell, only counted unparsed; a view is refused whole when that leaves a day of its lines with no cell
    // named (the first run's views, grid/2026-10-26/7 and 8), and is read with that one pair unparsed otherwise
    it('without GRID_UNPRICED_VERIFIED no unpriced name is read as a cell; the first run’s views are refused whole', async () => {
      let refused = 0;
      let partly = 0;
      for (const { file, rec } of sparse()) {
        const r = await serve(rec, new Map(), memoryLog(), { GRID_UNPRICED_VERIFIED: false });
        if (r.answer.kind !== 'grid') throw new Error(`${file}: ${JSON.stringify(r.answer)}`);
        // why: CodeRabbit on PR #33: every recorded view is answered, so none can pass by being left out
        expect(
          r.answer.views.map((v) => v.index),
          file,
        ).toEqual(rec.views.map((_v, i) => i));
        for (const v of r.answer.views) {
          const names = rec.views[v.index]?.candidates ?? [];
          const unpriced = names.filter((c) => c !== null && parseUnpricedCellName(c) !== null).length;
          const at = `${file} view ${v.index}`;
          if (file.startsWith('2026-10-26/')) {
            // why: the first run's views: a day of their lines has no priced cell, so the set check refuses them
            expect([v.structural, v.cells.length], at).toEqual(['unparsed', 0]);
            refused++;
          } else {
            // why: grid/2026-10-27/1: every day keeps a priced cell, so each view is read, its priced cells kept and
            // each unpriced name counted unparsed, never read as a cell
            expect([v.structural, v.unparsed, v.cells.length], at).toEqual([
              'ok',
              unpriced,
              names.length - unpriced,
            ]);
            expect(v.cells.every((c) => c.status === 'price')).toBe(true);
            if (unpriced > 0) partly++;
          }
        }
      }
      expect([refused > 0, partly > 0]).toEqual([true, true]);
    });
  },
);
