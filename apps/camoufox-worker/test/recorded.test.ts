// The recorded suites (decision 61; TS-04, TS-13, TS2-12): the worker's recordings of Google pages are vendor content,
// gitignored and local-only, so each kind's suite runs only where that kind's recordings exist and otherwise reports
// itself skipped with the decision-61 suffix. Every recording is parsed with zod (no casts) and checked against its
// own hash; none may hold an account trace.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRID_STEP_DAYS, OS_ARCHES } from '@gmt/core';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyLanding, classifyPage } from '../src/classify.js';
import { rejectionMark } from '../src/consentLine.js';
import { CONSENT_HOST } from '../src/consentWatch.js';
import { parseCellName, parseSelectedPrice, parseSelectedRange } from '../src/gridNames.js';
import { interpretView } from '../src/gridView.js';
import { onAllowlist } from '../src/guard.js';
import { parseOptionName } from '../src/names.js';
import { KINDS, RECORDED_BY, type RecordingKind } from '../src/record.js';
import { FLAG_NAMES, flagsOf, PROOFS, SELECTORS, selectorsFor } from '../src/selectors.js';
import { rangeOf, recordedAnchor, superseded, underDrawnSettle } from './support/recordedGrid.js';

const ROOT = fileURLToPath(new URL('../fixtures/recorded/', import.meta.url));

const metaSchema = z.object({
  recordedAt: z.string(),
  recordedBy: z.literal(RECORDED_BY),
  kind: z.enum(KINDS),
  socsReadBack: z.enum(['same', 'changed', 'missing']),
  launchOptions: z.object({ exclude_addons: z.array(z.string()), geoip: z.literal(false) }).loose(),
  versions: z.object({ selectors: z.string(), camoufoxJs: z.string(), binary: z.string() }),
  stepMs: z.record(z.string(), z.number()),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  failure: z.string().optional(),
  // why: pie-b1-006 added the entry; the recordings made before it are the operator's Mac (darwin-arm64)
  osArch: z.enum(OS_ARCHES).default('darwin-arm64'),
});
const pageFactsSchema = z.object({
  url: z.string(),
  hops: z.array(z.string()),
  frameUrls: z.array(z.string()),
  text: z.object({
    unusualTraffic: z.boolean(),
    consentHeading: z.boolean(),
    signInHeading: z.boolean(),
    challenge: z.boolean(),
    noFlights: z.boolean(),
    // why: WP17 Task 17.4 added it; recordings made before then lack it
    landingHeading: z.boolean().default(false),
  }),
  accountControl: z.boolean(),
  cheapestTabs: z.array(
    z.object({ name: z.string(), inTablist: z.boolean(), selected: z.boolean().exactOptional() }),
  ),
  dateGridButtons: z.number(),
  resultLinks: z.number(),
});
const factsSchema = z.object({
  kind: z.enum(KINDS),
  landing: z.string(),
  hops: z.array(z.string()),
  page: pageFactsSchema.nullable(),
  // why: the landing view (Task 17.8) reads no result names
  names: z.array(z.string().nullable()).default([]),
  headings: z.array(z.string()).default([]),
  socsReadBack: z.enum(['same', 'changed', 'missing']).optional(),
  clicked: z.array(z.string()),
});
interface Recording {
  file: string;
  text: string;
  facts: z.infer<typeof factsSchema>;
  meta: z.infer<typeof metaSchema>;
}

function recordingsOf(kind: RecordingKind): Recording[] {
  const dir = join(ROOT, kind);
  if (!existsSync(dir)) return [];
  const out: Recording[] = [];
  for (const day of readdirSync(dir, { withFileTypes: true })) {
    if (!day.isDirectory()) continue;
    for (const f of readdirSync(join(dir, day.name))) {
      if (!f.endsWith('.facts.json')) continue;
      const file = join(dir, day.name, f);
      const text = readFileSync(file, 'utf8');
      const meta = metaSchema.parse(
        JSON.parse(readFileSync(file.replace(/\.facts\.json$/, '.meta.json'), 'utf8')),
      );
      const raw: unknown = JSON.parse(text);
      // why: a consent-landing failure keeps only its landing and hops; the recorded suite reports it as such.
      if (meta.failure !== undefined)
        throw new Error(`${file} is a ${meta.failure} failure: the work stops for an operator ruling`);
      out.push({ file, text, facts: factsSchema.parse(raw), meta });
    }
  }
  return out;
}

function common(kind: RecordingKind): Recording[] {
  const recs = recordingsOf(kind);
  expect(recs.length).toBeGreaterThan(0);
  for (const r of recs) {
    expect(createHash('sha256').update(r.text).digest('hex'), r.file).toBe(r.meta.contentSha256);
    expect(r.text, r.file).not.toContain('Google Account:');
    expect(r.text, r.file).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  }
  return recs;
}

beforeEach(() => {
  expect.hasAssertions();
});

for (const kind of ['results', 'cheapest', 'view-more'] as const) {
  const present = recordingsPresentForKind(ROOT, kind);
  describe.skipIf(!present)(skipTitle(`recorded ${kind} pages (spec §2, Task 14.2)`, present), () => {
    it('landed on the allowlist with SOCS same, every hop on it', () => {
      for (const r of common(kind)) {
        expect(
          [r.facts.landing, ...r.facts.hops].every((u) => onAllowlist(u)),
          r.file,
        ).toBe(true);
        expect(r.meta.socsReadBack, r.file).toBe('same');
        // why: each recording is classified in the view it shows (the Cheapest recording has no Date grid button)
        const view = kind === 'cheapest' ? 'cheapest' : 'best';
        expect(
          r.facts.page === null ? 'no page' : classifyPage(r.facts.page, SELECTORS, view).kind,
          r.file,
        ).toBe('results');
      }
    });
    it('every readable name parses with the dated grammar (Task 14.3)', () => {
      for (const r of common(kind)) {
        // why: WP17 Task 17.8: the provider reads a View more page only where VIEW_MORE_ADDS_CHEAPER is set for the
        // entry; elsewhere its names are a recording's observation (linux-x64's of 2026-10-26 holds a mixed-cabin
        // option the grammar leaves unparsed, counted and never misread)
        if (
          kind === 'view-more' &&
          !selectorsFor(r.meta.osArch, r.meta.versions.binary).VIEW_MORE_ADDS_CHEAPER
        )
          continue;
        for (const name of r.facts.names)
          if (name !== null && name !== '') expect(parseOptionName(name), name).not.toBeNull();
      }
    });
  });
}

{
  const present = recordingsPresentForKind(ROOT, 'socs-stability');
  describe.skipIf(!present)(skipTitle('recorded SOCS stability (ruling 9)', present), () => {
    it('read-backs are all same iff SOCS_STABLE, per entry and build', () => {
      const recs = common('socs-stability');
      for (const k of OS_ARCHES) {
        const own = recs.filter((r) => r.meta.osArch === k);
        if (own.length === 0) continue;
        const S = selectorsFor(k, own[0]?.meta.versions.binary ?? '');
        expect(
          own.every((r) => r.meta.socsReadBack === 'same'),
          k,
        ).toBe(S.SOCS_STABLE);
      }
    });
  });
}

{
  const present = recordingsPresentForKind(ROOT, 'consent-probe');
  describe.skipIf(!present)(skipTitle('recorded consent probe (rule 3)', present), () => {
    it('classifies as consent-unhandled, and nothing was clicked', () => {
      for (const r of common('consent-probe')) {
        expect(r.facts.page === null ? null : classifyPage(r.facts.page), r.file).toEqual({
          kind: 'blocked',
          page: 'consent-unhandled',
        });
        expect(r.facts.clicked).toEqual([]);
      }
    });
  });
}

{
  const present = recordingsPresentForKind(ROOT, 'no-flights');
  describe.skipIf(!present)(skipTitle('recorded no-flights page (rule 4)', present), () => {
    it('a recorded line sets NO_FLIGHTS_VERIFIED only when its facts show it; an unrecorded one leaves the flag false', () => {
      const recs = recordingsOf('no-flights');
      const unrecorded = existsSync(join(ROOT, 'no-flights', 'unrecorded.meta.json'));
      expect(recs.length + (unrecorded ? 1 : 0)).toBeGreaterThan(0);
      if (recs.length === 0) expect(SELECTORS.NO_FLIGHTS_VERIFIED).toBe(false);
      for (const r of recs) expect(r.facts.page?.text.noFlights, r.file).toBe(true);
    });
  });
}

// WP17 Task 17.8 (decision 61: local-only, skipped visibly when absent): the landing view recorded headless in the
// worker's own profile with SOCS set. Each reads as the landing view under the hypothesis, nothing was clicked, SOCS
// came back the same, and under the selectors its own entry and build earned it reads as landing exactly where
// LANDING_VERIFIED is set.
{
  const present = recordingsPresentForKind(ROOT, 'landing');
  describe.skipIf(!present)(skipTitle('recorded landing view (Task 17.8)', present), () => {
    it('reads as the landing view, clicked nothing, SOCS same; landing under its own selectors iff LANDING_VERIFIED', () => {
      for (const r of common('landing')) {
        const S = selectorsFor(r.meta.osArch, r.meta.versions.binary);
        const page = r.facts.page;
        if (page === null) throw new Error(`${r.file} holds no page facts`);
        expect(classifyLanding(page, { ...S, LANDING_VERIFIED: true }).kind, r.file).toEqual({
          kind: 'landing',
        });
        expect(classifyLanding(page, S).kind.kind === 'landing', r.file).toBe(S.LANDING_VERIFIED);
        expect(r.facts.clicked, r.file).toEqual([]);
        expect(r.meta.socsReadBack, r.file).toBe('same');
        expect(onAllowlist(r.facts.landing), r.file).toBe(true);
      }
    });
  });
}

// WP17 research 17.0c (decision 61: local-only, skipped visibly when absent): the two headed sessions of 2026-10-25, one
// asked for "Reject all" and one for "Accept all". Each session's SOCS reads as the choice it was asked for, by the value
// alone; the first views are the consent page; and the views after the choice are the landing view under the selectors
// the recording's own entry and build earned, which is what sets LANDING_VERIFIED there.
{
  const present = recordingsPresentForKind(ROOT, 'consent-research');
  describe.skipIf(!present)(skipTitle('recorded consent research (research 17.0c)', present), () => {
    const researchSchema = z.object({
      sessions: z.array(
        z
          .object({ prompted: z.enum(['reject', 'accept']), socs: z.object({ value: z.string() }).loose() })
          .loose(),
      ),
      views: z.record(
        z.enum(['reject', 'accept']),
        z.object({ firstFacts: pageFactsSchema, afterFacts: pageFactsSchema }),
      ),
    });
    const metaOf = z.object({
      osArch: z.enum(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64']),
      versions: z.object({ binary: z.string() }),
    });
    const recs = () => {
      const dir = join(ROOT, 'consent-research');
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .flatMap((d) =>
          readdirSync(join(dir, d.name))
            .filter((f) => f.endsWith('.facts.json'))
            .map((f) => join(dir, d.name, f)),
        )
        .map((file) => ({
          file,
          facts: researchSchema.parse(JSON.parse(readFileSync(file, 'utf8'))),
          meta: metaOf.parse(JSON.parse(readFileSync(file.replace(/\.facts\.json$/, '.meta.json'), 'utf8'))),
        }));
    };
    // why: ts-b1-005: a directory that holds no facts file (a partial copy) fails, never passes with nothing checked
    const present = () => {
      const all = recs();
      expect(all.length).toBeGreaterThan(0);
      for (const r of all)
        expect(r.facts.sessions.map((s) => s.prompted).sort(), r.file).toEqual(['accept', 'reject']);
      return all;
    };
    it('each session’s SOCS value carries the mark of the button it asked for', () => {
      for (const r of present())
        for (const s of r.facts.sessions) expect(rejectionMark(s.socs.value), r.file).toBe(s.prompted);
    });
    it('the first views are the consent page; the views after the choice are landing exactly where LANDING_VERIFIED is set', () => {
      for (const r of present()) {
        const S = selectorsFor(r.meta.osArch, r.meta.versions.binary);
        for (const v of Object.values(r.facts.views)) {
          expect(classifyLanding(v.firstFacts, S).kind, r.file).toEqual({
            kind: 'blocked',
            page: 'consent-unhandled',
          });
          const after = {
            ...v.afterFacts,
            hops: v.afterFacts.hops.filter((h) => new URL(h).hostname !== CONSENT_HOST),
          };
          expect(classifyLanding(after, { ...S, LANDING_VERIFIED: true }).kind, r.file).toEqual({
            kind: 'landing',
          });
          expect(classifyLanding(after, S).kind.kind === 'landing', r.file).toBe(S.LANDING_VERIFIED);
        }
      }
    });
  });
}

describe('verification flags (TS-13; runs on every checkout)', () => {
  it('each true flag names its proving recording’s date', () => {
    for (const f of FLAG_NAMES)
      if (flagsOf()[f]) expect(PROOFS['darwin-arm64'][f], f).toMatch(/^\d{4}-\d{2}-\d{2} /);
  });
});

// WP15 Task 15.2 (decision 61: local-only, skipped visibly when absent): the --grid recordings of 2026-10-18. Every
// candidate parses, each view's cells name exactly its lines' dates, the selected cell's price is the price line's, and
// one scroll moves one day on its own axis (GRID_STEP_DAYS); the renamed exploration's 49 names parse too.
{
  const present = recordingsPresentForKind(ROOT, 'grid');
  describe.skipIf(!present)(
    skipTitle('recorded date grid pages (spec §2 rev 34, Task 15.1)', present),
    () => {
      const viewSchema = z
        .object({
          lines: z.object({ texts: z.array(z.string()) }),
          candidates: z.array(z.string().nullable()),
          datesGrid: z.object({
            dialog: z.number(),
            datesSelected: z.number(),
            grid: z.number(),
            scrollButtons: z.number(),
          }),
          selectedLines: z.array(z.string()),
          snapshot: z.string(),
          // why: spec §2 rev 46: a recording made under the settle that waits for every cell marks each view
          drawn: z.boolean().optional(),
        })
        .loose();
      const fileSchema = z
        .object({
          kind: z.literal('grid'),
          recordedAt: z.string(),
          // why: WP17 Task 17.8 names the entry in every grid recording; the earlier ones were made on entries whose
          // GRID_VERIFIED is set (darwin-arm64 on 2026-10-18, the two Linux entries on 2026-10-26)
          osArch: z.enum(OS_ARCHES).default('darwin-arm64'),
          versions: z.object({ binary: z.string() }).loose(),
          socsReadBack: z.literal('same'),
          views: z.array(viewSchema),
          moves: z.array(z.object({ dir: z.enum(['left', 'right', 'up', 'down']) }).loose()),
        })
        .loose();
      const exploreSchema = z
        .object({
          dates: z.object({ cells: z.array(z.object({ role: z.string(), name: z.string().nullable() })) }),
        })
        .loose();
      const files = () => {
        const out: Array<{ file: string; raw: unknown }> = [];
        for (const day of readdirSync(join(ROOT, 'grid'), { withFileTypes: true }))
          if (day.isDirectory())
            for (const f of readdirSync(join(ROOT, 'grid', day.name)))
              if (f.endsWith('.json'))
                out.push({
                  file: `${day.name}/${f}`,
                  raw: JSON.parse(readFileSync(join(ROOT, 'grid', day.name, f), 'utf8')),
                });
        return out;
      };
      // why: fix round 1 (TS 13): the recordings hold no query; the year rule is anchored on the first view's own range
      // line (test/support/recordedGrid.ts), never on an offset from the recording time
      const anchorOf = (rec: z.infer<typeof fileSchema>) =>
        recordedAnchor(rec.views[0]?.snapshot ?? '', rec.recordedAt);
      const verifiedOn = (rec: z.infer<typeof fileSchema>): boolean =>
        selectorsFor(rec.osArch, rec.versions.binary).GRID_VERIFIED;
      const all = () =>
        files()
          .filter((f) => !f.file.endsWith('0-explore.json'))
          .map((f) => ({ file: f.file, rec: fileSchema.parse(f.raw) }));
      /**
       * A year anchor for a recording any of whose views names its range: grid/2026-10-26/4's first view had drawn no
       * price line, and a scroll never moves the selection.
       */
      const anyAnchorOf = (rec: z.infer<typeof fileSchema>) => {
        const v = rec.views.find((x) => parseSelectedRange(rangeOf(x.snapshot)) !== null);
        return recordedAnchor(v?.snapshot ?? '', rec.recordedAt);
      };
      const isSuperseded = (rec: z.infer<typeof fileSchema>, recs: ReturnType<typeof all>): boolean =>
        superseded(
          rec,
          recs.map((r) => r.rec),
          anyAnchorOf(rec),
        );
      /**
       * The recordings of entries whose GRID_VERIFIED is set: the strict checks below hold on every one of them but a
       * recording the settle of spec §2 rev 46 supersedes (gridRecorded.test.ts holds those to wait or refuse).
       */
      const verified = () => {
        const recs = all();
        return recs.filter((f) => verifiedOn(f.rec) && !isSuperseded(f.rec, recs));
      };
      const readOf = (rec: z.infer<typeof fileSchema>) =>
        rec.views.map((v) =>
          interpretView(
            {
              lines: v.lines.texts,
              candidates: v.candidates,
              ranges: [],
              prices: v.selectedLines,
              datesGrid: v.datesGrid,
            },
            anchorOf(rec),
          ),
        );
      // why: WP17 Task 17.8: an entry whose grid recordings hold a view the reading refuses (on darwin-x64 under
      // Rosetta, a view taken before all its cells had rendered) keeps GRID_VERIFIED false, as SOCS_STABLE follows its
      // read-backs
      // and a view marked not drawn is refused; a view taken while still drawing in a recording the settle of rev 46
      // supersedes is the one excuse
      it('an entry with a refused view in any of its grid recordings keeps GRID_VERIFIED false', () => {
        const recs = all();
        expect(recs.length).toBeGreaterThan(0);
        for (const { file, rec } of recs) {
          // why: a first view with no range line (nothing rendered yet) gives the reading no anchor: refused too
          const anchored = parseSelectedRange(rangeOf(rec.views[0]?.snapshot ?? '')) !== null;
          const refused =
            !anchored ||
            rec.views.some((v) => v.drawn === false) ||
            readOf(rec).some((r) => r.kind !== 'view' || r.unparsed > 0 || r.structural !== 'ok');
          if (refused && !isSuperseded(rec, recs))
            expect(verifiedOn(rec), `${file} (${rec.osArch})`).toBe(false);
        }
      });
      it('every view is the dates-grid view; every candidate parses; the cells name exactly the lines’ dates', () => {
        const recs = verified();
        expect(recs.length).toBeGreaterThan(0);
        for (const { file, rec } of recs) {
          for (const [i, v] of rec.views.entries()) {
            const r = interpretView(
              {
                lines: v.lines.texts,
                candidates: v.candidates,
                ranges: [],
                prices: v.selectedLines,
                datesGrid: v.datesGrid,
              },
              anchorOf(rec),
            );
            expect(r.kind === 'view' && [r.unparsed, r.structural], `${file} view ${i}`).toEqual([0, 'ok']);
            if (underDrawnSettle(rec)) expect(v.drawn, `${file} view ${i}`).toBe(true);
            const sel = v.candidates.find((c) => c?.endsWith(', selected'));
            if (sel !== undefined && sel !== null)
              expect(parseSelectedPrice(v.selectedLines[0] ?? ''), file).toBe(parseCellName(sel)?.pounds);
          }
        }
      });
      it('one scroll moves one day on its own axis and none on the other (GRID_STEP_DAYS)', () => {
        let measured = 0;
        for (const { file, rec } of verified()) {
          const read = readOf(rec);
          for (const [i, m] of rec.moves.entries()) {
            const a = read[i];
            const b = read[i + 1];
            if (a?.kind !== 'view' || b?.kind !== 'view') continue;
            const day = (x: string | undefined) => Date.parse(`${x ?? ''}T00:00:00Z`) / 86_400_000;
            const dDep = day(b.departures[0]) - day(a.departures[0]);
            const dRet = day(b.returns[0]) - day(a.returns[0]);
            const want = {
              right: [GRID_STEP_DAYS.departures, 0],
              left: [-GRID_STEP_DAYS.departures, 0],
              down: [0, GRID_STEP_DAYS.returns],
              up: [0, -GRID_STEP_DAYS.returns],
            }[m.dir];
            expect([dDep, dRet], `${file} move ${i + 1} ${m.dir}`).toEqual(want);
            measured++;
          }
        }
        expect(measured).toBeGreaterThan(0);
      });
      it('the renamed exploration’s 49 cell names parse', () => {
        const explore = files().filter((f) => f.file.endsWith('0-explore.json'));
        // why: CodeRabbit on PR #9: a tree with grid recordings but no renamed exploration fails, never passes empty
        expect(explore.length).toBeGreaterThan(0);
        for (const { raw } of explore) {
          const names = exploreSchema
            .parse(raw)
            .dates.cells.filter((c) => c.role === 'button' && c.name !== null && !c.name.startsWith('Scroll'))
            .map((c) => c.name ?? '');
          expect(names).toHaveLength(49);
          for (const n of names) expect(parseCellName(n), n).not.toBeNull();
        }
      });
    },
  );
}
