/**
 * The smoke's checklist (spec §9 item 7; plan decisions 27, 29, 30, 34, 35, 39, 44, 66). Every line reads only what
 * this run saw: the hidden execution's ledger rows and guard usage, the requests this run's http-kit sent and the
 * bodies it received, and the adapters' results. `look` lines are for the operator to compare with the vendors' own
 * pages and never fail the run. What these lines check is the adapters' output on the operator's keys; the stored
 * record (calendar_prices, price_observations) is proved by layer B and the final pass's end-to-end trace.
 */
import {
  type DiscoveryQuery,
  daysBetween,
  effectiveAge,
  formatAgeFull,
  formatPence,
  type IsoDateTime,
  provenanceSchema,
  type SourceKind,
} from '@gmt/core';
import { majorToMinor } from '@gmt/providers/recording';
import type { Ports } from '../wiring.js';
import { cheapestOption } from './recordRequests.js';
import type { Chain, Discovery, SmokeProviderReport, Vendor } from './smoke.js';

/** One line of the checklist. */
export interface SmokeCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'look';
  detail: string;
}

/** One response this run's http-kit returned (never written anywhere). */
export interface Seen {
  providerId: string;
  tileIndex: number | null;
  url: URL;
  body: unknown;
}

/**
 * One answer the vendor gave this run, resolved or thrown by http-kit (a 401, a 5xx after its retries): the endpoint and
 * the HTTP status, which the ledger row of that attempt also records (cost review M2).
 */
export interface Answer {
  providerId: string;
  endpointPath: string;
  status: number;
}

/** What the checklist reads. `cap` is the run's frozen SearchApi cap, min(--budget, worst case). */
export interface ChecklistInput {
  ports: Ports;
  q: DiscoveryQuery;
  executionId: string;
  runStart: IsoDateTime;
  cap: number;
  configured: readonly Vendor[];
  found: ReadonlyMap<Vendor, Discovery>;
  itinerary: Chain | null;
  seen: readonly Seen[];
  answers: readonly Answer[];
}

/** Calls the chain may make: one step 1, then step 2 and step 3 for the one outbound it expands (spec §5.4). */
const CHAIN_CALLS = 3;
/** Departure days of the production SearchApi block for the smoke's band (decision 29). */
const RECTANGLE_DAYS = 9;

/** The source kind each provider and stage declares (spec §2 table); never 'synthetic' on a run against the vendors. */
const SOURCE_KIND: Record<`${Vendor} ${SmokeProviderReport['stage']}`, SourceKind | null> = {
  'travelpayouts discovery': 'authorised-cached',
  'travelpayouts itinerary': null,
  'searchapi discovery': 'scraped-aggregate',
  'searchapi itinerary': 'scraped-search',
};

/** Whole pence of a vendor GBP amount, or null (shared exact conversion, plan decision 24). */
const pence = (major: number | undefined): number | null =>
  major === undefined ? null : majorToMinor(major, 'GBP');
/** A WP6 per-cell issue that only reports open-jaw rows (its detail names no other cause). */
export const openJawOnly = (detail: string): boolean => /^travelpayouts: [^;]*\[open-jaw\]$/.test(detail);
/** The open-jaw row count in a WP6 per-cell issue detail ("2 rows were not the closed round trip … [open-jaw]"). */
const openJawRows = (detail: string): number =>
  Number(/(\d+) rows? were not the closed round trip[^;]*\[open-jaw\]/.exec(detail)?.[1] ?? 0);
/** A NoteCounter count (`key:n`, plan decision 24) from a notes list. */
const noteCount = (notes: readonly string[], key: string): number =>
  Number(notes.find((n) => n.startsWith(`${key}:`))?.slice(key.length + 1) ?? 0);

/**
 * Plan decision 34 and spec §5.2: every request names the query's own airports, never a city code (a city query returns
 * one cheapest row across every airport of the city, hiding the definition's own fare). Travelpayouts sends
 * `origin`/`destination`; SearchApi `departure_id`/`arrival_id` on every engine and step (prov-wp13-r1-011).
 */
export function metroRuleCheck(
  q: Pick<DiscoveryQuery, 'origin' | 'destination'>,
  requests: ReadonlyArray<{ providerId: string; url: URL }>,
): SmokeCheck {
  const names = (providerId: string): [string, string] =>
    providerId === 'searchapi' ? ['departure_id', 'arrival_id'] : ['origin', 'destination'];
  const faults = requests.filter((r) => {
    const [o, d] = names(r.providerId);
    return r.url.searchParams.get(o) !== q.origin || r.url.searchParams.get(d) !== q.destination;
  });
  return {
    name: 'airport pairs (metro rule)',
    status: requests.length === 0 ? 'skip' : faults.length === 0 ? 'pass' : 'fail',
    detail:
      requests.length === 0
        ? 'no request'
        : `${requests.length} request(s) named ${q.origin}→${q.destination}${faults.length === 0 ? '' : `; ${faults.length} named another code`}`,
  };
}

export function checklist(i: ChecklistInput): SmokeCheck[] {
  const { ports, q, executionId, configured, found, itinerary, seen } = i;
  const checks: SmokeCheck[] = [];
  const add = (name: string, status: SmokeCheck['status'], detail: string): void => {
    checks.push({ name, status, detail });
  };
  const tp = found.get('travelpayouts');
  const sa = found.get('searchapi');

  // 1. One tile per configured provider (spec §9 item 7).
  add(
    'one tile per provider',
    configured.every((id) => found.get(id)?.plans.length === 1) ? 'pass' : 'fail',
    configured.map((id) => `${id} ${found.get(id)?.plans.length ?? 0}`).join(', '),
  );

  // 2. Each tile read whole (decision 30; prov-wp13-r1-003): no page cap reached, no per-cell issue but open-jaw drops.
  const tiles = [...found.values()].flatMap((d) =>
    d.tile === null ? [] : [{ id: d.report.providerId, tile: d.tile }],
  );
  const partial = tiles.flatMap(({ id, tile }) => [
    ...(tile.truncated === true ? [`${id} stopped at the page cap`] : []),
    ...(tile.cellIssues ?? [])
      .filter((x) => !openJawOnly(x.detail))
      .map((x) => `${id} ${x.cell.departureDate}–${x.cell.returnDate} ${x.reason}`),
  ]);
  add(
    'tiles read whole',
    tiles.length === 0 ? 'skip' : partial.length === 0 ? 'pass' : 'fail',
    tiles.length === 0
      ? 'no tile'
      : partial.length === 0
        ? `${tiles.length} tile(s), every page and cell read`
        : partial.join('; '),
  );

  // 3. The ledger (spec §8.1): one first-attempt tile per provider, no cache hit, every answer this run received matched
  // like with like by a ledger row of its own endpoint and HTTP status (so a retried attempt's row cannot stand in for
  // it; cost review M2), the chain inside its estimate, and billed calls inside the frozen cap (the guard's own count,
  // cost-wp13-r1-008). Rows beyond the answers are http-kit's retries, reported.
  const counts = ports.repos.ledger.countsFor(executionId);
  const statuses = ports.repos.ledger.answeredFor(executionId);
  const line = (id: Vendor, stage: 'discovery' | 'verification') =>
    counts.perProvider.find((p) => p.providerId === id && p.stage === stage);
  const faults: string[] = [];
  const parts: string[] = [];
  for (const id of configured) {
    const d = line(id, 'discovery');
    const mine = i.answers.filter((a) => a.providerId === id);
    const keys = new Map<string, { endpointPath: string; status: number; n: number }>();
    for (const a of mine) {
      const k = `${a.endpointPath} ${a.status}`;
      const e = keys.get(k);
      if (e === undefined) keys.set(k, { endpointPath: a.endpointPath, status: a.status, n: 1 });
      else e.n += 1;
    }
    const rows = statuses.filter((s) => s.providerId === id);
    for (const { endpointPath, status, n } of keys.values()) {
      const ledgered =
        rows.find((s) => s.endpointPath === endpointPath && s.httpStatus === status)?.attempts ?? 0;
      if (ledgered < n)
        faults.push(
          `${id}: ${n - ledgered} answer(s) (${endpointPath} HTTP ${status}) missing from the ledger`,
        );
    }
    const retried = Math.max(0, rows.reduce((n, s) => n + s.attempts, 0) - mine.length);
    parts.push(
      `${id} ${d?.tiles ?? 0} tile, ${mine.length} answer(s) matched in the ledger by endpoint and status, ${retried} retried attempt(s), ${d?.cacheHits ?? 0} cache hit(s)`,
    );
    if (found.get(id)?.plans.length === 1 && (d?.tiles !== 1 || d.cacheHits !== 0))
      faults.push(`${id} discovery is not one fetched tile`);
  }
  const v = line('searchapi', 'verification');
  if (v !== undefined && v.calls > CHAIN_CALLS) faults.push('the chain exceeded its estimate');
  const billed = ports.budget.usage({ kind: 'execution-calls', executionId }).calls;
  parts.push(`SearchApi credits counted by the guard ${billed} of the frozen cap ${i.cap}`);
  if (billed > i.cap) faults.push('SearchApi credits exceeded the frozen cap');
  add('ledger', faults.length === 0 ? 'pass' : 'fail', [...parts, ...faults].join('; '));

  // 4. Provenance the adapters declare (spec §3; Global Constraints; prov-wp13-r1-005): complete, the source kind each
  // provider and stage declares (never synthetic), the point-of-sale rule, fetched during this run.
  const reports = [tp?.report, sa?.report, itinerary?.report].filter(
    (r): r is SmokeProviderReport => r !== undefined,
  );
  const shown = reports.flatMap((r) =>
    [r.cheapest, r.cheapestConfirmed].flatMap((p) => (p === null ? [] : [{ r, p: p.provenance }])),
  );
  const provFaults = shown.flatMap(({ r, p }) => {
    const out: string[] = [];
    const where = `${r.providerId} ${r.stage}`;
    if (!provenanceSchema.safeParse(p).success) out.push(`${where}: provenance incomplete`);
    const kind = SOURCE_KIND[`${r.providerId} ${r.stage}`];
    if (p.sourceKind === 'synthetic' || p.sourceKind !== kind)
      out.push(`${where}: source kind ${p.sourceKind}, expected ${kind ?? 'none'}`);
    const pos = r.providerId === 'travelpayouts' ? 'unknown' : ports.config.pointOfSale;
    if (p.pointOfSale !== pos) out.push(`${where}: point of sale ${p.pointOfSale}, expected ${pos}`);
    if (p.fetchedAt < i.runStart) out.push(`${where}: fetched before this run`);
    return out;
  });
  add(
    'provenance',
    shown.length === 0 ? 'skip' : provFaults.length === 0 ? 'pass' : 'fail',
    shown.length === 0
      ? 'no price to check'
      : [
          ...[
            ...new Set(
              shown.map(
                ({ r, p }) => `${r.providerId} ${r.stage} ${p.sourceKind}, point of sale ${p.pointOfSale}`,
              ),
            ),
          ],
          ...provFaults,
        ].join('; '),
  );

  // 5. Age labels as the views print them (spec §3, §11; decisions 35, 44, 58): for the operator to compare.
  const now = ports.clock.now();
  add(
    'age labels',
    shown.length === 0 ? 'skip' : 'look',
    shown.length === 0
      ? 'no price to label'
      : [
          ...new Set(
            shown.map(({ r, p }) => `${r.providerId} ${r.stage}: ${formatAgeFull(effectiveAge(p, now))}`),
          ),
        ].join('; '),
  );

  // 6. Airport pairs (decision 34), on both vendors.
  checks.push(metroRuleCheck(q, seen));

  // 7. Open-jaw drop (decision 39), read from the adapter's per-cell issues and notes, never from priced rows (which
  // carry no return airport): the issues' row counts must be inside the tile's dropped-row count. The cells are listed
  // for the operator to open on the Aviasales site.
  const tile = tp?.tile ?? null;
  if (tile === null) add('open-jaw drop', 'skip', 'no Travelpayouts tile');
  else {
    const jaw = (tile.cellIssues ?? []).filter((x) => x.detail.includes('[open-jaw]'));
    const rows = jaw.reduce((n, x) => n + openJawRows(x.detail), 0);
    const dropped = noteCount(tile.notes, 'offers-dropped');
    // why: pie-002: a priced row whose link token cannot be read was never checked for an open jaw; count it here.
    const unreadable = noteCount(tile.notes, 'itinerary-unreadable');
    add(
      'open-jaw drop',
      rows > dropped ? 'fail' : 'look',
      `${rows} open-jaw row(s) dropped in ${jaw.length} cell(s)${jaw.length === 0 ? '' : ` (${jaw.map((x) => `${x.cell.departureDate}–${x.cell.returnDate}`).join(', ')})`}; ${dropped} row(s) dropped in all${rows > dropped ? '; the issues count more rows than the tile dropped' : ''}; ${unreadable} priced row(s) whose link names no readable itinerary`,
    );
  }

  // 8. The production 9-day rectangle (WP5 smoke row; spec §2 fact 2): the vendor accepted 9 × 20 combinations.
  const rect = sa?.plans[0]?.request;
  if (sa === undefined || rect === undefined || rect.kind !== 'rectangle')
    add('9-day rectangle', 'skip', 'no SearchApi tile');
  else {
    const days = daysBetween(rect.departFrom, rect.departTo) + 1;
    const rets = daysBetween(rect.returnFrom, rect.returnTo) + 1;
    const accepted = sa.report.status === 'priced' || sa.report.status === 'empty';
    add(
      '9-day rectangle',
      days === RECTANGLE_DAYS && accepted ? 'pass' : 'fail',
      `${days} × ${rets} = ${days * rets} combinations, ${accepted ? 'accepted' : `not accepted (${sa.report.detail})`}`,
    );
  }

  // 9. Step 1 = step 2 (spec §5.4): step 2 expanded step 1's cheapest outbound, and the return's price equals it.
  const flights = seen.filter(
    (s) => s.providerId === 'searchapi' && s.url.searchParams.get('engine') === 'google_flights',
  );
  const step1 = flights.find(
    (s) => !s.url.searchParams.has('departure_token') && !s.url.searchParams.has('booking_token'),
  );
  const step2 = flights.find((s) => s.url.searchParams.has('departure_token'));
  const o1 = cheapestOption(step1?.body, 'departure_token');
  const p1 = pence(o1?.price);
  const p2 = pence(cheapestOption(step2?.body, 'booking_token')?.price);
  if (p1 === null || p2 === null || o1 === null)
    add('step 1 = step 2', 'skip', 'the chain did not answer both steps');
  else if (step2?.url.searchParams.get('departure_token') !== o1.token)
    add('step 1 = step 2', 'fail', 'step 2 expanded another outbound than step 1 priced cheapest');
  else
    add(
      'step 1 = step 2',
      p1 === p2 ? 'pass' : 'fail',
      `${formatPence(p1)} at step 1, ${formatPence(p2)} at step 2`,
    );

  // 10. Sellers (decisions 24, 27, 44): every offer names a seller; at least one price a seller listing confirmed.
  const result = itinerary?.result ?? null;
  if (result === null) add('sellers', 'skip', 'no chain result');
  else {
    const offers = result.offers;
    const named = offers.filter((o) => o.seller.trim() !== '');
    const confirmed = offers.filter((o) => o.verified).length;
    const noSeller = result.notes.filter((n) => n.startsWith('no-seller') || n.startsWith('no-airline'));
    add(
      'sellers',
      offers.length > 0 && named.length === offers.length && confirmed > 0 ? 'pass' : 'fail',
      `${offers.length} offer(s) from ${[...new Set(named.map((o) => o.seller))].join(', ') || 'no seller'}; ${confirmed} confirmed by a seller listing, ${offers.length - confirmed} not confirmed by the final step${noSeller.length === 0 ? '' : `; dropped: ${noSeller.join(', ')}`}`,
    );
  }

  // 11. Route-level history (decision 40; WP5 §13 row): what step 1 supplied, for the operator to compare with the
  // series another cell's search stored (Task 13.8). Best-effort: absence is the vendor's, never a fault.
  const history = result?.routeHistory ?? [];
  add(
    'route history',
    result === null ? 'skip' : 'look',
    result === null
      ? 'no chain result'
      : history.length === 0
        ? 'none supplied by the vendor for this cell'
        : `${history.length} point(s) from ${history[0]?.date} to ${history.at(-1)?.date}, lowest ${formatPence(Math.min(...history.map((h) => h.lowestPriceMinor)))}`,
  );

  // 12. Separate tickets (decision 29; WP5 smoke row): every SearchApi request asks to exclude them; whether Google
  // honours it is compared by eye in Task 13.8.
  const saSeen = seen.filter((s) => s.providerId === 'searchapi');
  const excluded = saSeen.filter((s) => s.url.searchParams.get('separate_tickets') === '1').length;
  const splits = result?.notes.filter((n) => n.startsWith('split-booking-skipped')) ?? [];
  add(
    'separate tickets excluded',
    saSeen.length === 0 ? 'skip' : excluded === saSeen.length ? 'look' : 'fail',
    saSeen.length === 0
      ? 'no SearchApi request'
      : `separate_tickets=1 on ${excluded} of ${saSeen.length} SearchApi request(s); split bookings skipped: ${splits.join(', ') || 'none'}`,
  );
  return checks;
}
