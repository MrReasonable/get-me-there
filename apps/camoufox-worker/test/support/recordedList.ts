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
  req: { departureDate: IsoDate; airportNames: { origin: string[]; destination: string[] } };
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
          airportNames: { origin: own(origin), destination: own(destination) },
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
