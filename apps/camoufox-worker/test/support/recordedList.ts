// The recorded list pages as the list and flights readers take them (decision 61: local-only, gitignored; a suite that
// uses these runs only where the kind's recordings exist). Each recording's request is rebuilt at run time, never
// written into a test: its departure date from the page URL's own query (the one URL form, `src/url.ts`), and its
// airport names from the airports dataset the engine's names come from (`packages/db/data/airports.<version>.json`,
// the file `packages/db/src/seed/airports.ts` loads), so no airport, date or name of a recording appears in the tree.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asIsoDate, type IsoDate } from '@gmt/core';
import { z } from 'zod';
import type { ListFacts } from '../../src/driver.js';

export const RECORDED_ROOT = fileURLToPath(new URL('../../fixtures/recorded/', import.meta.url));
const DATA_DIR = fileURLToPath(new URL('../../../../packages/db/data/', import.meta.url));

const listFactsSchema = z.object({
  names: z.array(z.string().nullable()),
  cheapestTabName: z.string(),
  resultsStated: z.number().nullable(),
  currencyName: z.string().nullable(),
  locationName: z.string().nullable(),
});
const recordingSchema = z
  .object({
    page: z.object({ url: z.string() }).loose().nullable(),
    list: listFactsSchema,
  })
  .loose();
const metaSchema = z.object({ contentSha256: z.string().regex(/^[0-9a-f]{64}$/) }).loose();
const datasetSchema = z.object({
  airports: z.array(z.object({ iata: z.string(), name: z.string() }).loose()),
});

/** The one query form the worker loads (`src/url.ts`): codes and both dates, read back from the recorded URL. */
const QUERY = /^Flights from ([A-Z]{3}) to ([A-Z]{3}) on (\d{4}-\d{2}-\d{2}) returning (\d{4}-\d{2}-\d{2})$/;

/**
 * WP21 Task 21.3 (test-r3-003): with RECORDINGS_REQUIRED=1 a recorded suite whose recordings are absent fails instead
 * of skipping (the controller's run before the select flags flip); otherwise it skips, naming itself skipped.
 */
export const RECORDINGS_REQUIRED = process.env.RECORDINGS_REQUIRED === '1';

/** The airports dataset's name for each code, as `airportNamesOf` gives the engine (one name a code). */
function datasetNames(): Map<string, string> {
  const files = readdirSync(DATA_DIR).filter((f) => /^airports\..+\.json$/.test(f));
  const [file] = files;
  if (file === undefined || files.length !== 1)
    throw new Error(`expected exactly one airports.<version>.json in ${DATA_DIR}`);
  const ds = datasetSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')));
  return new Map(ds.airports.map((a) => [a.iata, a.name]));
}

export interface RecordedList {
  /** `<kind>/<day>/<n>`: the recording's place in the tree, which names nothing of its contents. */
  key: string;
  /**
   * The recording's own content hash (its meta's `contentSha256`), never committed: a pinned hash of a value read from
   * the page is salted with it, so the committed hash cannot be reversed without the local recording (decision 61).
   */
  contentSha256: string;
  facts: ListFacts;
  req: {
    departureDate: IsoDate;
    airportNames: {
      origin: string[];
      destination: string[];
      otherOrigins: string[][];
      otherDestinations: string[][];
    };
  };
}

/** Every recording of `kind` whose page URL states the query (the first view's load), in path order. */
export function recordedLists(kind: 'results' | 'cheapest' | 'view-more'): RecordedList[] {
  const dir = join(RECORDED_ROOT, kind);
  if (!existsSync(dir)) return [];
  const names = datasetNames();
  const out: RecordedList[] = [];
  // why: a kind directory also holds its tracked .gitkeep; only day directories are read
  for (const day of readdirSync(dir)
    .filter((x) => statSync(join(dir, x)).isDirectory())
    .sort())
    for (const f of readdirSync(join(dir, day))
      .filter((x) => x.endsWith('.facts.json'))
      .sort()) {
      const rec = recordingSchema.parse(JSON.parse(readFileSync(join(dir, day, f), 'utf8')));
      const q = rec.page === null ? null : new URL(rec.page.url).searchParams.get('q');
      const m = q === null ? null : QUERY.exec(q);
      if (m === null) continue;
      const [, origin = '', destination = '', departure = ''] = m;
      const own = (code: string): string[] => {
        const n = names.get(code);
        return n === undefined ? [] : [n];
      };
      const meta = metaSchema.parse(
        JSON.parse(readFileSync(join(dir, day, f.replace(/\.facts\.json$/, '.meta.json')), 'utf8')),
      );
      out.push({
        key: `${kind}/${day}/${f.replace(/\.facts\.json$/, '')}`,
        contentSha256: meta.contentSha256,
        facts: rec.list,
        req: {
          departureDate: asIsoDate(departure),
          airportNames: {
            origin: own(origin),
            destination: own(destination),
            otherOrigins: [],
            otherDestinations: [],
          },
        },
      });
    }
  return out;
}

/** A short SHA-256 of `value` salted with the recording's own content hash: what a test may pin of a page's values. */
export function pinOf(contentSha256: string, value: unknown): string {
  return createHash('sha256')
    .update(`${contentSha256}:${JSON.stringify(value)}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * WP21 Task 21.3: a recording's request airport names from the dataset (one name a code), as the engine sends them;
 * nothing of a recording is written into a test.
 */
export function airportNamesOf(
  origin: string,
  destination: string,
): { origin: string[]; destination: string[]; otherOrigins: string[][]; otherDestinations: string[][] } {
  const names = datasetNames();
  const own = (code: string): string[] => {
    const n = names.get(code);
    return n === undefined ? [] : [n];
  };
  // why: a recording is one pair's page: no other chosen airport
  return { origin: own(origin), destination: own(destination), otherOrigins: [], otherDestinations: [] };
}

/**
 * WP21 Task 21.3 (the controller's ruling on review I2): the end-to-end recording's in-app evidence as the recorder
 * writes it. Each step states the documents the gate aborted (`gateRefusals`) and the main-frame documents the page
 * started (`documentStarts`, counted by the guard before the gate), 0 included, and a held navigation by its word; the
 * meta states the page's totals. Every field is required here, so a renamed field fails the parse instead of passing.
 */
const e2eStepSchema = z
  .object({
    step: z.string(),
    gateRefusals: z.number().int().nonnegative(),
    documentStarts: z.number().int().nonnegative(),
    held: z.enum(['unexpected-navigation', 'page-reservation']).optional(),
  })
  .loose();
// why: the meta's other fields are stripped: the evidence is these three counts only
const e2eMetaSchema = z.object({
  documentLoads: z.number().int().nonnegative(),
  documentStarts: z.number().int().nonnegative(),
  gateRefusals: z.number().int().nonnegative(),
});

/** One step's evidence: its name, the gate's refusals, the documents started, and its held word (null: none). */
export type StepEvidence = [step: string, gateRefusals: number, documentStarts: number, held: string | null];

/** The evidence of one end-to-end recording, from its facts' steps and its meta. */
export function inAppEvidence(
  facts: unknown,
  meta: unknown,
): {
  steps: StepEvidence[];
  meta: z.infer<typeof e2eMetaSchema>;
} {
  const steps = z
    .object({ steps: z.array(e2eStepSchema) })
    .loose()
    .parse(facts).steps;
  return {
    steps: steps.map((s) => [s.step, s.gateRefusals, s.documentStarts, s.held ?? null]),
    meta: e2eMetaSchema.parse(meta),
  };
}

/**
 * What the full served path's evidence must be (R-e2e): every activation in-app (no document started, none aborted,
 * nothing held), the reload the one document started, and the page's two documents, both loaded.
 */
export const IN_APP_E2E: { steps: StepEvidence[]; meta: z.infer<typeof e2eMetaSchema> } = {
  steps: [
    ['first-selection', 0, 0, null],
    ['reload', 0, 1, null],
    ['second-selection', 0, 0, null],
    ['return-selection', 0, 0, null],
    ['more-options', 0, 0, null],
  ],
  meta: { documentLoads: 2, documentStarts: 2, gateRefusals: 0 },
};

/** A recording's meta, read beside its facts (`<key>.meta.json` under RECORDED_ROOT). */
export function metaOf(key: string): unknown {
  return JSON.parse(readFileSync(join(RECORDED_ROOT, `${key}.meta.json`), 'utf8'));
}
