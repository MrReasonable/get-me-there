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
import {
  IN_APP_E2E,
  inAppEvidence,
  metaOf,
  RECORDED_ROOT,
  RECORDINGS_REQUIRED,
} from './support/recordedList.js';

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
    // why: kept readable for the recordings that name them; the booking view is never recognised by a heading (the
    // controller's ruling of 2026-11-02: the price-comparison note's wording follows the fare)
    headings: z.array(z.string()).nullable(),
    buttonNames: z.array(z.string()).nullable(),
    // why: review M9: the booking view's buttons in main (the driver's scope), recorded from WP21 Task 21.3 on
    mainButtonNames: z.array(z.string()).nullable().optional(),
  })
  .loose();
const factsSchema = z
  .object({
    picks: z.array(z.object({ name: z.string() })),
    // why: review I2: the step's held word and the guard's counts are named (inAppEvidence requires them)
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

interface Recorded {
  key: string;
  facts: z.infer<typeof factsSchema>;
  raw: unknown;
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
      const raw: unknown = JSON.parse(readFileSync(join(dir, day, f), 'utf8'));
      out.push({
        key: `${KIND}/${day}/${f.replace(/\.facts\.json$/, '')}`,
        facts: factsSchema.parse(raw),
        raw,
      });
    }
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

/** What the three booking patterns read of a list of button names (offers by name, the two controls counted). */
function patterns(buttons: readonly string[]) {
  return {
    offerNames: buttons.filter((b) => SELECTORS.booking.offer.test(b)),
    moreOptions: buttons.filter((b) => SELECTORS.booking.moreOptions.test(b)).length,
    grouped: buttons.filter((b) => SELECTORS.booking.grouped.test(b)).length,
  };
}
/**
 * The booking view's offers as `bookingFacts` reads them (buttons in main, review M9): from the recorded main-scoped
 * names where the recording has them (the end-to-end recording on), else from the page's (the research recordings of
 * 2026-11-01, which predate the main-scoped read).
 */
function bookingFacts(a: z.infer<typeof afterSchema>) {
  return patterns(a.mainButtonNames ?? a.buttonNames ?? []);
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
          expect(classifyPageWithRule(a.page, ON, 'booking'), `${r.key} ${step}`).toEqual({
            kind: { kind: 'results' },
            rule: 'booking',
          });
        }
    });
    // why: the controller's ruling on review I2, as in returnsRecorded: the activations' in-app evidence can fail
    it('the end-to-end recording: no gate refusal and no held navigation on any step; only the reload started a document', () => {
      expect(e2e.length > 0 || !RECORDINGS_REQUIRED, 'the end-to-end recording').toBe(true);
      for (const r of e2e) expect(inAppEvidence(r.raw, metaOf(r.key)), r.key).toEqual(IN_APP_E2E);
    });
    // why: review M9: on the end-to-end recording the replay reads main as the driver does, and no button outside main
    // matches an offer, expansion or grouped pattern (the page's and main's pattern reads agree)
    it('the end-to-end recording’s booking views: the main-scoped names recorded, no pattern match outside main', () => {
      expect(e2e.length > 0 || !RECORDINGS_REQUIRED, 'the end-to-end recording').toBe(true);
      for (const r of e2e)
        for (const step of ['return-selection', 'more-options']) {
          const a = after(r, step);
          expect(a?.mainButtonNames, `${r.key} ${step}`).toBeTruthy();
          expect(patterns(a?.buttonNames ?? []), `${r.key} ${step}`).toEqual(
            patterns(a?.mainButtonNames ?? []),
          );
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
