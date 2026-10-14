import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../util.js';
import { epochDayOf } from './dates.js';

/** `calendar/<O>-<D>.json`: parameters of the deterministic synthetic price formula. */
export interface CalendarPairFile {
  currency: string;
  baseMinor: number;
  weekdayStepMinor: number;
  perNightMinor: number;
  noFaresNights: number[];
  noDataNights: number[];
  pageSize?: number;
}
export interface LegTemplate {
  flightNumber: string;
  depart: string;
  arrive: string;
  arriveDayOffset: number;
}
export interface OptionTemplate {
  seller: string;
  carrier: string;
  outbound: LegTemplate;
  inbound: LegTemplate;
  priceDeltaMinor: number;
  cabinBagIncluded: boolean;
  checkedBags: number;
}
/** `itinerary/<O>-<D>.json`: offer templates placed on a cell's dates; `chain` makes verification three steps. */
export interface ItineraryPairFile {
  chain: boolean;
  options: OptionTemplate[];
}
export interface FixtureTree {
  root: string;
  calendar: Map<string, CalendarPairFile>;
  itinerary: Map<string, ItineraryPairFile>;
}

const TREE_SUFFIX = `${sep}fixtures${sep}synthetic${sep}fixture`;
const PAIR_FILE = /^[A-Z]{3}-[A-Z]{3}\.json$/;
const HHMM = /^\d{2}:\d{2}$/;

/** Absolute path of this package's synthetic tree (works from src/ and dist/). */
export function defaultFixtureRoot(): string {
  return fileURLToPath(new URL('../../fixtures/synthetic/fixture', import.meta.url));
}

/** The formula price for a cell: base + weekday step × (epoch day mod 7) + nights × per-night. */
export function calendarPriceMinor(file: CalendarPairFile, departureDate: string, nights: number): number {
  return (
    file.baseMinor + (epochDayOf(departureDate) % 7) * file.weekdayStepMinor + nights * file.perNightMinor
  );
}

type Obj = Record<string, unknown>;
function int(o: Obj, k: string, where: string, min = 0): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min)
    throw new Error(`${where}: ${k} must be an integer ≥ ${min}`);
  return v;
}
function str(o: Obj, k: string, where: string, re?: RegExp): string {
  const v = o[k];
  if (typeof v !== 'string' || v === '' || (re !== undefined && !re.test(v)))
    throw new Error(`${where}: ${k} is missing or malformed`);
  return v;
}
function ints(o: Obj, k: string, where: string): number[] {
  const v = o[k];
  if (!Array.isArray(v)) throw new Error(`${where}: ${k} must be an integer array`);
  const out: number[] = [];
  for (const x of v) {
    if (typeof x !== 'number' || !Number.isInteger(x))
      throw new Error(`${where}: ${k} must be an integer array`);
    out.push(x);
  }
  return out;
}
function obj(o: Obj, k: string, where: string): Obj {
  const v = o[k];
  if (!isRecord(v)) throw new Error(`${where}: ${k} must be an object`);
  return v;
}
function bool(o: Obj, k: string, where: string, fallback?: boolean): boolean {
  const v = o[k];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'boolean') throw new Error(`${where}: ${k} must be a boolean`);
  return v;
}
function leg(o: Obj, where: string): LegTemplate {
  return {
    flightNumber: str(o, 'flightNumber', where, /^\d{1,4}$/),
    depart: str(o, 'depart', where, HHMM),
    arrive: str(o, 'arrive', where, HHMM),
    arriveDayOffset: int(o, 'arriveDayOffset', where),
  };
}

function readPairs(dir: string): Array<{ pair: string; file: string; json: Obj }> {
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
  for (const { pair, file, json } of readPairs(join(real, 'calendar'))) {
    calendar.set(pair, {
      currency: str(json, 'currency', file, /^[A-Z]{3}$/),
      baseMinor: int(json, 'baseMinor', file),
      weekdayStepMinor: int(json, 'weekdayStepMinor', file),
      perNightMinor: int(json, 'perNightMinor', file),
      noFaresNights: ints(json, 'noFaresNights', file),
      noDataNights: ints(json, 'noDataNights', file),
      ...(json.pageSize === undefined ? {} : { pageSize: int(json, 'pageSize', file, 1) }),
    });
  }
  const itinerary = new Map<string, ItineraryPairFile>();
  for (const { pair, file, json } of readPairs(join(real, 'itinerary'))) {
    const options = json.options;
    if (!Array.isArray(options) || options.length === 0)
      throw new Error(`${file}: options must be a non-empty array`);
    itinerary.set(pair, {
      chain: bool(json, 'chain', file, false),
      options: options.map((raw: unknown, i) => {
        const where = `${file} options[${i}]`;
        if (!isRecord(raw)) throw new Error(`${where}: not an object`);
        return {
          seller: str(raw, 'seller', where),
          carrier: str(raw, 'carrier', where, /^[A-Z0-9]{2}$/),
          outbound: leg(obj(raw, 'outbound', where), `${where}.outbound`),
          inbound: leg(obj(raw, 'inbound', where), `${where}.inbound`),
          priceDeltaMinor: int(raw, 'priceDeltaMinor', where),
          cabinBagIncluded: bool(raw, 'cabinBagIncluded', where),
          checkedBags: int(raw, 'checkedBags', where),
        };
      }),
    });
  }
  return { root: real, calendar, itinerary };
}
