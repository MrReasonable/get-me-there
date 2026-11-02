// The recorded return views (WP21 Task 21.3; decision 61: local-only and gitignored, so the suite runs only where the
// recordings exist and otherwise reports itself skipped; with RECORDINGS_REQUIRED=1 their absence fails). It reads
// select-outbound/2026-11-01/3 and 4 (the keyboard activation; 1 and 2 were the failed pointer clicks and are not read)
// and the end-to-end recording of the full served path (R-e2e: `select-return` marked `forceSecond`), each by key.
// Structural pins only: counts, booleans and `pinOf` hashes salted with each recording's own content hash. No page
// text, price, time or name appears here; each request's dates and airports are rebuilt at run time.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate } from '@gmt/core';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyPageWithRule, type PageFacts } from '../src/classify.js';
import { parseOptionName } from '../src/names.js';
import { readReturns, returnDayOffset } from '../src/returns.js';
import { SELECTORS } from '../src/selectors.js';
import {
  airportNamesOf,
  IN_APP_E2E,
  inAppEvidence,
  metaOf,
  pinOf,
  RECORDED_ROOT,
  RECORDINGS_REQUIRED,
} from './support/recordedList.js';

const QUERY = /^Flights from ([A-Z]{3}) to ([A-Z]{3}) on (\d{4}-\d{2}-\d{2}) returning (\d{4}-\d{2}-\d{2})$/;
/** The keyboard recordings of the research kind this suite reads (1 and 2 were pointer clicks). */
const RESEARCH = ['select-outbound/2026-11-01/3', 'select-outbound/2026-11-01/4'];

const listSchema = z
  .object({
    names: z.array(z.string().nullable()),
    cheapestTabName: z.string(),
    resultsStated: z.number().nullable(),
    currencyName: z.string().nullable(),
    locationName: z.string().nullable(),
    viewMore: z.boolean(),
  })
  .loose();
const afterSchema = z
  .object({
    documentLoadsBefore: z.number(),
    documentLoads: z.number(),
    page: z.object({ url: z.string() }).loose(),
    list: listSchema.nullable(),
  })
  .loose();
const factsSchema = z
  .object({
    hops: z.array(z.string()),
    picks: z.array(z.object({ name: z.string() })),
    // why: review I2: the step's held word and the guard's counts are named, so their shape is checked where present
    // (the end-to-end recording's evidence requires them: inAppEvidence)
    steps: z.array(
      z
        .object({
          step: z.string(),
          after: afterSchema.optional(),
          held: z.enum(['unexpected-navigation', 'page-reservation']).optional(),
          gateRefusals: z.number().optional(),
          documentStarts: z.number().optional(),
        })
        .loose(),
    ),
    forceSecond: z.boolean().optional(),
  })
  .loose();
const metaSchema = z.object({ contentSha256: z.string() }).loose();
/** The recorded page facts as the classifier takes them (the fields it reads; the rest as recorded). */
const pageSchema: z.ZodType<PageFacts> = z
  .object({
    url: z.string(),
    hops: z.array(z.string()),
    frameUrls: z.array(z.string()),
    text: z
      .object({
        unusualTraffic: z.boolean(),
        consentHeading: z.boolean(),
        signInHeading: z.boolean(),
        challenge: z.boolean(),
        noFlights: z.boolean(),
        landingHeading: z.boolean(),
        returnHeading: z.boolean(),
      })
      .loose(),
    accountControl: z.boolean(),
    cheapestTabs: z.array(
      z.object({ name: z.string(), inTablist: z.boolean(), selected: z.boolean().exactOptional() }),
    ),
    dateGridButtons: z.number(),
    resultLinks: z.number(),
    outboundLinks: z.number(),
  })
  .loose();

interface Recorded {
  key: string;
  contentSha256: string;
  facts: z.infer<typeof factsSchema>;
  raw: unknown;
  req: {
    returnDate: ReturnType<typeof asIsoDate>;
    airportNames: { origin: string[]; destination: string[] };
  };
}

/** Every recording of `kind` that `keep` admits, with its request rebuilt from its own query URL. */
function recorded(kind: string, keep: (key: string, f: z.infer<typeof factsSchema>) => boolean): Recorded[] {
  const dir = join(RECORDED_ROOT, kind);
  if (!existsSync(dir)) return [];
  const out: Recorded[] = [];
  for (const day of readdirSync(dir)
    .filter((x) => statSync(join(dir, x)).isDirectory())
    .sort())
    for (const f of readdirSync(join(dir, day))
      .filter((x) => x.endsWith('.facts.json'))
      .sort()) {
      const key = `${kind}/${day}/${f.replace(/\.facts\.json$/, '')}`;
      const raw: unknown = JSON.parse(readFileSync(join(dir, day, f), 'utf8'));
      const facts = factsSchema.parse(raw);
      if (!keep(key, facts)) continue;
      const meta = metaSchema.parse(
        JSON.parse(readFileSync(join(dir, day, f.replace(/\.facts\.json$/, '.meta.json')), 'utf8')),
      );
      const q = facts.hops
        .map((h) => new URL(h).searchParams.get('q'))
        .find((x) => x !== null && QUERY.test(x));
      const m = q === undefined || q === null ? null : QUERY.exec(q);
      if (m === null) continue;
      out.push({
        key,
        contentSha256: meta.contentSha256,
        facts,
        raw,
        req: { returnDate: asIsoDate(m[4] ?? ''), airportNames: airportNamesOf(m[1] ?? '', m[2] ?? '') },
      });
    }
  return out;
}

/**
 * What each research recording showed, by key: the return options another cell's on each selection (a salted hash of
 * the counts) and whether the cheapest return's "From" figure equals the selected outbound's (true on every recording
 * of 2026-11-01; a changed value on re-recording is a finding for the controller, not a bug: test-r3-004).
 */
const PINS: Readonly<Record<string, { otherCell: string; minAtOutbound: boolean[] }>> = {
  'select-outbound/2026-11-01/3': { otherCell: 'f03979cd8c78180f', minAtOutbound: [true, true] },
  'select-outbound/2026-11-01/4': { otherCell: 'f3f24c512c54ed1d', minAtOutbound: [true, true] },
};
const NO_LIMITS = {
  maxJourneyMinutes: null,
  maxStops: null,
  departureWindowLocal: null,
  arrivalWindowLocal: null,
};
const ON = { ...SELECTORS, RETURN_SELECT_VERIFIED: true };

beforeEach(() => {
  expect.hasAssertions();
});

const present = recordingsPresentForKind(RECORDED_ROOT, 'select-outbound');
describe.skipIf(!present && !RECORDINGS_REQUIRED)(
  skipTitle('recorded return views (WP21 Task 21.3)', present),
  () => {
    const research = recorded('select-outbound', (key) => RESEARCH.includes(key));
    const e2e = recorded('select-return', (_key, f) => f.forceSecond === true);
    const all = [...research, ...e2e];
    /** Each selection that read a return view: its after, and the outbound selected for it. */
    const selections = (r: Recorded) =>
      r.facts.steps
        .filter((s) => s.step === 'first-selection' || s.step === 'second-selection')
        .map((s, i) => ({ after: s.after, pick: r.facts.picks[i]?.name ?? null }));
    it('the recordings are there: the research keys, and the end-to-end recording where it is required', () => {
      expect(present).toBe(true);
      expect(research.map((r) => r.key)).toEqual(RESEARCH);
      if (RECORDINGS_REQUIRED) expect(e2e.length).toBeGreaterThan(0);
    });
    it('every return name the option grammar reads states its times and a day offset in −1..3 from the return date', () => {
      for (const r of all)
        for (const { after } of selections(r))
          for (const name of after?.list?.names ?? []) {
            const p = name === null ? null : parseOptionName(name);
            expect(p, r.key).not.toBeNull();
            if (p === null || p.arrivesOn === null) continue;
            expect([p.departsAt === null, p.arrivesAt === null], r.key).toEqual([false, false]);
            const offset = returnDayOffset(p.departsOn, p.arrivesOn, r.req.returnDate);
            expect(offset !== null && offset >= -1 && offset <= 3, r.key).toBe(true);
          }
    });
    it('readReturns over each selection: returns listed, nothing unparsed, more listed, the other-cell counts and the minimum as pinned', () => {
      for (const r of all) {
        const reads = selections(r).map(({ after, pick }) => {
          const list = after?.list;
          expect(list, r.key).toBeTruthy();
          const rr =
            list === null || list === undefined
              ? null
              : readReturns(list, { ...r.req, returnLimits: NO_LIMITS });
          const outbound = pick === null ? null : parseOptionName(pick);
          return { rr, outbound };
        });
        for (const { rr } of reads) {
          expect(rr?.listed, r.key).toBe('returns');
          expect(rr?.optionsUnparsed, r.key).toBe(0);
          expect(rr?.moreListed, r.key).toBe(true);
          expect(rr?.currency, r.key).toBe('GBP');
        }
        const minAtOutbound = reads.map(
          ({ rr, outbound }) =>
            Math.min(...(rr?.returns ?? []).map((x) => x.fromMinor)) === outbound?.amountMinor,
        );
        const pin = PINS[r.key];
        if (pin === undefined) {
          // why: the end-to-end recording carries no pin yet; today's every recording has the equality
          expect(minAtOutbound.every(Boolean), r.key).toBe(true);
          continue;
        }
        expect(
          pinOf(
            r.contentSha256,
            reads.map(({ rr }) => rr?.optionsOtherCell),
          ),
          r.key,
        ).toBe(pin.otherCell);
        expect(minAtOutbound, r.key).toEqual(pin.minAtOutbound);
      }
    });
    // why: the controller's ruling on review I2: under the gate a selection's document growth is 0 by construction, so
    // the evidence that every activation is in-app is what the guard saw before the gate: no document started and none
    // aborted on any activation, the reload the one document started, nothing held
    it('the end-to-end recording: no gate refusal and no held navigation on any step; only the reload started a document', () => {
      expect(e2e.length > 0 || !RECORDINGS_REQUIRED, 'the end-to-end recording').toBe(true);
      for (const r of e2e) expect(inAppEvidence(r.raw, metaOf(r.key)), r.key).toEqual(IN_APP_E2E);
    });
    it('every selection’s view classifies as the return view with the dated selectors; a selection loads no document and the reload one', () => {
      for (const r of all) {
        const steps = factsSchema.parse(r.raw).steps;
        for (const s of steps) {
          const a = s.after;
          if (a === undefined) continue;
          const growth = a.documentLoads - a.documentLoadsBefore;
          if (s.step === 'reload') expect(growth, `${r.key} ${s.step}`).toBe(1);
          else expect(growth, `${r.key} ${s.step}`).toBe(0);
          if (s.step !== 'first-selection' && s.step !== 'second-selection') continue;
          const page = pageSchema.parse(a.page);
          expect(classifyPageWithRule(page, ON, 'returns'), `${r.key} ${s.step}`).toEqual({
            kind: { kind: 'results' },
            rule: 'returns',
          });
        }
      }
    });
  },
);
