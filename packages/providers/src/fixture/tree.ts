import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type IsoDate, toEpochDay } from '@gmt/core';
import { z } from 'zod';
import { isRecord, parseOrThrow } from '../util.js';

const HHMM = /^\d{2}:\d{2}$/;
const minorInt = (min = 0) => z.number().int().min(min);

/** `calendar/<O>-<D>.json`: parameters of the deterministic synthetic price formula. */
const calendarPairSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  baseMinor: minorInt(),
  weekdayStepMinor: minorInt(),
  perNightMinor: minorInt(),
  noFaresNights: z.array(z.number().int()),
  noDataNights: z.array(z.number().int()),
  pageSize: minorInt(1).optional(),
});
export type CalendarPairFile = z.output<typeof calendarPairSchema>;

const legSchema = z.object({
  flightNumber: z.string().regex(/^\d{1,4}$/),
  depart: z.string().regex(HHMM),
  arrive: z.string().regex(HHMM),
  arriveDayOffset: minorInt(),
});
export type LegTemplate = z.output<typeof legSchema>;

const optionSchema = z.object({
  seller: z.string().min(1),
  carrier: z.string().regex(/^[A-Z0-9]{2}$/),
  outbound: legSchema,
  inbound: legSchema,
  priceDeltaMinor: minorInt(),
  cabinBagIncluded: z.boolean(),
  checkedBags: minorInt(),
});
export type OptionTemplate = z.output<typeof optionSchema>;

/** `itinerary/<O>-<D>.json`: offer templates placed on a cell's dates; `chain` makes verification three steps. */
const itineraryPairSchema = z.object({
  chain: z.boolean().default(false),
  options: z.array(optionSchema).min(1),
});
export type ItineraryPairFile = z.output<typeof itineraryPairSchema>;

export interface FixtureTree {
  root: string;
  calendar: Map<string, CalendarPairFile>;
  itinerary: Map<string, ItineraryPairFile>;
}

const TREE_SUFFIX = `${sep}fixtures${sep}synthetic${sep}fixture`;
const PAIR_FILE = /^[A-Z]{3}-[A-Z]{3}\.json$/;

/** Absolute path of this package's synthetic tree (works from src/ and dist/). */
export function defaultFixtureRoot(): string {
  return fileURLToPath(new URL('../../fixtures/synthetic/fixture', import.meta.url));
}

/** The formula price for a cell: base + weekday step × (epoch day mod 7) + nights × per-night. */
export function calendarPriceMinor(file: CalendarPairFile, departureDate: IsoDate, nights: number): number {
  return (
    file.baseMinor + (toEpochDay(departureDate) % 7) * file.weekdayStepMinor + nights * file.perNightMinor
  );
}

function readPairs(dir: string): Array<{ pair: string; file: string; json: unknown }> {
  return readdirSync(dir)
    .filter((n) => PAIR_FILE.test(n))
    .sort()
    .map((n) => {
      const file = join(dir, n);
      const json: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!isRecord(json) || json.synthetic !== true)
        throw new Error(`refusing ${file}: every fixture-tree file carries "synthetic": true (spec §5.5)`);
      return { pair: n.slice(0, 7), file, json };
    });
}

/**
 * Loads and validates the synthetic tree. Refuses any root other than …/fixtures/synthetic/fixture (after realpath,
 * so a symlink cannot point it at the recorded tree) and any file without `"synthetic": true`. Spec §5.5, §9 item 2.
 */
export function loadFixtureTree(root: string): FixtureTree {
  const real = realpathSync(root);
  if (!real.endsWith(TREE_SUFFIX))
    throw new Error(
      `refusing fixture tree ${root}: the fixture provider reads only fixtures/synthetic/fixture (spec §5.5)`,
    );
  const calendar = new Map<string, CalendarPairFile>();
  for (const { pair, file, json } of readPairs(join(real, 'calendar')))
    calendar.set(pair, parseOrThrow(calendarPairSchema, json, file));
  const itinerary = new Map<string, ItineraryPairFile>();
  for (const { pair, file, json } of readPairs(join(real, 'itinerary')))
    itinerary.set(pair, parseOrThrow(itineraryPairSchema, json, file));
  return { root: real, calendar, itinerary };
}
