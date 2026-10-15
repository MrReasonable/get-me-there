/**
 * Arguments and the static call plan of `pnpm record:fixtures` (spec §9 item 7, §16 WP4b).
 * Pure, so the list the operator approves with --dry-run is exactly the list that runs.
 * No airport appears here: the route is a CLI argument and the metro comes from the airports table (spec §1, §5.2).
 */
import {
  addDays,
  asIsoDate,
  type Iata,
  type IsoDate,
  type IsoMonth,
  iataSchema,
  isoMonthSchema,
  monthOf,
} from '@gmt/core';
import { MAX_PAGES } from '@gmt/providers/recording';
import type { CellDates, Rect } from './recordRequests.js';

export type { CellDates, Rect } from './recordRequests.js';

/** Calendar + step 1 + step 2 + step 3: the credits the four required SearchApi fixtures cost. */
export const SA_REQUIRED_CREDITS = 4;
/** The smallest accepted --budget: the required four plus the over-limit probe (SA-03), which is billed if the vendor answers it with an empty 200. */
export const RECORD_MIN_BUDGET = 5;
/** Months of Travelpayouts metro tiles: the worked example's 182-day window spans 7 (spec §5.2). */
export const TP_MONTHS = 7;
/** Month offset of the best-effort empty-envelope probe (TP-19): outside the scanned months. */
export const TP_EMPTY_PROBE_OFFSET_MONTHS = 11;
/** Month offset of the Travelpayouts 401 probe (TP-20): a request no success recording makes (plan decision 20). */
export const TP_AUTH_PROBE_OFFSET_MONTHS = 12;
/** The worked example's nights band, 10–21 (spec §1): returns start 10 days after the first outbound. */
export const RECORD_MIN_NIGHTS = 10;
export const RECORD_NIGHTS_BAND = 12;
export const RECORD_MAX_NIGHTS = RECORD_MIN_NIGHTS + RECORD_NIGHTS_BAND - 1;
/**
 * Spec rev 15 §5.2 production tiling shape for the worked 10–21-night band (plan decision 29): the largest outbound
 * block b with b × (b + maxNights − minNights) ≤ 200, i.e. 9 outbound days × a 20-day return span = 180. why: the
 * return span is the rule, not a literal, so a changed band cannot silently leave the production shape (arch M-6).
 */
export const CALENDAR_OUT_DAYS = 9;
export const CALENDAR_RET_DAYS = CALENDAR_OUT_DAYS + RECORD_MAX_NIGHTS - RECORD_MIN_NIGHTS;
/** The deliberate over-limit probe: 9 × 24 = 216 > 200 (spec §2 fact 2). */
export const OVER_LIMIT_OUT_DAYS = 9;
export const OVER_LIMIT_RET_DAYS = 24;
/**
 * Pages fetched at most per Travelpayouts tile (cost-wp4b-r2-002): a vendor that ignored `page` and always answered
 * 1000 rows would otherwise page until the per-run cap. 3 covers the spike's busiest gateway month several times over.
 */
export const TP_MAX_PAGES_PER_TILE = MAX_PAGES;

/** Plan contract (Wiring and bootstraps), without `metro`: the metro comes from the seeded airports table (decision 20). */
export interface RecordArgs {
  budget: number;
  origins: Iata[];
  destinations: Iata[];
  month: IsoMonth;
}
/** What the CLI asks for beyond RecordArgs. */
export interface RecordCli {
  args: RecordArgs;
  dryRun: boolean;
  /** Required for a live run when earlier tool runs already ledgered SearchApi credits in the window (decision 20). */
  confirmRerun: boolean;
  /**
   * `--out DIR`: record into DIR/fixtures/recorded instead of the committed tree. Required for any route other than the
   * worked example, and DIR must be outside the repository (sec2-002; the operator's own routes never enter the repo).
   */
  out: string | null;
}
export type ParseRecordResult = { ok: true; value: RecordCli } | { ok: false; message: string };

/**
 * Why a Travelpayouts tile is in the plan. `reverse` (TP-21, plan decision 31): the first destination back to the
 * origins' metro for the same month, so WP6 can check every row's local departure month against the tile month for a
 * westward origin (UTC bucketing at month boundaries).
 */
export type TilePurpose = 'metro' | 'airport' | 'empty-probe' | 'reverse';

export type CallSpec =
  | {
      kind: 'tp-tile';
      /** An airport or a metro code; the reverse tile's destination is the metro (plan decision 31). */
      origin: string;
      destination: string;
      month: IsoMonth;
      purpose: TilePurpose;
    }
  | { kind: 'tp-auth'; origin: string; destination: Iata; month: IsoMonth }
  | { kind: 'sa-calendar' | 'sa-over-limit'; origin: Iata; destination: Iata; rect: Rect }
  | { kind: 'sa-step1' | 'sa-step2' | 'sa-step3'; origin: Iata; destination: Iata }
  | { kind: 'sa-auth'; origin: Iata; destination: Iata; cell: CellDates };

export interface PlannedCall {
  id: string;
  spec: CallSpec;
  label: string;
  /** SearchApi credits the ledger counts if the vendor answers HTTP 200 (spec §2 fact 4: every 200 counts). */
  worstCaseCredits: 0 | 1;
  /** Credits the spike's behaviour predicts. */
  expectedCredits: 0 | 1;
  freeCalls: 0 | 1;
  expect: readonly number[];
  /** Counted by `requiredOk`; the empty-envelope probe is best-effort (pie-010). */
  required: boolean;
}

export const USAGE =
  'usage: pnpm record:fixtures --budget N --route O1,O2:D1,D2 --month YYYY-MM [--out DIR] [--dry-run] [--confirm-rerun]';
const VALUE_FLAGS = new Set(['budget', 'route', 'month', 'out']);
const SWITCHES = new Set(['dry-run', 'confirm-rerun']);

function positiveInt(s: string): number | null {
  return /^[1-9]\d{0,5}$/.test(s) ? Number(s) : null;
}

function iataList(s: string): Iata[] | null {
  const out: Iata[] = [];
  for (const part of s.split(',')) {
    const r = iataSchema.safeParse(part); // iataSchema trims and upper-cases (plan decision 1)
    if (!r.success || out.includes(r.data)) return null;
    out.push(r.data);
  }
  return out.length > 0 ? out : null;
}

/** Parses the CLI. Refuses a missing or too-small budget before anything is opened (spec §9 item 7). */
export function parseRecordArgs(argv: readonly string[]): ParseRecordResult {
  const fail = (message: string): ParseRecordResult => ({ ok: false, message: `${message}\n${USAGE}` });
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue; // why: pnpm may forward its own separator
    if (a === undefined || !a.startsWith('--')) return fail(`unexpected argument ${String(a)}`);
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (SWITCHES.has(name) && eq === -1) {
      switches.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) return fail(`unknown flag --${name}`);
    if (flags.has(name)) return fail(`--${name} is given twice`);
    const value = eq === -1 ? argv[i + 1] : a.slice(eq + 1);
    if (value === undefined || value === '' || value.startsWith('--')) return fail(`--${name} needs a value`);
    flags.set(name, value);
    if (eq === -1) i++;
  }
  const budgetRaw = flags.get('budget');
  if (budgetRaw === undefined)
    return fail('--budget is required: the explicit SearchApi call budget (spec §9 item 7)');
  const budget = positiveInt(budgetRaw);
  if (budget === null) return fail('--budget must be a positive integer; 0 would record nothing');
  if (budget < RECORD_MIN_BUDGET)
    return fail(
      `--budget must be at least ${RECORD_MIN_BUDGET} (calendar, the over-limit probe and the three-step chain); got ${budget}`,
    );
  const route = flags.get('route');
  if (route === undefined) return fail('--route is required, e.g. --route O1,O2:D1,D2');
  const sides = route.split(':');
  const [from, to] = sides;
  if (sides.length !== 2 || from === undefined || to === undefined)
    return fail('--route must look like O1,O2:D1,D2');
  const origins = iataList(from);
  const destinations = iataList(to);
  if (origins === null || destinations === null)
    return fail('--route must look like O1,O2:D1,D2 with distinct three-letter codes');
  if (origins.some((o) => destinations.includes(o)))
    return fail('an airport cannot be both origin and destination');
  const month = isoMonthSchema.safeParse(flags.get('month') ?? '');
  if (!month.success) return fail('--month must be YYYY-MM');
  return {
    ok: true,
    value: {
      args: { budget, origins, destinations, month: month.data },
      dryRun: switches.has('dry-run'),
      confirmRerun: switches.has('confirm-rerun'),
      out: flags.get('out') ?? null,
    },
  };
}

/** The first day of a month, through core's brand helper. */
export function firstDayOf(month: IsoMonth): IsoDate {
  return asIsoDate(`${month}-01`);
}

/**
 * The month `k` months after `month`, from core's date helpers (spec §6.1: epoch-day arithmetic only).
 * why: 31·k days after the 1st lands inside month + k for 0 ≤ k ≤ 12, because any 12 consecutive months
 * fall at most 7 days short of 31 days each and every month has at least 28 days.
 */
export function monthAfter(month: IsoMonth, k: number): IsoMonth {
  if (!Number.isInteger(k) || k < 0 || k > 12)
    throw new RangeError(`monthAfter supports 0..12 months, got ${k}`);
  return monthOf(addDays(firstDayOf(month), 31 * k));
}

/** Outbound days from the 1st of `month`; returns start `minNights` after the first outbound day. */
export function rectangle(month: IsoMonth, outDays: number, retDays: number, minNights: number): Rect {
  const outFrom = firstDayOf(month);
  const retFrom = addDays(outFrom, minNights);
  return {
    outFrom,
    outTo: addDays(outFrom, outDays - 1),
    retFrom,
    retTo: addDays(retFrom, retDays - 1),
    combinations: outDays * retDays,
  };
}

function first<T>(xs: readonly T[]): T {
  const x = xs[0];
  if (x === undefined) throw new Error('empty list');
  return x;
}

/** The exact ordered call list (brief section 7). `metro` is the origins' shared metro code from the airports table, or null. */
export function planCalls(a: RecordArgs, metro: string | null): PlannedCall[] {
  const calls: PlannedCall[] = [];
  let tp = 0;
  let sa = 0;
  const tpCall = (spec: CallSpec, label: string, expect: readonly number[], required: boolean): void => {
    tp++;
    const id = `TP-${String(tp).padStart(2, '0')}`;
    calls.push({ id, spec, label, worstCaseCredits: 0, expectedCredits: 0, freeCalls: 1, expect, required });
  };
  const saCall = (
    spec: CallSpec,
    label: string,
    credits: { worst: 0 | 1; expected: 0 | 1 },
    expect: readonly number[],
  ): void => {
    sa++;
    const id = `SA-${String(sa).padStart(2, '0')}`;
    calls.push({
      id,
      spec,
      label,
      worstCaseCredits: credits.worst,
      expectedCredits: credits.expected,
      freeCalls: 0,
      expect,
      required: true,
    });
  };
  const tile = (origin: string, destination: string, month: IsoMonth, purpose: TilePurpose): void =>
    tpCall(
      { kind: 'tp-tile', origin, destination, month, purpose },
      `travelpayouts prices_for_dates ${origin}→${destination} ${month} (${purpose})`,
      [200],
      purpose !== 'empty-probe',
    );

  const tileOrigins = metro === null ? a.origins : [metro];
  for (let k = 0; k < TP_MONTHS; k++) {
    const month = monthAfter(a.month, k);
    for (const o of tileOrigins)
      for (const d of a.destinations) tile(o, d, month, metro === null ? 'airport' : 'metro');
  }
  if (metro !== null)
    for (const o of a.origins) for (const d of a.destinations) tile(o, d, a.month, 'airport');
  const o0 = first(a.origins);
  const d0 = first(a.destinations);
  const tpOrigin = metro ?? o0;
  tile(tpOrigin, d0, monthAfter(a.month, TP_EMPTY_PROBE_OFFSET_MONTHS), 'empty-probe');
  const authMonth = monthAfter(a.month, TP_AUTH_PROBE_OFFSET_MONTHS);
  tpCall(
    { kind: 'tp-auth', origin: tpOrigin, destination: d0, month: authMonth },
    `travelpayouts prices_for_dates ${tpOrigin}→${d0} ${authMonth} with an invalid token (401 body)`,
    [401],
    true,
  );
  // why: plan decision 31 — a required, free reverse-direction tile for the same month (TP-21)
  tile(d0, tpOrigin, a.month, 'reverse');

  const rect = rectangle(a.month, CALENDAR_OUT_DAYS, CALENDAR_RET_DAYS, RECORD_MIN_NIGHTS);
  const over = rectangle(a.month, OVER_LIMIT_OUT_DAYS, OVER_LIMIT_RET_DAYS, RECORD_MIN_NIGHTS);
  const rectLabel = (r: Rect): string =>
    `out ${r.outFrom}..${r.outTo} × ret ${r.retFrom}..${r.retTo} (${r.combinations})`;
  // why: first, so its reservation never meets a cap the billed calls have filled (the guard counts a pending row before
  // the 401 finalises it unbilled); one day past the rectangle on both sides, so it never equals a chain request (prov-wp04b-004)
  const authCell: CellDates = { departure: addDays(rect.outTo, 1), return: addDays(rect.retTo, 1) };
  saCall(
    { kind: 'sa-auth', origin: o0, destination: d0, cell: authCell },
    `searchapi google_flights step 1 ${o0}→${d0} ${authCell.departure}/${authCell.return} with an invalid key (401 body)`,
    { worst: 0, expected: 0 },
    [401],
  );
  saCall(
    { kind: 'sa-calendar', origin: o0, destination: d0, rect },
    `searchapi google_flights_calendar ${o0}→${d0} ${rectLabel(rect)}`,
    { worst: 1, expected: 1 },
    [200],
  );
  saCall(
    { kind: 'sa-over-limit', origin: o0, destination: d0, rect: over },
    `searchapi google_flights_calendar ${o0}→${d0} ${rectLabel(over)} over the limit (400, or an empty 200 per the docs)`,
    { worst: 1, expected: 0 },
    [400, 200],
  );
  saCall(
    { kind: 'sa-step1', origin: o0, destination: d0 },
    `searchapi google_flights step 1 ${o0}→${d0}, cheapest priced in-band cell of SA-02`,
    { worst: 1, expected: 1 },
    [200],
  );
  saCall(
    { kind: 'sa-step2', origin: o0, destination: d0 },
    'searchapi google_flights step 2, departure_token of the cheapest priced step-1 option',
    { worst: 1, expected: 1 },
    [200],
  );
  saCall(
    { kind: 'sa-step3', origin: o0, destination: d0 },
    'searchapi google_flights step 3, booking_token of the cheapest priced step-2 option',
    { worst: 1, expected: 1 },
    [200],
  );
  return calls;
}

/** Totals over a plan. */
export function planTotals(plan: readonly PlannedCall[]): {
  saCalls: number;
  worstCaseCredits: number;
  expectedCredits: number;
  freeCalls: number;
  worstCaseFreeCalls: number;
} {
  const tiles = plan.filter((c) => c.spec.kind === 'tp-tile').length;
  const freeCalls = plan.reduce((n, c) => n + c.freeCalls, 0);
  return {
    saCalls: plan.filter((c) => c.spec.kind.startsWith('sa-')).length,
    worstCaseCredits: plan.reduce((n, c) => n + c.worstCaseCredits, 0),
    expectedCredits: plan.reduce((n, c) => n + c.expectedCredits, 0),
    freeCalls,
    // why: every tile may page up to TP_MAX_PAGES_PER_TILE; the 401 probe never pages
    worstCaseFreeCalls: freeCalls + tiles * (TP_MAX_PAGES_PER_TILE - 1),
  };
}

/** One line per call with running totals, then a total line (printed by --dry-run and before a live run). */
export function formatPlan(plan: readonly PlannedCall[]): string[] {
  let credits = 0;
  let free = 0;
  const lines = plan.map((c) => {
    credits += c.worstCaseCredits;
    free += c.freeCalls;
    return `${c.id.padEnd(6)} ${c.label} | expect ${c.expect.join('/')} | SearchApi ≤${c.worstCaseCredits} (running ≤${credits}) | Travelpayouts ${c.freeCalls} (running ${free})`;
  });
  const t = planTotals(plan);
  lines.push(
    `total: SearchApi ${t.saCalls} calls, ≤${t.worstCaseCredits} credits (${t.expectedCredits} expected); Travelpayouts ${t.freeCalls} free calls, ≤${t.worstCaseFreeCalls} with up to ${TP_MAX_PAGES_PER_TILE} pages per tile`,
  );
  return lines;
}

/** Refusal message when the plan's worst-case free calls exceed the configured per-execution cap (EXECUTION_MAX_FREE_CALLS), else null. */
export function freeCallMisfit(plan: readonly PlannedCall[], maxFreeCalls: number): string | null {
  const need = planTotals(plan).worstCaseFreeCalls;
  return need <= maxFreeCalls
    ? null
    : `the plan needs up to ${need} Travelpayouts calls but EXECUTION_MAX_FREE_CALLS is ${maxFreeCalls}; raise it or narrow --route`;
}
