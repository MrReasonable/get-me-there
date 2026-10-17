/**
 * The smoke's arguments and its fixed plan (spec §9 item 7; plan decisions 29, 61, 66), pure so the dry run, the CLI and
 * the route agree: the argv reader's use, the one-tile query, the stated worst case and where a command-line run writes
 * its fixtures. Split from `smoke.ts` (the run) the way `recordPlan.ts` is split from `record.ts` (code-architect M3).
 */
import { dirname, join, resolve } from 'node:path';
import {
  addDays,
  type Cabin,
  type Config,
  type DiscoveryQuery,
  type Iata,
  type IsoDate,
  iataSchema,
  monthOf,
} from '@gmt/core';
import { defaultRecordedRoot } from '@gmt/providers';
import { positiveInt, readFlags } from './args.js';
import { isInside } from './paths.js';
import {
  CALENDAR_OUT_DAYS,
  firstDayOf,
  monthAfter,
  RECORD_MAX_NIGHTS,
  RECORD_MIN_NIGHTS,
  TP_MAX_PAGES_PER_TILE,
} from './recordPlan.js';
import type { WorstCase } from './toolExecution.js';

/** The recordedBy signature on every file a command-line smoke writes (spec §5.5). */
export const SMOKE_RECORDED_BY = '@gmt/api smoke:live';
/** Outbounds the chain expands: one, so the chain is step 1, one step 2 and one step 3 (spec §5.4). */
export const SMOKE_EXPAND_TOP = 1;
/**
 * Departure days of the smoke query: the production SearchApi block for the 10–21-night band (9 × 20 = 180
 * combinations, plan decision 29), so the smoke is also WP5's "try a 9-day rectangle" row, and every day sits inside
 * one month, so Travelpayouts plans one month tile.
 */
export const SMOKE_DEPARTURE_DAYS = CALENDAR_OUT_DAYS;
export const SMOKE_CABIN: Cabin = 'economy';
export const SMOKE_USAGE =
  'usage: pnpm smoke:live --origin IATA --destination IATA --budget N [--dry-run] [--confirm-rerun]';

const VALUE_FLAGS: ReadonlySet<string> = new Set(['origin', 'destination', 'budget']);
const SWITCHES: ReadonlySet<string> = new Set(['confirm-rerun', 'dry-run']);

export interface SmokeArgs {
  origin: Iata;
  destination: Iata;
  /** SearchApi credits tool runs may have ledgered in the provider's budget window, this run included (decision 20). */
  budget: number;
}
export interface SmokeCli {
  args: SmokeArgs;
  /** Lifts only the cross-run refusal, as for recording; never a window without room, never the frozen cap. */
  confirmRerun: boolean;
  /** Prints the query, the worst case and the spend position; opens no execution and sends nothing (decision 66). */
  dryRun: boolean;
}
export type ParseSmokeResult = { ok: true; value: SmokeCli } | { ok: false; message: string };

/** `--origin X --destination Y --budget N [--dry-run] [--confirm-rerun]` through the tools' one argv reader. */
export function parseSmokeArgs(argv: readonly string[]): ParseSmokeResult {
  const fail = (message: string): ParseSmokeResult => ({ ok: false, message: `${message}\n${SMOKE_USAGE}` });
  const read = readFlags(argv, VALUE_FLAGS, SWITCHES);
  if (!read.ok) return fail(read.message);
  const origin = iataSchema.safeParse(read.flags.get('origin') ?? '');
  const destination = iataSchema.safeParse(read.flags.get('destination') ?? '');
  if (!origin.success || !destination.success)
    return fail('--origin and --destination are required: one three-letter airport code each');
  const budgetRaw = read.flags.get('budget');
  if (budgetRaw === undefined)
    return fail(
      '--budget is required: the SearchApi credits tool runs may use in this budget window (spec §9 item 7)',
    );
  const budget = positiveInt(budgetRaw);
  if (budget === null) return fail('--budget must be a positive integer');
  return {
    ok: true,
    value: {
      args: { origin: origin.data, destination: destination.data, budget },
      confirmRerun: read.switches.has('confirm-rerun'),
      dryRun: read.switches.has('dry-run'),
    },
  };
}

/**
 * The one-tile query: departures on the first `SMOKE_DEPARTURE_DAYS` days of next month, 10–21 nights, economy. Next
 * month's 1st is always after today and nine days from the 1st never cross a month end, so Travelpayouts plans one
 * month tile; SearchApi's block for this band is nine days, so it plans one 9 × 20 rectangle. `runSmoke` still checks
 * `plan().length === 1` for each provider before any request.
 */
export function smokeQuery(today: IsoDate, origin: Iata, destination: Iata): DiscoveryQuery {
  const departureFrom = firstDayOf(monthAfter(monthOf(today), 1));
  return {
    origin,
    destination,
    departureFrom,
    departureTo: addDays(departureFrom, SMOKE_DEPARTURE_DAYS - 1),
    minNights: RECORD_MIN_NIGHTS,
    maxNights: RECORD_MAX_NIGHTS,
    cabin: SMOKE_CABIN,
    currency: 'GBP',
  };
}

/**
 * The run's stated worst case: SearchApi one calendar tile plus the chain's `1 + 2 × expandTop` (the adapter's own
 * estimate rule, spec §5.4); Travelpayouts one month tile at the page cap.
 */
export function smokeWorstCase(config: Config): WorstCase {
  return {
    credits: config.providers.searchapi === null ? 0 : 1 + 1 + 2 * SMOKE_EXPAND_TOP,
    freeCalls: config.providers.travelpayouts === null ? 0 : TP_MAX_PAGES_PER_TILE,
  };
}

/**
 * Where a command-line smoke writes: `<dirname(DATABASE_PATH)>/smoke/fixtures/recorded` (the recorder requires the
 * `fixtures/recorded` suffix), refused when that lies inside the repository's recorded tree (decision 61), compared as
 * true-case real paths (`isInside`). The data directory is the operator's (gitignored `data/` on a checkout, the volume
 * in a container), like the backups beside it.
 */
export function smokeFixtureTarget(
  databasePath: string,
  recordedTree: string = defaultRecordedRoot(),
): { root: string; recordedBy: string } | { refusal: string } {
  const root = join(dirname(resolve(databasePath)), 'smoke', 'fixtures', 'recorded');
  if (isInside(root, recordedTree))
    return {
      refusal: `DATABASE_PATH would put the smoke's fixtures in the recorded tree (${root}); move the database`,
    };
  return { root, recordedBy: SMOKE_RECORDED_BY };
}
