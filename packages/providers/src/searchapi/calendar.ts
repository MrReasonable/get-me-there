import {
  addDays,
  type CellKey,
  type DiscoveryQuery,
  daysBetween,
  generateCells,
  type IsoDate,
  type TilePlan,
  type TileRequest,
} from '@gmt/core';

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
