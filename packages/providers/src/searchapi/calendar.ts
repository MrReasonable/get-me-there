import {
  addDays,
  type CellIssue,
  type CellKey,
  cellKeyString,
  type DiscoveryQuery,
  type DiscoveryTileResult,
  daysBetween,
  generateCells,
  type IsoDate,
  isoDateSchema,
  type Logger,
  type ProviderContext,
  ProviderError,
  type RawCalendarPrice,
  type Secret,
  type TilePlan,
  type TileRequest,
} from '@gmt/core';
import type { HttpKit } from '../http/types.js';
import { assertRequestAllowed, type ParamsAllowlist } from '../params/allowlist.js';
import { parseError, parseVendor } from '../shared/errors.js';
import { NoteCounter } from '../shared/notes.js';
import { authHeaders, calendarParams, SEARCHAPI_ENDPOINT_PATH, SEARCHAPI_WHERE, toUrl } from './params.js';
import { calendarResponseSchema, currencySupported, minorOrDrop, readEcho } from './shapes.js';

/** Spec §2 fact 2: the calendar engine refuses more than 200 outbound × return combinations (HTTP 400). */
export const MAX_COMBINATIONS = 200;

/** The rectangle variant of the vendor-neutral tile request (spec §5.1). */
export type Rectangle = Extract<TileRequest, { kind: 'rectangle' }>;

/** Outbound days × return days of a rectangle, the quantity SearchApi caps at 200. Spec §5.2. */
export function combinations(r: Rectangle): number {
  return (daysBetween(r.departFrom, r.departTo) + 1) * (daysBetween(r.returnFrom, r.returnTo) + 1);
}

/** The ≤200 assertion of spec §5.2; `fetchTile` repeats it before `http.request`, so it precedes `budget.reserve`. */
export function assertWithinLimit(r: Rectangle): void {
  const n = combinations(r);
  if (n > MAX_COMBINATIONS) {
    throw new RangeError(
      `searchapi rectangle ${r.departFrom}..${r.departTo} × ${r.returnFrom}..${r.returnTo} has ${n} combinations, above ${MAX_COMBINATIONS}`,
    );
  }
}

/**
 * Outbound days per tile: the largest b with b × (b + maxNights − minNights) ≤ 200, bounded by the window
 * length (ruling CBR-03). A block of b departure days needs b + spread return days, so this is the widest
 * rectangle the vendor accepts: 9 days for the worked 10–21-night band (9 × 20 = 180), 14 for a fixed-length
 * stay (14 × 14 = 196). One day always fits because nights ≤ 90 (spec §6.1).
 */
export function outboundBlockDays(
  q: Pick<DiscoveryQuery, 'departureFrom' | 'departureTo' | 'minNights' | 'maxNights'>,
): number {
  const spread = q.maxNights - q.minNights;
  const windowDays = daysBetween(q.departureFrom, q.departureTo) + 1;
  let b = 1;
  while ((b + 1) * (b + 1 + spread) <= MAX_COMBINATIONS) b += 1;
  return Math.max(1, Math.min(b, windowDays));
}

function byDepartureThenReturn(a: CellKey, b: CellKey): number {
  if (a.departureDate !== b.departureDate) return a.departureDate < b.departureDate ? -1 : 1;
  if (a.returnDate !== b.returnDate) return a.returnDate < b.returnDate ? -1 : 1;
  return 0;
}

/** Cells from `start` whose departure is on or before `lastDeparture` (input sorted by departure). */
function takeBlock(cells: readonly CellKey[], start: number, lastDeparture: IsoDate): CellKey[] {
  const out: CellKey[] = [];
  for (let i = start; i < cells.length; i++) {
    const c = cells[i];
    if (c === undefined || c.departureDate > lastDeparture) break;
    out.push(c);
  }
  return out;
}

/** The tight bounding rectangle of a block; `first` is its earliest cell. */
function boundsOf(first: CellKey, group: readonly CellKey[]): Rectangle {
  const r: Rectangle = {
    kind: 'rectangle',
    departFrom: first.departureDate,
    departTo: first.departureDate,
    returnFrom: first.returnDate,
    returnTo: first.returnDate,
  };
  for (const c of group) {
    if (c.departureDate > r.departTo) r.departTo = c.departureDate;
    if (c.returnDate < r.returnFrom) r.returnFrom = c.returnDate;
    if (c.returnDate > r.returnTo) r.returnTo = c.returnDate;
  }
  return r;
}

/**
 * `DiscoveryCapability.plan` for SearchApi: pure, deterministic rectangle tiling of `google_flights_calendar`.
 * Spec §5.2. Cells (the band, or `q.cells` on a re-plan) are sorted and cut into blocks of
 * `outboundBlockDays(q)` consecutive departure days; each tile is its block's tight bounding box, so tiles
 * partition the input exactly. A block whose box would still exceed 200 combinations (only possible when
 * `q.cells` carries an off-band cell) shrinks a day at a time.
 */
export function planRectangles(q: DiscoveryQuery): TilePlan[] {
  const source: CellKey[] =
    q.cells ??
    generateCells({
      origins: [q.origin],
      destinations: [q.destination],
      departureFrom: q.departureFrom,
      departureTo: q.departureTo,
      minNights: q.minNights,
      maxNights: q.maxNights,
    }).map(({ origin, destination, departureDate, returnDate }) => ({
      origin,
      destination,
      departureDate,
      returnDate,
    }));
  const cells = [...source].sort(byDepartureThenReturn);
  const widest = outboundBlockDays(q);
  const tiles: TilePlan[] = [];
  let start = 0;
  while (start < cells.length) {
    const first = cells[start];
    if (first === undefined) break;
    let block = widest;
    let group = takeBlock(cells, start, addDays(first.departureDate, block - 1));
    let rect = boundsOf(first, group);
    // why: a re-plan subset may hold a cell outside the band (an engine bug); shrink rather than overflow.
    while (combinations(rect) > MAX_COMBINATIONS && block > 1) {
      block -= 1;
      group = takeBlock(cells, start, addDays(first.departureDate, block - 1));
      rect = boundsOf(first, group);
    }
    assertWithinLimit(rect);
    tiles.push({ index: tiles.length, coveredCells: group, request: rect });
    start += group.length;
  }
  return tiles;
}

/** What `fetchTile` needs; built once by `searchApiProvider`. */
export interface CalendarDeps {
  http: HttpKit;
  log: Logger;
  key: Secret;
  pointOfSale: string;
  allowlist: ParamsAllowlist;
  cacheTtlSeconds: number;
}

/** A tile's parsed content, before `fetchedAt` and the tile identity are added. */
export interface ParsedCalendar {
  prices: RawCalendarPrice[];
  noFares: CellKey[];
  notes: string[];
  pointOfSale: string;
  /** Present only when a covered cell had a row dropped (decision 28; WP6 omits it the same way). */
  cellIssues?: CellIssue[];
}

/** `n calendar row(s)` for a cell issue's detail. */
const rowsWord = (n: number): string => (n === 1 ? '1 calendar row' : `${n} calendar rows`);

/**
 * A cell issue's detail in WP6's grammar: provider prefix, what happened, the machine tag in brackets (`bad-price`
 * for reason `parse`, `currency-unsupported` for that reason), so `last_error` reads one way for both adapters.
 */
function dropDetail(n: number, currency: string, reason: 'currency-unsupported' | 'parse'): string {
  return reason === 'currency-unsupported'
    ? `searchapi: ${rowsWord(n)} for this cell priced in ${currency}, which has no known minor unit [currency-unsupported]`
    : `searchapi: ${rowsWord(n)} for this cell had no usable ${currency} price (not a positive amount with at most its currency's decimals) [bad-price]`;
}

/**
 * Parses one calendar response for one tile. Spec §5.2: cell keys from the response; entries outside
 * `coveredCells` or the nights band are dropped and counted; `has_no_flights` → `noFares`; an empty grid →
 * parse; currency and point of sale from the echo. Every in-tile priced entry is returned, duplicates included,
 * so the engine's one-price-per-cell rule (spec §5.6: the minimum, vendor order breaking ties) decides. A cell
 * for which the vendor stated a price is never "no fares", even when that price was dropped; a cell with both is
 * counted `conflicting-entries`. Every covered cell with a dropped row gets a `CellIssue` (decision 28): the engine
 * records it `priced` with `offers-dropped:n` when another row priced it, else `error` with the issue's reason
 * (`currency-unsupported` or `parse`), never `no_data`.
 */
export function parseCalendarBody(
  body: unknown,
  plan: TilePlan,
  q: DiscoveryQuery,
  requestedGl: string,
): ParsedCalendar {
  const data = parseVendor(calendarResponseSchema, body, 'malformed-calendar', SEARCHAPI_WHERE);
  const echo = readEcho(data.search_parameters, requestedGl);
  // why: spec §5.2: under a passing ≤200 assertion an empty grid is a vendor fault, never "no data".
  if (data.calendar.length === 0)
    throw parseError('empty-grid', 'an empty grid within the 200-combination limit', SEARCHAPI_WHERE);
  const covered = new Set(plan.coveredCells.map(cellKeyString));
  const seen = new Set<string>();
  const stated = new Set<string>();
  const noFlights = new Set<string>();
  // why: one response states one currency, so every dropped row of a tile has the same reason.
  const dropReason = currencySupported(echo.currency) ? 'parse' : 'currency-unsupported';
  const dropped = new Map<string, number>();
  const notes = new NoteCounter();
  const prices: RawCalendarPrice[] = [];
  for (const e of data.calendar) {
    if (e.return === undefined) {
      notes.add('dropped-no-return');
      continue;
    }
    const dep = isoDateSchema.safeParse(e.departure);
    const ret = isoDateSchema.safeParse(e.return);
    if (!dep.success || !ret.success) {
      notes.add('dropped-bad-date');
      continue;
    }
    const cell: CellKey = {
      origin: q.origin,
      destination: q.destination,
      departureDate: dep.data,
      returnDate: ret.data,
    };
    const key = cellKeyString(cell);
    if (!covered.has(key)) {
      notes.add('dropped-outside-tile');
      continue;
    }
    const nights = daysBetween(cell.departureDate, cell.returnDate);
    if (nights < q.minNights || nights > q.maxNights) {
      notes.add('dropped-outside-band');
      continue;
    }
    if (seen.has(key)) notes.add('duplicate-entries');
    seen.add(key);
    if (e.has_no_flights === true) {
      noFlights.add(key);
      // why: a row that also states a price is a stated fare, never "no fares"; the cell counts as conflicting below.
      if (e.price === undefined) continue;
    }
    if (e.price === undefined) {
      notes.add('unpriced-skipped');
      continue;
    }
    stated.add(key);
    const m = minorOrDrop(e.price, echo.currency, notes);
    if (m.minor === null) {
      dropped.set(key, (dropped.get(key) ?? 0) + 1);
      continue;
    }
    prices.push({ ...cell, amountMinor: m.minor, currency: echo.currency });
  }
  const noFares = plan.coveredCells.filter((c) => {
    const key = cellKeyString(c);
    return noFlights.has(key) && !stated.has(key);
  });
  notes.add('conflicting-entries', [...noFlights].filter((k) => stated.has(k)).length);
  // why: an absent cell is neither priced nor "no fares"; the engine decides its outcome, the note keeps it visible.
  notes.add('covered-cells-absent', covered.size - seen.size);
  const cellIssues: CellIssue[] = plan.coveredCells.flatMap((cell) => {
    const n = dropped.get(cellKeyString(cell));
    if (n === undefined) return [];
    return [{ cell, reason: dropReason, offersDropped: n, detail: dropDetail(n, echo.currency, dropReason) }];
  });
  return {
    prices,
    noFares,
    notes: notes.list(),
    pointOfSale: echo.pointOfSale,
    ...(cellIssues.length === 0 ? {} : { cellIssues }),
  };
}

/**
 * `DiscoveryCapability.fetchTile` for SearchApi. Spec §5.2. The rectangle check, the ≤200 assertion and the
 * allowlist check run before `http.request`, so none reaches `budget.reserve`. A `ProviderError` becomes a
 * `tile-error` for exactly this tile's cells; `BudgetExceeded` and `AbortedError` propagate.
 */
export async function fetchCalendarTile(
  d: CalendarDeps,
  plan: TilePlan,
  q: DiscoveryQuery,
  ctx: ProviderContext,
): Promise<DiscoveryTileResult> {
  const req = plan.request;
  if (req.kind !== 'rectangle') throw new TypeError(`searchapi plans rectangle tiles only; got ${req.kind}`);
  assertWithinLimit(req);
  const url = toUrl(calendarParams(q, req, d.pointOfSale));
  assertRequestAllowed(d.allowlist, SEARCHAPI_ENDPOINT_PATH, url);
  const gl = d.pointOfSale.toLowerCase();
  // why: plan decision 15: `accept` vetoes caching a body this parser rejects, so a bad grid is never served again;
  // only a parse refusal means "do not cache", anything else is a bug and propagates.
  const accept = (body: unknown): boolean => {
    try {
      parseCalendarBody(body, plan, q, gl);
      return true;
    } catch (err) {
      if (err instanceof ProviderError) return false;
      throw err;
    }
  };
  try {
    // why: the cache key excludes execution and tile ids (plan decision 14), so an identical rectangle from a
    // resumed run is a cache hit, ledgered with this tile's index (spec §8.1 parity).
    const res = await d.http.request({
      providerId: 'searchapi',
      executionId: ctx.executionId,
      tileIndex: plan.index,
      endpointPath: SEARCHAPI_ENDPOINT_PATH,
      method: 'GET',
      url,
      headers: authHeaders(d.key),
      cache: { ttlSeconds: d.cacheTtlSeconds, accept },
      signal: ctx.signal,
      recordFixtures: ctx.recordFixtures,
    });
    const parsed = parseCalendarBody(res.body, plan, q, gl);
    d.log.debug(
      {
        tileIndex: plan.index,
        prices: parsed.prices.length,
        noFares: parsed.noFares.length,
        notes: parsed.notes,
      },
      'searchapi calendar tile parsed',
    );
    return {
      kind: 'tile',
      index: plan.index,
      coveredCells: plan.coveredCells,
      fetchedAt: res.fetchedAt,
      ...parsed,
    };
  } catch (err) {
    if (err instanceof ProviderError)
      return { kind: 'tile-error', index: plan.index, coveredCells: plan.coveredCells, error: err };
    throw err;
  }
}
