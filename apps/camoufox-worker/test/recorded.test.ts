// The recorded suites (decision 61; TS-04, TS-13, TS2-12): the worker's recordings of Google pages are vendor content,
// gitignored and local-only, so each kind's suite runs only where that kind's recordings exist and otherwise reports
// itself skipped with the decision-61 suffix. Every recording is parsed with zod (no casts) and checked against its
// own hash; none may hold an account trace.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIsoDate, GRID_STEP_DAYS } from '@gmt/core';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyPage } from '../src/classify.js';
import { parseCellName, parseSelectedPrice } from '../src/gridNames.js';
import { interpretView } from '../src/gridView.js';
import { onAllowlist } from '../src/guard.js';
import { parseOptionName } from '../src/names.js';
import { KINDS, RECORDED_BY, type RecordingKind } from '../src/record.js';
import { FLAG_NAMES, flagsOf, PROOFS, SELECTORS } from '../src/selectors.js';

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
  names: z.array(z.string().nullable()),
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
      for (const r of common(kind))
        for (const name of r.facts.names)
          if (name !== null && name !== '') expect(parseOptionName(name), name).not.toBeNull();
    });
  });
}

{
  const present = recordingsPresentForKind(ROOT, 'socs-stability');
  describe.skipIf(!present)(skipTitle('recorded SOCS stability (ruling 9)', present), () => {
    it('read-backs are all same iff SOCS_STABLE', () => {
      const recs = common('socs-stability');
      expect(recs.every((r) => r.meta.socsReadBack === 'same')).toBe(SELECTORS.SOCS_STABLE);
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

describe('verification flags (TS-13; runs on every checkout)', () => {
  it('each true flag names its proving recording’s date', () => {
    for (const f of FLAG_NAMES) if (flagsOf()[f]) expect(PROOFS[f], f).toMatch(/^\d{4}-\d{2}-\d{2} /);
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
        })
        .loose();
      const fileSchema = z
        .object({
          kind: z.literal('grid'),
          recordedAt: z.string(),
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
      // why: the recordings hold no query; every recorded date lies within the sale window after recordedAt, so the
      // anchor for the year rule is half a window on
      const anchorOf = (recordedAt: string) =>
        asIsoDate(new Date(Date.parse(recordedAt) + 180 * 86_400_000).toISOString().slice(0, 10));
      it('every view is the dates-grid view; every candidate parses; the cells name exactly the lines’ dates', () => {
        const recs = files().filter((f) => !f.file.endsWith('0-explore.json'));
        expect(recs.length).toBeGreaterThan(0);
        for (const { file, raw } of recs) {
          const rec = fileSchema.parse(raw);
          for (const [i, v] of rec.views.entries()) {
            const r = interpretView(
              {
                lines: v.lines.texts,
                candidates: v.candidates,
                ranges: [],
                prices: v.selectedLines,
                datesGrid: v.datesGrid,
              },
              anchorOf(rec.recordedAt),
            );
            expect(r.kind === 'view' && [r.unparsed, r.structural], `${file} view ${i}`).toEqual([0, 'ok']);
            const sel = v.candidates.find((c) => c?.endsWith(', selected'));
            if (sel !== undefined && sel !== null)
              expect(parseSelectedPrice(v.selectedLines[0] ?? ''), file).toBe(parseCellName(sel)?.pounds);
          }
        }
      });
      it('one scroll moves one day on its own axis and none on the other (GRID_STEP_DAYS)', () => {
        let measured = 0;
        for (const { file, raw } of files().filter((f) => !f.file.endsWith('0-explore.json'))) {
          const rec = fileSchema.parse(raw);
          const read = rec.views.map((v) =>
            interpretView(
              {
                lines: v.lines.texts,
                candidates: v.candidates,
                ranges: [],
                prices: v.selectedLines,
                datesGrid: v.datesGrid,
              },
              anchorOf(rec.recordedAt),
            ),
          );
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
