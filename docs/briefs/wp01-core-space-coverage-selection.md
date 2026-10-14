---
wp: 1
title: "core: dates, windows, space, validation, roll-up, coverage, selection"
owner: sonnet
depends_on: [0]
spec_sections: ["§6.1", "§6.6", "§6.7", "§3", "§9 item 1"]
reviewers: [code-architect, test-strategy-reviewer, search-strategy-reviewer, product-owner, provenance-auditor]
status: draft
---

# WP1 — `core`: dates, windows, space, validation, roll-up, coverage, selection

## Goal

Give `@gmt/core` the pure, timezone-independent functions that define the search space (epoch-day dates, window resolution, cell generation and counting, validation), roll per-provider cell outcomes into coverage (precedence roll-up, monotone merge, six buckets, "selected but not reached"), and choose the cells stage 2 verifies (spec §6.7), all at 100% coverage.

## Scope

**In**

- `packages/core/src/dates/epochDay.ts`: epoch-day conversion (civil-date algorithm, no `Date`), `addDays`, `daysBetween`, `monthOf`, `monthsSpanned`, `isLeapYear`.
- `packages/core/src/space/`: `resolveWindow`, `generateCells`, `countCells`, `validateSearchSpace` with the `AirportLookup` object and the metro-code message.
- `packages/core/src/coverage/`: `rollUp` (spec §6.6 table), `mergeWithinProvider`, `sixBuckets`, `selectedNotReached`.
- `packages/core/src/selection/select.ts`: `selectCandidates` (spec §6.7 steps 1–6).
- Tests for every spec §6.1, §6.6, §6.7 and §9 item 1 case owned by these functions, including the TZ matrix, fast-check properties and the independent roll-up enumeration.
- Barrel exports in `packages/core/src/index.ts`; the `test:tz` script.

**Out**

- Normalisation, hashing, constraints, verdict classes, ranking, filters, money, alerts, vendor URLs: WP2 (`core`).
- `cellKeyString`, `parseCellKeyString`, `Buckets`, `iataSchema` (which trims and upper-cases), and the Stryker configuration (command runner, `ignorePatterns` with `"/coverage"`): WP0. WP1 imports them and defines none of them.
- Persisting outcomes, roll-ups, buckets and selections (`CellsRepo`) and the airports table (`AirportsRepo.exists`, `metroOf`, `airportsOfMetro`, which satisfies `AirportLookup` structurally): WP3 (`db`).
- Running selection once per execution, the `skipped_window` status, recording `alwaysInclude` cells that slid out of a relative window in `DefinitionSnapshot.droppedAlwaysInclude`, child executions bypassing selection, and calling `clock.todayLondon()`: WP7 (`engine`).
- `POST /definitions` returning 422 on a zero-cell window and mapping `ValidationResult.errors` to the error envelope: WP8 (`api`).
- Upper-casing operator input: WP0's `iataSchema` at the API boundary and WP9's form on blur. Showing the city-code message beside the field: WP9 (`web`).
- `@date-fns/tz` instants and DST wall-clock rules: WP2 (`normalise/localTime.ts`).

## Spec sections

- **§6.1 Search-space generation**: relative windows resolve in Europe/London and absolute windows clamp to tomorrow; dates are epoch-day integers, never `Date`-local arithmetic; `returnDate = departureDate + nights`, window ends inclusive; deterministic order origin, destination, departureDate, nights; `countCells` closed form; the validation list; the named test list.
- **§6.6 Coverage math and roll-up precedence**: rows 0–6 with the skip-reason priority; monotone merge within one provider with `min_pence = min`; six buckets summing to the cell count; "selected but not reached" = `selected ∧ (not_run ∨ skipped:budget)`; property test from an independent enumeration of the table.
- **§6.7 Candidate selection**: `alwaysInclude` first and counted; rank priced discovery cells by `discovery_min_pence` with generation-order ties; `topN`, `maxCells`, `perDepartureDateBest`; the ceiling walk; the stride fallback with `m ≤ 0` and `total < m`; `selection_reason`.
- **§3 Core concepts**: the cell outcome vocabulary (`not_run | priced | empty | no_data | error | skipped`, skip reasons) and the six buckets (priced, no fares, no cached data, error, skipped, not searched) with reused outcomes counted in their own bucket.
- **§9 item 1**, rows for §6.1, §6.6 and §6.7: relative windows, clamping, zero-cell windows, `startOffsetDays = 0` rejection, DST/TZ matrix; precedence table enumerated independently, property invariant, monotone merge; every selection interaction and the stride edge cases. §9 also fixes `core` at 100% lines/branches/functions and puts `selection` and `rollUp` under Stryker at break 80%.

## Interfaces consumed

From the plan's "Cross-package contracts", copied verbatim (the lines WP1 uses):

```ts
// types/ids.ts (WP0)
export type Iata = string & { readonly __brand: 'Iata' };          // ^[A-Z]{3}$ after upper-casing
export type IsoDate = string & { readonly __brand: 'IsoDate' };    // YYYY-MM-DD
export type IsoMonth = string & { readonly __brand: 'IsoMonth' };  // YYYY-MM
export const iataSchema: z.ZodType<Iata, string>;  // trims, upper-cases, then requires ^[A-Z]{3}$ (so 'lhr' → 'LHR'; 'LHRX' rejected)
export function isRealDate(y: number, m: number, d: number): boolean;
export function asIata(s: string): Iata;           // throws on mismatch; tests and seeds only
export function asIsoDate(s: string): IsoDate;

// types/definition.ts (WP0)
export type WindowSpec = { kind: 'absolute'; from: IsoDate; to: IsoDate } | { kind: 'relative'; startOffsetDays: number; lengthDays: number };
export interface ResolvedSpace { origins: Iata[]; destinations: Iata[]; departureFrom: IsoDate; departureTo: IsoDate; minNights: number; maxNights: number }
export interface CellKey { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate }   // the ONLY definition; ports/provider.ts imports it
export interface Cell extends CellKey { nights: number }
export function cellKeyString(c: CellKey): string;        // `${origin}|${destination}|${departureDate}|${returnDate}` — lives here (WP0) so WP1, WP2, WP3 all share it
export function parseCellKeyString(s: string): CellKey;   // inverse; throws on malformed input
export interface VerificationPolicy { maxCells: number; topN: number; priceCeilingPence?: number; perDepartureDateBest?: number; alwaysInclude: CellKey[]; expandTop: number; bookingLinks: boolean; maxStops?: number }
export interface SearchDefinition {
  id: string; name: string; origins: Iata[]; destinations: Iata[]; window: WindowSpec; minNights: number; maxNights: number;
  cabin: Cabin; constraints: Constraints; verification: VerificationPolicy; budget: ExecutionBudget; providers: ProvidersConfig;
  destinationNotes: Partial<Record<Iata, string>>; onwardCostPence: Partial<Record<Iata, number>>;
  scheduleCron: string | null; scheduleTz: string; confirmedCostPence: number | null; enabled: boolean;
  createdAt: IsoDateTime; updatedAt: IsoDateTime; deletedAt: IsoDateTime | null;
}
export type DefinitionSnapshot = SearchDefinition & { resolved: ResolvedSpace; resolvedAt: IsoDateTime; windowClamped: boolean; droppedAlwaysInclude: CellKey[] };

// types/execution.ts (WP0)
export type Stage = 'discovery' | 'verification';
export type CellOutcomeStatus = 'not_run' | 'priced' | 'empty' | 'no_data' | 'error' | 'skipped';
export type SkipReason = 'not_selected' | 'budget' | 'provider_disabled' | 'departed';
export interface CellOutcome extends CellKey {
  executionId: string; stage: Stage; providerId: ProviderId; status: CellOutcomeStatus; reason: string | null;
  attempts: number; lastError: string | null; fetchedAt: IsoDateTime | null; minPence: number | null;
  cabin: Cabin | null; pointOfSale: PointOfSale | null; sourceKind: SourceKind | null; reusedFromExecutionId: string | null;
}
export interface RollUp { status: CellOutcomeStatus | null; reason: string | null; minPence: number | null }   // null status ↔ API 'not_applicable'
export type SelectionReason = 'always_include' | 'top_n' | 'ceiling' | 'stride';
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }   // bucketsSchema in api-contract/common.ts is z.ZodType<Buckets>

// ports/clock.ts (WP0); callers pass clock.todayLondon() as todayLondon, WP1 never reads a clock
export interface Clock { now(): IsoDateTime; todayLondon(): IsoDate }
```

WP1 source calls `cellKeyString` and never defines its own; `parseCellKeyString` is what consumers of `selectCandidates`' `discovery` map use to convert keys back. `DefinitionSnapshot.droppedAlwaysInclude` is listed because it is where the engine records the `alwaysInclude` cells `selectCandidates` omits.

## Interfaces produced

The plan's "Core domain functions (WP1, WP2)" block, WP1 lines, verbatim. Every name is exported from `@gmt/core`:

```ts
// WP1 (dates/, space/, coverage/, selection/)
export function toEpochDay(d: IsoDate): number; export function fromEpochDay(n: number): IsoDate; export function addDays(d: IsoDate, n: number): IsoDate; export function daysBetween(a: IsoDate, b: IsoDate): number /* b − a */; export function monthOf(d: IsoDate): IsoMonth; export function monthsSpanned(from: IsoDate, to: IsoDate): IsoMonth[]; export function isLeapYear(y: number): boolean;
export function resolveWindow(w: WindowSpec, todayLondon: IsoDate): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean };
export function generateCells(space: ResolvedSpace): Cell[]; export function countCells(space: ResolvedSpace): number;
export interface AirportLookup { exists(iata: Iata): boolean; metroOf(iata: Iata): string | null; airportsOfMetro(code: string): Iata[] }
export type ValidationResult = { ok: true; resolved: ResolvedSpace; clamped: boolean; notes: string[] } | { ok: false; errors: Array<{ field: string; message: string }> };
export function validateSearchSpace(def: Pick<SearchDefinition, 'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights' | 'verification'>, todayLondon: IsoDate, lookup: AirportLookup, maxCells: number): ValidationResult;
export function rollUp(outcomes: CellOutcome[]): RollUp; export function mergeWithinProvider(a: CellOutcome, b: CellOutcome): CellOutcome;
export function sixBuckets(outcomes: CellOutcome[]): Buckets /* one stage, one provider */; export function selectedNotReached(selected: CellKey[], outcomes: CellOutcome[]): Array<{ cell: CellKey; reason: string }>;
export function selectCandidates(policy: VerificationPolicy, cells: Cell[], discovery: Map<string, RollUp>, hasDiscoveryProvider: boolean): Array<{ cell: CellKey; reason: SelectionReason }>;
```

No other name is exported. The limits (window ≤ 400 days, nights ≤ 90, the epoch-day range 0001–9999), the skip-reason priority and the merge ranks are module-local constants.

Behaviour later packages rely on, each pinned by a test below:

- `generateCells` orders by origin, destination (both sorted by code), departureDate, nights.
- `validateSearchSpace` upper-cases nothing. Per code it checks format, duplicate, existence, then `airportsOfMetro`, so a code that is both an airport and a metro code is accepted. A zero-cell window is `ok: false` with `field: 'window'`; the engine tells `skipped_window` apart by calling `resolveWindow` and `countCells` itself.
- `mergeWithinProvider` accepts only `priced | empty | no_data | error` outcomes of the same cell, stage, provider and execution, and throws otherwise. It returns the winning outcome (`a` on equal status) with the merged `status`, `minPence` and `reason`; callers pass (existing, incoming).
- `sixBuckets` throws on mixed stages or providers or a repeated cell.
- `selectedNotReached` returns `reason` `'not_run'` or `'budget'`, judged on the cell's verification roll-up.
- `selectCandidates` reads `maxCells`, `topN`, `priceCeilingPence`, `perDepartureDateBest` and `alwaysInclude`, and omits `alwaysInclude` members not in `cells`.

## Library notes

Verified 2026-10-14 against context7 and by running every test and implementation in this brief in a scratch package with the pinned versions installed (`vitest@5.0.4`, `@vitest/coverage-v8@5.0.4`, `fast-check@4.10.2`, `zod@4.6.7`, `typescript@5.9.3`, `@biomejs/biome@2.5.15`, `@stryker-mutator/core@10.0.0`, Node 26.10, with stand-ins for WP0's types written from the contract block): 170 tests green, 100% statements/branches/functions/lines on the WP1 files, `tsc --noEmit` clean under the plan's `tsconfig.base.json` flags, `biome check` clean, and the suite green under `TZ=Europe/London`, `TZ=UTC` and `TZ=America/Los_Angeles`.

- **zod 4.6.7** (versions from plan Task 0.1). WP1 source does not import zod. Tests call `iataSchema.parse('lhr')` (returns `'LHR'` through WP0's `.trim().toUpperCase().regex(...)` chain) and `iataSchema.safeParse('LHRX').success` (false); the zod 4 `safeParse` result is `{ success: false, error: ZodError }` with `error.issues[]` carrying `code`, `path`, `message`. Source: context7 `/colinhacks/zod/v4.6.5`, `packages/docs/content/error-customization.mdx` and `error-formatting.mdx` (4.6.5 is the newest indexed; the scratch run used 4.6.7).
- **fast-check 4.10.2**. Calls used: `fc.assert(fc.property(...arbs, predicate), { numRuns })`, `fc.integer({ min, max })`, `fc.array(arb, { minLength, maxLength })`, `fc.constantFrom(...values)`, `fc.constant(v)`, `fc.oneof(...arbs)`, `fc.record({ ... })`, `fc.tuple(...)`, `fc.boolean()`, `.map(f)`; the default import `import fc from 'fast-check'`. Source: context7 `/dubzzz/fast-check`, `website/docs/core-blocks/arbitraries/primitives/number.md`, `.../combiners/constant.md`, `.../composites/object.md`.
- **vitest 5.0.4**. Calls used: `describe`, `it`, `it.each(rows)` with `%s`/`%j`/`%i`/`%d`, `describe.each(objects)` with `$tz` interpolation, `beforeAll`, `afterAll`, `expect(...).toEqual/toBe/toThrow/toContain/toContainEqual/toMatchObject/toHaveLength`, `expect(value, message)`. The default pool is `forks` (each test file in its own child process). The `test.env` option does **not** change the time zone in `threads`/`vmThreads` pools, and `process.env.TZ` set at runtime takes effect in a forked process; so the TZ matrix sets `process.env.TZ` inside the test file and first asserts the zone took effect, and `test:tz` sets `TZ` on the command line for the whole suite. Source: context7 `/vitest-dev/vitest/v5.0.3`, `docs/config/env.md` (warning "TZ set here does not change the time zone in threads and vmThreads pools") and `docs/guide/common-errors.md` ("Time Zone Does Not Change in Worker Threads"; pool defaults in `packages/vitest/src/node/cli/cli-config.ts`).
- **Stryker 10.0.0**: WP0's `packages/core/stryker.config.json` is used unchanged (command runner `pnpm exec vitest run --coverage.enabled=false`, `ignorePatterns` with `"/coverage"` so `src/coverage/` is mutated, `mutate` already listing `src/selection/select.ts` and `src/coverage/rollUp.ts`, break 80). A scratch run with that configuration scored 96.28% on the two files (`rollUp.ts` 96.80%, `select.ts` 95.73%); the nine survivors are equivalent mutants (for example `m <= 0` → `m < 0`, the tie-order comparator, the `out.length < maxCells` loop guard that `fits` repeats).
- **`@date-fns/tz`**: not used in WP1 (WP2 owns instants). **`Intl`**: not needed; WP1 performs no timezone conversion, because `todayLondon` arrives from `Clock.todayLondon()` (WP0).

## Files

**Create**

- `packages/core/src/dates/epochDay.ts`
- `packages/core/src/space/generate.ts`
- `packages/core/src/space/window.ts`
- `packages/core/src/space/validate.ts`
- `packages/core/src/coverage/rollUp.ts`
- `packages/core/src/coverage/buckets.ts`
- `packages/core/src/selection/select.ts`
- `packages/core/test/support/build.ts`
- `packages/core/test/space/generate.test.ts`
- `packages/core/test/dates/epochDay.test.ts`
- `packages/core/test/space/calendar.test.ts`
- `packages/core/test/space/window.test.ts`
- `packages/core/test/space/validate.test.ts`
- `packages/core/test/coverage/rollUp.test.ts`
- `packages/core/test/coverage/buckets.test.ts`
- `packages/core/test/selection/select.test.ts`
- `packages/core/test/barrel-wp1.test.ts`
- `packages/core/test/no-date-wp1.test.ts`

**Modify**

- `packages/core/src/index.ts` (append WP1 exports)
- `packages/core/package.json` (add the `test:tz` script)

## Tasks

Per-task runs use `pnpm --filter @gmt/core exec vitest run <path>` without coverage, because the 100% thresholds apply to the whole of `src/` and only hold once every task has landed; Task 1.8 and the definition of done run the thresholded suite.

### Task 1.1: Cell counts for the default and the enumerated tiny space (first failing test)

**Files:**
- Create: `packages/core/test/support/build.ts`, `packages/core/test/space/generate.test.ts`, `packages/core/src/dates/epochDay.ts`, `packages/core/src/space/generate.ts`

**Interfaces:**
- Consumes: `Iata`, `IsoDate`, `asIata`, `asIsoDate`, `isRealDate`, `ResolvedSpace`, `CellKey`, `Cell`, `CellOutcome`, `CellOutcomeStatus`.
- Produces: `isLeapYear`, `toEpochDay`, `fromEpochDay`, `addDays`, `daysBetween`, `countCells`, `generateCells`.

- [ ] **Step 1: Write the failing test**

The shared builders first (scaffolding the later suites reuse). `packages/core/test/support/build.ts`:

```ts
// Test builders shared by the WP1 suites. Worked-example airports only (LHR, LGW → JFK, EWR)
// plus clearly synthetic codes (AAA, BBB).
import type { Cell, CellKey, ResolvedSpace } from '../../src/types/definition.js';
import type { CellOutcome, CellOutcomeStatus } from '../../src/types/execution.js';
import { asIata, asIsoDate } from '../../src/types/ids.js';

export const iatas = (...codes: string[]) => codes.map(asIata);

export function space(p: {
  o: string[];
  d: string[];
  from: string;
  to: string;
  min: number;
  max: number;
}): ResolvedSpace {
  return {
    origins: iatas(...p.o),
    destinations: iatas(...p.d),
    departureFrom: asIsoDate(p.from),
    departureTo: asIsoDate(p.to),
    minNights: p.min,
    maxNights: p.max,
  };
}

export function key(o: string, d: string, dep: string, ret: string): CellKey {
  return {
    origin: asIata(o),
    destination: asIata(d),
    departureDate: asIsoDate(dep),
    returnDate: asIsoDate(ret),
  };
}

export function cellOf(o: string, d: string, dep: string, ret: string, nights: number): Cell {
  return { ...key(o, d, dep, ret), nights };
}

export function outcome(
  k: CellKey,
  status: CellOutcomeStatus,
  over: Partial<Omit<CellOutcome, keyof CellKey | 'status'>> = {},
): CellOutcome {
  return {
    ...k,
    executionId: 'exec-1',
    stage: 'discovery',
    providerId: 'travelpayouts',
    status,
    reason: null,
    attempts: 0,
    lastError: null,
    fetchedAt: null,
    minPence: null,
    cabin: null,
    pointOfSale: null,
    sourceKind: null,
    reusedFromExecutionId: null,
    ...over,
  };
}
```

`packages/core/test/space/generate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countCells, generateCells } from '../../src/space/generate.js';
import { cellOf, space } from '../support/build.js';

describe('countCells / generateCells (spec §6.1)', () => {
  it('counts the default space by hand: 2 origins × 3 destinations × 182 days × 12 nights = 13,104', () => {
    // 2026-10-21 + 181 days = 2027-04-20 (182 departure days inclusive); nights 10..21 = 12 values.
    const s = space({
      o: ['LHR', 'LGW'],
      d: ['JFK', 'EWR', 'AAA'],
      from: '2026-10-21',
      to: '2027-04-20',
      min: 10,
      max: 21,
    });
    expect(countCells(s)).toBe(13_104);
  });

  it('enumerates the tiny space literally: 1 × 1 × 3 days × 2 nights = 6 cells, in order', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 7, max: 8 });
    expect(countCells(s)).toBe(6);
    expect(generateCells(s)).toEqual([
      cellOf('LHR', 'JFK', '2027-03-01', '2027-03-08', 7),
      cellOf('LHR', 'JFK', '2027-03-01', '2027-03-09', 8),
      cellOf('LHR', 'JFK', '2027-03-02', '2027-03-09', 7),
      cellOf('LHR', 'JFK', '2027-03-02', '2027-03-10', 8),
      cellOf('LHR', 'JFK', '2027-03-03', '2027-03-10', 7),
      cellOf('LHR', 'JFK', '2027-03-03', '2027-03-11', 8),
    ]);
  });

  it('secondary property: countCells equals the generated length on the default space', () => {
    const s = space({
      o: ['LHR', 'LGW'],
      d: ['JFK', 'EWR', 'AAA'],
      from: '2026-10-21',
      to: '2027-04-20',
      min: 10,
      max: 21,
    });
    expect(generateCells(s)).toHaveLength(countCells(s));
  });

  it('is zero for an empty window (departureTo before departureFrom) and generates nothing', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-05', to: '2027-03-04', min: 7, max: 8 });
    expect(countCells(s)).toBe(0);
    expect(generateCells(s)).toEqual([]);
  });

  it('is zero for an inverted nights range', () => {
    expect(
      countCells(space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 9, max: 8 })),
    ).toBe(0);
  });
});
```

`AAA` is the synthetic third destination: spec §6.1's default space is 2 × 3 pairs, the worked example has two destinations, and the brief rules allow only worked-example or synthetic codes.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/space/generate.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/space/generate.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/dates/epochDay.ts` (the epoch-day conversion: days since 1970-01-01 by the civil-date algorithm, no `Date` object):

```ts
import { type IsoDate, isRealDate } from '../types/ids.js';

/**
 * Calendar-date arithmetic on epoch-day integers (days since 1970-01-01). Spec §6.1:
 * "Dates are calendar dates independent of process timezone: epoch-day integers and `Intl`
 * only, never `Date`-local arithmetic."
 *
 * why: no `Date` object appears in this file. The conversions are Howard Hinnant's
 * `days_from_civil` / `civil_from_days` algorithms on the proleptic Gregorian calendar, which
 * are exact integer arithmetic and cannot be shifted by the process timezone or a DST change.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Epoch day of 0001-01-01 and 9999-12-31: the range a four-digit `IsoDate` can express. */
const MIN_EPOCH_DAY = -719_162;
const MAX_EPOCH_DAY = 2_932_896;

/** Gregorian leap year: divisible by 4, except centuries not divisible by 400. */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days since 1970-01-01 for a real `YYYY-MM-DD`. Throws `RangeError` on anything else. Spec §6.1. */
export function toEpochDay(date: IsoDate): number {
  const m = DATE_RE.exec(date);
  const y = Number(m?.[1]);
  const mo = Number(m?.[2]);
  const d = Number(m?.[3]);
  // why: the brand says the string was validated, but rows read back from SQLite JSON are not
  // re-parsed by zod, so a malformed value must fail loudly here rather than produce a wrong day.
  if (m === null || y < 1 || !isRealDate(y, mo, d)) throw new RangeError(`not a calendar date: ${date}`);
  const yy = mo <= 2 ? y - 1 : y; // the civil year starts in March so the leap day is last
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400; // [0, 399]
  const mp = (mo + 9) % 12; // March = 0 … February = 11
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146_097 + doe - 719_468;
}

/** The `YYYY-MM-DD` for an epoch day. Throws `RangeError` outside years 0001–9999 or on a non-integer. Spec §6.1. */
export function fromEpochDay(day: number): IsoDate {
  if (!Number.isInteger(day) || day < MIN_EPOCH_DAY || day > MAX_EPOCH_DAY) {
    throw new RangeError(`epoch day out of range: ${day}`);
  }
  const z = day + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (mo <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` as IsoDate;
}

/** `date` plus `n` calendar days (n may be negative). Spec §6.1: `returnDate = departureDate + nights`. */
export function addDays(date: IsoDate, n: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + n);
}

/** Calendar days from `a` to `b` (negative when `b` is earlier). `daysBetween(d, d) === 0`. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toEpochDay(b) - toEpochDay(a);
}
```

`packages/core/src/space/generate.ts`:

```ts
import { addDays, daysBetween } from '../dates/epochDay.js';
import type { Cell, ResolvedSpace } from '../types/definition.js';

/**
 * Number of cells in a resolved space, in closed form with no allocation. Spec §6.1: "the
 * estimate and caps use it". Zero when the window is empty (`departureTo < departureFrom`,
 * which a clamped absolute window in the past produces) or the nights range is inverted.
 */
export function countCells(space: ResolvedSpace): number {
  const days = Math.max(0, daysBetween(space.departureFrom, space.departureTo) + 1);
  const nights = Math.max(0, space.maxNights - space.minNights + 1);
  return space.origins.length * space.destinations.length * days * nights;
}

/**
 * Every cell of a resolved space. Spec §6.1: "deterministic order: origin, destination,
 * departureDate, nights"; window ends inclusive; `returnDate = departureDate + nights`.
 *
 * why: origins and destinations are sorted, not taken in the order the operator typed them, so
 * the generation order (which selection uses for tie-breaks and the stride, spec §6.7) does not
 * change when a definition lists the same airports in a different order.
 */
export function generateCells(space: ResolvedSpace): Cell[] {
  // why: the default sort compares UTF-16 code units, which is locale-independent (unlike
  // localeCompare) and exact for upper-case IATA codes.
  const origins = [...space.origins].sort();
  const destinations = [...space.destinations].sort();
  const days = Math.max(0, daysBetween(space.departureFrom, space.departureTo) + 1);
  const cells: Cell[] = [];
  for (const origin of origins) {
    for (const destination of destinations) {
      for (let i = 0; i < days; i += 1) {
        const departureDate = addDays(space.departureFrom, i);
        for (let nights = space.minNights; nights <= space.maxNights; nights += 1) {
          cells.push({
            origin,
            destination,
            departureDate,
            returnDate: addDays(departureDate, nights),
            nights,
          });
        }
      }
    }
  }
  return cells;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/space/generate.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: epoch-day dates and cell generation with hand-computed counts (spec §6.1)"
```

### Task 1.2: Calendar edges, month helpers and the TZ matrix

**Files:**
- Create: `packages/core/test/dates/epochDay.test.ts`, `packages/core/test/space/calendar.test.ts`
- Modify: `packages/core/src/dates/epochDay.ts`, `packages/core/package.json`

**Interfaces:**
- Consumes: Task 1.1's epoch-day functions and `generateCells`.
- Produces: `monthOf`, `monthsSpanned`; the `test:tz` script.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/dates/epochDay.test.ts` (reference values, leap day 2028-02-29, the 2027→2028 boundary, range guards, a fast-check round-trip against a UTC oracle, months):

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  fromEpochDay,
  isLeapYear,
  monthOf,
  monthsSpanned,
  toEpochDay,
} from '../../src/dates/epochDay.js';
import { asIsoDate, type IsoDate } from '../../src/types/ids.js';

const d = asIsoDate;
// Epoch days of 0001-01-01 and 9999-12-31, the range a four-digit IsoDate can express.
const MIN_EPOCH_DAY = -719_162;
const MAX_EPOCH_DAY = 2_932_896;

describe('toEpochDay / fromEpochDay (spec §6.1: epoch-day integers, never Date-local arithmetic)', () => {
  // Reference values computed independently when the brief was written (Date.UTC(y, m-1, d) / 86_400_000)
  // and, for 0001-01-01, from the 719,162 days between 0001-01-01 and 1970-01-01.
  it.each([
    ['1970-01-01', 0],
    ['1969-12-31', -1],
    ['2000-02-29', 11_016],
    ['2000-03-01', 11_017],
    ['2026-10-14', 20_740],
    ['2027-12-31', 21_183],
    ['2028-01-01', 21_184],
    ['2028-02-28', 21_242],
    ['2028-02-29', 21_243],
    ['2028-03-01', 21_244],
    ['0001-01-01', MIN_EPOCH_DAY],
    ['9999-12-31', MAX_EPOCH_DAY],
  ])('%s is epoch day %i both ways', (iso, n) => {
    expect(toEpochDay(d(iso))).toBe(n);
    expect(fromEpochDay(n)).toBe(iso);
  });

  it('round-trips every day in years 0001–9999 and agrees with a UTC oracle (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_EPOCH_DAY, max: MAX_EPOCH_DAY }), (n) => {
        const iso = fromEpochDay(n);
        expect(toEpochDay(iso)).toBe(n);
        // why: the oracle is UTC-only (no local time) and is used in tests, never in src.
        if (n >= 0) expect(iso).toBe(new Date(n * 86_400_000).toISOString().slice(0, 10));
      }),
      { numRuns: 2000 },
    );
  });

  it.each(['2027-02-29', '2026-13-01', '0000-06-01', '2026-1-1', 'garbage'])(
    'toEpochDay rejects %j',
    (bad) => {
      expect(() => toEpochDay(bad as IsoDate)).toThrow(RangeError);
    },
  );

  it.each([MIN_EPOCH_DAY - 1, MAX_EPOCH_DAY + 1, 1.5, Number.NaN])('fromEpochDay rejects %d', (n) => {
    expect(() => fromEpochDay(n)).toThrow(RangeError);
  });
});

describe('isLeapYear', () => {
  it.each([
    [2028, true],
    [2027, false],
    [2000, true],
    [1900, false],
    [2100, false],
    [2400, true],
  ])('%i → %s', (y, leap) => {
    expect(isLeapYear(y)).toBe(leap);
  });
});

describe('addDays / daysBetween', () => {
  it('lands on the leap day 2028-02-29 and steps over it', () => {
    expect(addDays(d('2028-02-28'), 1)).toBe('2028-02-29');
    expect(addDays(d('2028-02-29'), 1)).toBe('2028-03-01');
    expect(addDays(d('2027-02-28'), 1)).toBe('2027-03-01'); // 2027 is not a leap year
    expect(daysBetween(d('2028-02-01'), d('2028-03-01'))).toBe(29);
    expect(daysBetween(d('2027-02-01'), d('2027-03-01'))).toBe(28);
  });
  it('crosses the 2027→2028 boundary', () => {
    expect(addDays(d('2027-12-30'), 3)).toBe('2028-01-02');
    expect(addDays(d('2028-01-01'), -1)).toBe('2027-12-31');
    expect(daysBetween(d('2027-12-31'), d('2028-01-01'))).toBe(1);
  });
  it('is zero from a date to itself and negative backwards', () => {
    expect(daysBetween(d('2027-03-28'), d('2027-03-28'))).toBe(0);
    expect(daysBetween(d('2027-03-29'), d('2027-03-28'))).toBe(-1);
  });
});

describe('monthOf / monthsSpanned', () => {
  it('monthOf takes YYYY-MM and validates', () => {
    expect(monthOf(d('2028-02-29'))).toBe('2028-02');
    expect(() => monthOf('2027-02-29' as IsoDate)).toThrow(RangeError);
  });
  it('spans the default window: 2026-10-21 .. 2027-04-20 is seven months', () => {
    expect(monthsSpanned(d('2026-10-21'), d('2027-04-20'))).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
    ]);
  });
  it('is one month for a single day and empty when reversed', () => {
    expect(monthsSpanned(d('2027-03-28'), d('2027-03-28'))).toEqual(['2027-03']);
    expect(monthsSpanned(d('2027-03-29'), d('2027-03-28'))).toEqual([]);
  });
});
```

`packages/core/test/space/calendar.test.ts` (the DST windows under `TZ=Europe/London` and `TZ=UTC`, min = max nights, single-day window, multi-origin × multi-destination ordering):

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countCells, generateCells } from '../../src/space/generate.js';
import { cellOf, space } from '../support/build.js';

// Spec §6.1 / §9 item 1: windows spanning the March and October DST changes, run under
// TZ=Europe/London and TZ=UTC. The functions under test never touch Date, so the zone must make
// no difference; each block switches process.env.TZ at runtime (Node re-reads it on assignment;
// Vitest's default `forks` pool gives each file its own process) and first proves the switch
// took effect, so a silently ignored TZ fails the suite instead of passing it vacuously.
// `pnpm --filter @gmt/core test:tz` additionally runs the whole core suite under each zone.
const ZONES = [
  { tz: 'Europe/London', marchOffset: -60 }, // 2027-03-28 12:00 local is BST (UTC+1)
  { tz: 'UTC', marchOffset: 0 },
] as const;

describe.each(ZONES)('calendar edges under TZ=$tz', ({ tz, marchOffset }) => {
  const saved = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    process.env.TZ = saved;
  });

  it('the process really is in the zone (guard)', () => {
    // why: Date is allowed in tests; this only checks the environment, not the code under test.
    expect(new Date(2027, 2, 28, 12).getTimezoneOffset()).toBe(marchOffset);
  });

  it('a window across the March change (2027-03-28, clocks forward) keeps every day and night', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-27', to: '2027-03-29', min: 1, max: 1 });
    expect(generateCells(s)).toEqual([
      cellOf('LHR', 'JFK', '2027-03-27', '2027-03-28', 1),
      cellOf('LHR', 'JFK', '2027-03-28', '2027-03-29', 1),
      cellOf('LHR', 'JFK', '2027-03-29', '2027-03-30', 1),
    ]);
  });

  it('a window across the October change (2027-10-31, clocks back) neither repeats nor skips a day', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-10-30', to: '2027-11-01', min: 0, max: 0 });
    expect(generateCells(s).map((c) => c.departureDate)).toEqual(['2027-10-30', '2027-10-31', '2027-11-01']);
    expect(generateCells(s).every((c) => c.returnDate === c.departureDate)).toBe(true);
  });

  it('a 14-night stay departing before the March change returns 14 calendar days later', () => {
    const [c] = generateCells(
      space({ o: ['LHR'], d: ['JFK'], from: '2027-03-20', to: '2027-03-20', min: 14, max: 14 }),
    );
    expect(c).toEqual(cellOf('LHR', 'JFK', '2027-03-20', '2027-04-03', 14));
  });

  it('crosses the leap day 2028-02-29 and the 2027→2028 boundary', () => {
    const leap = generateCells(
      space({ o: ['LHR'], d: ['JFK'], from: '2028-02-28', to: '2028-03-01', min: 1, max: 1 }),
    );
    expect(leap.map((c) => [c.departureDate, c.returnDate])).toEqual([
      ['2028-02-28', '2028-02-29'],
      ['2028-02-29', '2028-03-01'],
      ['2028-03-01', '2028-03-02'],
    ]);
    const nye = generateCells(
      space({ o: ['LHR'], d: ['JFK'], from: '2027-12-31', to: '2027-12-31', min: 1, max: 2 }),
    );
    expect(nye.map((c) => c.returnDate)).toEqual(['2028-01-01', '2028-01-02']);
  });
});

describe('generation shape (spec §6.1)', () => {
  it('min = max nights gives one cell per departure day', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-04', min: 10, max: 10 });
    expect(countCells(s)).toBe(4);
    expect(generateCells(s).map((c) => c.nights)).toEqual([10, 10, 10, 10]);
  });

  it('a single-day window gives one departure date', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-01', min: 10, max: 12 });
    expect(generateCells(s).map((c) => `${c.departureDate}+${c.nights}`)).toEqual([
      '2027-03-01+10',
      '2027-03-01+11',
      '2027-03-01+12',
    ]);
  });

  it('orders multi-origin × multi-destination by origin, destination, departure, nights (codes sorted)', () => {
    // Listed out of order on purpose: generation order must not depend on how the operator typed them.
    const s = space({
      o: ['LHR', 'LGW'],
      d: ['JFK', 'EWR'],
      from: '2027-03-01',
      to: '2027-03-02',
      min: 7,
      max: 8,
    });
    expect(
      generateCells(s).map((c) => `${c.origin}-${c.destination} ${c.departureDate} ${c.nights}`),
    ).toEqual([
      'LGW-EWR 2027-03-01 7',
      'LGW-EWR 2027-03-01 8',
      'LGW-EWR 2027-03-02 7',
      'LGW-EWR 2027-03-02 8',
      'LGW-JFK 2027-03-01 7',
      'LGW-JFK 2027-03-01 8',
      'LGW-JFK 2027-03-02 7',
      'LGW-JFK 2027-03-02 8',
      'LHR-EWR 2027-03-01 7',
      'LHR-EWR 2027-03-01 8',
      'LHR-EWR 2027-03-02 7',
      'LHR-EWR 2027-03-02 8',
      'LHR-JFK 2027-03-01 7',
      'LHR-JFK 2027-03-01 8',
      'LHR-JFK 2027-03-02 7',
      'LHR-JFK 2027-03-02 8',
    ]);
  });

  it('does not reorder the caller’s arrays', () => {
    const s = space({
      o: ['LHR', 'LGW'],
      d: ['JFK', 'EWR'],
      from: '2027-03-01',
      to: '2027-03-01',
      min: 7,
      max: 7,
    });
    generateCells(s);
    expect(s.origins).toEqual(['LHR', 'LGW']);
    expect(s.destinations).toEqual(['JFK', 'EWR']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/dates test/space/calendar.test.ts`
Expected: FAIL, `TypeError: monthOf is not a function` and `TypeError: monthsSpanned is not a function` (3 failing tests); every other test in both files passes, pinning Task 1.1's behaviour (including `isLeapYear`) across the calendar edges and both zones.

- [ ] **Step 3: Implement**

In `packages/core/src/dates/epochDay.ts`, change the first line to:

```ts
import { type IsoDate, type IsoMonth, isRealDate } from '../types/ids.js';
```

and append:

```ts
/** The `YYYY-MM` month a date falls in. Used by month tiles (spec §5.2). */
export function monthOf(date: IsoDate): IsoMonth {
  toEpochDay(date); // validates
  return date.slice(0, 7) as IsoMonth;
}

/** Every month from `from`'s month to `to`'s month inclusive, in order; empty when `to < from`. */
export function monthsSpanned(from: IsoDate, to: IsoDate): IsoMonth[] {
  if (daysBetween(from, to) < 0) return [];
  const out: IsoMonth[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const last = monthOf(to);
  for (;;) {
    const month = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}` as IsoMonth;
    out.push(month);
    if (month === last) return out;
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
}
```

In `packages/core/package.json` add to `scripts` (`// why:` the whole core suite under each zone, without coverage, in addition to the in-file matrix):

```json
"test:tz": "TZ=Europe/London vitest run && TZ=UTC vitest run"
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/dates test/space && pnpm --filter @gmt/core test:tz`
Expected: PASS (epochDay 34 tests, calendar 14, generate 5); `test:tz` passes twice. The guard test "the process really is in the zone" passes in both `describe.each` blocks, proving the TZ switch took effect.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: calendar edges, month helpers and TZ matrix (spec §6.1, §9 item 1)"
```

### Task 1.3: `resolveWindow`

**Files:**
- Create: `packages/core/test/space/window.test.ts`, `packages/core/src/space/window.ts`

**Interfaces:**
- Consumes: `WindowSpec`, `addDays`, `daysBetween`, `countCells`.
- Produces: `resolveWindow`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { countCells } from '../../src/space/generate.js';
import { resolveWindow } from '../../src/space/window.js';
import type { WindowSpec } from '../../src/types/definition.js';
import { asIsoDate } from '../../src/types/ids.js';
import { iatas } from '../support/build.js';

const d = asIsoDate;

describe('resolveWindow (spec §6.1)', () => {
  it('resolves the default relative window (offset 7, length 182) from 2026-10-14', () => {
    expect(resolveWindow({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, d('2026-10-14'))).toEqual(
      {
        departureFrom: '2026-10-21',
        departureTo: '2027-04-20',
        clamped: false,
      },
    );
  });

  it('resolves across a month end (2027-01-30 + 7 = 2027-02-06; +181 = 2027-08-06)', () => {
    expect(resolveWindow({ kind: 'relative', startOffsetDays: 7, lengthDays: 182 }, d('2027-01-30'))).toEqual(
      {
        departureFrom: '2027-02-06',
        departureTo: '2027-08-06',
        clamped: false,
      },
    );
  });

  it('startOffsetDays 1 starts tomorrow; lengthDays 1 is a single day', () => {
    expect(resolveWindow({ kind: 'relative', startOffsetDays: 1, lengthDays: 1 }, d('2028-02-28'))).toEqual({
      departureFrom: '2028-02-29',
      departureTo: '2028-02-29',
      clamped: false,
    });
  });

  it('leaves a future absolute window alone', () => {
    expect(
      resolveWindow({ kind: 'absolute', from: d('2027-03-01'), to: d('2027-03-31') }, d('2026-10-14')),
    ).toEqual({
      departureFrom: '2027-03-01',
      departureTo: '2027-03-31',
      clamped: false,
    });
  });

  it('accepts an absolute window starting exactly tomorrow without clamping', () => {
    expect(
      resolveWindow({ kind: 'absolute', from: d('2026-10-15'), to: d('2026-10-20') }, d('2026-10-14'))
        .clamped,
    ).toBe(false);
  });

  it('clamps an absolute window that starts today or earlier to tomorrow', () => {
    expect(
      resolveWindow({ kind: 'absolute', from: d('2026-10-01'), to: d('2026-10-31') }, d('2026-10-14')),
    ).toEqual({
      departureFrom: '2026-10-15',
      departureTo: '2026-10-31',
      clamped: true,
    });
    expect(
      resolveWindow({ kind: 'absolute', from: d('2026-10-14'), to: d('2026-10-31') }, d('2026-10-14'))
        .departureFrom,
    ).toBe('2026-10-15');
  });

  it('an absolute window wholly in the past resolves to zero cells', () => {
    const w = resolveWindow(
      { kind: 'absolute', from: d('2026-09-01'), to: d('2026-10-14') },
      d('2026-10-14'),
    );
    expect(w).toEqual({ departureFrom: '2026-10-15', departureTo: '2026-10-14', clamped: true });
    expect(
      countCells({ origins: iatas('LHR'), destinations: iatas('JFK'), minNights: 1, maxNights: 1, ...w }),
    ).toBe(0);
  });

  it.each([
    [{ kind: 'relative', startOffsetDays: 0, lengthDays: 10 }],
    [{ kind: 'relative', startOffsetDays: 1.5, lengthDays: 10 }],
    [{ kind: 'relative', startOffsetDays: 7, lengthDays: 0 }],
    [{ kind: 'relative', startOffsetDays: 7, lengthDays: 2.5 }],
  ] as Array<[WindowSpec]>)('throws RangeError on %j (validation rejects these first)', (w) => {
    expect(() => resolveWindow(w, d('2026-10-14'))).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/space/window.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/space/window.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/space/window.ts`:

```ts
import { addDays, daysBetween } from '../dates/epochDay.js';
import type { WindowSpec } from '../types/definition.js';
import type { IsoDate } from '../types/ids.js';

/**
 * Resolve a window against `todayLondon` (the caller passes `clock.todayLondon()`). Spec §6.1:
 * relative windows `{ startOffsetDays ≥ 1, lengthDays }` start `startOffsetDays` after today and
 * run `lengthDays` days inclusive; absolute windows are clamped to start no earlier than
 * tomorrow. An absolute window wholly before tomorrow resolves to `departureFrom > departureTo`,
 * which `countCells` counts as zero cells (the zero-cell case of spec §6.1). `clamped` is true
 * when an absolute window's start was moved forward to tomorrow (noted in the estimate).
 *
 * Throws `RangeError` for a relative window with `startOffsetDays < 1` or `lengthDays < 1`:
 * those are rejected by validation (`validateSearchSpace`) and by the zod schema, so reaching
 * here with one is a programming error, not operator input.
 */
export function resolveWindow(
  w: WindowSpec,
  todayLondon: IsoDate,
): { departureFrom: IsoDate; departureTo: IsoDate; clamped: boolean } {
  const tomorrow = addDays(todayLondon, 1);
  if (w.kind === 'relative') {
    if (!Number.isInteger(w.startOffsetDays) || w.startOffsetDays < 1) {
      throw new RangeError(`startOffsetDays must be an integer ≥ 1, got ${w.startOffsetDays}`);
    }
    if (!Number.isInteger(w.lengthDays) || w.lengthDays < 1) {
      throw new RangeError(`lengthDays must be an integer ≥ 1, got ${w.lengthDays}`);
    }
    const departureFrom = addDays(todayLondon, w.startOffsetDays);
    return { departureFrom, departureTo: addDays(departureFrom, w.lengthDays - 1), clamped: false };
  }
  const clamped = daysBetween(w.from, tomorrow) > 0; // from is before tomorrow
  return { departureFrom: clamped ? tomorrow : w.from, departureTo: w.to, clamped };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/space/window.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: resolveWindow with relative resolution and clamping (spec §6.1)"
```

### Task 1.4: `validateSearchSpace` with the airports lookup (pinned review focus 1)

**Files:**
- Create: `packages/core/test/space/validate.test.ts`, `packages/core/src/space/validate.ts`

**Interfaces:**
- Consumes: `SearchDefinition`, `VerificationPolicy`, `ResolvedSpace`, `CellKey`, `Iata`, `IsoDate`, `iataSchema`, `resolveWindow`, `countCells`, `daysBetween`.
- Produces: `validateSearchSpace`, `AirportLookup`, `ValidationResult`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { type AirportLookup, validateSearchSpace } from '../../src/space/validate.js';
import { asIsoDate, iataSchema } from '../../src/types/ids.js';
import { iatas, key } from '../support/build.js';

const today = asIsoDate('2026-10-14');
const MAX = 50_000;

// The airports table as the lookup sees it: four worked-example airports, the two metro codes
// they belong to, and the synthetic AAA, which is both an airport and a metro code.
const AIRPORTS = new Set(['LHR', 'LGW', 'JFK', 'EWR', 'AAA']);
const METROS: Record<string, string[]> = { LON: ['LHR', 'LGW'], NYC: ['JFK', 'EWR'], AAA: ['AAA', 'BBB'] };
const lookup: AirportLookup = {
  exists: (c) => AIRPORTS.has(c),
  metroOf: (c) => Object.entries(METROS).find(([, a]) => a.includes(c))?.[0] ?? null,
  airportsOfMetro: (c) => iatas(...(METROS[c] ?? [])),
};

type Input = Parameters<typeof validateSearchSpace>[0];

const base: Input = {
  origins: iatas('LHR', 'LGW'),
  destinations: iatas('JFK', 'EWR'),
  window: { kind: 'relative', startOffsetDays: 7, lengthDays: 182 },
  minNights: 10,
  maxNights: 21,
  verification: { maxCells: 10, topN: 10, alwaysInclude: [], expandTop: 2, bookingLinks: true },
};
const fields = (input: Input, max = MAX) => {
  const r = validateSearchSpace(input, today, lookup, max);
  return r.ok ? [] : r.errors;
};

describe('validateSearchSpace (spec §6.1)', () => {
  it('accepts the worked example and returns the resolved space', () => {
    expect(validateSearchSpace(base, today, lookup, MAX)).toEqual({
      ok: true,
      resolved: {
        origins: ['LHR', 'LGW'],
        destinations: ['JFK', 'EWR'],
        departureFrom: '2026-10-21',
        departureTo: '2027-04-20',
        minNights: 10,
        maxNights: 21,
      },
      clamped: false,
      notes: [],
    });
  });

  describe('review focus 1: lowercase and metropolitan codes', () => {
    it('upstream: iataSchema upper-cases operator input at the boundary (lhr → LHR)', () => {
      expect(iataSchema.parse('lhr')).toBe('LHR');
      expect(iataSchema.parse(' lgw ')).toBe('LGW');
      expect(iataSchema.safeParse('LHRX').success).toBe(false);
    });

    it('accepts the upper-cased code the schema produced', () => {
      const origins = ['lhr', 'lgw'].map((c) => iataSchema.parse(c));
      expect(validateSearchSpace({ ...base, origins }, today, lookup, MAX).ok).toBe(true);
    });

    it('upper-cases nothing itself: a lowercase code that bypassed the schema is a format error', () => {
      expect(fields({ ...base, origins: ['lhr' as never, ...iatas('LGW')] })).toEqual([
        { field: 'origins.0', message: 'lhr is not a three-letter upper-case IATA code' },
      ]);
    });

    it('rejects a metro code with a message naming it a city code and listing its airports', () => {
      expect(fields({ ...base, origins: iatas('LON') })).toEqual([
        { field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' },
      ]);
      expect(fields({ ...base, destinations: iatas('JFK', 'NYC') })).toEqual([
        { field: 'destinations.1', message: 'NYC is a city code; use one of JFK, EWR' },
      ]);
    });

    it('rejects an unknown code as absent from the airports table', () => {
      expect(fields({ ...base, destinations: iatas('XYZ') })).toEqual([
        { field: 'destinations.0', message: 'XYZ is not in the airports table' },
      ]);
    });

    it('accepts a code that is both an airport and a metro code (existence wins)', () => {
      expect(validateSearchSpace({ ...base, destinations: iatas('AAA') }, today, lookup, MAX).ok).toBe(true);
    });
  });

  it('requires at least one origin and one destination', () => {
    expect(fields({ ...base, origins: [], destinations: [] })).toEqual([
      { field: 'origins', message: 'at least one origin is required' },
      { field: 'destinations', message: 'at least one destination is required' },
    ]);
  });

  it('rejects a code listed twice and an airport that is both origin and destination', () => {
    expect(fields({ ...base, origins: iatas('LHR', 'LHR') })).toEqual([
      { field: 'origins.1', message: 'LHR is listed twice' },
    ]);
    expect(fields({ ...base, destinations: iatas('JFK', 'LHR') })).toEqual([
      { field: 'destinations.1', message: 'LHR is both an origin and a destination' },
    ]);
  });

  it.each([
    [{ minNights: -1 }, 'minNights', 'minNights must be an integer ≥ 0'],
    [{ minNights: 1.5, maxNights: 2 }, 'minNights', 'minNights must be an integer ≥ 0'],
    [{ maxNights: 91 }, 'maxNights', 'maxNights must be an integer ≤ 90'],
    [{ maxNights: 20.5 }, 'maxNights', 'maxNights must be an integer ≤ 90'],
    [{ minNights: 12, maxNights: 11 }, 'maxNights', 'maxNights must be ≥ minNights'],
  ])('rejects nights %j', (patch, field, message) => {
    expect(fields({ ...base, ...patch })).toContainEqual({ field, message });
  });

  it('accepts 0 ≤ minNights = maxNights ≤ 90 at both ends', () => {
    expect(validateSearchSpace({ ...base, minNights: 0, maxNights: 0 }, today, lookup, MAX).ok).toBe(true);
    expect(validateSearchSpace({ ...base, minNights: 90, maxNights: 90 }, today, lookup, MAX).ok).toBe(true);
  });

  it('rejects startOffsetDays = 0', () => {
    expect(fields({ ...base, window: { kind: 'relative', startOffsetDays: 0, lengthDays: 182 } })).toEqual([
      {
        field: 'window.startOffsetDays',
        message: 'startOffsetDays must be at least 1 (the window starts tomorrow at the earliest)',
      },
    ]);
  });

  it.each([0, 401, 10.5])('rejects lengthDays %d', (lengthDays) => {
    expect(fields({ ...base, window: { kind: 'relative', startOffsetDays: 7, lengthDays } })).toEqual([
      { field: 'window.lengthDays', message: 'lengthDays must be an integer from 1 to 400' },
    ]);
  });

  it('rejects an absolute window ending before it starts, and one longer than 400 days', () => {
    expect(
      fields({
        ...base,
        window: { kind: 'absolute', from: asIsoDate('2027-03-02'), to: asIsoDate('2027-03-01') },
      }),
    ).toEqual([{ field: 'window.to', message: 'window end must be on or after its start' }]);
    // 2027-01-01 .. 2028-02-04 is 400 days (2028 is a leap year); one more day is 401.
    const ok400 = { kind: 'absolute', from: asIsoDate('2027-01-01'), to: asIsoDate('2028-02-04') } as const;
    expect(
      validateSearchSpace({ ...base, minNights: 1, maxNights: 1, window: ok400 }, today, lookup, MAX).ok,
    ).toBe(true);
    expect(fields({ ...base, window: { ...ok400, to: asIsoDate('2028-02-05') } })).toEqual([
      { field: 'window.to', message: 'window must be at most 400 days' },
    ]);
  });

  it('rejects a zero-cell window (absolute, wholly in the past)', () => {
    expect(
      fields({
        ...base,
        window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-10-14') },
      }),
    ).toEqual([{ field: 'window', message: 'window resolves to zero cells: it ends before 2026-10-15' }]);
  });

  it('clamps a partly past absolute window and says so', () => {
    const r = validateSearchSpace(
      { ...base, window: { kind: 'absolute', from: asIsoDate('2026-10-01'), to: asIsoDate('2026-10-31') } },
      today,
      lookup,
      MAX,
    );
    expect(r).toMatchObject({
      ok: true,
      clamped: true,
      resolved: { departureFrom: '2026-10-15', departureTo: '2026-10-31' },
      notes: ['window start moved to 2026-10-15 (tomorrow); the start date had passed'],
    });
  });

  it('enforces MAX_CELLS_PER_DEFINITION with the count in the message (2 × 2 × 182 × 12 = 8,736)', () => {
    expect(validateSearchSpace(base, today, lookup, 8_736).ok).toBe(true);
    expect(fields(base, 8_735)).toEqual([
      { field: 'window', message: 'the space has 8736 cells; MAX_CELLS_PER_DEFINITION is 8735' },
    ]);
  });

  it('requires alwaysInclude members to be inside the resolved space at save time', () => {
    const inside = key('LHR', 'JFK', '2026-11-01', '2026-11-15'); // 14 nights, in window
    const outside = [
      key('LHR', 'JFK', '2026-10-20', '2026-11-01'), // departs before the window
      key('LHR', 'JFK', '2027-04-21', '2027-05-01'), // departs after the window
      key('LHR', 'JFK', '2026-11-01', '2026-11-10'), // 9 nights < min
      key('LHR', 'JFK', '2026-11-01', '2026-11-23'), // 22 nights > max
      key('LHR', 'AAA', '2026-11-01', '2026-11-15'), // destination not in the definition
      key('AAA', 'JFK', '2026-11-01', '2026-11-15'), // origin not in the definition
    ];
    const r = fields({
      ...base,
      verification: { ...base.verification, alwaysInclude: [inside, ...outside] },
    });
    expect(r.map((e) => e.field)).toEqual([1, 2, 3, 4, 5, 6].map((i) => `verification.alwaysInclude.${i}`));
    expect(r[0]?.message).toBe('LHR→JFK 2026-10-20–2026-11-01 is outside the search space');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/space/validate.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/space/validate.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/space/validate.ts`:

```ts
import { daysBetween } from '../dates/epochDay.js';
import type { CellKey, ResolvedSpace, SearchDefinition } from '../types/definition.js';
import type { Iata, IsoDate } from '../types/ids.js';
import { countCells } from './generate.js';
import { resolveWindow } from './window.js';

/**
 * Airports-table lookups `validateSearchSpace` needs. `AirportsRepo` (WP3) satisfies it; tests
 * pass a literal. `metroOf` is part of the contract (WP9's autocomplete hint) and is not called
 * here: the city-code message needs the airports of a metro, which `airportsOfMetro` gives.
 */
export interface AirportLookup {
  exists(iata: Iata): boolean;
  metroOf(iata: Iata): string | null;
  /** Airports the table maps to a metropolitan (city) code, in table order; empty when the code is not a metro. */
  airportsOfMetro(code: string): Iata[];
}

export type ValidationResult =
  | { ok: true; resolved: ResolvedSpace; clamped: boolean; notes: string[] }
  | { ok: false; errors: Array<{ field: string; message: string }> };

/** Spec §6.1 limits. */
const MAX_WINDOW_DAYS = 400;
const MAX_NIGHTS = 90;
const IATA_RE = /^[A-Z]{3}$/;

/**
 * Validate a definition's space at save time and at execution start. Spec §6.1: IATA format
 * `^[A-Z]{3}$` and existence; `to ≥ from`; window ≤ 400 days; `0 ≤ minNights ≤ maxNights ≤ 90`;
 * ≥1 origin and destination, disjoint; `countCells ≤ MAX_CELLS_PER_DEFINITION` (`maxCells`);
 * `alwaysInclude` members of the resolved space; `startOffsetDays = 0` rejected; a window that
 * resolves to zero cells rejected (spec §10: `POST /definitions` returns 422).
 *
 * why: nothing is upper-cased or otherwise repaired here. `iataSchema` upper-cases operator input
 * at the API boundary (review focus 1), so codes arrive upper-case; one that does not (a row
 * written around the schema) is rejected with a format error rather than silently repaired.
 *
 * Every error carries a dotted `field` path matching the request body (`origins.0`,
 * `window.startOffsetDays`, `verification.alwaysInclude.2`) so the form can place it.
 */
export function validateSearchSpace(
  def: Pick<
    SearchDefinition,
    'origins' | 'destinations' | 'window' | 'minNights' | 'maxNights' | 'verification'
  >,
  todayLondon: IsoDate,
  lookup: AirportLookup,
  maxCells: number,
): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const err = (field: string, message: string) => errors.push({ field, message });

  checkAirports('origins', def.origins, lookup, err);
  checkAirports('destinations', def.destinations, lookup, err);
  def.destinations.forEach((code, i) => {
    if (def.origins.includes(code)) err(`destinations.${i}`, `${code} is both an origin and a destination`);
  });

  if (!Number.isInteger(def.minNights) || def.minNights < 0) {
    err('minNights', 'minNights must be an integer ≥ 0');
  }
  if (!Number.isInteger(def.maxNights) || def.maxNights > MAX_NIGHTS) {
    err('maxNights', `maxNights must be an integer ≤ ${MAX_NIGHTS}`);
  }
  if (def.maxNights < def.minNights) err('maxNights', 'maxNights must be ≥ minNights');

  const w = def.window;
  if (w.kind === 'relative') {
    if (!Number.isInteger(w.startOffsetDays) || w.startOffsetDays < 1) {
      err(
        'window.startOffsetDays',
        'startOffsetDays must be at least 1 (the window starts tomorrow at the earliest)',
      );
    }
    if (!Number.isInteger(w.lengthDays) || w.lengthDays < 1 || w.lengthDays > MAX_WINDOW_DAYS) {
      err('window.lengthDays', `lengthDays must be an integer from 1 to ${MAX_WINDOW_DAYS}`);
    }
  } else {
    const span = daysBetween(w.from, w.to) + 1;
    if (span < 1) err('window.to', 'window end must be on or after its start');
    if (span > MAX_WINDOW_DAYS) err('window.to', `window must be at most ${MAX_WINDOW_DAYS} days`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const win = resolveWindow(w, todayLondon);
  const resolved: ResolvedSpace = {
    origins: [...def.origins],
    destinations: [...def.destinations],
    departureFrom: win.departureFrom,
    departureTo: win.departureTo,
    minNights: def.minNights,
    maxNights: def.maxNights,
  };
  const cells = countCells(resolved);
  if (cells === 0) {
    return {
      ok: false,
      errors: [
        { field: 'window', message: `window resolves to zero cells: it ends before ${win.departureFrom}` },
      ],
    };
  }
  if (cells > maxCells) {
    return {
      ok: false,
      errors: [
        { field: 'window', message: `the space has ${cells} cells; MAX_CELLS_PER_DEFINITION is ${maxCells}` },
      ],
    };
  }
  def.verification.alwaysInclude.forEach((cell, i) => {
    if (!inSpace(cell, resolved)) {
      err(
        `verification.alwaysInclude.${i}`,
        `${cell.origin}→${cell.destination} ${cell.departureDate}–${cell.returnDate} is outside the search space`,
      );
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const notes = win.clamped
    ? [`window start moved to ${win.departureFrom} (tomorrow); the start date had passed`]
    : [];
  return { ok: true, resolved, clamped: win.clamped, notes };
}

function checkAirports(
  field: 'origins' | 'destinations',
  codes: readonly string[],
  lookup: AirportLookup,
  err: (field: string, message: string) => void,
): void {
  if (codes.length === 0) {
    err(field, `at least one ${field === 'origins' ? 'origin' : 'destination'} is required`);
  }
  codes.forEach((code, i) => {
    const problem = airportProblem(code, codes.indexOf(code) !== i, lookup);
    if (problem !== null) err(`${field}.${i}`, problem);
  });
}

/** The first thing wrong with one code, or null. Order: format, duplicate, existence, metro. */
function airportProblem(code: string, duplicate: boolean, lookup: AirportLookup): string | null {
  if (!IATA_RE.test(code)) return `${code} is not a three-letter upper-case IATA code`;
  if (duplicate) return `${code} is listed twice`;
  // why: existence is checked before the metro test, so a code that is both an airport and a
  // metro code in the table (some cities share their main airport's code) is accepted.
  if (lookup.exists(code as Iata)) return null;
  const metro = lookup.airportsOfMetro(code);
  if (metro.length > 0) return `${code} is a city code; use one of ${metro.join(', ')}`;
  return `${code} is not in the airports table`;
}

/** Closed-form membership of a cell in a resolved space (no generation). */
function inSpace(cell: CellKey, space: ResolvedSpace): boolean {
  const nights = daysBetween(cell.departureDate, cell.returnDate);
  return (
    space.origins.includes(cell.origin) &&
    space.destinations.includes(cell.destination) &&
    daysBetween(space.departureFrom, cell.departureDate) >= 0 &&
    daysBetween(cell.departureDate, space.departureTo) >= 0 &&
    nights >= space.minNights &&
    nights <= space.maxNights
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/space/validate.test.ts`
Expected: PASS, 23 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: validateSearchSpace with metro-code and unknown-airport messages (spec §6.1, review focus 1)"
```

### Task 1.5: `rollUp` and `mergeWithinProvider`

**Files:**
- Create: `packages/core/test/coverage/rollUp.test.ts`, `packages/core/src/coverage/rollUp.ts`

**Interfaces:**
- Consumes: `CellOutcome`, `CellOutcomeStatus`, `RollUp`, `SkipReason`, `cellKeyString`.
- Produces: `rollUp`, `mergeWithinProvider`.

- [ ] **Step 1: Write the failing test**

The precedence table is checked three ways: the named rows, an exhaustive comparison against an oracle transcribed independently from spec §6.6 (every sequence of up to three outcomes over nine variants, 820 cases), and fast-check properties (oracle agreement on longer arrays, order independence, monotonicity under an added `priced`). The merge is checked by cases on the merged fields (`status`, `minPence`, `reason`), by the rule for every other field, by its refusals, and by commutativity, associativity, idempotence, rank and min-price properties.

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeWithinProvider, rollUp } from '../../src/coverage/rollUp.js';
import type { CellOutcome, RollUp, SkipReason } from '../../src/types/execution.js';
import { key, outcome } from '../support/build.js';

// One cell; the providers differ per row in real data, but rollUp reads only status, reason, minPence.
const K = key('LHR', 'JFK', '2027-03-01', '2027-03-08');
type O = CellOutcome;
const o = (status: O['status'], extra: Partial<Pick<O, 'reason' | 'minPence'>> = {}): O =>
  outcome(K, status, extra);
const priced = (p: number) => o('priced', { minPence: p });
const skipped = (reason: SkipReason) => o('skipped', { reason });

/**
 * Independent oracle: spec §6.6's table transcribed row by row, including row 4's full condition
 * ("any empty and every other ∈ {empty, no_data, skipped}"), written without reference to the
 * implementation's early returns.
 */
function oracle(xs: readonly O[]): RollUp {
  const any = (s: O['status']) => xs.some((x) => x.status === s);
  if (xs.length === 0) return { status: null, reason: null, minPence: null }; // row 0
  if (any('priced')) {
    const ps = xs.filter((x) => x.status === 'priced').map((x) => x.minPence as number);
    return { status: 'priced', reason: null, minPence: Math.min(...ps) }; // row 1
  }
  if (any('not_run')) return { status: 'not_run', reason: null, minPence: null }; // row 2
  if (any('error')) return { status: 'error', reason: null, minPence: null }; // row 3
  if (any('empty') && xs.every((x) => ['empty', 'no_data', 'skipped'].includes(x.status))) {
    return { status: 'empty', reason: null, minPence: null }; // row 4
  }
  if (any('no_data')) return { status: 'no_data', reason: null, minPence: null }; // row 5
  // row 6: all skipped
  const rs = xs.map((x) => x.reason);
  const reason = rs.includes('budget')
    ? 'budget'
    : rs.includes('provider_disabled')
      ? 'provider_disabled'
      : rs.includes('departed')
        ? 'departed'
        : 'not_selected';
  return { status: 'skipped', reason, minPence: null };
}

const VARIANTS: O[] = [
  o('not_run'),
  priced(41_200),
  o('empty'),
  o('no_data'),
  o('error', { reason: 'upstream' }),
  skipped('budget'),
  skipped('provider_disabled'),
  skipped('departed'),
  skipped('not_selected'),
];

describe('rollUp precedence (spec §6.6)', () => {
  it.each([
    ['row 0: no rows', [], { status: null, reason: null, minPence: null }],
    [
      'row 1: any priced wins over not_run and error',
      [o('not_run'), o('error'), priced(500)],
      { status: 'priced', reason: null, minPence: 500 },
    ],
    [
      'row 1: minPence is the minimum priced',
      [priced(700), priced(450), o('empty')],
      { status: 'priced', reason: null, minPence: 450 },
    ],
    [
      'row 2: not_run beats error',
      [o('error'), o('not_run')],
      { status: 'not_run', reason: null, minPence: null },
    ],
    ['row 3: error beats empty', [o('empty'), o('error')], { status: 'error', reason: null, minPence: null }],
    [
      'row 4: empty with no_data and skipped',
      [o('no_data'), o('empty'), skipped('budget')],
      { status: 'empty', reason: null, minPence: null },
    ],
    [
      'row 5: no_data with skipped',
      [skipped('budget'), o('no_data')],
      { status: 'no_data', reason: null, minPence: null },
    ],
    [
      'row 6: budget first',
      [skipped('not_selected'), skipped('departed'), skipped('budget')],
      { status: 'skipped', reason: 'budget', minPence: null },
    ],
    [
      'row 6: provider_disabled over departed',
      [skipped('departed'), skipped('provider_disabled')],
      { status: 'skipped', reason: 'provider_disabled', minPence: null },
    ],
    [
      'row 6: departed over not_selected',
      [skipped('not_selected'), skipped('departed')],
      { status: 'skipped', reason: 'departed', minPence: null },
    ],
    [
      'row 6: not_selected alone',
      [skipped('not_selected')],
      { status: 'skipped', reason: 'not_selected', minPence: null },
    ],
  ] as Array<[string, O[], RollUp]>)('%s', (_name, xs, expected) => {
    expect(rollUp(xs)).toEqual(expected);
  });

  it('matches the independent oracle on every sequence of up to three outcomes (820 cases)', () => {
    let cases = 0;
    const walk = (prefix: O[]) => {
      expect(rollUp(prefix), JSON.stringify(prefix)).toEqual(oracle(prefix));
      cases += 1;
      if (prefix.length < 3) for (const v of VARIANTS) walk([...prefix, v]);
    };
    walk([]);
    expect(cases).toBe(1 + 9 + 81 + 729);
  });

  const arbOutcome: fc.Arbitrary<O> = fc.oneof(
    fc.constantFrom<O['status']>('not_run', 'empty', 'no_data', 'error').map((s) => o(s)),
    fc.integer({ min: 0, max: 1_000_000 }).map(priced),
    fc.constantFrom<SkipReason>('budget', 'provider_disabled', 'departed', 'not_selected').map(skipped),
  );

  it('property: agrees with the oracle, ignores order, and only ever reports a status it was given', () => {
    fc.assert(
      fc.property(fc.array(arbOutcome, { maxLength: 8 }), (xs) => {
        const r = rollUp(xs);
        expect(r).toEqual(oracle(xs));
        expect(rollUp([...xs].reverse())).toEqual(r);
        if (r.status === null) expect(xs).toHaveLength(0);
        else expect(xs.map((x) => x.status)).toContain(r.status);
      }),
      { numRuns: 1000 },
    );
  });

  it('property: adding a priced outcome always yields priced', () => {
    fc.assert(
      fc.property(fc.array(arbOutcome, { maxLength: 8 }), fc.integer({ min: 0, max: 1_000_000 }), (xs, p) => {
        expect(rollUp([...xs, priced(p)]).status).toBe('priced');
      }),
    );
  });

  it('throws on a priced outcome without minPence and on an unknown skip reason', () => {
    expect(() => rollUp([o('priced')])).toThrow(/no minPence/);
    expect(() => rollUp([o('skipped', { reason: 'tired' })])).toThrow(/unknown reason: tired/);
    expect(() => rollUp([o('skipped')])).toThrow(/unknown reason: null/);
  });
});

describe('mergeWithinProvider (spec §6.6 monotone merge)', () => {
  type M = 'priced' | 'empty' | 'no_data' | 'error';
  const m = (
    status: M,
    minPence: number | null = null,
    reason: string | null = null,
    over: Partial<O> = {},
  ): O => outcome(K, status, { minPence, reason, ...over });
  const merged = (x: O) => ({ status: x.status, minPence: x.minPence, reason: x.reason });

  it.each([
    [m('priced', 500), m('error', null, 'upstream'), { status: 'priced', minPence: 500, reason: null }],
    [
      m('error', null, 'upstream'),
      m('priced', 500, 'partial-expansion'),
      { status: 'priced', minPence: 500, reason: 'partial-expansion' },
    ],
    [m('empty'), m('no_data'), { status: 'empty', minPence: null, reason: null }],
    [m('empty', null, 'x'), m('error', null, 'upstream'), { status: 'empty', minPence: null, reason: 'x' }],
    [m('no_data'), m('error', null, 'parse'), { status: 'no_data', minPence: null, reason: null }],
    [m('priced', 700), m('priced', 450), { status: 'priced', minPence: 450, reason: null }],
    [
      m('error', null, 'upstream'),
      m('error', null, 'parse'),
      { status: 'error', minPence: null, reason: 'parse' },
    ],
    [m('error'), m('error', null, 'network'), { status: 'error', minPence: null, reason: 'network' }],
    [m('error'), m('error'), { status: 'error', minPence: null, reason: null }],
  ])('merge(%j, %j) has status/minPence/reason %j', (a, b, expected) => {
    expect(merged(mergeWithinProvider(a, b))).toEqual(expected);
  });

  it('keeps the winning outcome’s other fields, and a’s on equal status', () => {
    const a = m('priced', 700, null, { fetchedAt: '2026-10-14T05:00:00.000Z' as never, attempts: 1 });
    const b = m('priced', 450, null, { fetchedAt: '2026-10-14T06:00:00.000Z' as never, attempts: 2 });
    expect(mergeWithinProvider(a, b)).toEqual({ ...a, minPence: 450 });
    const e = m('empty', null, null, { attempts: 3 });
    expect(mergeWithinProvider(e, a)).toEqual(a);
  });

  it('refuses outcomes of different cells, stages, providers or executions', () => {
    const a = m('priced', 500);
    const other = outcome(key('LHR', 'JFK', '2027-03-02', '2027-03-09'), 'empty');
    expect(() => mergeWithinProvider(a, other)).toThrow(/one cell, stage, provider and execution/);
    expect(() => mergeWithinProvider(a, m('empty', null, null, { stage: 'verification' }))).toThrow(
      /one cell/,
    );
    expect(() => mergeWithinProvider(a, m('empty', null, null, { providerId: 'searchapi' }))).toThrow(
      /one cell/,
    );
    expect(() => mergeWithinProvider(a, m('empty', null, null, { executionId: 'exec-2' }))).toThrow(
      /one cell/,
    );
  });

  it('refuses not_run and skipped (seeding and skipping replace outcomes, they never merge)', () => {
    expect(() => mergeWithinProvider(m('priced', 500), outcome(K, 'not_run'))).toThrow(
      /cannot merge priced with not_run/,
    );
    expect(() => mergeWithinProvider(outcome(K, 'skipped', { reason: 'budget' }), m('empty'))).toThrow(
      /cannot merge skipped/,
    );
  });

  const arb: fc.Arbitrary<O> = fc.oneof(
    fc
      .tuple(fc.integer({ min: 0, max: 100_000 }), fc.constantFrom(null, 'partial-expansion'))
      .map(([p, r]) => m('priced', p, r)),
    fc
      .tuple(fc.constantFrom<M>('empty', 'no_data', 'error'), fc.constantFrom(null, 'upstream', 'parse'))
      .map(([st, r]) => m(st, null, r)),
  );
  const rank: Record<M, number> = { priced: 3, empty: 2, no_data: 1, error: 0 };

  it('property: on status, minPence and reason it is commutative, associative, idempotent, monotone', () => {
    fc.assert(
      fc.property(arb, arb, arb, (a, b, c) => {
        const ab = mergeWithinProvider(a, b);
        expect(merged(ab)).toEqual(merged(mergeWithinProvider(b, a)));
        expect(merged(mergeWithinProvider(ab, c))).toEqual(
          merged(mergeWithinProvider(a, mergeWithinProvider(b, c))),
        );
        expect(merged(mergeWithinProvider(a, a))).toEqual(merged(a));
        expect(rank[ab.status as M]).toBe(Math.max(rank[a.status as M], rank[b.status as M]));
        const prices = [a, b].flatMap((x) => (x.status === 'priced' ? [x.minPence as number] : []));
        expect(ab.minPence).toBe(prices.length > 0 ? Math.min(...prices) : null);
      }),
      { numRuns: 1000 },
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/coverage/rollUp.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/coverage/rollUp.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/coverage/rollUp.ts`:

```ts
import { cellKeyString } from '../types/definition.js';
import type { CellOutcome, CellOutcomeStatus, RollUp, SkipReason } from '../types/execution.js';

/** Spec §6.6 row 6: the reason a fully skipped cell reports, highest priority first. */
const SKIP_REASON_PRIORITY: readonly SkipReason[] = [
  'budget',
  'provider_disabled',
  'departed',
  'not_selected',
];

/**
 * Roll the outcomes of one cell in one stage (one row per provider) into the cell's stage status.
 * Spec §6.6 precedence, first matching row wins:
 *
 * | 0 | no outcome rows                                      | `null` (`not_applicable` in the API) |
 * | 1 | any `priced`                                         | `priced`  |
 * | 2 | any `not_run`                                        | `not_run` |
 * | 3 | any `error`                                          | `error`   |
 * | 4 | any `empty`, every other ∈ {empty, no_data, skipped} | `empty`   |
 * | 5 | any `no_data`                                        | `no_data` |
 * | 6 | all `skipped`                                        | `skipped`, reason budget > provider_disabled > departed > not_selected |
 *
 * `minPence` is the minimum over `priced` outcomes ("the minimum over rows actually written",
 * spec §5.6), else `null`. `reason` is set only for `skipped`.
 *
 * Throws on a `skipped` outcome whose reason is not a `SkipReason` and on a `priced` outcome with
 * no `minPence`: both are broken invariants (spec §3) that must not be rolled up silently.
 */
export function rollUp(outcomes: CellOutcome[]): RollUp {
  if (outcomes.length === 0) return { status: null, reason: null, minPence: null };
  const has = (s: CellOutcomeStatus) => outcomes.some((o) => o.status === s);
  if (has('priced')) {
    let min = Number.POSITIVE_INFINITY;
    for (const o of outcomes) {
      if (o.status !== 'priced') continue;
      if (o.minPence === null) {
        throw new Error('a priced outcome has no minPence (spec §3: priced means a price was written)');
      }
      min = Math.min(min, o.minPence);
    }
    return { status: 'priced', reason: null, minPence: min };
  }
  if (has('not_run')) return { status: 'not_run', reason: null, minPence: null };
  if (has('error')) return { status: 'error', reason: null, minPence: null };
  // why: rows 1–3 have removed priced, not_run and error, so every remaining outcome is empty,
  // no_data or skipped; row 4's "every other ∈ {empty, no_data, skipped}" is therefore implied.
  if (has('empty')) return { status: 'empty', reason: null, minPence: null };
  if (has('no_data')) return { status: 'no_data', reason: null, minPence: null };
  const reasons = outcomes.map((o) => o.reason);
  for (const r of reasons) {
    if (!SKIP_REASON_PRIORITY.includes(r as SkipReason)) {
      throw new Error(`skipped outcome with unknown reason: ${String(r)}`);
    }
  }
  const reason = SKIP_REASON_PRIORITY.find((r) => reasons.includes(r)) as SkipReason;
  return { status: 'skipped', reason, minPence: null };
}

/** Spec §6.6 merge order; only statuses a fetch produces take part. */
const RANK: Partial<Record<CellOutcomeStatus, number>> = { priced: 3, empty: 2, no_data: 1, error: 0 };

/**
 * Merge two outcomes for the same cell, stage and provider. Spec §6.6: "Within one provider,
 * monotone merge `priced > empty > no_data > error`, `min_pence = min`". Tiles partition cells,
 * so this is a safety net. On the merged fields (`status`, `minPence`, `reason`) it is
 * commutative, associative and idempotent (property-tested): the status is the higher-ranked,
 * `minPence` the minimum over the priced inputs, and the reason follows the winning status (on
 * equal status, the lexicographically smaller non-null reason).
 *
 * why: every other field (`fetchedAt`, `attempts`, provenance columns) comes from the winning
 * outcome, and from `a` on equal status; callers pass (existing, incoming).
 *
 * Throws when the two outcomes are for different cells, stages, providers or executions, or when
 * either status is `not_run` or `skipped` (seeding and skipping replace outcomes; they never merge).
 */
export function mergeWithinProvider(a: CellOutcome, b: CellOutcome): CellOutcome {
  if (
    cellKeyString(a) !== cellKeyString(b) ||
    a.stage !== b.stage ||
    a.providerId !== b.providerId ||
    a.executionId !== b.executionId
  ) {
    throw new Error('mergeWithinProvider merges outcomes of one cell, stage, provider and execution');
  }
  const ra = RANK[a.status];
  const rb = RANK[b.status];
  if (ra === undefined || rb === undefined) {
    throw new Error(`mergeWithinProvider: cannot merge ${a.status} with ${b.status}`);
  }
  const winner = ra >= rb ? a : b;
  const reasons = [a, b]
    .filter((o) => o.status === winner.status && o.reason !== null)
    .map((o) => o.reason as string)
    .sort();
  const prices = [a, b].flatMap((o) => (o.status === 'priced' && o.minPence !== null ? [o.minPence] : []));
  return {
    ...winner,
    reason: reasons[0] ?? null,
    minPence: winner.status === 'priced' ? Math.min(...prices) : null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/coverage/rollUp.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: roll-up precedence and monotone merge with independent enumeration (spec §6.6)"
```

### Task 1.6: `sixBuckets` and `selectedNotReached`

**Files:**
- Create: `packages/core/test/coverage/buckets.test.ts`, `packages/core/src/coverage/buckets.ts`

**Interfaces:**
- Consumes: `Buckets`, `CellOutcome`, `CellKey`, `cellKeyString`, `rollUp`.
- Produces: `sixBuckets`, `selectedNotReached`.

- [ ] **Step 1: Write the failing test**

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { selectedNotReached, sixBuckets } from '../../src/coverage/buckets.js';
import { generateCells } from '../../src/space/generate.js';
import type { CellOutcomeStatus } from '../../src/types/execution.js';
import { key, outcome, space } from '../support/build.js';

const cells = generateCells(
  space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 7, max: 8 }),
); // 6 cells

describe('sixBuckets (spec §3: six buckets summing to the cell count)', () => {
  it('counts one stage × provider into the six buckets and reused beside them', () => {
    const statuses: CellOutcomeStatus[] = ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run'];
    const outs = cells.map((c, i) =>
      outcome(c, statuses[i] as CellOutcomeStatus, { reusedFromExecutionId: i < 2 ? 'exec-0' : null }),
    );
    expect(sixBuckets(outs)).toEqual({
      priced: 1,
      empty: 1,
      no_data: 1,
      error: 1,
      skipped: 1,
      not_run: 1,
      reused: 2,
    });
  });

  it('is all zeros for no outcomes', () => {
    expect(sixBuckets([])).toEqual({
      priced: 0,
      empty: 0,
      no_data: 0,
      error: 0,
      skipped: 0,
      not_run: 0,
      reused: 0,
    });
  });

  it('property: the six buckets always sum to the cell count; reused never exceeds it', () => {
    const status = fc.constantFrom<CellOutcomeStatus>(
      'priced',
      'empty',
      'no_data',
      'error',
      'skipped',
      'not_run',
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(status, fc.boolean()), { minLength: cells.length, maxLength: cells.length }),
        (spec) => {
          const outs = cells.map((c, i) => {
            const [s, reused] = spec[i] as [CellOutcomeStatus, boolean];
            return outcome(c, s, { reusedFromExecutionId: reused ? 'exec-0' : null });
          });
          const b = sixBuckets(outs);
          expect(b.priced + b.empty + b.no_data + b.error + b.skipped + b.not_run).toBe(cells.length);
          expect(b.reused).toBe(spec.filter(([, r]) => r).length);
        },
      ),
    );
  });

  it('refuses mixed stages, mixed providers and repeated cells (the sum would be wrong)', () => {
    const [a, b] = cells;
    if (!a || !b) throw new Error('fixture');
    expect(() => sixBuckets([outcome(a, 'priced'), outcome(b, 'priced', { stage: 'verification' })])).toThrow(
      /one stage and one provider/,
    );
    expect(() =>
      sixBuckets([outcome(a, 'priced'), outcome(b, 'priced', { providerId: 'searchapi' })]),
    ).toThrow(/one stage and one provider/);
    expect(() => sixBuckets([outcome(a, 'priced'), outcome(a, 'empty')])).toThrow(/appears twice/);
  });
});

describe('selectedNotReached (spec §6.6: selected ∧ (not_run ∨ skipped:budget))', () => {
  const v = { stage: 'verification' as const, providerId: 'searchapi' as const };
  const [c0, c1, c2, c3, c4, c5] = cells.map((c) =>
    key(c.origin, c.destination, c.departureDate, c.returnDate),
  );
  if (!c0 || !c1 || !c2 || !c3 || !c4 || !c5) throw new Error('fixture');

  it('lists selected cells left not_run or skipped for budget, in selection order, with the reason', () => {
    const outs = [
      outcome(c0, 'priced', { ...v, minPence: 41_200 }),
      outcome(c1, 'not_run', v),
      outcome(c2, 'skipped', { ...v, reason: 'budget' }),
      outcome(c3, 'skipped', { ...v, reason: 'provider_disabled' }),
      outcome(c4, 'error', { ...v, reason: 'upstream' }),
      outcome(c5, 'empty', v),
    ];
    expect(selectedNotReached([c2, c0, c1, c3, c4, c5], outs)).toEqual([
      { cell: c2, reason: 'budget' },
      { cell: c1, reason: 'not_run' },
    ]);
  });

  it('a cell priced by one verification provider was reached even if another is skipped:budget', () => {
    const outs = [
      outcome(c0, 'priced', { ...v, minPence: 500 }),
      outcome(c0, 'skipped', { ...v, providerId: 'fixture', reason: 'budget' }),
    ];
    expect(selectedNotReached([c0], outs)).toEqual([]);
  });

  it('ignores discovery outcomes and cells with no verification rows (not applicable)', () => {
    expect(selectedNotReached([c0], [outcome(c0, 'not_run')])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/coverage/buckets.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/coverage/buckets.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/coverage/buckets.ts`:

```ts
import { type CellKey, cellKeyString } from '../types/definition.js';
import type { Buckets, CellOutcome } from '../types/execution.js';
import { rollUp } from './rollUp.js';

/**
 * Count one stage × provider's outcomes into the six coverage buckets of spec §3: priced, no
 * fares (`empty`), no cached data (`no_data`), error, skipped, not searched (`not_run`). They sum
 * to the cell count. `reused` is not a seventh bucket: it counts outcomes copied from an earlier
 * execution, which also sit in their own bucket ("(R reused from earlier runs)").
 *
 * Throws when the outcomes mix stages or providers, or repeat a cell, because then the buckets
 * could not sum to the cell count.
 */
export function sixBuckets(outcomes: CellOutcome[]): Buckets {
  const b: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
  const seen = new Set<string>();
  const first = outcomes[0];
  for (const o of outcomes) {
    if (o.stage !== first?.stage || o.providerId !== first.providerId) {
      throw new Error('sixBuckets takes the outcomes of one stage and one provider');
    }
    const key = cellKeyString(o);
    if (seen.has(key)) throw new Error(`sixBuckets: cell ${key} appears twice`);
    seen.add(key);
    b[o.status] += 1;
    if (o.reusedFromExecutionId !== null) b.reused += 1;
  }
  return b;
}

/**
 * Spec §6.6: "Selected but not reached" = `selected ∧ (not_run ∨ skipped:budget)`, judged on the
 * cell's verification roll-up across verification providers (so a cell any provider priced was
 * reached). `reason` is `'not_run'` or `'budget'`. `outcomes` are the execution's outcomes;
 * discovery rows are ignored. Returned in the order of `selected`.
 */
export function selectedNotReached(
  selected: CellKey[],
  outcomes: CellOutcome[],
): Array<{ cell: CellKey; reason: string }> {
  const byCell = new Map<string, CellOutcome[]>();
  for (const o of outcomes) {
    if (o.stage !== 'verification') continue;
    const key = cellKeyString(o);
    const list = byCell.get(key) ?? [];
    list.push(o);
    byCell.set(key, list);
  }
  const out: Array<{ cell: CellKey; reason: string }> = [];
  for (const cell of selected) {
    const r = rollUp(byCell.get(cellKeyString(cell)) ?? []);
    if (r.status === 'not_run') out.push({ cell, reason: 'not_run' });
    else if (r.status === 'skipped' && r.reason === 'budget') out.push({ cell, reason: 'budget' });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/coverage/buckets.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: six coverage buckets and selected-but-not-reached (spec §3, §6.6)"
```

### Task 1.7: `selectCandidates`

**Files:**
- Create: `packages/core/test/selection/select.test.ts`, `packages/core/src/selection/select.ts`

**Interfaces:**
- Consumes: `VerificationPolicy`, `Cell`, `CellKey`, `RollUp`, `SelectionReason`, `cellKeyString`, `generateCells`.
- Produces: `selectCandidates`.

Interpretation fixed here (spec §6.7 step 5, "advancing past `alwaysInclude` members rather than losing a slot"): the stride keeps a cursor; when the cursor lands on an already selected cell it moves one cell forward and tries again, and after each pick the cursor jumps `k` cells from the pick. The stride ignores `perDepartureDateBest` (spec §6.7 step 5 replaces steps 2–4, which are where that cap applies).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { selectCandidates } from '../../src/selection/select.js';
import { generateCells } from '../../src/space/generate.js';
import { type Cell, cellKeyString, type VerificationPolicy } from '../../src/types/definition.js';
import type { RollUp } from '../../src/types/execution.js';
import { key, space } from '../support/build.js';

// 3 departure days × 2 nights = 6 cells, generation order:
// 0: 03-01+7  1: 03-01+8  2: 03-02+7  3: 03-02+8  4: 03-03+7  5: 03-03+8
const cells = generateCells(
  space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 7, max: 8 }),
);
const at = (i: number) => cells[i] as Cell;
const k = (i: number) => key(at(i).origin, at(i).destination, at(i).departureDate, at(i).returnDate);

/** Discovery roll-ups from a list of [cell index, price]; unlisted cells have no priced roll-up. */
function priced(
  entries: Array<[number, number]>,
  others: Partial<Record<number, RollUp>> = {},
): Map<string, RollUp> {
  const m = new Map<string, RollUp>();
  for (const [i, p] of entries) m.set(cellKeyString(at(i)), { status: 'priced', reason: null, minPence: p });
  for (const [i, r] of Object.entries(others)) if (r) m.set(cellKeyString(at(Number(i))), r);
  return m;
}
// expandTop and bookingLinks belong to stage 2's search, not to selection; fixed values here.
const policy = (p: Partial<VerificationPolicy>): VerificationPolicy => ({
  maxCells: 10,
  topN: 10,
  alwaysInclude: [],
  expandTop: 2,
  bookingLinks: true,
  ...p,
});
const picks = (r: ReturnType<typeof selectCandidates>) =>
  r.map((s) => [cells.findIndex((c) => cellKeyString(c) === cellKeyString(s.cell)), s.reason]);

const PRICES: Array<[number, number]> = [
  [0, 600],
  [1, 400],
  [2, 500],
  [3, 400],
  [4, 900],
  [5, 300],
];

describe('selectCandidates (spec §6.7)', () => {
  it('step 2–3: ranks priced cells by minPence, ties in generation order, stops after topN', () => {
    expect(picks(selectCandidates(policy({ topN: 4 }), cells, priced(PRICES), true))).toEqual([
      [5, 'top_n'],
      [1, 'top_n'],
      [3, 'top_n'],
      [2, 'top_n'], // 400 tie: index 1 before 3
    ]);
  });

  it('only priced roll-ups are ranked: empty, no_data, error, not_run and absent cells are not selected', () => {
    const others = {
      1: { status: 'empty', reason: null, minPence: null },
      2: { status: 'no_data', reason: null, minPence: null },
      3: { status: 'error', reason: null, minPence: null },
      4: { status: 'not_run', reason: null, minPence: null },
    } satisfies Partial<Record<number, RollUp>>;
    expect(picks(selectCandidates(policy({}), cells, priced([[0, 600]], others), true))).toEqual([
      [0, 'top_n'],
    ]);
  });

  it('step 1: alwaysInclude first, deduplicated, counted toward maxCells, skipped in the walk', () => {
    const r = selectCandidates(
      policy({ maxCells: 3, alwaysInclude: [k(4), k(5), k(4)] }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [4, 'always_include'],
      [5, 'always_include'],
      [1, 'top_n'],
    ]);
  });

  it('step 3: maxCells stops additions before topN is reached', () => {
    expect(picks(selectCandidates(policy({ maxCells: 2, topN: 5 }), cells, priced(PRICES), true))).toEqual([
      [5, 'top_n'],
      [1, 'top_n'],
    ]);
  });

  it('step 3: perDepartureDateBest caps each date and counts alwaysInclude toward it', () => {
    // 03-03 already has cell 4 from alwaysInclude, so cell 5 (cheapest, also 03-03) is skipped;
    // 1 (400, 03-01) and 3 (400, 03-02) are taken; 2 (500, 03-02) finds 03-02 full.
    const r = selectCandidates(
      policy({ perDepartureDateBest: 1, alwaysInclude: [k(4)] }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [4, 'always_include'],
      [1, 'top_n'],
      [3, 'top_n'],
    ]);
  });

  it('step 4: with a ceiling, keeps walking after topN adding only cells ≤ ceiling until maxCells', () => {
    const r = selectCandidates(
      policy({ topN: 1, maxCells: 4, priceCeilingPence: 500 }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [5, 'top_n'],
      [1, 'ceiling'],
      [3, 'ceiling'],
      [2, 'ceiling'],
    ]);
  });

  it('step 4: the ceiling excludes dearer cells, honours perDepartureDateBest, and is inclusive', () => {
    const r = selectCandidates(
      policy({ topN: 1, priceCeilingPence: 400, perDepartureDateBest: 1 }),
      cells,
      priced(PRICES),
      true,
    );
    // 5 (300) top_n; 1 (400, 03-01) ceiling; 3 (400, 03-02) ceiling; 2 (500) over the ceiling.
    expect(picks(r)).toEqual([
      [5, 'top_n'],
      [1, 'ceiling'],
      [3, 'ceiling'],
    ]);
  });

  it('step 4: cells dearer than the ceiling are never added, however much room is left', () => {
    const r = selectCandidates(
      policy({ topN: 1, maxCells: 6, priceCeilingPence: 450 }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [5, 'top_n'],
      [1, 'ceiling'],
      [3, 'ceiling'],
    ]); // 2 (500), 0 (600), 4 (900) excluded
  });

  it('step 4: an alwaysInclude member under the ceiling is not added twice', () => {
    const r = selectCandidates(
      policy({ topN: 1, maxCells: 6, priceCeilingPence: 450, alwaysInclude: [k(1)] }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [1, 'always_include'],
      [5, 'top_n'],
      [3, 'ceiling'],
    ]);
  });

  it('step 3: perDepartureDateBest 2 allows exactly two cells per date', () => {
    const r = selectCandidates(
      policy({ perDepartureDateBest: 2 }),
      cells,
      priced([
        [0, 100],
        [1, 200],
        [2, 300],
        [3, 400],
      ]),
      true,
    );
    expect(picks(r).map(([i]) => i)).toEqual([0, 1, 2, 3]);
    const same = selectCandidates(
      policy({ perDepartureDateBest: 2, alwaysInclude: [k(0)] }),
      cells,
      priced([
        [1, 200],
        [2, 300],
      ]),
      true,
    );
    expect(picks(same).map(([i]) => i)).toEqual([0, 1, 2]);
  });

  it('step 4: without a ceiling, stops after step 3 even with room left', () => {
    expect(picks(selectCandidates(policy({ topN: 1, maxCells: 6 }), cells, priced(PRICES), true))).toEqual([
      [5, 'top_n'],
    ]);
  });

  it('topN 0 with a ceiling selects by ceiling only', () => {
    const r = selectCandidates(
      policy({ topN: 0, maxCells: 2, priceCeilingPence: 450 }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [5, 'ceiling'],
      [1, 'ceiling'],
    ]);
  });

  it('sparse discovery is not topped up by stride: no priced cells means alwaysInclude only', () => {
    expect(picks(selectCandidates(policy({ alwaysInclude: [k(2)] }), cells, new Map(), true))).toEqual([
      [2, 'always_include'],
    ]);
  });

  it('drops alwaysInclude members outside the resolved space (slid out of a relative window)', () => {
    const gone = key('LHR', 'JFK', '2027-02-28', '2027-03-07');
    expect(
      picks(selectCandidates(policy({ maxCells: 1, alwaysInclude: [gone] }), cells, priced(PRICES), true)),
    ).toEqual([[5, 'top_n']]);
  });

  it('throws on a priced discovery roll-up without minPence (broken invariant)', () => {
    const bad = new Map<string, RollUp>([
      [cellKeyString(at(0)), { status: 'priced', reason: null, minPence: null }],
    ]);
    expect(() => selectCandidates(policy({}), cells, bad, true)).toThrow(/without minPence/);
  });

  describe('step 5: even stride when the execution has no discovery provider', () => {
    it('k = floor(total / m), start at 0, at most m cells', () => {
      // m = 3, k = floor(6 / 3) = 2 → indexes 0, 2, 4
      expect(picks(selectCandidates(policy({ maxCells: 3 }), cells, new Map(), false))).toEqual([
        [0, 'stride'],
        [2, 'stride'],
        [4, 'stride'],
      ]);
    });

    it('advances past an alwaysInclude member instead of losing the slot', () => {
      // m = 4 − 1 = 3, k = 2: index 0 is alwaysInclude → take 1, then 3, then 5.
      const r = selectCandidates(policy({ maxCells: 4, alwaysInclude: [k(0)] }), cells, new Map(), false);
      expect(picks(r)).toEqual([
        [0, 'always_include'],
        [1, 'stride'],
        [3, 'stride'],
        [5, 'stride'],
      ]);
    });

    it('total < m: k = max(1, 0) = 1 and every cell is taken once', () => {
      expect(
        picks(selectCandidates(policy({ maxCells: 10 }), cells, new Map(), false)).map(([i]) => i),
      ).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('m = 0: alwaysInclude fills maxCells and the stride adds nothing', () => {
      expect(
        picks(selectCandidates(policy({ maxCells: 1, alwaysInclude: [k(3)] }), cells, new Map(), false)),
      ).toEqual([[3, 'always_include']]);
    });

    it('m < 0: more alwaysInclude members than maxCells (never valid at save) still adds nothing', () => {
      const r = selectCandidates(
        policy({ maxCells: 1, alwaysInclude: [k(3), k(4)] }),
        cells,
        new Map(),
        false,
      );
      expect(picks(r)).toEqual([
        [3, 'always_include'],
        [4, 'always_include'],
      ]);
    });

    it('ignores discovery roll-ups entirely', () => {
      expect(picks(selectCandidates(policy({ maxCells: 1 }), cells, priced(PRICES), false))).toEqual([
        [0, 'stride'],
      ]);
    });

    it('stops at the end of the space when the stride runs off it', () => {
      // m = 4, k = floor(6 / 4) = 1, but alwaysInclude 5 is skipped at the end: 0,1,2,3 taken.
      const r = selectCandidates(policy({ maxCells: 5, alwaysInclude: [k(5)] }), cells, new Map(), false);
      expect(picks(r).map(([i]) => i)).toEqual([5, 0, 1, 2, 3]);
    });
  });

  it('is deterministic: the same inputs give the same output', () => {
    const p = policy({ topN: 2, priceCeilingPence: 600, perDepartureDateBest: 1, alwaysInclude: [k(4)] });
    expect(selectCandidates(p, cells, priced(PRICES), true)).toEqual(
      selectCandidates(p, cells, priced(PRICES), true),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/selection/select.test.ts`
Expected: FAIL, `Error: Cannot find module '../../src/selection/select.js'`.

- [ ] **Step 3: Implement**

`packages/core/src/selection/select.ts`:

```ts
import { type Cell, type CellKey, cellKeyString, type VerificationPolicy } from '../types/definition.js';
import type { RollUp, SelectionReason } from '../types/execution.js';

/**
 * Choose the cells stage 2 itinerary-searches. Spec §6.7, steps in order:
 *  1. `alwaysInclude`, deduplicated, counted toward `maxCells` and `perDepartureDateBest`;
 *  2. rank cells whose discovery roll-up is `priced` by `minPence`, tie-break generation order;
 *  3. walk the ranking skipping `alwaysInclude`; add while under `maxCells` and under
 *     `perDepartureDateBest` for that date; stop after `topN` additions (`top_n`);
 *  4. if `priceCeilingPence` is set, keep walking, adding only cells ≤ the ceiling, same caps,
 *     until `maxCells` (`ceiling`); if unset, stop after step 3;
 *  5. with no discovery provider, replace 2–4 by an even stride over generation order (`stride`).
 *
 * `cells` is the resolved space in generation order (`generateCells`). `discovery` maps
 * `cellKeyString` (WP0, `types/definition.ts`) to the cell's discovery roll-up. Only `maxCells`,
 * `topN`, `priceCeilingPence`, `perDepartureDateBest` and `alwaysInclude` of the policy are read. Pure and deterministic; the engine runs it
 * once per execution and persists the result (spec §6.7).
 *
 * why: `alwaysInclude` members that are not in `cells` are left out. At execution start a relative
 * window may have slid past them (spec §6.1: "dropped with a note, not an error"); the engine
 * writes that note by comparing `policy.alwaysInclude` with the result.
 */
export function selectCandidates(
  policy: VerificationPolicy,
  cells: Cell[],
  discovery: Map<string, RollUp>,
  hasDiscoveryProvider: boolean,
): Array<{ cell: CellKey; reason: SelectionReason }> {
  const inSpace = new Set(cells.map(cellKeyString));
  const out: Array<{ cell: CellKey; reason: SelectionReason }> = [];
  const chosen = new Set<string>();
  const perDate = new Map<string, number>();
  const take = (cell: CellKey, reason: SelectionReason) => {
    chosen.add(cellKeyString(cell));
    perDate.set(cell.departureDate, (perDate.get(cell.departureDate) ?? 0) + 1);
    out.push({ cell, reason });
  };

  for (const cell of policy.alwaysInclude) {
    const key = cellKeyString(cell);
    if (inSpace.has(key) && !chosen.has(key)) take(cell, 'always_include');
  }

  if (!hasDiscoveryProvider) {
    const m = policy.maxCells - out.length;
    if (m <= 0) return out;
    const k = Math.max(1, Math.floor(cells.length / m));
    let added = 0;
    let i = 0;
    while (added < m && i < cells.length) {
      const cell = cells[i] as Cell;
      // why: landing on an alwaysInclude member advances to the next cell instead of losing the slot.
      if (chosen.has(cellKeyString(cell))) {
        i += 1;
        continue;
      }
      take(cell, 'stride');
      added += 1;
      i += k;
    }
    return out;
  }

  const ranked = cells
    .map((cell, i) => ({ cell, i, r: discovery.get(cellKeyString(cell)) }))
    .filter((x): x is { cell: Cell; i: number; r: RollUp & { minPence: number } } => {
      if (x.r?.status !== 'priced') return false;
      if (x.r.minPence === null) {
        throw new Error(`priced discovery roll-up without minPence for ${cellKeyString(x.cell)}`);
      }
      return true;
    })
    .sort((a, b) => a.r.minPence - b.r.minPence || a.i - b.i);

  const pdb = policy.perDepartureDateBest;
  const fits = (cell: CellKey) =>
    out.length < policy.maxCells && (pdb === undefined || (perDate.get(cell.departureDate) ?? 0) < pdb);

  let pos = 0;
  let topAdded = 0;
  for (; pos < ranked.length && topAdded < policy.topN; pos += 1) {
    const { cell } = ranked[pos] as (typeof ranked)[number];
    if (chosen.has(cellKeyString(cell)) || !fits(cell)) continue;
    take(cell, 'top_n');
    topAdded += 1;
  }
  const ceiling = policy.priceCeilingPence;
  if (ceiling === undefined) return out;
  for (; pos < ranked.length && out.length < policy.maxCells; pos += 1) {
    const { cell, r } = ranked[pos] as (typeof ranked)[number];
    if (r.minPence > ceiling || chosen.has(cellKeyString(cell)) || !fits(cell)) continue;
    take(cell, 'ceiling');
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/selection/select.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: candidate selection with ceiling walk and stride fallback (spec §6.7)"
```

### Task 1.8: Barrel, no-`Date` guard, thresholds and mutation gate

**Files:**
- Create: `packages/core/test/barrel-wp1.test.ts`, `packages/core/test/no-date-wp1.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: every name in "Interfaces produced", from `@gmt/core`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/barrel-wp1.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

// The plan's WP1 "Produces" list: every name later packages import from @gmt/core.
const WP1_FUNCTIONS = [
  'toEpochDay',
  'fromEpochDay',
  'addDays',
  'daysBetween',
  'monthOf',
  'monthsSpanned',
  'isLeapYear',
  'resolveWindow',
  'generateCells',
  'countCells',
  'validateSearchSpace',
  'rollUp',
  'mergeWithinProvider',
  'sixBuckets',
  'selectedNotReached',
  'selectCandidates',
] as const;

describe('@gmt/core barrel exports WP1', () => {
  it.each(WP1_FUNCTIONS)('exports %s', (name) => {
    expect(typeof (core as Record<string, unknown>)[name]).toBe('function');
  });
});
```

`packages/core/test/no-date-wp1.test.ts` (spec §6.1 "never `Date`-local arithmetic", enforced on the source text so a later edit cannot slip a `Date` in):

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Spec §6.1: "epoch-day integers and Intl only, never Date-local arithmetic". WP1's source must not
// construct or call Date at all; this test reads the files so a later edit cannot slip one in.
const ROOT = join(import.meta.dirname, '..', 'src');
const DIRS = ['dates', 'space', 'coverage', 'selection'];

describe('WP1 sources never use Date', () => {
  const files = DIRS.flatMap((dir) => readdirSync(join(ROOT, dir)).map((f) => join(ROOT, dir, f)));
  it('found the files', () => expect(files.length).toBeGreaterThanOrEqual(7));
  it.each(files)('%s has no Date', (file) => {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bDate\b/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @gmt/core exec vitest run test/barrel-wp1.test.ts test/no-date-wp1.test.ts`
Expected: FAIL, 16 `exports …` tests fail with `expected 'undefined' to be 'function'`; the 8 no-`Date` tests pass.

- [ ] **Step 3: Implement**

Append to `packages/core/src/index.ts`, after the WP0 lines:

```ts
// WP1: dates, windows, space, validation, roll-up, coverage, selection (spec §6.1, §6.6, §6.7).
export * from './dates/epochDay.js';
export * from './space/window.js';
export * from './space/generate.js';
export * from './space/validate.js';
export * from './coverage/rollUp.js';
export * from './coverage/buckets.js';
export * from './selection/select.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core test && pnpm --filter @gmt/core test:tz && pnpm --filter @gmt/core mutate`
Expected: every core test passes (WP0's plus 170 from WP1) with coverage 100% statements, branches, functions and lines and no `ERROR: Coverage for …` line; `test:tz` passes under both zones; Stryker, with WP0's configuration unchanged, lists `src/selection/select.ts` and `src/coverage/rollUp.ts` each at ≥ 80% and prints `Final mutation score of … is greater than or equal to break threshold 80` (scratch: 96.28% on the two files).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: barrel exports and no-Date guard"
```

## Pinned review-focus tests

- **Review focus 1, operator types a lowercase or metropolitan IATA code (`lhr`, `LON`, `NYC`)**: Task 1.4, `describe('review focus 1: lowercase and metropolitan codes')` in `packages/core/test/space/validate.test.ts`:
  - Upstream, `iataSchema.parse('lhr')` is `'LHR'` and `iataSchema.parse(' lgw ')` is `'LGW'`; `'LHRX'` is rejected. Codes reach `validateSearchSpace` upper-case.
  - `validateSearchSpace` accepts the schema-produced `LHR`, `LGW`.
  - It upper-cases nothing itself: a lowercase code that bypassed the schema yields exactly `{ field: 'origins.0', message: 'lhr is not a three-letter upper-case IATA code' }`.
  - `origins: ['LON']` yields `{ field: 'origins.0', message: 'LON is a city code; use one of LHR, LGW' }`, and `destinations: ['JFK', 'NYC']` yields `{ field: 'destinations.1', message: 'NYC is a city code; use one of JFK, EWR' }`, listing what `lookup.airportsOfMetro` returns, in its order.
  - `destinations: ['XYZ']` yields `{ field: 'destinations.0', message: 'XYZ is not in the airports table' }`.
  - A code that is both an airport and a metro code (`AAA`) is accepted, because existence is checked first.

## Definition of done

Run from the repository root on the `wp/01-core-space-coverage-selection` branch:

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/core test` | PASS; coverage 100% statements, branches, functions, lines for `packages/core/src/**`; no `ERROR: Coverage for …` line |
| `pnpm --filter @gmt/core test:tz` | PASS twice (`TZ=Europe/London`, then `TZ=UTC`) |
| `pnpm --filter @gmt/core mutate` | exit 0; `select.ts` and `rollUp.ts` each ≥ 80% in the table; `Final mutation score of … is greater than or equal to break threshold 80` |
| `pnpm lint` | `biome check .` reports no errors |
| `pnpm -r typecheck` | exit 0 |
| `node scripts/check-boundaries.mjs` | exit 0 (no `@gmt/*` import and no `process.env` under `packages/core/src/`) |
| `pnpm test` | every package green at its thresholds |
| `grep -rnE '\bDate\b' packages/core/src/dates packages/core/src/space packages/core/src/coverage packages/core/src/selection` | only doc-comment lines (the no-`Date` test strips comments and passes) |
| `grep -rnE '\b(LHR\|LGW\|JFK\|EWR\|LON\|NYC)\b' packages/core/src` | no output (airport codes appear only in tests) |

## Open questions

None.
