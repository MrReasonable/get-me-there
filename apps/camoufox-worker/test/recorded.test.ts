// The recorded suites (decision 61; TS-04, TS-13, TS2-12): the worker's recordings of Google pages are vendor content,
// gitignored and local-only, so each kind's suite runs only where that kind's recordings exist and otherwise reports
// itself skipped with the decision-61 suffix. Every recording is parsed with zod (no casts) and checked against its
// own hash; none may hold an account trace.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyPage } from '../src/classify.js';
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
  cheapestTabs: z.array(z.object({ name: z.string(), inTablist: z.boolean() })),
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
        expect(r.facts.page === null ? 'no page' : classifyPage(r.facts.page).kind, r.file).toBe('results');
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
