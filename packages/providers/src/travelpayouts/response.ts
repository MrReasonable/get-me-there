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
  toEpochDay,
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
 * because the row cannot be placed in or out of any cell); `price` and `link` are read leniently and
 * judged per row. Other fields (airline, flight_number, transfers, duration, `duration_to`, `duration_back`, and the undocumented
 * `gate` selling agency) are not used: unknown keys are allowed on a row (plan decision 33).
 */
const rowSchema = z.object({
  origin_airport: iataSchema,
  destination_airport: iataSchema,
  departure_at: localDateSchema,
  return_at: localDateSchema.nullish(),
  price: z.unknown(),
  link: z.unknown().optional(),
});

/** The Aviasales site the vendor's relative `link` is relative to (docs/providers.md). */
export const AVIASALES_BASE = 'https://www.aviasales.com';

/**
 * The one guarded reading of a vendor `link` (plan decision 35): a site-relative path only, as a URL on the Aviasales
 * site, or null. `//` and `/\` prefixes are refused because they mean another host, and `new URL` is wrapped so a
 * malformed value is a null, never an unclassified throw out of fetchTile.
 */
function parseLink(link: unknown): URL | null {
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//') || link.startsWith('/\\')) {
    return null;
  }
  try {
    const url = new URL(link, AVIASALES_BASE);
    // why: the WHATWG parser strips tabs and newlines, so `/\t/evil` passes the prefix checks and parses as another host.
    return url.origin === AVIASALES_BASE ? url : null;
  } catch {
    return null;
  }
}

/**
 * Spec §5.2 vendor links: the relative Aviasales path prefixed with the site, then checked by core's
 * validateVendorUrl against LINK_ALLOWLIST.travelpayouts (WP2). Null when refused. This is the vendor's own search
 * link for the row (its search may name another airport of the same city), never a fare link; the UI's search link is
 * core's searchLinkFor.
 * why: only a site-relative path is accepted; an absolute or protocol-relative value is refused, never resolved.
 */
export function vendorLinkFor(link: unknown): string | null {
  if (parseLink(link) === null || typeof link !== 'string') return null;
  const booking = validateVendorUrl(`${AVIASALES_BASE}${link}`, LINK_ALLOWLIST.travelpayouts);
  return booking.kind === 'get' ? booking.url : null;
}

/** `search_date=DDMMYYYY` in a vendor link's query. */
const SEARCH_DATE = /^(\d{2})(\d{2})(\d{4})$/;

/**
 * Spec §3 row age (plan decision 35): the day the vendor says the price was found, from `search_date=DDMMYYYY` in the
 * row's own link, as that day at 00:00 UTC (day resolution; the vendor does not state the day's zone). Every recorded link carries it and the
 * recorded rows were 4 to 7 days old at fetch time, so the 48-hour declaration is only the fallback for a link without
 * it. Null when the link is absent, unreadable, has no search date or an impossible calendar date; nothing is guessed.
 * why: the field is undocumented by the vendor, so the replay test pins it on the recordings.
 */
export function searchedAt(link: unknown): IsoDateTime | null {
  const m = SEARCH_DATE.exec(parseLink(link)?.searchParams.get('search_date') ?? '');
  if (m === null) return null;
  const [, dd = '', mm = '', yyyy = ''] = m;
  const day = isoDateSchema.safeParse(`${yyyy}-${mm}-${dd}`);
  return day.success ? isoDateTimeOfEpochMs(toEpochDay(day.data) * 86_400_000) : null;
}

/** One direction of the link's `t` itinerary: 26 digits (two epoch times and a duration), then its airport chain. */
const LEG = /\d{26}((?:[A-Z]{3})+)/g;

/**
 * Both airport chains of the `t` token of the row's own link (plan decision 35): the token holds the outbound and the
 * return direction, each as digits followed by its airport chain (`LHRFRAEWR`, `EWRFRALCY`). Null when the link, the
 * token or either direction is missing or not in that shape: the itinerary then cannot be checked and nothing is
 * guessed.
 * why: a row's `origin_airport` and `destination_airport` name only the outbound ends, and the recordings show metro
 * rows whose outbound lands, or whose return leaves or lands, at another airport (open-jaw); an airport query returned
 * none, which the replay test pins. The token format is undocumented by the vendor.
 */
export function itineraryOf(link: unknown): { out: string[]; back: string[] } | null {
  const t = parseLink(link)?.searchParams.get('t');
  if (t === undefined || t === null) return null;
  const legs = [...(t.split('_')[0] ?? '').matchAll(LEG)].map((m) => m[1] ?? '');
  const [out, back] = legs;
  if (legs.length !== 2 || out === undefined || back === undefined) return null;
  const codes = (chain: string): string[] => chain.match(/[A-Z]{3}/g) ?? [];
  return { out: codes(out), back: codes(back) };
}

/** Whether a readable itinerary is the closed round trip origin → destination → origin. */
function isClosed(trip: { out: string[]; back: string[] }, origin: string, destination: string): boolean {
  return (
    trip.out[0] === origin &&
    trip.out.at(-1) === destination &&
    trip.back[0] === destination &&
    trip.back.at(-1) === origin
  );
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
  /** When the response was fetched (the oldest page): the upper bound of any row's observation time. */
  fetchedAt: IsoDateTime;
  coveredCells: readonly CellKey[];
  /** The pair's origin airport; a row naming any other origin airport is dropped (and fails the tile in fetchTile). */
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
  // per covered cell: rows dropped for an unusable price, and rows dropped because they are not the closed round trip, and rows with an unusable link
  const dropped = new Map<string, { cell: CellKey; badPrice: number; openJaw: number; badLink: number }>();
  const droppedFor = (key: string, cell: CellKey) => {
    const d = dropped.get(key) ?? { cell, badPrice: 0, openJaw: 0, badLink: 0 };
    dropped.set(key, d);
    return d;
  };
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
    // why: a link that looks site-relative but cannot be read (`//host`, `/\`, an unparsable value) is a malformed
    // row for its cell, reported rather than thrown (decision 35).
    if (typeof row.link === 'string' && row.link.startsWith('/') && parseLink(row.link) === null) {
      notes.add('offers-dropped');
      droppedFor(key, cell).badLink += 1;
      continue;
    }
    // why: an airport query is the closed round trip origin → destination → origin (decision 35); a row whose outbound
    // or return starts or ends at another airport is not the cell's trip, so it is dropped and reported rather than priced.
    const trip = itineraryOf(row.link);
    if (trip !== null && !isClosed(trip, input.origin, input.destination)) {
      notes.add('offers-dropped');
      droppedFor(key, cell).openJaw += 1;
      continue;
    }
    const amountMinor = typeof row.price === 'number' ? majorToMinor(row.price, input.currency.code) : null;
    if (amountMinor === null) {
      notes.add('offers-dropped');
      droppedFor(key, cell).badPrice += 1;
      continue;
    }
    const price: RawCalendarPrice = { ...cell, amountMinor, currency: input.currency.code };
    // why: day resolution (decision 35). A search day that is the fetch day, or later, would read "just now" from its
    // midnight, so the row is observed at the fetch itself; an earlier day stays its 00:00 UTC start.
    const seen = searchedAt(row.link);
    if (seen !== null) {
      price.providerObservedAt =
        seen >= `${input.fetchedAt.slice(0, 10)}T00:00:00.000Z` ? input.fetchedAt : seen;
    }
    const link = vendorLinkFor(row.link);
    if (link !== null) price.vendorLink = link;
    else if (row.link !== undefined && row.link !== null) notes.add('link-rejected');
    prices.push(price);
  }
  const { code, exponent } = input.currency;
  const rowsWord = (n: number): string => `${n} row${n === 1 ? '' : 's'}`;
  const cellIssues = [...dropped.values()].map(({ cell, badPrice, openJaw, badLink }): CellIssue => {
    const parts: string[] = [];
    if (badPrice > 0) {
      parts.push(
        exponent === null
          ? `${rowsWord(badPrice)} priced in ${code}, which has no known minor unit [currency-unsupported]`
          : `${rowsWord(badPrice)} had no usable ${code} price (not a positive amount with at most ${exponent} decimals) [bad-price]`,
      );
    }
    if (openJaw > 0) {
      parts.push(
        `${rowsWord(openJaw)} were not the closed round trip ${input.origin} to ${input.destination} and back [open-jaw]`,
      );
    }
    if (badLink > 0) parts.push(`${rowsWord(badLink)} had a malformed link [bad-link]`);
    return {
      cell,
      reason: badPrice > 0 && exponent === null ? 'currency-unsupported' : 'parse',
      offersDropped: badPrice + openJaw + badLink,
      detail: `travelpayouts: ${parts.join('; ')}`,
    };
  });
  return { prices, cellIssues, notes };
}
