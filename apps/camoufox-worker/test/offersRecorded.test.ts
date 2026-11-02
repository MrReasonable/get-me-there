// The recorded booking views (WP21 Task 21.3; decision 61: local-only and gitignored, so the suite runs only where the
// recordings exist and otherwise reports itself skipped; with RECORDINGS_REQUIRED=1 their absence fails). It reads
// select-return/2026-11-01/1–4 (1 and 2 for the booking view's classify and shape only; 3 and 4, which ran the
// expansion, for the offers) and the end-to-end recording (R-e2e: marked `forceSecond`). Structural pins only: counts
// and booleans. No page text, price, seller or name appears here.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recordingsPresentForKind, skipTitle } from '@gmt/providers/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { classifyPageWithRule, type PageFacts } from '../src/classify.js';
import { parseOptionName } from '../src/names.js';
import { readOffers } from '../src/offers.js';
import { SELECTORS } from '../src/selectors.js';
import { RECORDED_ROOT, RECORDINGS_REQUIRED } from './support/recordedList.js';

const KIND = 'select-return';
const RESEARCH = [
  'select-return/2026-11-01/1',
  'select-return/2026-11-01/2',
  'select-return/2026-11-01/3',
  'select-return/2026-11-01/4',
];
/** The research recordings that ran the expansion. */
const EXPANDED = ['select-return/2026-11-01/3', 'select-return/2026-11-01/4'];

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
        priceRangeHeading: z.boolean().exactOptional(),
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
const afterSchema = z
  .object({
    page: pageSchema,
    headings: z.array(z.string()).nullable(),
    buttonNames: z.array(z.string()).nullable(),
  })
  .loose();
const factsSchema = z
  .object({
    picks: z.array(z.object({ name: z.string() })),
    steps: z.array(z.object({ step: z.string(), after: afterSchema.optional() }).loose()),
    forceSecond: z.boolean().optional(),
  })
  .loose();

interface Recorded {
  key: string;
  facts: z.infer<typeof factsSchema>;
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
      .sort())
      out.push({
        key: `${KIND}/${day}/${f.replace(/\.facts\.json$/, '')}`,
        facts: factsSchema.parse(JSON.parse(readFileSync(join(dir, day, f), 'utf8'))),
      });
  return out;
}

/**
 * Per expansion recording (counts and booleans only): the grouped controls and a further expansion control after the
 * expansion (as the Task 21.0 suite pinned them), and whether the cheapest offer equals the selected return's "From"
 * price (true on both today: a changed value on re-recording is a finding for the controller, not a bug).
 */
const PINS: Readonly<Record<string, { grouped: number; moreControl: boolean; cheapestAtFrom: boolean }>> = {
  'select-return/2026-11-01/3': { grouped: 1, moreControl: false, cheapestAtFrom: true },
  'select-return/2026-11-01/4': { grouped: 0, moreControl: false, cheapestAtFrom: true },
};
const ON = { ...SELECTORS, RETURN_SELECT_VERIFIED: true, BOOKING_SELECT_VERIFIED: true };

/**
 * A booking view's facts as the driver now reads them: the recordings predate the price-range fact, so it is derived
 * from the recorded heading names by the dated pattern (the driver's own read).
 */
function bookingPage(a: z.infer<typeof afterSchema>): PageFacts {
  return {
    ...a.page,
    text: {
      ...a.page.text,
      priceRangeHeading: (a.headings ?? []).some((h) => SELECTORS.booking.priceRangeHeading.test(h)),
    },
  };
}
/** The booking view's offers as `bookingFacts` reads them, from the recorded button names. */
function bookingFacts(a: z.infer<typeof afterSchema>) {
  const buttons = a.buttonNames ?? [];
  return {
    offerNames: buttons.filter((b) => SELECTORS.booking.offer.test(b)),
    moreOptions: buttons.filter((b) => SELECTORS.booking.moreOptions.test(b)).length,
    grouped: buttons.filter((b) => SELECTORS.booking.grouped.test(b)).length,
  };
}

beforeEach(() => {
  expect.hasAssertions();
});

const present = recordingsPresentForKind(RECORDED_ROOT, KIND);
describe.skipIf(!present && !RECORDINGS_REQUIRED)(
  skipTitle('recorded booking views (WP21 Task 21.3)', present),
  () => {
    const all = recorded();
    const research = all.filter((r) => RESEARCH.includes(r.key));
    const e2e = all.filter((r) => r.facts.forceSecond === true);
    const after = (r: Recorded, step: string) => r.facts.steps.find((s) => s.step === step)?.after;
    it('the recordings are there: the research keys, and the end-to-end recording where it is required', () => {
      expect(present).toBe(true);
      expect(research.map((r) => r.key)).toEqual(RESEARCH);
      if (RECORDINGS_REQUIRED) expect(e2e.length).toBeGreaterThan(0);
    });
    it('the dated booking branch classifies every settled booking view as the booking view', () => {
      for (const r of [...research, ...e2e])
        for (const step of ['return-selection', 'more-options']) {
          const a = after(r, step);
          if (a === undefined) continue;
          expect(classifyPageWithRule(bookingPage(a), ON, 'booking'), `${r.key} ${step}`).toEqual({
            kind: { kind: 'results' },
            rule: 'booking',
          });
        }
    });
    it('readOffers over each expanded view: every offer read, none "From", the controls and the cheapest as pinned', () => {
      for (const r of [...research.filter((x) => EXPANDED.includes(x.key)), ...e2e]) {
        const a = after(r, 'more-options');
        expect(a, r.key).toBeDefined();
        if (a === undefined) continue;
        const facts = bookingFacts(a);
        expect(facts.offerNames.length, r.key).toBeGreaterThan(0);
        expect(
          facts.offerNames.some((x) => /\bFrom\b/.test(x)),
          r.key,
        ).toBe(false);
        const read = readOffers(facts);
        expect([read.unparsed, read.nonGbp, read.allGbp], r.key).toEqual([0, 0, true]);
        expect(
          read.offers.length + (read.offersStated === null ? 0 : read.offersStated - read.offers.length),
          r.key,
        ).toBe(facts.offerNames.length);
        const fromMinor = parseOptionName(r.facts.picks.at(-1)?.name ?? '')?.amountMinor ?? null;
        const cheapest = Math.min(...read.offers.map((o) => o.priceMinor));
        const pin = PINS[r.key];
        if (pin === undefined) {
          // why: the end-to-end recording carries no pin yet; both expansion recordings of today show the equality
          expect(cheapest, r.key).toBe(fromMinor);
          continue;
        }
        expect([read.grouped, read.moreControl, cheapest === fromMinor], r.key).toEqual([
          pin.grouped,
          pin.moreControl,
          pin.cheapestAtFrom,
        ]);
      }
    });
  },
);
