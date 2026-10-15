/**
 * Travelpayouts response parsing and row attribution. Spec §2 (raw shapes, currency from the response), §5.2
 * ("Empty is per capability", "Cell keys from the response", rows filtered to the pair, vendor links), §8.1 (rows
 * dropped for a covered cell are reported per cell). Untrusted JSON is read through zod schemas (plan decision 15);
 * failures are `parseError` from the shared module (plan decision 24).
 */
import {
  type CellIssue,
  type CellKey,
  cellKeyString,
  daysBetween,
  type Iata,
  type IsoDateTime,
  iataSchema,
  isoDateSchema,
  isoDateTimeOfEpochMs,
  LINK_ALLOWLIST,
  MINOR_EXPONENT,
  type RawCalendarPrice,
  validateVendorUrl,
} from '@gmt/core';
import { z } from 'zod';
import { type ParseWhere, parseError, parseVendor } from '../shared/errors.js';
import { majorToMinor } from '../shared/money.js';
import { NoteCounter } from '../shared/notes.js';
import { zodReason } from '../util.js';
import { PRICES_FOR_DATES_PATH } from './params.js';

/** Where every Travelpayouts parse error comes from (message prefix). */
export const WHERE: ParseWhere = { providerId: 'travelpayouts', endpointPath: PRICES_FOR_DATES_PATH };

/**
 * The envelope (Library notes: `{ "currency": "rub", "data": [...], "success": true }`). Rows stay unknown here;
 * each is read by rowSchema. `success:false` carries an optional `error` string (an assumption: the docs show no
 * error body; any other shape falls to malformed-envelope).
 */
const envelopeSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: z.array(z.unknown()), currency: z.string().optional() }),
  z.object({ success: z.literal(false), error: z.unknown().optional() }),
]);

/**
 * A response currency: the ISO 4217 code and core's minor-unit exponent, or null when core does not know the
 * currency (plan decision 29: its rows are dropped per cell as `currency-unsupported`, never a tile-level error).
 */
export interface ResponseCurrency {
  code: string;
  exponent: number | null;
}

/** A checked success envelope: rows still unparsed, the currency read from the response (spec §2). */
export interface Envelope {
  rows: readonly unknown[];
  currency: ResponseCurrency;
}

/** The envelope's currency upper-cased to ISO 4217 with core's exponent (null when unknown), or why it is unreadable. */
export function currencyOf(
  raw: string | undefined,
):
  | ({ ok: true } & ResponseCurrency)
  | { ok: false; cause: 'currency-missing' | 'currency-malformed'; detail: string | null } {
  if (raw === undefined) return { ok: false, cause: 'currency-missing', detail: null };
  const code = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code))
    return { ok: false, cause: 'currency-malformed', detail: `currency ${raw.slice(0, 10)}` };
  return { ok: true, code, exponent: MINOR_EXPONENT[code] ?? null };
}

/**
 * Spec §5.2 "Empty is per capability" (authorised-cached) and §2 "a response that states no currency is a parse
 * error": a success envelope with a usable currency is returned (zero rows → the engine records every covered cell
 * no_data); `success:false` → `vendor-error` with the vendor's text as detail; anything else → `malformed-envelope`;
 * a missing or unreadable currency → `currency-missing` / `currency-malformed`. All are non-retryable `parse` errors.
 * A readable code core has no exponent for is returned with `exponent: null` (plan decision 29).
 */
export function readEnvelope(body: unknown): Envelope {
  const env = parseVendor(envelopeSchema, body, 'malformed-envelope', WHERE);
  if (!env.success)
    throw parseError(
      'vendor-error',
      typeof env.error === 'string' && env.error.length > 0 ? env.error : null,
      WHERE,
    );
  const cur = currencyOf(env.currency);
  if (!cur.ok) throw parseError(cur.cause, cur.detail, WHERE);
  return { rows: env.data, currency: { code: cur.code, exponent: cur.exponent } };
}

/**
 * The http-kit cache `accept` hook (plan decision 15): a body is cached only when readEnvelope would accept it, so a
 * `success:false`, malformed or currency-less body is never replayed from the cache inside the TTL. A currency core
 * does not know is cacheable: the body is the vendor's valid answer, and its rows are dropped per cell either way.
 */
export function cacheableBody(body: unknown): boolean {
  const env = envelopeSchema.safeParse(body);
  return env.success && env.data.success && currencyOf(env.data.currency).ok;
}

/**
 * A vendor time read as its local calendar date (spec §6.1: never through UTC). Accepted: a bare date, or a date-time
 * with an explicit offset, which is the documented form (`2021-09-14T08:55:00+03:00`). The vendor writes a zero offset
 * as `Z` (recorded: London winter times such as `2027-03-15T06:50:00Z`), so `Z` is an explicit `+00:00` offset (plan
 * decision 33). An offset-less time is refused: whether it is local or UTC cannot be told, and a UTC reading keys
 * evening flights a day late.
 * why: core's vendor-time parser (normalise/localTime.ts) is not exported and takes no bare date, so this pattern
 * checks the time part's ranges itself; the calendar date is then checked by core's isoDateSchema.
 */
const LOCAL_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/;
const localDateSchema = z
  .string()
  .regex(LOCAL_TIME)
  .transform((s) => s.slice(0, 10))
  .pipe(isoDateSchema);

/**
 * One row. The attribution fields are required and checked (an unreadable one makes the whole response `parse`,
 * because the row cannot be placed in or out of any cell); `price`, `link` and `found_at` are read leniently and
 * judged per row. Other fields (airline, flight_number, transfers, duration, and the undocumented `gate` selling
 * agency, `duration_to`, `duration_back`) are not used: unknown keys are allowed on a row (plan decision 33).
 */
const rowSchema = z.object({
  origin_airport: iataSchema,
  destination_airport: iataSchema,
  departure_at: localDateSchema,
  return_at: localDateSchema.nullish(),
  price: z.unknown(),
  link: z.unknown().optional(),
  found_at: z.unknown().optional(),
});

/** The Aviasales site the vendor's relative `link` is relative to (docs/providers.md). */
export const AVIASALES_BASE = 'https://www.aviasales.com';

/**
 * Spec §5.2 vendor links: the relative Aviasales path prefixed with the site, then checked by core's
 * validateVendorUrl against LINK_ALLOWLIST.travelpayouts (WP2). Null when refused. This is the vendor's own search
 * link for the row (it may search the metro), never a fare link; the UI's search link is core's searchLinkFor.
 * why: only a site-relative path is accepted; an absolute or protocol-relative value is refused, never resolved.
 */
export function vendorLinkFor(link: unknown): string | null {
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) return null;
  const booking = validateVendorUrl(`${AVIASALES_BASE}${link}`, LINK_ALLOWLIST.travelpayouts);
  return booking.kind === 'get' ? booking.url : null;
}

/**
 * An instant with an explicit zone, the only form a vendor observation time is taken in.
 * why: with the zone in the string, Date.parse is exact; core's toIsoDateTime needs a time kind and an airport zone.
 */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Spec §2 and §3: `providerObservedAt` only when the vendor states when the price was found. Spike fact 1 says
 * prices_for_dates rows carry no `found_at`; if a row ever does, its instant is used, else nothing is set (the
 * declared 48-hour horizon applies). An unreadable value is ignored, never guessed.
 */
export function observedAt(foundAt: unknown): IsoDateTime | null {
  if (typeof foundAt !== 'string' || !INSTANT.test(foundAt)) return null;
  const ms = Date.parse(foundAt);
  return Number.isNaN(ms) ? null : isoDateTimeOfEpochMs(ms);
}

type Row = z.infer<typeof rowSchema>;

/**
 * Where a row belongs: the pair's cell its own dates name, or the note key it is dropped under when it belongs to no
 * cell of this pair and band.
 */
function placeRow(row: Row, input: AttributionInput): { cell: CellKey } | { drop: string } {
  if (row.return_at === null || row.return_at === undefined) return { drop: 'dropped-one-way' };
  if (row.origin_airport !== input.origin) return { drop: 'dropped-other-origin' };
  if (row.destination_airport !== input.destination) return { drop: 'dropped-other-destination' };
  const nights = daysBetween(row.departure_at, row.return_at);
  if (nights < input.minNights || nights > input.maxNights) return { drop: 'dropped-outside-band' };
  return {
    cell: {
      origin: row.origin_airport,
      destination: row.destination_airport,
      departureDate: row.departure_at,
      returnDate: row.return_at,
    },
  };
}

export interface AttributionInput {
  coveredCells: readonly CellKey[];
  /** The pair's origin airport; rows from other airports of a metro response are dropped. */
  origin: Iata;
  destination: Iata;
  minNights: number;
  maxNights: number;
  currency: ResponseCurrency;
}

export interface Attribution {
  prices: RawCalendarPrice[];
  /**
   * One entry per covered cell that had rows dropped (spec §8.1): reason 'parse' (unusable price) or
   * 'currency-unsupported' (a currency core does not know), the count, a URL-free detail.
   */
  cellIssues: CellIssue[];
  /** Tile-level counts: `dropped-*`, `offers-dropped`, `link-rejected` (spec §5.2: every drop is counted). */
  notes: NoteCounter;
}

/**
 * Spec §5.2: rows are attributed by `origin_airport`, `destination_airport` and their own local dates, filtered to
 * the pair, the nights band and the covered cells. A row for another airport, another destination, a one-way row, an
 * out-of-band or uncovered date pair is dropped and counted in notes. A row for exactly a covered cell whose price is
 * unusable (not a number, not positive, or more decimals than the currency has: shared majorToMinor) is dropped,
 * counted `offers-dropped` and reported for that cell, so the engine records `error` (reason 'parse') when no other
 * row priced it, never `no_data` (spec §3, §8.1; plan decision 24).
 * Throws `parseError('malformed-row')` when a row cannot be read at all.
 */
export function attributeRows(rows: readonly unknown[], input: AttributionInput): Attribution {
  const covered = new Set(input.coveredCells.map(cellKeyString));
  const notes = new NoteCounter();
  const prices: RawCalendarPrice[] = [];
  const dropped = new Map<string, { cell: CellKey; n: number }>();
  for (const [i, raw] of rows.entries()) {
    const r = rowSchema.safeParse(raw);
    // why: not parseVendor, because the detail names the row's index so the operator can find it in the response.
    if (!r.success) throw parseError('malformed-row', `row ${i}: ${zodReason(r.error)}`, WHERE);
    const row = r.data;
    const placed = placeRow(row, input);
    if ('drop' in placed) {
      notes.add(placed.drop);
      continue;
    }
    const { cell } = placed;
    const key = cellKeyString(cell);
    if (!covered.has(key)) {
      notes.add('dropped-outside-tile');
      continue;
    }
    const amountMinor = typeof row.price === 'number' ? majorToMinor(row.price, input.currency.code) : null;
    if (amountMinor === null) {
      notes.add('offers-dropped');
      const d = dropped.get(key);
      if (d === undefined) dropped.set(key, { cell, n: 1 });
      else d.n += 1;
      continue;
    }
    const price: RawCalendarPrice = { ...cell, amountMinor, currency: input.currency.code };
    const seen = observedAt(row.found_at);
    if (seen !== null) price.providerObservedAt = seen;
    const link = vendorLinkFor(row.link);
    if (link !== null) price.vendorLink = link;
    else if (row.link !== undefined && row.link !== null) notes.add('link-rejected');
    prices.push(price);
  }
  const { code, exponent } = input.currency;
  const rowsWord = (n: number): string => `${n} row${n === 1 ? '' : 's'}`;
  const cellIssues = [...dropped.values()].map(
    ({ cell, n }): CellIssue =>
      exponent === null
        ? {
            cell,
            reason: 'currency-unsupported',
            offersDropped: n,
            detail: `travelpayouts: ${rowsWord(n)} for this cell priced in ${code}, which has no known minor unit [currency-unsupported]`,
          }
        : {
            cell,
            reason: 'parse',
            offersDropped: n,
            detail: `travelpayouts: ${rowsWord(n)} for this cell had no usable ${code} price (not a positive amount with at most ${exponent} decimals) [bad-price]`,
          },
  );
  return { prices, cellIssues, notes };
}
