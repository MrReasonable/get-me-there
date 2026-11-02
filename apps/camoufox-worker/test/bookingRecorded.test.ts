// The recorded select-return pages (Ian's ruling of 2026-11-01: read the booking options; decision 61: local-only and
// gitignored, so the suite runs only where the kind's recordings exist and otherwise reports itself skipped).
// Structural pins only: counts, booleans and `pinOf` hashes salted with each recording's own content hash. No page
// text, price, seller, time or name appears here; each request's dates are read back at run time from its query URL.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseOptionName } from '../src/names.js';
import { minorOf } from '../src/pence.js';
import { SELECTORS } from '../src/selectors.js';
import { pinOf, RECORDED_ROOT, RECORDINGS_REQUIRED } from './support/recordedList.js';

const KIND = 'select-return';
const QUERY = /^Flights from ([A-Z]{3}) to ([A-Z]{3}) on (\d{4}-\d{2}-\d{2}) returning (\d{4}-\d{2}-\d{2})$/;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const afterSchema = z
  .object({
    url: z.string(),
    documentLoadsBefore: z.number(),
    documentLoads: z.number(),
    urlChanged: z.boolean().nullable(),
    changedFromPreClick: z.boolean().nullable(),
    settled: z.boolean(),
    classification: z.object({ kind: z.string(), rule: z.string() }),
    names: z.array(z.string().nullable()).nullable(),
    form: z.unknown(),
    headings: z.array(z.string()).nullable(),
    buttonNames: z.array(z.string()).nullable(),
    linkNames: z.array(z.string()).nullable(),
    tabNames: z.array(z.string()).nullable(),
    booking: z
      .object({ headingLevels: z.array(z.number()), roleCounts: z.record(z.string(), z.number()) })
      .nullable()
      .optional(),
  })
  .loose();
const factsSchema = z
  .object({
    hops: z.array(z.string()),
    best: z.object({ page: z.object({ resultLinks: z.number() }).loose() }).loose(),
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
 * What the recordings of 2026-11-01 showed, by key (counts, booleans and salted hashes only): the first view's links, the
 * return view's options, the booking view's offers and headings per level, whether the cheapest offer's price equals the
 * return's "From" price, and a hash of the two picks' names.
 */
const PINS: Readonly<
  Record<
    string,
    {
      best: number;
      returns: number;
      offers: number;
      headingLevels: number[];
      cheapestOfferAtFrom: boolean;
      picks: string;
      /** The expansion (Ian's ruling of 2026-11-01), on the recordings that ran it: offers after, further controls. */
      expanded?: { offers: number; furtherMore: number; cheapestVsFrom: string };
    }
  >
> = {
  'select-return/2026-11-01/1': {
    best: 25,
    returns: 6,
    offers: 6,
    headingLevels: [1, 3, 4, 1, 0, 0],
    cheapestOfferAtFrom: false,
    picks: '50a5dc9ebb51abae',
  },
  'select-return/2026-11-01/2': {
    best: 12,
    returns: 3,
    offers: 5,
    headingLevels: [1, 3, 1, 1, 0, 0],
    cheapestOfferAtFrom: true,
    picks: 'b9b4dc417f989ee2',
  },
  'select-return/2026-11-01/3': {
    best: 25,
    returns: 6,
    offers: 6,
    headingLevels: [1, 3, 4, 1, 0, 0],
    cheapestOfferAtFrom: false,
    picks: 'cfbcd5fd020d2f2b',
    expanded: { offers: 23, furtherMore: 0, cheapestVsFrom: 'equal' },
  },
  'select-return/2026-11-01/4': {
    best: 12,
    returns: 5,
    offers: 5,
    headingLevels: [1, 3, 1, 1, 0, 0],
    cheapestOfferAtFrom: true,
    picks: 'a5db91894d52f047',
    expanded: { offers: 19, furtherMore: 0, cheapestVsFrom: 'equal' },
  },
};

const OFFER_PRICE = /for ([\d,]+) [A-Za-z ]+$/;
// why: the review and the 21.0 Lows: minor units by the currency's ISO 4217 exponent, through the worker's one pence
// helper (every recorded offer states British pounds)
const pence = (s: string): number => minorOf(s, 'GBP') ?? Number.NaN;
const offersOf = (names: readonly string[]): string[] => names.filter((b) => SELECTORS.booking.offer.test(b));

beforeEach(() => {
  expect.hasAssertions();
});

const present = recordingsPresentForKind(RECORDED_ROOT, KIND);
describe.skipIf(!present && !RECORDINGS_REQUIRED)(
  skipTitle('recorded select-return pages (the booking research)', present),
  () => {
    const all = recorded();
    it('the pinned recordings are there, with their counts, levels, price equality and picks as pinned', () => {
      // why: test-r3-003: with RECORDINGS_REQUIRED=1 an absent kind fails here instead of skipping
      expect(present).toBe(true);
      for (const [key, pin] of Object.entries(PINS)) {
        const r = all.find((x) => x.key === key);
        expect(r, key).toBeDefined();
        if (r === undefined) continue;
        const [out, ret] = r.facts.steps.map((s) => s.after);
        const offers = offersOf(ret?.buttonNames ?? []);
        const from = parseOptionName(r.facts.picks[1]?.name ?? '')?.amountMinor;
        expect(r.facts.best.page.resultLinks, key).toBe(pin.best);
        expect(out?.names?.length, key).toBe(pin.returns);
        expect(offers.length, key).toBe(pin.offers);
        expect(ret?.booking?.headingLevels, key).toEqual(pin.headingLevels);
        expect(Math.min(...offers.map((b) => pence(OFFER_PRICE.exec(b)?.[1] ?? '0'))) === from, key).toBe(
          pin.cheapestOfferAtFrom,
        );
        expect(
          pinOf(
            r.contentSha256,
            r.facts.picks.map((p) => p.name),
          ),
          key,
        ).toBe(pin.picks);
        const more = r.facts.steps[2]?.after;
        expect(
          more === undefined
            ? undefined
            : {
                offers: offersOf(more.buttonNames ?? []).length,
                furtherMore: (more.buttonNames ?? []).filter((b) => SELECTORS.booking.moreOptions.test(b))
                  .length,
                cheapestVsFrom: Reflect.get(Reflect.get(more, 'expansion') ?? {}, 'cheapestVsFrom'),
              },
          key,
        ).toEqual(pin.expanded);
      }
    });
    // why: Ian's ruling of 2026-11-01 (open "more booking options"): the expansion in-app on the booking path, more offers
    // after it than before, none of them "From", no further control, the cheapest at the return's price, no dialog
    it('the expansion, where it ran: in-app, more offers, the cheapest at the return’s price, nothing further', () => {
      for (const r of all) {
        const step = r.facts.steps[2];
        if (step === undefined) continue;
        const before = r.facts.steps[1]?.after;
        const after = step.after;
        if (before === undefined || after === undefined) throw new Error(`${r.key}: no expansion view`);
        const from = parseOptionName(r.facts.picks[1]?.name ?? '')?.amountMinor;
        const offers = offersOf(after.buttonNames ?? []);
        expect([step.step, step.activation], r.key).toEqual(['more-options', 'keyboard']);
        expect([after.documentLoadsBefore, after.documentLoads, after.urlChanged], r.key).toEqual([
          1,
          1,
          false,
        ]);
        expect([after.settled, after.changedFromPreClick], r.key).toEqual([true, true]);
        expect(new URL(after.url).pathname, r.key).toBe(SELECTORS.booking.path);
        expect(offers.length, r.key).toBeGreaterThan(offersOf(before.buttonNames ?? []).length);
        expect(
          offers.every((b) => !/\bFrom\b/.test(b)),
          r.key,
        ).toBe(true);
        expect(Math.min(...offers.map((b) => pence(OFFER_PRICE.exec(b)?.[1] ?? '0'))), r.key).toBe(from);
        expect(
          (after.buttonNames ?? []).some((b) => SELECTORS.booking.moreOptions.test(b)),
          r.key,
        ).toBe(false);
        expect([after.booking?.roleCounts.dialog, after.booking?.roleCounts.alertdialog], r.key).toEqual([
          0, 0,
        ]);
      }
    });
    it('both selections in-app by keyboard; the booking view on its own path, classified as such, SOCS the same', () => {
      for (const r of all) {
        expect(
          r.facts.steps.slice(0, 2).map((s) => [s.step, s.activation]),
          r.key,
        ).toEqual([
          ['first-selection', 'keyboard'],
          ['return-selection', 'keyboard'],
        ]);
        const [out, ret] = r.facts.steps.map((s) => s.after);
        if (out === undefined || ret === undefined) throw new Error(`${r.key}: a step has no after`);
        expect(
          [out.documentLoadsBefore, out.documentLoads, ret.documentLoadsBefore, ret.documentLoads],
          r.key,
        ).toEqual([1, 1, 1, 1]);
        expect([ret.settled, ret.changedFromPreClick, ret.urlChanged], r.key).toEqual([true, true, true]);
        expect(ret.classification, r.key).toEqual({ kind: 'blocked', rule: 'booking-view' });
        expect(new URL(ret.url).pathname, r.key).toBe('/travel/flights/booking');
        expect([r.documentLoads, r.facts.socsReadBack], r.key).toEqual([1, 'same']);
      }
    });
    it('the booking view: stated prices on every offer, never "From", none below the return’s, a more-options control, no tab or dialog', () => {
      for (const r of all) {
        const ret = r.facts.steps[1]?.after;
        if (ret === undefined) throw new Error(`${r.key}: no booking view`);
        const offers = offersOf(ret.buttonNames ?? []);
        const from = parseOptionName(r.facts.picks[1]?.name ?? '')?.amountMinor ?? 0;
        expect(offers.length, r.key).toBeGreaterThan(0);
        expect(
          offers.every((b) => OFFER_PRICE.test(b) && !/\bFrom\b/.test(b)),
          r.key,
        ).toBe(true);
        expect(
          Math.min(...offers.map((b) => pence(OFFER_PRICE.exec(b)?.[1] ?? '0'))),
          r.key,
        ).toBeGreaterThanOrEqual(from);
        expect(
          (ret.buttonNames ?? []).some((b) => /more booking options/i.test(b)),
          r.key,
        ).toBe(true);
        expect(
          [ret.tabNames?.length, ret.booking?.roleCounts.dialog, ret.booking?.roleCounts.alertdialog],
          r.key,
        ).toEqual([0, 0, 0]);
      }
    });
    it('the request persists: one passenger, both dates named on the booking view, the form not read there', () => {
      for (const r of all) {
        const ret = r.facts.steps[1]?.after;
        if (ret === undefined) throw new Error(`${r.key}: no booking view`);
        const named = [...(ret.headings ?? []), ...(ret.buttonNames ?? []), ...(ret.linkNames ?? [])];
        const shows = (iso: string): boolean => {
          const month = MONTHS[Number(iso.slice(5, 7)) - 1] ?? '';
          const day = Number(iso.slice(8, 10));
          return named.some((x) => x.includes(`${month} ${day}`) || x.includes(`${day} ${month}`));
        };
        expect([shows(r.departureDate), shows(r.returnDate)], r.key).toEqual([true, true]);
        expect(
          (ret.buttonNames ?? []).some((b) => /^1 passenger\b(?!s)/.test(b)),
          r.key,
        ).toBe(true);
        expect(ret.form, r.key).toBeNull();
      }
    });
  },
);
