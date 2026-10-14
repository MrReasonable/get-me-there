import {
  apiContract,
  asIata,
  asIsoDate,
  asIsoDateTime,
  type BaggageSnapshot,
  type Booking,
  type Cabin,
  type CellKey,
  type Estimate,
  type FareConditions,
  type Iata,
  type IsoDate,
  type IsoDateTime,
  type Layover,
  type SuppliedField,
  type VerificationPolicy,
} from '@gmt/core';
import { CABINS, SUPPLIED_FIELDS } from './enums.js';

/** A stored value that does not parse as its type: corruption is reported, never passed through (dm-006). */
export class RowCorrupt extends Error {
  readonly column: string;
  constructor(column: string, detail: string) {
    super(`stored ${column} is not valid: ${detail}`);
    this.name = 'RowCorrupt';
    this.column = column;
  }
}

function mint<T>(column: string, v: string, f: (s: string) => T): T {
  try {
    return f(v);
  } catch (err) {
    throw new RowCorrupt(column, err instanceof Error ? err.message : String(err));
  }
}
export const readIata = (column: string, v: string): Iata => mint(column, v, asIata);
export const readDate = (column: string, v: string): IsoDate => mint(column, v, asIsoDate);
export const readTime = (column: string, v: string): IsoDateTime => mint(column, v, asIsoDateTime);
export const readNullableTime = (column: string, v: string | null): IsoDateTime | null =>
  v === null ? null : readTime(column, v);

/** Narrows a stored string to a member of a typed constant list. */
export function oneOf<T extends string>(column: string, values: readonly T[], v: string): T {
  const hit = values.find((x) => x === v);
  if (hit === undefined) throw new RowCorrupt(column, `unexpected value ${v}`);
  return hit;
}
export function nullableOneOf<T extends string>(
  column: string,
  values: readonly T[],
  v: string | null,
): T | null {
  return v === null ? null : oneOf(column, values, v);
}

export function readJson(column: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new RowCorrupt(column, 'not JSON');
  }
}
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Parses through a core zod schema (anything with `parse`), reporting the column on failure. */
export function parseWith<T>(column: string, schema: { parse(v: unknown): T }, v: unknown): T {
  try {
    return schema.parse(v);
  } catch (err) {
    throw new RowCorrupt(column, err instanceof Error ? err.message : String(err));
  }
}

export function readStringArray(column: string, v: unknown): string[] {
  if (!Array.isArray(v)) throw new RowCorrupt(column, 'not an array');
  return v.map((x) => {
    if (typeof x !== 'string') throw new RowCorrupt(column, 'array member is not a string');
    return x;
  });
}
export const readIataArray = (column: string, v: unknown): Iata[] =>
  readStringArray(column, v).map((s) => readIata(column, s));
export const readCabins = (column: string, v: unknown): Cabin[] =>
  readStringArray(column, v).map((s) => oneOf(column, CABINS, s));
export const readSuppliedFields = (column: string, v: unknown): SuppliedField[] =>
  readStringArray(column, v).map((s) => oneOf(column, SUPPLIED_FIELDS, s));

export function readInt(column: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new RowCorrupt(column, 'expected an integer');
  return v;
}
export function readBool(column: string, v: unknown): boolean {
  if (typeof v !== 'boolean') throw new RowCorrupt(column, 'expected a boolean');
  return v;
}
export function readString(column: string, v: unknown): string {
  if (typeof v !== 'string') throw new RowCorrupt(column, 'expected a string');
  return v;
}

export function readLayovers(column: string, v: unknown): Layover[] {
  if (!Array.isArray(v)) throw new RowCorrupt(column, 'not an array');
  return v.map((x) => {
    if (!isRecord(x) || typeof x.at !== 'string') throw new RowCorrupt(column, 'bad layover');
    return {
      at: readIata(column, x.at),
      minutes: readInt(column, x.minutes),
      overnight: readBool(column, x.overnight),
      airportChange: readBool(column, x.airportChange),
    };
  });
}

export function readCellKey(column: string, v: unknown): CellKey {
  if (
    !isRecord(v) ||
    typeof v.origin !== 'string' ||
    typeof v.destination !== 'string' ||
    typeof v.departureDate !== 'string' ||
    typeof v.returnDate !== 'string'
  ) {
    throw new RowCorrupt(column, 'bad cell key');
  }
  return {
    origin: readIata(column, v.origin),
    destination: readIata(column, v.destination),
    departureDate: readDate(column, v.departureDate),
    returnDate: readDate(column, v.returnDate),
  };
}

function notes(column: string, v: unknown): { notes?: string[] } {
  return v === undefined ? {} : { notes: readStringArray(column, v) };
}
export function readBaggage(column: string, v: unknown): BaggageSnapshot {
  if (!isRecord(v)) throw new RowCorrupt(column, 'bad baggage');
  const cabinBag =
    v.cabinBag === undefined
      ? {}
      : {
          cabinBag: oneOf(
            column,
            ['included', 'not-included'],
            typeof v.cabinBag === 'string' ? v.cabinBag : '',
          ),
        };
  const checkedBags = v.checkedBags === undefined ? {} : { checkedBags: readInt(column, v.checkedBags) };
  return { ...cabinBag, ...checkedBags, ...notes(column, v.notes) };
}
export function readFareConditions(column: string, v: unknown): FareConditions {
  if (!isRecord(v)) throw new RowCorrupt(column, 'bad fare conditions');
  const refundable = v.refundable === undefined ? {} : { refundable: readBool(column, v.refundable) };
  const changeable = v.changeable === undefined ? {} : { changeable: readBool(column, v.changeable) };
  return { ...refundable, ...changeable, ...notes(column, v.notes) };
}
export const readBooking = (column: string, text: string): Booking =>
  parseWith(column, apiContract.bookingSchema, readJson(column, text));
export const readEstimate = (column: string, text: string): Estimate =>
  parseWith(column, apiContract.estimateSchema, readJson(column, text));

/**
 * A stored verification policy, read field by field. // why: core's policy schema refines topN ≤ maxCells and
 * alwaysInclude ≤ maxCells, which are save-time policy; a stored row (a child snapshot with maxCells 1 and an
 * inherited topN, spec §8.1) must read back as stored (arch-r2-003, dm-r2-001).
 */
export function readVerificationPolicy(column: string, v: unknown): VerificationPolicy {
  if (!isRecord(v) || !Array.isArray(v.alwaysInclude))
    throw new RowCorrupt(column, 'not a verification policy');
  return {
    maxCells: readInt(column, v.maxCells),
    topN: readInt(column, v.topN),
    expandTop: readInt(column, v.expandTop),
    bookingLinks: readBool(column, v.bookingLinks),
    alwaysInclude: v.alwaysInclude.map((x: unknown) => readCellKey(column, x)),
    ...(v.priceCeilingPence === undefined ? {} : { priceCeilingPence: readInt(column, v.priceCeilingPence) }),
    ...(v.perDepartureDateBest === undefined
      ? {}
      : { perDepartureDateBest: readInt(column, v.perDepartureDateBest) }),
    ...(v.maxStops === undefined ? {} : { maxStops: readInt(column, v.maxStops) }),
  };
}
