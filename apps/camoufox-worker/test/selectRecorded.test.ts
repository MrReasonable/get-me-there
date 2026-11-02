// The recorded select-outbound pages (WP21 Task 21.0; decision 61: local-only and gitignored, so the suite runs only
// where the kind's recordings exist and otherwise reports itself skipped). Structural pins only: counts, booleans and
// `pinOf` hashes salted with each recording's own content hash. No page text, price, time or name appears here; each
// request's dates are read back at run time from the recorded query URL. Recordings made with the pointer click (the
// first two of 2026-11-01, superseded by the keyboard activation) are left out: they carry no activation.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type ParsedOption, parseOptionName } from '../src/names.js';
import { SELECTORS } from '../src/selectors.js';
import { pinOf, RECORDED_ROOT, RECORDINGS_REQUIRED } from './support/recordedList.js';

const KIND = 'select-outbound';
const QUERY = /^Flights from ([A-Z]{3}) to ([A-Z]{3}) on (\d{4}-\d{2}-\d{2}) returning (\d{4}-\d{2}-\d{2})$/;

const pageSchema = z
  .object({
    resultLinks: z.number(),
    outboundLinks: z.number(),
    dateGridButtons: z.number(),
    cheapestTabs: z.array(z.object({ inTablist: z.boolean(), selected: z.boolean().optional() }).loose()),
    text: z.object({ returnHeading: z.boolean(), noFlights: z.boolean() }).loose(),
  })
  .loose();
const afterSchema = z
  .object({
    documentLoadsBefore: z.number(),
    documentLoads: z.number(),
    urlChanged: z.boolean().nullable(),
    changedFromPreClick: z.boolean().nullable(),
    settled: z.boolean(),
    classification: z.object({ kind: z.string(), rule: z.string() }),
    view: z.string().optional(),
    page: pageSchema,
    names: z.array(z.string().nullable()),
    list: z.object({ viewMore: z.boolean(), resultsStated: z.number().nullable() }).loose(),
    headings: z.array(z.string()),
    form: z.unknown(),
    stepMs: z.number(),
    waitMs: z.number(),
  })
  .loose();
const factsSchema = z
  .object({
    hops: z.array(z.string()),
    best: z.object({ page: pageSchema, names: z.array(z.string().nullable()) }).loose(),
    cheapest: z
      .object({ page: pageSchema, names: z.array(z.string().nullable()) })
      .loose()
      .nullable(),
    picks: z.array(z.object({ name: z.string(), linkIndex: z.number() })),
    steps: z.array(
      z
        .object({ step: z.string(), activation: z.string().optional(), after: afterSchema.optional() })
        .loose(),
    ),
    socsReadBack: z.string(),
    forceSecond: z.boolean().optional(),
  })
  .loose();
const metaSchema = z.object({ contentSha256: z.string(), documentLoads: z.number() }).loose();

interface Recorded {
  key: string;
  contentSha256: string;
  documentLoads: number;
  facts: z.infer<typeof factsSchema>;
  departureDate: string;
  returnDate: string;
}

/** Every keyboard-activation recording of the kind, with its request's dates from its own query URL. */
function recorded(): Recorded[] {
  const dir = join(RECORDED_ROOT, KIND);
  if (!existsSync(dir)) return [];
  const out: Recorded[] = [];
  for (const day of readdirSync(dir)
    .filter((x) => statSync(join(dir, x)).isDirectory())
    .sort())
    for (const f of readdirSync(join(dir, day))
      .filter((x) => x.endsWith('.facts.json'))
      .sort()) {
      const facts = factsSchema.parse(JSON.parse(readFileSync(join(dir, day, f), 'utf8')));
      // why: WP21 Task 21.3 (R-e2e): the end-to-end recording of the served path is returnsRecorded's and
      // offersRecorded's, never this research suite's
      if (facts.forceSecond === true) continue;
      if (!facts.steps.some((s) => s.activation === 'keyboard')) continue;
      const meta = metaSchema.parse(
        JSON.parse(readFileSync(join(dir, day, f.replace(/\.facts\.json$/, '.meta.json')), 'utf8')),
      );
      const q = facts.hops
        .map((h) => new URL(h).searchParams.get('q'))
        .find((x) => x !== null && QUERY.test(x));
      const m = q === undefined || q === null ? null : QUERY.exec(q);
      if (m === null) continue;
      out.push({
        key: `${KIND}/${day}/${f.replace(/\.facts\.json$/, '')}`,
        contentSha256: meta.contentSha256,
        documentLoads: meta.documentLoads,
        facts,
        departureDate: m[3] ?? '',
        returnDate: m[4] ?? '',
      });
    }
  return out;
}

/**
 * What the recordings of 2026-11-01 showed, by key (counts and salted hashes only): the first view's and the Cheapest
 * view's link counts, each selection's return-option count, and a hash of the two picks' names.
 */
const PINS: Readonly<
  Record<string, { best: number; cheapest: number; returns: [number, number]; picks: string }>
> = {
  'select-outbound/2026-11-01/3': { best: 12, cheapest: 13, returns: [4, 4], picks: '1d67f8c010f0cb36' },
  'select-outbound/2026-11-01/4': { best: 25, cheapest: 26, returns: [15, 15], picks: '914b3c8f0b38934b' },
};

const md = (iso: string) => ({ month: Number(iso.slice(5, 7)), day: Number(iso.slice(8, 10)) });
const onDay = (d: { month: number; day: number } | null, iso: string): boolean =>
  d !== null && d.month === md(iso).month && d.day === md(iso).day;

beforeEach(() => {
  expect.hasAssertions();
});

const present = recordingsPresentForKind(RECORDED_ROOT, KIND);
describe.skipIf(!present && !RECORDINGS_REQUIRED)(
  skipTitle('recorded select-outbound pages (WP21 Task 21.0)', present),
  () => {
    const all = recorded();
    it('the pinned recordings are there, each with its counts and picks as pinned', () => {
      // why: test-r3-003: with RECORDINGS_REQUIRED=1 an absent kind fails here instead of skipping
      expect(present).toBe(true);
      for (const [key, pin] of Object.entries(PINS)) {
        const r = all.find((x) => x.key === key);
        expect(r, key).toBeDefined();
        if (r === undefined) continue;
        expect(r.facts.best.page.resultLinks, key).toBe(pin.best);
        expect(r.facts.cheapest?.page.resultLinks, key).toBe(pin.cheapest);
        expect(
          r.facts.steps.filter((s) => s.step !== 'reload').map((s) => s.after?.names.length),
          key,
        ).toEqual(pin.returns);
        expect(
          pinOf(
            r.contentSha256,
            r.facts.picks.map((p) => p.name),
          ),
          key,
        ).toBe(pin.picks);
      }
    });
    it('every recording ran the whole sequence: two selections in-app, the reload one document, SOCS the same', () => {
      for (const r of all) {
        const steps = r.facts.steps;
        expect(
          steps.map((s) => s.step),
          r.key,
        ).toEqual(['first-selection', 'reload', 'second-selection']);
        const [first, reload, second] = steps.map((s) => s.after);
        expect(first && reload && second, r.key).toBeTruthy();
        if (first === undefined || reload === undefined || second === undefined) continue;
        // why: finding 1 (navigation): the first view is one document; a selection loads none; the reload loads one
        expect([first.documentLoadsBefore, first.documentLoads], r.key).toEqual([1, 1]);
        expect([reload.documentLoadsBefore, reload.documentLoads], r.key).toEqual([1, 2]);
        expect([second.documentLoadsBefore, second.documentLoads], r.key).toEqual([2, 2]);
        expect(r.documentLoads, r.key).toBe(2);
        for (const a of [first, second]) {
          expect([a.settled, a.changedFromPreClick, a.urlChanged], r.key).toEqual([true, true, true]);
          expect(a.classification, r.key).toEqual({ kind: 'results', rule: 'returns' });
        }
        expect([reload.settled, reload.view], r.key).toEqual([true, 'cheapest']);
        expect(
          steps.filter((s) => s.step !== 'reload').map((s) => s.activation),
          r.key,
        ).toEqual(['keyboard', 'keyboard']);
        expect(r.facts.socsReadBack, r.key).toBe('same');
      }
    });
    it('the return view: a returning heading, no tab, no Date grid, View more, no stated count, no form read', () => {
      for (const r of all)
        for (const s of r.facts.steps.filter((x) => x.step !== 'reload')) {
          const a = s.after;
          if (a === undefined) continue;
          expect(a.page.text.returnHeading, r.key).toBe(true);
          expect(
            a.headings.some((h) => SELECTORS.returns.heading.test(h)),
            r.key,
          ).toBe(true);
          expect(
            a.headings.some((h) => /departing/i.test(h)),
            r.key,
          ).toBe(false);
          expect([a.page.cheapestTabs.length, a.page.dateGridButtons], r.key).toEqual([0, 0]);
          expect([a.list.viewMore, a.list.resultsStated, a.form], r.key).toEqual([true, null, null]);
          // why: every return link reads by the outbound pattern too (finding 4: one price form)
          expect(a.page.outboundLinks, r.key).toBe(a.page.resultLinks);
        }
    });
    it('every return name: the outbound grammar reads it, "From" priced, from the destination to the origin on the return date', () => {
      for (const r of all) {
        const picks = r.facts.picks.map((p) => parseOptionName(p.name));
        r.facts.steps
          .filter((x) => x.step !== 'reload')
          .forEach((s, i) => {
            const pick: ParsedOption | null | undefined = picks[i];
            const names = (s.after?.names ?? []).filter((x): x is string => x !== null);
            expect(pick, r.key).not.toBeNull();
            expect(names.length, r.key).toBeGreaterThan(0);
            const parsed = names.map((x) => parseOptionName(x));
            expect(
              parsed.every((p) => p !== null),
              r.key,
            ).toBe(true);
            // why: finding 5's stop condition: every return name carries the "From" price clause
            expect(
              names.every((x) => x.startsWith('From ')),
              r.key,
            ).toBe(true);
            expect(
              names.every((x) => SELECTORS.returns.resultLink.test(x)),
              r.key,
            ).toBe(true);
            for (const p of parsed) {
              if (p === null || pick === null || pick === undefined) continue;
              expect([p.from === pick.to, p.to === pick.from], r.key).toEqual([true, true]);
              expect(onDay(p.departsOn, r.returnDate), r.key).toBe(true);
            }
            // why: finding 5: the cheapest return's price equals the selected outbound's own "From" price
            const min = Math.min(...parsed.map((p) => p?.amountMinor ?? Number.POSITIVE_INFINITY));
            expect(min, r.key).toBe(pick?.amountMinor);
            expect(onDay(pick?.departsOn ?? null, r.departureDate), r.key).toBe(true);
          });
      }
    });
  },
);
