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
- Barrel exports in `packages/core/src/index.ts`; the `test` and `test:tz` script lines in `packages/core/package.json` (a WP0 file that WP0 will land with these lines; WP1 writes them as a Modify).

**Out**

- Normalisation, hashing, constraints, verdict classes, ranking, filters, money, alerts, vendor URLs: WP2 (`core`).
- `cellKeyString`, `parseCellKeyString`, `Buckets`, `iataSchema` (which trims and upper-cases), and the Stryker configuration (command runner, `ignorePatterns` with `"/coverage"`): WP0. WP1 imports them and defines none of them.
- Persisting outcomes, roll-ups, buckets and selections (`CellsRepo`) and the airports table (`AirportsRepo.exists`, `metroOf`, `airportsOfMetro`, which satisfies `AirportLookup` structurally): WP3 (`db`). WP3's `writeTile` calls `mergeWithinProvider` for a cell that already has a fetched outcome; WP3 asserts parity of its SQL bucket counts (`CellsRepo.buckets`, `bucketsPerDay`) against `sixBuckets` on the same outcomes; WP3 and WP7 assert that the six buckets sum to `countCells(snapshot.resolved)` for every seeded stage × provider.
- Running selection once per execution, the `skipped_window` status, recording `alwaysInclude` cells that slid out of a relative window in `DefinitionSnapshot.droppedAlwaysInclude`, child executions bypassing selection, and calling `clock.todayLondon()`: WP7 (`engine`).
- `POST /definitions` returning 422 on a zero-cell window and mapping `ValidationResult.errors` to the error envelope: WP8 (`api`).
- Upper-casing operator input: WP0's `iataSchema` at the API boundary and WP9's form on blur. Showing the city-code message beside the field: WP9 (`web`).
- `@date-fns/tz` instants and DST wall-clock rules: WP2 (`normalise/localTime.ts`).

## Spec sections

- **§6.1 Search-space generation**: relative windows resolve in Europe/London and absolute windows clamp to tomorrow; dates are epoch-day integers, never `Date`-local arithmetic; `returnDate = departureDate + nights`, window ends inclusive; deterministic order origin, destination, departureDate, nights; `countCells` closed form; the validation list; the named test list.
- **§6.6 Coverage math and roll-up precedence**: rows 0–6 with the skip-reason priority; monotone merge within one provider with `min_pence = min`; six buckets summing to the cell count; "selected but not reached" = `selected ∧ (not_run ∨ skipped:budget)`; property test from an independent enumeration of the table. Rulings of 2026-10-14 that go into §6.6 and that this brief implements: `no_data:cabin-not-offered` outcomes are ignored whenever another outcome exists for the cell (all of them → `no_data:cabin-not-offered`); the roll-up reason rule (priced → `partial-expansion` if any priced input has it; error → the shared reason, else `mixed`; skipped → the priority rule); both-priced merges keep the cheaper input's provenance.
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
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' }; // Date#toISOString() form only
export const iataSchema: z.ZodType<Iata, string>;  // trims, upper-cases, then requires ^[A-Z]{3}$ (so 'lhr' → 'LHR'; 'LHRX' rejected)
export const isoDateSchema: z.ZodType<IsoDate, string>;    // regex + real calendar date check (rejects 2027-02-29)
export const isoMonthSchema: z.ZodType<IsoMonth, string>;
export function isRealDate(y: number, m: number, d: number): boolean;
export function asIata(s: string): Iata;           // throws on mismatch; tests and seeds only
export function asIsoDate(s: string): IsoDate;
export function asIsoMonth(s: string): IsoMonth;
export function asIsoDateTime(s: string): IsoDateTime;

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
export type NoDataReason = 'cabin-not-offered';          // a provider whose `cabins` excludes the definition's cabin: every cell no_data, no call
export interface CellOutcome extends CellKey {
  executionId: string; stage: Stage; providerId: ProviderId; status: CellOutcomeStatus; reason: string | null;
  attempts: number; lastError: string | null; fetchedAt: IsoDateTime | null; minPence: number | null;
  cabin: Cabin | null; pointOfSale: PointOfSale | null; sourceKind: SourceKind | null; reusedFromExecutionId: string | null;
}
export interface RollUp { status: CellOutcomeStatus | null; reason: string | null; minPence: number | null }   // null status ↔ API 'not_applicable'
export type SelectionReason = 'always_include' | 'top_n' | 'ceiling' | 'stride';
export interface Buckets { priced: number; empty: number; no_data: number; error: number; skipped: number; not_run: number; reused: number }   // bucketsSchema in api-contract/common.ts is z.ZodType<Buckets>

// text/bannedWords.ts (WP0, Task 0.6 plus the shared allowlist)
export function findBannedWords(text: string, allowlist: readonly string[] = []): Array<{ word: string; index: number }>;
export const BANNED_WORD_ALLOWLIST: readonly string[] = ['smoke:live', 'lives in'];

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
export function sixBuckets(outcomes: CellOutcome[]): Buckets /* one stage, one provider */; export function selectedNotReached(selected: CellKey[], outcomes: CellOutcome[]): Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }>;
export function selectCandidates(policy: VerificationPolicy, cells: Cell[], discovery: Map<string, RollUp>, hasDiscoveryProvider: boolean): Array<{ cell: CellKey; reason: SelectionReason }>;
```

One deviation from the plan's current text, by ruling of 2026-10-14: `selectedNotReached`'s `reason` is the literal union `'not_run' | 'skipped:budget'` (spec §6.6 notation, which WP9 maps to copy) rather than `string`; the plan contract is being tightened to match. No other name is exported. The limits (window ≤ 400 days, nights ≤ 90, the epoch-day range 0001–9999), the skip-reason priority and the merge ranks are module-local constants.

Behaviour later packages rely on, each pinned by a test below:

- `generateCells` orders by origin, destination (both sorted by code), departureDate, nights.
- `validateSearchSpace` upper-cases nothing. Per code it checks format, duplicate, existence, then `airportsOfMetro`, so a code that is both an airport and a metro code is accepted. A zero-cell window is `ok: false` with `field: 'window'`; the engine tells `skipped_window` apart by calling `resolveWindow` and `countCells` itself.
- `validateSearchSpace` also enforces the spec §6.7 policy bounds at save time: `maxCells`, `topN`, `perDepartureDateBest` non-negative integers, `topN ≤ maxCells`, distinct `alwaysInclude` ≤ `maxCells`. It is for save time only (`POST`/`PUT /definitions`); at execution start the engine uses `resolveWindow`, `countCells` and `selectCandidates`.
- `rollUp` ignores `no_data:cabin-not-offered` beside any other outcome (all of them → `no_data` with reason `cabin-not-offered`). Reasons: priced → `partial-expansion` when any priced input has it, else null; error → the reason every error input shares, else `mixed`; skipped → budget > provider_disabled > departed > not_selected; otherwise null.
- `mergeWithinProvider` accepts only `priced | empty | no_data | error` outcomes of the same cell, stage, provider and execution, and throws otherwise, and on a priced outcome without `minPence`. Different statuses: the higher-ranked outcome wins whole. Both priced: the result is the cheaper input whole (ties to `a`), so `minPence` and its `fetchedAt`, `sourceKind`, `pointOfSale`, `cabin` and `reusedFromExecutionId` travel together, with reason `partial-expansion` when either input has it. Same non-priced status: `a`, with the lexicographically smaller non-null reason. Callers pass (existing, incoming) and keep `attempts` bookkeeping.
- `sixBuckets` takes one execution × stage × provider and throws on mixed executions, stages or providers or a repeated cell. Its buckets sum to the outcomes given, which is the cell count only for a stage seeded for every cell; an empty input is spec §6.6 row 0 (`not_applicable`) and must not be rendered as coverage.
- `selectedNotReached` returns `'not_run'` or `'skipped:budget'`, judged on the cell's verification roll-up, and throws when a selected cell has no verification rows.
- `selectCandidates` reads `maxCells`, `topN`, `priceCeilingPence`, `perDepartureDateBest` and `alwaysInclude`; throws `RangeError` unless the counts are non-negative integers and the distinct in-space `alwaysInclude` cells number ≤ `maxCells`, so the result never exceeds `maxCells`; omits `alwaysInclude` members not in `cells`; returns fresh `CellKey` objects (no `nights`, no aliasing); and strides over the cells not already chosen, taking `min(maxCells − |alwaysInclude|, remaining)`.

## Library notes

Verified 2026-10-14 against context7 and by running every test and implementation in this brief in a scratch package with the pinned versions installed (`vitest@5.0.4`, `@vitest/coverage-v8@5.0.4`, `fast-check@4.10.2`, `zod@4.6.7`, `typescript@5.9.3`, `@biomejs/biome@2.5.15`, `@stryker-mutator/core@10.0.0`, Node 26.10, with stand-ins for WP0's types written from the contract block): 219 tests green, 100% statements/branches/functions/lines on the WP1 files, `tsc --noEmit` clean over `src` **and** `test` under the plan's `tsconfig.base.json` flags (every `@ts-expect-error` is consumed), `biome check` clean, and the suite green under `TZ=Europe/London`, `TZ=UTC`, `TZ=America/Los_Angeles` and `TZ=Asia/Tokyo`.

**No casts (ruling 2026-10-14).** Neither `src` nor `test` contains `as` except `as const` and `satisfies`. Branded values are minted only through WP0's zod schemas in production code (`isoDateSchema.parse`, `isoMonthSchema.parse`) and through WP0's `asIata`/`asIsoDate`/`asIsoMonth`/`asIsoDateTime` in tests. A deliberately invalid input in a test is passed as a widened value (`const bad: string = …`) on a call preceded by `// @ts-expect-error <why>`, never `as never`. Indexed reads are guarded (`const c = cells[i]; if (c === undefined) throw …`) or replaced by `for…of`/`flatMap`. Core's tests are type-checked from WP0 (its `tsconfig.test.json`), so the test code must compile.

- **zod 4.6.7** (versions from plan Task 0.1). WP1 source does not import zod. Tests call `iataSchema.parse('lhr')` (returns `'LHR'` through WP0's `.trim().toUpperCase().regex(...)` chain) and `iataSchema.safeParse('LHRX').success` (false); the zod 4 `safeParse` result is `{ success: false, error: ZodError }` with `error.issues[]` carrying `code`, `path`, `message`. Source: context7 `/colinhacks/zod/v4.6.5`, `packages/docs/content/error-customization.mdx` and `error-formatting.mdx` (4.6.5 is the newest indexed; the scratch run used 4.6.7).
- **fast-check 4.10.2**. Calls used: `fc.assert(fc.property(...arbs, predicate), { numRuns })`, `fc.integer({ min, max })`, `fc.array(arb, { minLength, maxLength })`, `fc.constantFrom(...values)`, `fc.constant(v)`, `fc.oneof(...arbs)`, `fc.record({ ... })`, `fc.tuple(...)`, `fc.boolean()`, `fc.option(arb, { nil })`, `arb.chain(f)`, `.map(f)`; the default import `import fc from 'fast-check'`. Source: context7 `/dubzzz/fast-check`, `website/docs/core-blocks/arbitraries/primitives/number.md`, `.../combiners/constant.md`, `.../composites/object.md`.
- **vitest 5.0.4**. Calls used: `describe`, `it`, `it.each(rows)` with `%s`/`%j`/`%i`/`%d`, `describe.each(objects)` with `$tz` interpolation, `beforeAll`, `afterAll`, `expect(...).toEqual/toBe/toThrow/toContain/toContainEqual/toMatchObject/toHaveLength`, `expect(value, message)`. The default pool is `forks` (each test file in its own child process). The `test.env` option does **not** change the time zone in `threads`/`vmThreads` pools, and `process.env.TZ` set at runtime takes effect in a forked process; so the TZ matrix sets `process.env.TZ` inside the test file, first asserts the zone took effect, and restores an originally unset `TZ` with `Reflect.deleteProperty(process.env, 'TZ')` (assigning `undefined` stores the string `"undefined"`, which Node treats as UTC); `test:tz` sets `TZ` on the command line for the whole suite under four zones, and `test` runs it after the coverage run so CI exercises the matrix. Source: context7 `/vitest-dev/vitest/v5.0.3`, `docs/config/env.md` (warning "TZ set here does not change the time zone in threads and vmThreads pools") and `docs/guide/common-errors.md` ("Time Zone Does Not Change in Worker Threads"; pool defaults in `packages/vitest/src/node/cli/cli-config.ts`).
- **Stryker 10.0.0**: WP0's `packages/core/stryker.config.json` is used unchanged (command runner `pnpm exec vitest run --coverage.enabled=false`, `ignorePatterns` with `"/coverage"` so `src/coverage/` is mutated, `mutate` already listing `src/selection/select.ts` and `src/coverage/rollUp.ts`, break 80). A scratch run with that configuration scored 96.32% on the two files (`rollUp.ts` 95.48%, `select.ts` 97.64%); the twelve survivors are equivalent mutants (for example the `m === 0` early return, the `ceiling === undefined` break whose absence still adds nothing, `<` → `<=` in the skip-reason `reduce` over equal ranks, and the `minPence !== null` guards already enforced by the earlier throw).
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
- `packages/core/test/helpers/space.ts` (WP2 shares `test/helpers/`; the builder is `spaceCell`, so it cannot collide with WP2's `cellOf`)
- `packages/core/test/space/generate.test.ts`
- `packages/core/test/dates/epochDay.test.ts`
- `packages/core/test/space/calendar.test.ts`
- `packages/core/test/space/window.test.ts`
- `packages/core/test/space/validate.test.ts`
- `packages/core/test/coverage/rollUp.test.ts`
- `packages/core/test/coverage/buckets.test.ts`
- `packages/core/test/selection/select.test.ts`
- `packages/core/test/wp1-barrel.test.ts`
- `packages/core/test/wp1-no-date.test.ts`

**Modify**

- `packages/core/src/index.ts` (append WP1 exports)
- `packages/core/package.json` (the `test` and `test:tz` script lines; WP0 lands them, WP1 checks they are present)

## Tasks

Per-task runs use `pnpm --filter @gmt/core exec vitest run <path>` without coverage, because the 100% thresholds apply to the whole of `src/` and only hold once every task has landed; Task 1.8 and the definition of done run the thresholded suite.

### Task 1.1: Cell counts for the default and the enumerated tiny space (first failing test)

**Files:**
- Create: `packages/core/test/helpers/space.ts`, `packages/core/test/space/generate.test.ts`, `packages/core/src/dates/epochDay.ts`, `packages/core/src/space/generate.ts`

**Interfaces:**
- Consumes: `Iata`, `IsoDate`, `asIata`, `asIsoDate`, `isRealDate`, `ResolvedSpace`, `CellKey`, `Cell`, `CellOutcome`, `CellOutcomeStatus`.
- Produces: `isLeapYear`, `toEpochDay`, `fromEpochDay`, `addDays`, `daysBetween`, `countCells`, `generateCells`.

- [ ] **Step 1: Write the failing test**

The shared builders first (scaffolding the later suites reuse). `packages/core/test/helpers/space.ts`:

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

export function spaceCell(o: string, d: string, dep: string, ret: string, nights: number): Cell {
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
import { space, spaceCell } from '../helpers/space.js';

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
      spaceCell('LHR', 'JFK', '2027-03-01', '2027-03-08', 7),
      spaceCell('LHR', 'JFK', '2027-03-01', '2027-03-09', 8),
      spaceCell('LHR', 'JFK', '2027-03-02', '2027-03-09', 7),
      spaceCell('LHR', 'JFK', '2027-03-02', '2027-03-10', 8),
      spaceCell('LHR', 'JFK', '2027-03-03', '2027-03-10', 7),
      spaceCell('LHR', 'JFK', '2027-03-03', '2027-03-11', 8),
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
import { type IsoDate, isoDateSchema, isRealDate } from '../types/ids.js';

/**
 * Calendar-date arithmetic on epoch-day integers (days since 1970-01-01). Spec §6.1:
 * "Dates are calendar dates independent of process timezone: epoch-day integers and `Intl`
 * only, never `Date`-local arithmetic."
 *
 * why: no `Date` object appears in this file. The conversions are Howard Hinnant's
 * `days_from_civil` / `civil_from_days` algorithms on the proleptic Gregorian calendar, which
 * are exact integer arithmetic and cannot be shifted by the process timezone or a DST change.
 * Branded values are minted only by WP0's zod schemas (`isoDateSchema.parse`,
 * `isoMonthSchema.parse`), never by an `as` cast.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Epoch day of 0001-01-01 and 9999-12-31: the range a four-digit `IsoDate` can express. */
const MIN_EPOCH_DAY = -719_162;
const MAX_EPOCH_DAY = 2_932_896;

/** Zero-padded decimal, e.g. pad(7, 2) = '07'. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

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
  return isoDateSchema.parse(`${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`);
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
- Produces: `monthOf`, `monthsSpanned`; the `test` and `test:tz` script lines.

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
import { asIsoDate } from '../../src/types/ids.js';

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
    (bad: string) => {
      // @ts-expect-error a plain string is not an IsoDate; the runtime guard is what is under test
      expect(() => toEpochDay(bad)).toThrow(RangeError);
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
    const bad: string = '2027-02-29';
    // @ts-expect-error a plain string is not an IsoDate; the runtime guard is what is under test
    expect(() => monthOf(bad)).toThrow(RangeError);
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
import { space, spaceCell } from '../helpers/space.js';

// Spec §6.1 / §9 item 1: windows spanning the March and October DST changes, run under
// TZ=Europe/London and TZ=UTC (plus two zones far from London, which catch an off-by-one day). The functions under test never touch Date, so the zone must make
// no difference; each block switches process.env.TZ at runtime (Node re-reads it on assignment;
// Vitest's default `forks` pool gives each file its own process) and first proves the switch
// took effect, so a silently ignored TZ fails the suite instead of passing it vacuously.
// `pnpm --filter @gmt/core test:tz` additionally runs the whole core suite under each zone.
const ZONES = [
  { tz: 'Europe/London', marchOffset: -60 }, // 2027-03-28 12:00 local is BST (UTC+1)
  { tz: 'UTC', marchOffset: 0 },
  { tz: 'America/Los_Angeles', marchOffset: 420 }, // PDT (UTC−7) since 2027-03-14
  { tz: 'Asia/Tokyo', marchOffset: -540 }, // JST (UTC+9), no DST
] as const;

describe.each(ZONES)('calendar edges under TZ=$tz', ({ tz, marchOffset }) => {
  const saved = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(() => {
    // why: assigning undefined to process.env stores the string "undefined" (an invalid zone that
    // Node treats as UTC), so an originally unset TZ is restored by deleting the key.
    if (saved === undefined) Reflect.deleteProperty(process.env, 'TZ');
    else process.env.TZ = saved;
  });

  it('the process really is in the zone (guard)', () => {
    // why: Date is allowed in tests; this only checks the environment, not the code under test.
    expect(new Date(2027, 2, 28, 12).getTimezoneOffset()).toBe(marchOffset);
  });

  it('a window across the March change (2027-03-28, clocks forward) keeps every day and night', () => {
    const s = space({ o: ['LHR'], d: ['JFK'], from: '2027-03-27', to: '2027-03-29', min: 1, max: 1 });
    expect(generateCells(s)).toEqual([
      spaceCell('LHR', 'JFK', '2027-03-27', '2027-03-28', 1),
      spaceCell('LHR', 'JFK', '2027-03-28', '2027-03-29', 1),
      spaceCell('LHR', 'JFK', '2027-03-29', '2027-03-30', 1),
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
    expect(c).toEqual(spaceCell('LHR', 'JFK', '2027-03-20', '2027-04-03', 14));
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
import { type IsoDate, type IsoMonth, isoDateSchema, isoMonthSchema, isRealDate } from '../types/ids.js';
```

and append:

```ts
/** The `YYYY-MM` month a date falls in. Used by month tiles (spec §5.2). */
export function monthOf(date: IsoDate): IsoMonth {
  toEpochDay(date); // validates
  return isoMonthSchema.parse(date.slice(0, 7));
}

/** Every month from `from`'s month to `to`'s month inclusive, in order; empty when `to < from`. */
export function monthsSpanned(from: IsoDate, to: IsoDate): IsoMonth[] {
  if (daysBetween(from, to) < 0) return [];
  const out: IsoMonth[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const last = monthOf(to);
  for (;;) {
    const month = isoMonthSchema.parse(`${pad(y, 4)}-${pad(m, 2)}`);
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

In `packages/core/package.json` (a WP0 file; WP0 lands these exact lines, and WP1 adds them only if they are missing), `scripts` reads:

```json
"test": "vitest run --coverage && pnpm run test:tz",
"test:tz": "TZ=Europe/London vitest run && TZ=UTC vitest run && TZ=America/Los_Angeles vitest run && TZ=Asia/Tokyo vitest run"
```

`// why:` spec §6.1 asks for the suite under `TZ=Europe/London` and `TZ=UTC`; the two far zones catch an off-by-one day, and running the matrix from `test` means CI (`pnpm -r test`) checks it on every push rather than once at merge. WP2 relies on the same script.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/dates test/space && pnpm --filter @gmt/core test:tz`
Expected: PASS (epochDay 34 tests, calendar 24, generate 5); `test:tz` passes four times. The guard test "the process really is in the zone" passes in all four `describe.each` blocks, proving the TZ switch took effect.

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
import { iatas } from '../helpers/space.js';

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
  ] satisfies Array<[WindowSpec]>)('throws RangeError on %j (validation rejects these first)', (w) => {
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
- Consumes: `SearchDefinition`, `VerificationPolicy`, `ResolvedSpace`, `CellKey`, `cellKeyString`, `Iata`, `IsoDate`, `iataSchema`, `findBannedWords`, `BANNED_WORD_ALLOWLIST`, `resolveWindow`, `countCells`, `daysBetween`.
- Produces: `validateSearchSpace`, `AirportLookup`, `ValidationResult`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { type AirportLookup, type ValidationResult, validateSearchSpace } from '../../src/space/validate.js';
import { BANNED_WORD_ALLOWLIST, findBannedWords } from '../../src/text/bannedWords.js';
import { asIsoDate, iataSchema } from '../../src/types/ids.js';
import { iatas, key } from '../helpers/space.js';

const today = asIsoDate('2026-10-14');
const MAX = 50_000;

// The airports table as the lookup sees it: four worked-example airports, the two metro codes
// they belong to, and the synthetic AAA, which is both an airport and a metro code.
// airportsOfMetro returns codes sorted, as WP3's AirportsRepo does (ORDER BY iata).
const AIRPORTS = new Set(['LHR', 'LGW', 'JFK', 'EWR', 'AAA']);
const METROS: Record<string, string[]> = { LON: ['LGW', 'LHR'], NYC: ['EWR', 'JFK'], AAA: ['AAA', 'BBB'] };
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

// Every operator-facing string any test produces, checked against spec §11 at the end.
const copy: string[] = [];
function run(input: Input, max = MAX): ValidationResult {
  const r = validateSearchSpace(input, today, lookup, max);
  if (r.ok) copy.push(...r.notes);
  else copy.push(...r.errors.map((e) => e.message));
  return r;
}
const fields = (input: Input, max = MAX) => {
  const r = run(input, max);
  return r.ok ? [] : r.errors;
};
const policy = (p: Partial<Input['verification']>): Input => ({
  ...base,
  verification: { ...base.verification, ...p },
});

describe('validateSearchSpace (spec §6.1, §6.7 policy bounds)', () => {
  it('accepts the worked example and returns the resolved space', () => {
    expect(run(base)).toEqual({
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
      expect(run({ ...base, origins }).ok).toBe(true);
    });

    it('upper-cases nothing itself: a lowercase code that bypassed the schema is a format error', () => {
      const origins: string[] = ['lhr', 'LGW'];
      // @ts-expect-error a plain string[] is not Iata[]; this is a row written around the schema
      expect(fields({ ...base, origins })).toEqual([
        { field: 'origins.0', message: 'lhr is not a three-letter upper-case IATA code' },
      ]);
    });

    it('rejects a metro code with a message naming it a city code and listing its airports', () => {
      expect(fields({ ...base, origins: iatas('LON') })).toEqual([
        { field: 'origins.0', message: 'LON is a city code; use one of LGW, LHR' },
      ]);
      expect(fields({ ...base, destinations: iatas('JFK', 'NYC') })).toEqual([
        { field: 'destinations.1', message: 'NYC is a city code; use one of EWR, JFK' },
      ]);
    });

    it('rejects an unknown code as absent from the airports table', () => {
      expect(fields({ ...base, destinations: iatas('XYZ') })).toEqual([
        { field: 'destinations.0', message: 'XYZ is not in the airports table' },
      ]);
    });

    it('accepts a code that is both an airport and a metro code (existence wins)', () => {
      expect(run({ ...base, destinations: iatas('AAA') }).ok).toBe(true);
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
    [{ minNights: -1 }, 'minNights', 'minNights must be a whole number of 0 or more'],
    [{ minNights: 1.5, maxNights: 2 }, 'minNights', 'minNights must be a whole number of 0 or more'],
    [{ maxNights: 91 }, 'maxNights', 'maxNights must be a whole number no greater than 90'],
    [{ maxNights: 20.5 }, 'maxNights', 'maxNights must be a whole number no greater than 90'],
    [{ minNights: 12, maxNights: 11 }, 'maxNights', 'maxNights must be at least minNights'],
  ])('rejects nights %j', (patch, field, message) => {
    expect(fields({ ...base, ...patch })).toContainEqual({ field, message });
  });

  it('accepts 0 ≤ minNights = maxNights ≤ 90 at both ends', () => {
    expect(run({ ...base, minNights: 0, maxNights: 0 }).ok).toBe(true);
    expect(run({ ...base, minNights: 90, maxNights: 90 }).ok).toBe(true);
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
      { field: 'window.lengthDays', message: 'lengthDays must be a whole number from 1 to 400' },
    ]);
  });

  it('rejects an absolute window ending before it starts, and one longer than 400 days', () => {
    expect(
      fields({
        ...base,
        window: { kind: 'absolute', from: asIsoDate('2027-03-02'), to: asIsoDate('2027-03-01') },
      }),
    ).toEqual([{ field: 'window.to', message: 'the window must end on or after the day it starts' }]);
    // 2027-01-01 .. 2028-02-04 is 400 days (2028 is a leap year); one more day is 401.
    const ok400 = { kind: 'absolute', from: asIsoDate('2027-01-01'), to: asIsoDate('2028-02-04') } as const;
    expect(run({ ...base, minNights: 1, maxNights: 1, window: ok400 }).ok).toBe(true);
    expect(fields({ ...base, window: { ...ok400, to: asIsoDate('2028-02-05') } })).toEqual([
      { field: 'window.to', message: 'the window must be at most 400 days long' },
    ]);
  });

  it('rejects a zero-cell window (absolute, wholly in the past)', () => {
    expect(
      fields({
        ...base,
        window: { kind: 'absolute', from: asIsoDate('2026-09-01'), to: asIsoDate('2026-10-14') },
      }),
    ).toEqual([
      { field: 'window', message: 'the window resolves to no departure days: it ends before 2026-10-15' },
    ]);
  });

  it('clamps an absolute window that starts today or earlier, and says so accurately', () => {
    for (const from of ['2026-10-01', '2026-10-14']) {
      expect(
        run({ ...base, window: { kind: 'absolute', from: asIsoDate(from), to: asIsoDate('2026-10-31') } }),
      ).toMatchObject({
        ok: true,
        clamped: true,
        resolved: { departureFrom: '2026-10-15', departureTo: '2026-10-31' },
        notes: ['window start moved to 2026-10-15 (tomorrow); searches start tomorrow at the earliest'],
      });
    }
  });

  it('enforces MAX_CELLS_PER_DEFINITION and names the factors (2 × 2 × 182 × 12 = 8,736)', () => {
    expect(run(base, 8_736).ok).toBe(true);
    expect(fields(base, 8_735)).toEqual([
      {
        field: 'window',
        message:
          'the space has 8,736 cells (2 origins × 2 destinations × 182 days × 12 night lengths); the limit MAX_CELLS_PER_DEFINITION is 8,735. Shorten the window, narrow the nights or remove an airport.',
      },
    ]);
  });

  it('uses singular factor names for a factor of one (1 × 1 × 3 × 1 = 3 cells)', () => {
    const tiny: Input = {
      ...base,
      origins: iatas('LHR'),
      destinations: iatas('JFK'),
      window: { kind: 'absolute', from: asIsoDate('2027-03-01'), to: asIsoDate('2027-03-03') },
      minNights: 7,
      maxNights: 7,
    };
    expect(fields(tiny, 2)).toEqual([
      {
        field: 'window',
        message:
          'the space has 3 cells (1 origin × 1 destination × 3 days × 1 night length); the limit MAX_CELLS_PER_DEFINITION is 2. Shorten the window, narrow the nights or remove an airport.',
      },
    ]);
  });

  it('requires alwaysInclude members inside the resolved space and names the first failing condition', () => {
    const inside = key('LHR', 'JFK', '2026-11-01', '2026-11-15'); // 14 nights, in window
    expect(
      fields(
        policy({
          alwaysInclude: [
            inside,
            key('LHR', 'JFK', '2026-10-20', '2026-11-01'),
            key('LHR', 'JFK', '2027-04-21', '2027-05-01'),
            key('LHR', 'JFK', '2026-11-01', '2026-11-10'),
            key('LHR', 'JFK', '2026-11-01', '2026-11-23'),
            key('LHR', 'AAA', '2026-11-01', '2026-11-15'),
            key('AAA', 'JFK', '2026-11-01', '2026-11-15'),
          ],
        }),
      ),
    ).toEqual([
      {
        field: 'verification.alwaysInclude.1',
        message: 'LHR→JFK 2026-10-20–2026-11-01: departs before the window starts (2026-10-21)',
      },
      {
        field: 'verification.alwaysInclude.2',
        message: 'LHR→JFK 2027-04-21–2027-05-01: departs after the window ends (2027-04-20)',
      },
      {
        field: 'verification.alwaysInclude.3',
        message: 'LHR→JFK 2026-11-01–2026-11-10: 9 nights is outside 10–21',
      },
      {
        field: 'verification.alwaysInclude.4',
        message: 'LHR→JFK 2026-11-01–2026-11-23: 22 nights is outside 10–21',
      },
      {
        field: 'verification.alwaysInclude.5',
        message: "LHR→AAA 2026-11-01–2026-11-15: AAA is not one of this definition's destinations",
      },
      {
        field: 'verification.alwaysInclude.6',
        message: "AAA→JFK 2026-11-01–2026-11-15: AAA is not one of this definition's origins",
      },
    ]);
  });

  describe('selection policy bounds (spec §6.7: maxCells is the spend upper bound)', () => {
    it.each([
      [{ maxCells: -1, topN: 0 }, 'verification.maxCells', 'maxCells must be a whole number of 0 or more'],
      [{ maxCells: 2.5, topN: 0 }, 'verification.maxCells', 'maxCells must be a whole number of 0 or more'],
      [{ topN: -1 }, 'verification.topN', 'topN must be a whole number of 0 or more'],
      [{ topN: 1.5 }, 'verification.topN', 'topN must be a whole number of 0 or more'],
      [{ maxCells: 3, topN: 4 }, 'verification.topN', 'topN must be no greater than maxCells (3)'],
      [
        { perDepartureDateBest: -1 },
        'verification.perDepartureDateBest',
        'perDepartureDateBest must be a whole number of 0 or more',
      ],
      [
        { perDepartureDateBest: 0.5 },
        'verification.perDepartureDateBest',
        'perDepartureDateBest must be a whole number of 0 or more',
      ],
    ])('rejects %j', (patch, field, message) => {
      expect(fields(policy(patch))).toEqual([{ field, message }]);
    });

    it('rejects more distinct alwaysInclude cells than maxCells, counting duplicates once', () => {
      const a = key('LHR', 'JFK', '2026-11-01', '2026-11-15');
      const b = key('LHR', 'JFK', '2026-11-02', '2026-11-16');
      expect(run(policy({ maxCells: 2, topN: 2, alwaysInclude: [a, b, a] })).ok).toBe(true);
      expect(fields(policy({ maxCells: 1, topN: 1, alwaysInclude: [a, b, a] }))).toEqual([
        {
          field: 'verification.alwaysInclude',
          message: 'alwaysInclude lists 2 distinct cells; maxCells is 1',
        },
      ]);
    });

    it('accepts maxCells 0, topN 0 and perDepartureDateBest 0', () => {
      expect(run(policy({ maxCells: 0, topN: 0, perDepartureDateBest: 0 })).ok).toBe(true);
    });
  });

  // Keep last: it reads the strings every test above collected.
  it('every message and note is free of banned words (spec §11)', () => {
    expect(copy.length).toBeGreaterThanOrEqual(30);
    for (const s of copy) expect(findBannedWords(s, BANNED_WORD_ALLOWLIST), s).toEqual([]);
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
import {
  type CellKey,
  cellKeyString,
  type ResolvedSpace,
  type SearchDefinition,
} from '../types/definition.js';
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
  /** Airports the table maps to a metropolitan (city) code, sorted by code (WP3); empty when the code is not a metro. */
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
 * Validate a definition's space at save time (`POST`/`PUT /definitions`). Spec §6.1: IATA format
 * `^[A-Z]{3}$` and existence; `to ≥ from`; window ≤ 400 days; `0 ≤ minNights ≤ maxNights ≤ 90`;
 * ≥1 origin and destination, disjoint; `countCells ≤ MAX_CELLS_PER_DEFINITION` (`maxCells`);
 * `alwaysInclude` members of the resolved space; `startOffsetDays = 0` rejected; a window that
 * resolves to zero cells rejected (spec §10: 422). Spec §6.7 policy bounds: `maxCells`, `topN`
 * and `perDepartureDateBest` non-negative integers, `topN ≤ maxCells`, distinct `alwaysInclude`
 * cells ≤ `maxCells` (the estimate's upper bound, so selection can never exceed it).
 *
 * why: the engine must not call this at execution start. There a relative window may have slid
 * past an `alwaysInclude` cell, which spec §6.1 says is "dropped with a note, not an error", and a
 * zero-cell window is recorded as `skipped_window`; the engine uses `resolveWindow`, `countCells`
 * and `selectCandidates`' omission of out-of-space members instead.
 *
 * why: nothing is upper-cased or otherwise repaired here. `iataSchema` upper-cases operator input
 * at the API boundary (review focus 1), so codes arrive upper-case; one that does not (a row
 * written around the schema) is rejected with a format error rather than silently repaired.
 *
 * Every error carries a dotted `field` path matching the request body (`origins.0`,
 * `window.startOffsetDays`, `verification.alwaysInclude.2`) so the form can place it. Every
 * message and note is operator-facing copy and is checked against the banned-word list.
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

  if (!isCount(def.minNights)) err('minNights', 'minNights must be a whole number of 0 or more');
  if (!Number.isInteger(def.maxNights) || def.maxNights > MAX_NIGHTS) {
    err('maxNights', `maxNights must be a whole number no greater than ${MAX_NIGHTS}`);
  }
  if (def.maxNights < def.minNights) err('maxNights', 'maxNights must be at least minNights');

  const w = def.window;
  if (w.kind === 'relative') {
    if (!Number.isInteger(w.startOffsetDays) || w.startOffsetDays < 1) {
      err(
        'window.startOffsetDays',
        'startOffsetDays must be at least 1 (the window starts tomorrow at the earliest)',
      );
    }
    if (!Number.isInteger(w.lengthDays) || w.lengthDays < 1 || w.lengthDays > MAX_WINDOW_DAYS) {
      err('window.lengthDays', `lengthDays must be a whole number from 1 to ${MAX_WINDOW_DAYS}`);
    }
  } else {
    const span = daysBetween(w.from, w.to) + 1;
    if (span < 1) err('window.to', 'the window must end on or after the day it starts');
    if (span > MAX_WINDOW_DAYS) err('window.to', `the window must be at most ${MAX_WINDOW_DAYS} days long`);
  }

  const v = def.verification;
  const maxCellsOk = isCount(v.maxCells);
  if (!maxCellsOk) err('verification.maxCells', 'maxCells must be a whole number of 0 or more');
  if (!isCount(v.topN)) err('verification.topN', 'topN must be a whole number of 0 or more');
  else if (maxCellsOk && v.topN > v.maxCells) {
    err('verification.topN', `topN must be no greater than maxCells (${v.maxCells})`);
  }
  if (v.perDepartureDateBest !== undefined && !isCount(v.perDepartureDateBest)) {
    err('verification.perDepartureDateBest', 'perDepartureDateBest must be a whole number of 0 or more');
  }
  const distinct = new Set(v.alwaysInclude.map(cellKeyString)).size;
  if (maxCellsOk && distinct > v.maxCells) {
    err(
      'verification.alwaysInclude',
      `alwaysInclude lists ${distinct} distinct cells; maxCells is ${v.maxCells}`,
    );
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
        {
          field: 'window',
          message: `the window resolves to no departure days: it ends before ${win.departureFrom}`,
        },
      ],
    };
  }
  if (cells > maxCells) {
    const days = daysBetween(win.departureFrom, win.departureTo) + 1;
    const nights = def.maxNights - def.minNights + 1;
    const factors = [
      plural(def.origins.length, 'origin'),
      plural(def.destinations.length, 'destination'),
      plural(days, 'day'),
      plural(nights, 'night length'),
    ].join(' × ');
    return {
      ok: false,
      errors: [
        {
          field: 'window',
          message: `the space has ${thousands(cells)} cells (${factors}); the limit MAX_CELLS_PER_DEFINITION is ${thousands(maxCells)}. Shorten the window, narrow the nights or remove an airport.`,
        },
      ],
    };
  }
  v.alwaysInclude.forEach((cell, i) => {
    const why = outsideReason(cell, resolved);
    if (why !== null) {
      err(
        `verification.alwaysInclude.${i}`,
        `${cell.origin}→${cell.destination} ${cell.departureDate}–${cell.returnDate}: ${why}`,
      );
    }
  });
  if (errors.length > 0) return { ok: false, errors };

  const notes = win.clamped
    ? [`window start moved to ${win.departureFrom} (tomorrow); searches start tomorrow at the earliest`]
    : [];
  return { ok: true, resolved, clamped: win.clamped, notes };
}

/** A non-negative integer (spec §6.1 nights, spec §6.7 policy counts). */
function isCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

/** "1 origin", "2 origins". */
function plural(n: number, word: string): string {
  return `${thousands(n)} ${word}${n === 1 ? '' : 's'}`;
}

/** Thousands separators without Intl locale data: 13104 → "13,104". */
function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function checkAirports(
  field: 'origins' | 'destinations',
  codes: readonly Iata[],
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
function airportProblem(code: Iata, duplicate: boolean, lookup: AirportLookup): string | null {
  if (!IATA_RE.test(code)) return `${code} is not a three-letter upper-case IATA code`;
  if (duplicate) return `${code} is listed twice`;
  // why: existence is checked before the metro test, so a code that is both an airport and a
  // metro code in the table (some cities share their main airport's code) is accepted.
  if (lookup.exists(code)) return null;
  const metro = lookup.airportsOfMetro(code);
  if (metro.length > 0) return `${code} is a city code; use one of ${metro.join(', ')}`;
  return `${code} is not in the airports table`;
}

/** Why a cell lies outside a resolved space (the first failing condition), or null when it is inside. */
function outsideReason(cell: CellKey, space: ResolvedSpace): string | null {
  if (!space.origins.includes(cell.origin)) return `${cell.origin} is not one of this definition's origins`;
  if (!space.destinations.includes(cell.destination)) {
    return `${cell.destination} is not one of this definition's destinations`;
  }
  if (daysBetween(space.departureFrom, cell.departureDate) < 0) {
    return `departs before the window starts (${space.departureFrom})`;
  }
  if (daysBetween(cell.departureDate, space.departureTo) < 0) {
    return `departs after the window ends (${space.departureTo})`;
  }
  const nights = daysBetween(cell.departureDate, cell.returnDate);
  if (nights < space.minNights || nights > space.maxNights) {
    return `${nights} nights is outside ${space.minNights}–${space.maxNights}`;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/space/validate.test.ts`
Expected: PASS, 35 tests (the last one checks every message and note the others produced against the banned-word list).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: validateSearchSpace with metro-code and unknown-airport messages (spec §6.1, review focus 1)"
```

### Task 1.5: `rollUp` and `mergeWithinProvider`

**Files:**
- Create: `packages/core/test/coverage/rollUp.test.ts`, `packages/core/src/coverage/rollUp.ts`

**Interfaces:**
- Consumes: `CellOutcome`, `CellOutcomeStatus`, `NoDataReason`, `RollUp`, `SkipReason`, `cellKeyString`, `asIsoDateTime` (tests).
- Produces: `rollUp`, `mergeWithinProvider`.

- [ ] **Step 1: Write the failing test**

The precedence table is checked three ways: the named rows, an exhaustive comparison against an oracle transcribed independently from spec §6.6 and the 2026-10-14 rulings (every sequence of up to three outcomes over twelve variants, including `no_data:cabin-not-offered`, two error reasons and a `partial-expansion` price: 1,885 cases), and fast-check properties (oracle agreement on longer arrays, order independence, monotonicity under an added `priced`). The merge is checked by cases on `status`, `minPence` and `reason` (including `offers-dropped:n` beside `partial-expansion`), by the provenance rule (a reused row and a fresh cheaper fetch), by its refusals (including a priced outcome without `minPence`), and by properties: commutativity and associativity on status and price, idempotence, rank, min price, and `fetchedAt`/`reusedFromExecutionId` belonging to the winner.

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeWithinProvider, rollUp } from '../../src/coverage/rollUp.js';
import type { CellOutcome, CellOutcomeStatus, RollUp, SkipReason } from '../../src/types/execution.js';
import { asIsoDateTime } from '../../src/types/ids.js';
import { key, outcome } from '../helpers/space.js';

// One cell; providers differ per row in real data, but rollUp reads only status, reason, minPence.
const K = key('LHR', 'JFK', '2027-03-01', '2027-03-08');
type O = CellOutcome;
const o = (status: CellOutcomeStatus, extra: Partial<Pick<O, 'reason' | 'minPence'>> = {}): O =>
  outcome(K, status, extra);
const priced = (p: number, reason: string | null = null) => o('priced', { minPence: p, reason });
const skipped = (reason: SkipReason) => o('skipped', { reason });
const notOffered = () => o('no_data', { reason: 'cabin-not-offered' });

/**
 * Independent oracle: spec §6.6's table transcribed row by row, including row 4's full condition
 * ("any empty and every other ∈ {empty, no_data, skipped}"), plus the 2026-10-14 rulings on
 * cabin-not-offered and on roll-up reasons, written without reference to the implementation.
 */
function oracle(all: readonly O[]): RollUp {
  if (all.length === 0) return { status: null, reason: null, minPence: null }; // row 0
  const isNotOffered = (x: O) => x.status === 'no_data' && x.reason === 'cabin-not-offered';
  if (all.every(isNotOffered)) return { status: 'no_data', reason: 'cabin-not-offered', minPence: null };
  const xs = all.filter((x) => !isNotOffered(x));
  const any = (s: CellOutcomeStatus) => xs.some((x) => x.status === s);
  if (any('priced')) {
    const ps = xs.flatMap((x) => (x.status === 'priced' && x.minPence !== null ? [x.minPence] : []));
    const partial = xs.some((x) => x.status === 'priced' && x.reason === 'partial-expansion');
    return { status: 'priced', reason: partial ? 'partial-expansion' : null, minPence: Math.min(...ps) }; // row 1
  }
  if (any('not_run')) return { status: 'not_run', reason: null, minPence: null }; // row 2
  if (any('error')) {
    const rs = xs.filter((x) => x.status === 'error').map((x) => x.reason);
    const agree = rs.every((r) => r === rs[0]);
    return { status: 'error', reason: agree ? (rs[0] ?? null) : 'mixed', minPence: null }; // row 3
  }
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
  priced(39_900, 'partial-expansion'),
  o('empty'),
  o('no_data'),
  notOffered(),
  o('error', { reason: 'upstream' }),
  o('error', { reason: 'parse' }),
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
    [
      'row 3: error beats empty',
      [o('empty'), o('error', { reason: 'upstream' })],
      { status: 'error', reason: 'upstream', minPence: null },
    ],
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
  ] satisfies Array<[string, O[], RollUp]>)('%s', (_name, xs, expected) => {
    expect(rollUp(xs)).toEqual(expected);
  });

  describe('cabin-not-offered (ruling 2026-10-14)', () => {
    it.each([
      [
        'ignored beside a budget skip: [no_data:cabin-not-offered, skipped:budget] → skipped:budget',
        [notOffered(), skipped('budget')],
        { status: 'skipped', reason: 'budget', minPence: null },
      ],
      [
        'ignored beside not_run',
        [notOffered(), o('not_run')],
        { status: 'not_run', reason: null, minPence: null },
      ],
      [
        'ignored beside a real no_data, which keeps a null reason',
        [notOffered(), o('no_data')],
        { status: 'no_data', reason: null, minPence: null },
      ],
      [
        'every outcome not offered → no_data:cabin-not-offered',
        [notOffered(), notOffered()],
        { status: 'no_data', reason: 'cabin-not-offered', minPence: null },
      ],
    ] satisfies Array<[string, O[], RollUp]>)('%s', (_name, xs, expected) => {
      expect(rollUp(xs)).toEqual(expected);
    });
  });

  describe('roll-up reason (ruling 2026-10-14)', () => {
    it('priced carries partial-expansion when any priced input has it', () => {
      expect(rollUp([priced(500), priced(600, 'partial-expansion')]).reason).toBe('partial-expansion');
      expect(rollUp([priced(500, 'offers-dropped:2')]).reason).toBeNull();
    });
    it('error carries the reason when every error input agrees, else mixed', () => {
      expect(rollUp([o('error', { reason: 'parse' }), o('error', { reason: 'parse' })]).reason).toBe('parse');
      expect(rollUp([o('error', { reason: 'parse' }), o('error', { reason: 'upstream' })]).reason).toBe(
        'mixed',
      );
      expect(rollUp([o('error'), o('error')]).reason).toBeNull();
    });
    it('not_run, empty and an asked no_data carry null', () => {
      expect(rollUp([o('not_run')]).reason).toBeNull();
      expect(rollUp([o('empty')]).reason).toBeNull();
      expect(rollUp([o('no_data')]).reason).toBeNull();
    });
  });

  it('matches the independent oracle on every sequence of up to three outcomes (1,885 cases)', () => {
    let cases = 0;
    const walk = (prefix: O[]) => {
      expect(rollUp(prefix), JSON.stringify(prefix.map((x) => [x.status, x.reason]))).toEqual(oracle(prefix));
      cases += 1;
      if (prefix.length < 3) for (const v of VARIANTS) walk([...prefix, v]);
    };
    walk([]);
    expect(cases).toBe(1 + 12 + 144 + 1728);
  });

  const arbOutcome: fc.Arbitrary<O> = fc.oneof(
    fc.constantFrom<CellOutcomeStatus>('not_run', 'empty', 'no_data').map((s) => o(s)),
    fc.constant(null).map(notOffered),
    fc.constantFrom('upstream', 'parse', 'network').map((reason) => o('error', { reason })),
    fc
      .tuple(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.constantFrom(null, 'partial-expansion', 'offers-dropped:1'),
      )
      .map(([p, r]) => priced(p, r)),
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
  const RANK: Record<M, number> = { priced: 3, empty: 2, no_data: 1, error: 0 };
  const rankOf = (s: CellOutcomeStatus): number => {
    switch (s) {
      case 'priced':
      case 'empty':
      case 'no_data':
      case 'error':
        return RANK[s];
      default:
        throw new Error(`not mergeable: ${s}`);
    }
  };
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
      m('priced', 450, 'offers-dropped:2'),
      m('priced', 700, 'partial-expansion'),
      { status: 'priced', minPence: 450, reason: 'partial-expansion' },
    ],
    [
      m('priced', 700, 'partial-expansion'),
      m('priced', 450, 'offers-dropped:2'),
      { status: 'priced', minPence: 450, reason: 'partial-expansion' },
    ],
    [
      m('priced', 450, 'offers-dropped:2'),
      m('priced', 700),
      { status: 'priced', minPence: 450, reason: 'offers-dropped:2' },
    ],
    [
      m('error', null, 'upstream'),
      m('error', null, 'parse'),
      { status: 'error', minPence: null, reason: 'parse' },
    ],
    [m('error'), m('error', null, 'network'), { status: 'error', minPence: null, reason: 'network' }],
    [m('error'), m('error', null, 'parse'), { status: 'error', minPence: null, reason: 'parse' }],
    [m('error'), m('error'), { status: 'error', minPence: null, reason: null }],
  ])('merge(%j, %j) has status/minPence/reason %j', (a, b, expected) => {
    expect(merged(mergeWithinProvider(a, b))).toEqual(expected);
  });

  it('both priced: every other field travels with the cheaper input (ties to a)', () => {
    const a = m('priced', 700, null, { fetchedAt: asIsoDateTime('2026-10-14T05:00:00.000Z'), attempts: 1 });
    const b = m('priced', 450, null, { fetchedAt: asIsoDateTime('2026-10-14T06:00:00.000Z'), attempts: 2 });
    expect(mergeWithinProvider(a, b)).toEqual(b);
    expect(mergeWithinProvider(b, a)).toEqual(b);
    const tie = m('priced', 700, null, { attempts: 3 });
    expect(mergeWithinProvider(a, tie)).toEqual(a);
  });

  it('a reused priced row and a fresh cheaper fetch: the fresh price keeps its own provenance', () => {
    const reused = m('priced', 700, null, {
      reusedFromExecutionId: 'exec-0',
      fetchedAt: asIsoDateTime('2026-10-10T05:00:00.000Z'),
    });
    const fresh = m('priced', 450, null, { fetchedAt: asIsoDateTime('2026-10-14T06:00:00.000Z') });
    const r = mergeWithinProvider(reused, fresh);
    expect(r.reusedFromExecutionId).toBeNull();
    expect(r.fetchedAt).toBe('2026-10-14T06:00:00.000Z');
    expect(r.minPence).toBe(450);
  });

  it('different statuses: the higher-ranked outcome wins whole', () => {
    const e = m('empty', null, null, { attempts: 3 });
    const p = m('priced', 700, null, { attempts: 1 });
    expect(mergeWithinProvider(e, p)).toEqual(p);
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

  it('refuses a priced outcome without minPence, like rollUp', () => {
    expect(() => mergeWithinProvider(m('priced', null), m('empty'))).toThrow(/no minPence/);
    expect(() => mergeWithinProvider(m('empty'), m('priced', null))).toThrow(/no minPence/);
  });

  // Distinct fetchedAt and reusedFrom per generated outcome so the winner is identifiable.
  let serial = 0;
  const stamp = () => {
    serial += 1;
    return {
      fetchedAt: asIsoDateTime(new Date(Date.UTC(2026, 9, 1) + serial * 60_000).toISOString()),
      reusedFromExecutionId: `exec-${serial}`,
    };
  };
  const arb: fc.Arbitrary<O> = fc.oneof(
    fc
      .tuple(
        fc.integer({ min: 0, max: 100_000 }),
        fc.constantFrom(null, 'partial-expansion', 'offers-dropped:1', 'offers-dropped:2'),
      )
      .map(([p, r]) => m('priced', p, r, stamp())),
    fc
      .tuple(fc.constantFrom<M>('empty', 'no_data', 'error'), fc.constantFrom(null, 'upstream', 'parse'))
      .map(([st, r]) => m(st, null, r, stamp())),
  );
  /** The input whose non-merged fields the result must carry. */
  const winnerOf = (a: O, b: O): O => {
    if (rankOf(a.status) !== rankOf(b.status)) return rankOf(a.status) > rankOf(b.status) ? a : b;
    if (a.status === 'priced' && a.minPence !== null && b.minPence !== null && b.minPence < a.minPence)
      return b;
    return a;
  };

  it('property: status/minPence commutative, associative, idempotent, monotone; provenance travels with the winner', () => {
    fc.assert(
      fc.property(arb, arb, arb, (a, b, c) => {
        const ab = mergeWithinProvider(a, b);
        const ba = mergeWithinProvider(b, a);
        expect([ab.status, ab.minPence]).toEqual([ba.status, ba.minPence]);
        const left = mergeWithinProvider(ab, c);
        const right = mergeWithinProvider(a, mergeWithinProvider(b, c));
        expect([left.status, left.minPence]).toEqual([right.status, right.minPence]);
        expect(merged(mergeWithinProvider(a, a))).toEqual(merged(a));
        expect(rankOf(ab.status)).toBe(Math.max(rankOf(a.status), rankOf(b.status)));
        const prices = [a, b].flatMap((x) =>
          x.status === 'priced' && x.minPence !== null ? [x.minPence] : [],
        );
        expect(ab.minPence).toBe(prices.length > 0 ? Math.min(...prices) : null);
        const w = winnerOf(a, b);
        expect(ab.fetchedAt).toBe(w.fetchedAt);
        expect(ab.reusedFromExecutionId).toBe(w.reusedFromExecutionId);
        if (a.status === 'priced' && b.status === 'priced') {
          const partial = a.reason === 'partial-expansion' || b.reason === 'partial-expansion';
          expect(ab.reason).toBe(partial ? 'partial-expansion' : w.reason);
        }
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
import type { CellOutcome, CellOutcomeStatus, NoDataReason, RollUp, SkipReason } from '../types/execution.js';

/** Spec §6.6 row 6: skip-reason priority, lower rank wins. */
const SKIP_RANK: Record<SkipReason, number> = {
  budget: 0,
  provider_disabled: 1,
  departed: 2,
  not_selected: 3,
};
const CABIN_NOT_OFFERED: NoDataReason = 'cabin-not-offered';
const PARTIAL_EXPANSION = 'partial-expansion';

function isSkipReason(r: string | null): r is SkipReason {
  return r !== null && Object.hasOwn(SKIP_RANK, r);
}

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
 * Before the table: `no_data` outcomes with reason `cabin-not-offered` (written at seeding, no
 * call made) are ignored whenever any other outcome exists for the cell; when every outcome is
 * one, the roll-up is `no_data` with reason `cabin-not-offered` (ruling 2026-10-14, spec §6.6).
 * why: a provider that was never asked must not make an unsearched cell look searched.
 *
 * Roll-up `reason` (ruling 2026-10-14): `priced` carries `partial-expansion` when any priced
 * input has it, else null; `error` carries the reason when every error input agrees, else
 * `mixed`; `no_data` carries `cabin-not-offered` only in the all-not-offered case, else null;
 * `skipped` carries the highest-priority skip reason; `not_run` and `empty` carry null.
 * `minPence` is the minimum over `priced` outcomes ("the minimum over rows actually written",
 * spec §5.6), else `null`.
 *
 * Throws on a `skipped` outcome whose reason is not a `SkipReason` and on a `priced` outcome with
 * no `minPence`: both are broken invariants (spec §3) that must not be rolled up silently.
 */
export function rollUp(outcomes: CellOutcome[]): RollUp {
  if (outcomes.length === 0) return { status: null, reason: null, minPence: null };
  const asked = outcomes.filter((o) => !(o.status === 'no_data' && o.reason === CABIN_NOT_OFFERED));
  if (asked.length === 0) return { status: 'no_data', reason: CABIN_NOT_OFFERED, minPence: null };
  const of = (s: CellOutcomeStatus) => asked.filter((o) => o.status === s);

  const priced = of('priced');
  if (priced.length > 0) {
    let min = Number.POSITIVE_INFINITY;
    for (const o of priced) {
      if (o.minPence === null) {
        throw new Error('a priced outcome has no minPence (spec §3: priced means a price was written)');
      }
      min = Math.min(min, o.minPence);
    }
    const partial = priced.some((o) => o.reason === PARTIAL_EXPANSION);
    return { status: 'priced', reason: partial ? PARTIAL_EXPANSION : null, minPence: min };
  }
  if (of('not_run').length > 0) return { status: 'not_run', reason: null, minPence: null };
  const errors = of('error');
  if (errors.length > 0) {
    const reasons = new Set(errors.map((o) => o.reason));
    const [only] = reasons;
    return {
      status: 'error',
      reason: reasons.size === 1 && only !== undefined ? only : 'mixed',
      minPence: null,
    };
  }
  // why: rows 1–3 have removed priced, not_run and error, so every remaining outcome is empty,
  // no_data or skipped; row 4's "every other ∈ {empty, no_data, skipped}" is therefore implied.
  if (of('empty').length > 0) return { status: 'empty', reason: null, minPence: null };
  if (of('no_data').length > 0) return { status: 'no_data', reason: null, minPence: null };
  const skipReasons: SkipReason[] = [];
  for (const o of asked) {
    if (!isSkipReason(o.reason)) throw new Error(`skipped outcome with unknown reason: ${String(o.reason)}`);
    skipReasons.push(o.reason);
  }
  const reason = skipReasons.reduce((best, r) => (SKIP_RANK[r] < SKIP_RANK[best] ? r : best));
  return { status: 'skipped', reason, minPence: null };
}

/** Spec §6.6 merge order; only statuses a fetch produces take part. */
function mergeRank(s: CellOutcomeStatus): number | null {
  switch (s) {
    case 'priced':
      return 3;
    case 'empty':
      return 2;
    case 'no_data':
      return 1;
    case 'error':
      return 0;
    default:
      return null;
  }
}

/**
 * Merge two outcomes for the same cell, stage, provider and execution. Spec §6.6: "Within one
 * provider, monotone merge `priced > empty > no_data > error`, `min_pence = min`". WP3's
 * `writeTile` calls it when a cell already has a fetched outcome (a safety net: tiles partition
 * cells). Callers pass (existing, incoming); `attempts` bookkeeping stays with the caller.
 *
 * - Different statuses: the higher-ranked outcome wins whole.
 * - Both `priced`: the result is the input that supplies the minimum price (ties to `a`), so
 *   `minPence` and its provenance (`fetchedAt`, `sourceKind`, `pointOfSale`, `cabin`,
 *   `reusedFromExecutionId`) travel together (spec §3: `reused_from_execution_id` is always the
 *   execution that fetched the price); its reason becomes `partial-expansion` when either input
 *   has it.
 * - Both the same non-priced status: `a` wins; the reason is the lexicographically smaller
 *   non-null reason, so the merged reason does not depend on argument order.
 *
 * Throws when the outcomes are for different cells, stages, providers or executions, when either
 * status is `not_run` or `skipped` (seeding and skipping replace outcomes; they never merge), or
 * when a `priced` outcome has no `minPence`.
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
  const ra = mergeRank(a.status);
  const rb = mergeRank(b.status);
  if (ra === null || rb === null) {
    throw new Error(`mergeWithinProvider: cannot merge ${a.status} with ${b.status}`);
  }
  for (const o of [a, b]) {
    if (o.status === 'priced' && o.minPence === null) {
      throw new Error('a priced outcome has no minPence (spec §3: priced means a price was written)');
    }
  }
  if (ra !== rb) return ra > rb ? a : b;
  if (a.status === 'priced') {
    const source = b.minPence !== null && a.minPence !== null && b.minPence < a.minPence ? b : a;
    const partial = a.reason === PARTIAL_EXPANSION || b.reason === PARTIAL_EXPANSION;
    return partial ? { ...source, reason: PARTIAL_EXPANSION } : source;
  }
  const reasons = [a.reason, b.reason].flatMap((r) => (r === null ? [] : [r])).sort();
  return { ...a, reason: reasons[0] ?? null };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/coverage/rollUp.test.ts`
Expected: PASS, 42 tests.

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
import type { Cell } from '../../src/types/definition.js';
import type { CellOutcomeStatus } from '../../src/types/execution.js';
import { key, outcome, space } from '../helpers/space.js';

const cells = generateCells(
  space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 7, max: 8 }),
); // 6 cells
const STATUSES = ['priced', 'empty', 'no_data', 'error', 'skipped', 'not_run'] as const;
const zip = <A, B>(as: readonly A[], bs: readonly B[]): Array<[A, B]> =>
  as.flatMap((x, i) => {
    const y = bs[i];
    return y === undefined ? [] : [[x, y]];
  });

describe('sixBuckets (spec §3: six buckets; reference oracle for WP3)', () => {
  it('counts one execution × stage × provider into the six buckets and reused beside them', () => {
    const outs = zip(cells, STATUSES).map(([c, s], i) =>
      outcome(c, s, { reusedFromExecutionId: i < 2 ? 'exec-0' : null }),
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

  it('is all zeros for no outcomes (spec §6.6 row 0, not_applicable; callers must not render it as coverage)', () => {
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

  it('property: each bucket equals an independently computed count of that status', () => {
    const status = fc.constantFrom<CellOutcomeStatus>(...STATUSES);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(status, fc.boolean()), { minLength: cells.length, maxLength: cells.length }),
        (spec) => {
          const outs = zip<Cell, [CellOutcomeStatus, boolean]>(cells, spec).map(([c, [s, reused]]) =>
            outcome(c, s, { reusedFromExecutionId: reused ? 'exec-0' : null }),
          );
          const b = sixBuckets(outs);
          for (const s of STATUSES) expect(b[s]).toBe(spec.filter(([x]) => x === s).length);
          expect(b.reused).toBe(spec.filter(([, r]) => r).length);
        },
      ),
    );
  });

  it('refuses mixed executions, stages, providers and repeated cells (the counts would be wrong)', () => {
    const [a, b] = cells;
    if (a === undefined || b === undefined) throw new Error('fixture');
    const mixed = /one execution, one stage and one provider/;
    expect(() => sixBuckets([outcome(a, 'priced'), outcome(b, 'priced', { executionId: 'exec-2' })])).toThrow(
      mixed,
    );
    expect(() => sixBuckets([outcome(a, 'priced'), outcome(b, 'priced', { stage: 'verification' })])).toThrow(
      mixed,
    );
    expect(() =>
      sixBuckets([outcome(a, 'priced'), outcome(b, 'priced', { providerId: 'searchapi' })]),
    ).toThrow(mixed);
    expect(() => sixBuckets([outcome(a, 'priced'), outcome(a, 'empty')])).toThrow(/appears twice/);
  });
});

describe('selectedNotReached (spec §6.6: selected ∧ (not_run ∨ skipped:budget))', () => {
  const v = { stage: 'verification', providerId: 'searchapi' } as const;
  const [c0, c1, c2, c3, c4, c5] = cells.map((c) =>
    key(c.origin, c.destination, c.departureDate, c.returnDate),
  );
  if (!c0 || !c1 || !c2 || !c3 || !c4 || !c5) throw new Error('fixture');

  it('lists selected cells left not_run or skipped for budget, in selection order, in spec notation', () => {
    const outs = [
      outcome(c0, 'priced', { ...v, minPence: 41_200 }),
      outcome(c1, 'not_run', v),
      outcome(c2, 'skipped', { ...v, reason: 'budget' }),
      outcome(c3, 'skipped', { ...v, reason: 'provider_disabled' }),
      outcome(c4, 'error', { ...v, reason: 'upstream' }),
      outcome(c5, 'empty', v),
    ];
    expect(selectedNotReached([c2, c0, c1, c3, c4, c5], outs)).toEqual([
      { cell: c2, reason: 'skipped:budget' },
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

  it('a cabin-not-offered row never hides a budget skip', () => {
    const outs = [
      outcome(c0, 'no_data', { ...v, providerId: 'fixture', reason: 'cabin-not-offered' }),
      outcome(c0, 'skipped', { ...v, reason: 'budget' }),
    ];
    expect(selectedNotReached([c0], outs)).toEqual([{ cell: c0, reason: 'skipped:budget' }]);
  });

  it('ignores discovery rows', () => {
    const outs = [outcome(c0, 'not_run'), outcome(c0, 'priced', { ...v, minPence: 500 })];
    expect(selectedNotReached([c0], outs)).toEqual([]);
  });

  it('throws when a selected cell has no verification rows while other cells have them', () => {
    expect(() => selectedNotReached([c0, c1], [outcome(c0, 'not_run', v), outcome(c1, 'not_run')])).toThrow(
      /selected cell LHR\|JFK\|2027-03-01\|2027-03-09 has no verification outcome rows/,
    );
  });

  it('is empty when nothing was selected', () => {
    expect(selectedNotReached([], [outcome(c0, 'not_run', v)])).toEqual([]);
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
 * Count one execution's outcomes for one stage × provider into the six coverage buckets of spec
 * §3: priced, no fares (`empty`), no cached data (`no_data`), error, skipped, not searched
 * (`not_run`). `reused` is not a seventh bucket: it counts outcomes copied from an earlier
 * execution, which also sit in their own bucket ("(R reused from earlier runs)").
 *
 * The six buckets sum to the number of outcomes given; that equals the cell count only when the
 * stage was seeded for every cell of the resolved space (precondition: exactly one row per cell).
 * An empty input returns all zeros, which is spec §6.6 row 0 (`not_applicable`: the stage has no
 * provider or is not yet seeded) and must not be rendered as coverage.
 *
 * Role: the reference oracle for WP3's SQL bucket counts (`CellsRepo.buckets`, `bucketsPerDay`);
 * WP3 asserts parity against it on the same outcomes, and WP3/WP7 assert the sum equals
 * `countCells(snapshot.resolved)` for every seeded stage × provider.
 *
 * Throws when the outcomes mix executions, stages or providers, or repeat a cell.
 */
export function sixBuckets(outcomes: CellOutcome[]): Buckets {
  const b: Buckets = { priced: 0, empty: 0, no_data: 0, error: 0, skipped: 0, not_run: 0, reused: 0 };
  const seen = new Set<string>();
  const first = outcomes[0];
  for (const o of outcomes) {
    if (
      o.executionId !== first?.executionId ||
      o.stage !== first.stage ||
      o.providerId !== first.providerId
    ) {
      throw new Error('sixBuckets takes the outcomes of one execution, one stage and one provider');
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
 * reached, and `no_data:cabin-not-offered` rows never hide a budget skip). `reason` uses the
 * spec's notation, `'not_run'` or `'skipped:budget'`, which WP9 maps to operator copy.
 * `outcomes` are the execution's outcomes; discovery rows are ignored. Returned in the order of
 * `selected`.
 *
 * Throws when a selected cell has no verification outcome rows: selection and verification
 * seeding happen in one transaction (spec §7), so a gap is a broken invariant, and treating the
 * cell as reached would overstate coverage.
 */
export function selectedNotReached(
  selected: CellKey[],
  outcomes: CellOutcome[],
): Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }> {
  const byCell = new Map<string, CellOutcome[]>();
  for (const o of outcomes) {
    if (o.stage !== 'verification') continue;
    const key = cellKeyString(o);
    const list = byCell.get(key) ?? [];
    list.push(o);
    byCell.set(key, list);
  }
  const out: Array<{ cell: CellKey; reason: 'not_run' | 'skipped:budget' }> = [];
  for (const cell of selected) {
    const rows = byCell.get(cellKeyString(cell));
    if (rows === undefined) {
      throw new Error(`selected cell ${cellKeyString(cell)} has no verification outcome rows`);
    }
    const r = rollUp(rows);
    if (r.status === 'not_run') out.push({ cell, reason: 'not_run' });
    else if (r.status === 'skipped' && r.reason === 'budget') out.push({ cell, reason: 'skipped:budget' });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/coverage/buckets.test.ts`
Expected: PASS, 10 tests.

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

Interpretation fixed here (spec §6.7 step 5, "advancing past `alwaysInclude` members rather than losing a slot"): the stride walks the cells not already chosen, with `m = maxCells − |alwaysInclude|` and `k = max(1, floor(remaining / m))`, taking remaining[0], remaining[k], … up to `m`, so it takes `min(m, remaining)` cells and never loses a slot. The stride ignores `perDepartureDateBest` (spec §6.7 step 5 replaces steps 2–4, which are where that cap applies). The spend bound (ruling 2026-10-14): `selectCandidates` throws `RangeError` unless `maxCells`, `topN` and `perDepartureDateBest` are non-negative integers and the distinct in-space `alwaysInclude` cells number ≤ `maxCells`; a fast-check property asserts the result never exceeds `maxCells`, has no duplicates, keeps every `alwaysInclude` member, holds the per-date cap, and strides exactly `min(m, remaining)` cells.

- [ ] **Step 1: Write the failing test**

```ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { selectCandidates } from '../../src/selection/select.js';
import { generateCells } from '../../src/space/generate.js';
import { type Cell, cellKeyString, type VerificationPolicy } from '../../src/types/definition.js';
import type { RollUp } from '../../src/types/execution.js';
import { key, space } from '../helpers/space.js';

// 3 departure days × 2 nights = 6 cells, generation order:
// 0: 03-01+7  1: 03-01+8  2: 03-02+7  3: 03-02+8  4: 03-03+7  5: 03-03+8
const cells = generateCells(
  space({ o: ['LHR'], d: ['JFK'], from: '2027-03-01', to: '2027-03-03', min: 7, max: 8 }),
);
const at = (i: number): Cell => {
  const c = cells[i];
  if (c === undefined) throw new Error(`fixture has no cell ${i}`);
  return c;
};
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

    it('strides over the cells not already chosen', () => {
      // m = 4 − 1 = 3; remaining = [1, 2, 3, 4, 5]; k = floor(5 / 3) = 1 → 1, 2, 3.
      const r = selectCandidates(policy({ maxCells: 4, alwaysInclude: [k(0)] }), cells, new Map(), false);
      expect(picks(r)).toEqual([
        [0, 'always_include'],
        [1, 'stride'],
        [2, 'stride'],
        [3, 'stride'],
      ]);
    });

    it('never loses a slot to alwaysInclude members the stride would land on (cells 0 and 3)', () => {
      // m = 5 − 2 = 3; remaining = [1, 2, 4, 5]; k = floor(4 / 3) = 1 → 1, 2, 4: three picks, not two.
      const r = selectCandidates(
        policy({ maxCells: 5, alwaysInclude: [k(0), k(3)] }),
        cells,
        new Map(),
        false,
      );
      expect(picks(r)).toEqual([
        [0, 'always_include'],
        [3, 'always_include'],
        [1, 'stride'],
        [2, 'stride'],
        [4, 'stride'],
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

    it('ignores discovery roll-ups entirely', () => {
      expect(picks(selectCandidates(policy({ maxCells: 1 }), cells, priced(PRICES), false))).toEqual([
        [0, 'stride'],
      ]);
    });

    it('takes every remaining cell when m exceeds them: maxCells 6 with alwaysInclude [5] takes 0–4', () => {
      const r = selectCandidates(policy({ maxCells: 6, alwaysInclude: [k(5)] }), cells, new Map(), false);
      expect(picks(r).map(([i]) => i)).toEqual([5, 0, 1, 2, 3, 4]);
    });
  });

  it('alwaysInclude of exactly maxCells with discovery adds no top_n or ceiling cells', () => {
    const r = selectCandidates(
      policy({ maxCells: 2, topN: 2, priceCeilingPence: 10_000, alwaysInclude: [k(4), k(0)] }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [4, 'always_include'],
      [0, 'always_include'],
    ]);
  });

  it('a ceiling that admits every cell still stops at maxCells', () => {
    const r = selectCandidates(
      policy({ maxCells: 3, topN: 1, priceCeilingPence: 10_000 }),
      cells,
      priced(PRICES),
      true,
    );
    expect(picks(r)).toEqual([
      [5, 'top_n'],
      [1, 'ceiling'],
      [3, 'ceiling'],
    ]);
  });

  it('returns fresh CellKey objects: no nights key, no aliasing of the policy', () => {
    const p = policy({ maxCells: 2, topN: 1, alwaysInclude: [k(4)] });
    const r = selectCandidates(p, cells, priced(PRICES), true);
    expect(r).toEqual([
      { cell: k(4), reason: 'always_include' },
      { cell: k(5), reason: 'top_n' },
    ]);
    expect(r[0]?.cell).not.toBe(p.alwaysInclude[0]);
    expect(Object.keys(r[1]?.cell ?? {})).toEqual(['origin', 'destination', 'departureDate', 'returnDate']);
  });

  describe('spend bound (spec §6.7: maxCells is the upper bound the estimate uses)', () => {
    it.each([
      [{ maxCells: -1 }, /maxCells must be a non-negative integer/],
      [{ maxCells: 2.5 }, /maxCells must be a non-negative integer/],
      [{ topN: -1 }, /topN must be a non-negative integer/],
      [{ topN: 0.5 }, /topN must be a non-negative integer/],
      [{ perDepartureDateBest: 1.5 }, /perDepartureDateBest must be a non-negative integer/],
      [{ perDepartureDateBest: -1 }, /perDepartureDateBest must be a non-negative integer/],
    ])('throws RangeError for %j', (patch, message) => {
      expect(() => selectCandidates(policy(patch), cells, priced(PRICES), true)).toThrow(RangeError);
      expect(() => selectCandidates(policy(patch), cells, priced(PRICES), true)).toThrow(message);
    });

    it('throws when distinct in-space alwaysInclude cells exceed maxCells (duplicates and out-of-space members do not count)', () => {
      const gone = key('LHR', 'JFK', '2027-02-28', '2027-03-07');
      expect(() =>
        selectCandidates(policy({ maxCells: 1, alwaysInclude: [k(3), k(4), k(3)] }), cells, new Map(), false),
      ).toThrow(/alwaysInclude has 2 distinct cells in the space; maxCells is 1/);
      expect(
        picks(
          selectCandidates(
            policy({ maxCells: 1, alwaysInclude: [k(3), k(3), gone] }),
            cells,
            new Map(),
            false,
          ),
        ),
      ).toEqual([[3, 'always_include']]);
    });

    it('property: never more than maxCells, no duplicates, all in space, alwaysInclude kept, per-date cap held', () => {
      // A 2 × 1 × 4 × 2 = 16-cell space keeps the generator small but lets dates collide.
      const big = generateCells(
        space({ o: ['LHR', 'LGW'], d: ['JFK'], from: '2027-03-01', to: '2027-03-04', min: 7, max: 8 }),
      );
      const keys = big.map(cellKeyString);
      const arbPolicy = fc.integer({ min: 0, max: 8 }).chain((maxCells) =>
        fc.record({
          maxCells: fc.constant(maxCells),
          topN: fc.integer({ min: 0, max: maxCells }),
          priceCeilingPence: fc.option(fc.integer({ min: 0, max: 1_200 }), { nil: undefined }),
          perDepartureDateBest: fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
          alwaysIdx: fc.array(fc.integer({ min: 0, max: big.length - 1 }), { maxLength: maxCells * 2 }),
        }),
      );
      const arbDiscovery = fc.array(fc.option(fc.integer({ min: 0, max: 1_000 }), { nil: null }), {
        minLength: big.length,
        maxLength: big.length,
      });
      fc.assert(
        fc.property(arbPolicy, arbDiscovery, fc.boolean(), (p, prices, hasDiscovery) => {
          // Keep the distinct alwaysInclude count within maxCells, as validation guarantees.
          const distinct = [...new Set(p.alwaysIdx)].slice(0, p.maxCells);
          const alwaysInclude = p.alwaysIdx
            .filter((i) => distinct.includes(i))
            .flatMap((i) => {
              const c = big[i];
              return c === undefined ? [] : [key(c.origin, c.destination, c.departureDate, c.returnDate)];
            });
          const pol: VerificationPolicy = {
            maxCells: p.maxCells,
            topN: p.topN,
            alwaysInclude,
            expandTop: 2,
            bookingLinks: true,
            ...(p.priceCeilingPence === undefined ? {} : { priceCeilingPence: p.priceCeilingPence }),
            ...(p.perDepartureDateBest === undefined ? {} : { perDepartureDateBest: p.perDepartureDateBest }),
          };
          const discovery = new Map<string, RollUp>();
          big.forEach((c, i) => {
            const price = prices[i];
            if (price !== null && price !== undefined) {
              discovery.set(cellKeyString(c), { status: 'priced', reason: null, minPence: price });
            }
          });
          const r = selectCandidates(pol, big, discovery, hasDiscovery);
          const got = r.map((x) => cellKeyString(x.cell));
          expect(r.length).toBeLessThanOrEqual(p.maxCells);
          expect(new Set(got).size).toBe(got.length);
          for (const g of got) expect(keys).toContain(g);
          for (const a of alwaysInclude) expect(got).toContain(cellKeyString(a));
          if (hasDiscovery && pol.perDepartureDateBest !== undefined) {
            const perDate = new Map<string, number>();
            for (const x of r)
              perDate.set(x.cell.departureDate, (perDate.get(x.cell.departureDate) ?? 0) + 1);
            for (const x of r) {
              if (x.reason === 'always_include') continue;
              expect(perDate.get(x.cell.departureDate)).toBeLessThanOrEqual(
                Math.max(
                  pol.perDepartureDateBest,
                  r.filter(
                    (y) => y.reason === 'always_include' && y.cell.departureDate === x.cell.departureDate,
                  ).length,
                ),
              );
            }
          }
          if (!hasDiscovery) {
            const strides = r.filter((x) => x.reason === 'stride').length;
            expect(strides).toBe(Math.min(p.maxCells - distinct.length, big.length - distinct.length));
          }
        }),
        { numRuns: 500 },
      );
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

/** A non-negative integer. */
function isCount(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

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
 * `topN`, `priceCeilingPence`, `perDepartureDateBest` and `alwaysInclude` of the policy are read.
 * Pure and deterministic; the engine runs it once per execution and persists the result. Every
 * returned `cell` is a fresh `CellKey` (no `nights`, no aliasing of the policy's objects).
 *
 * Spend bound (spec §6.7 "the estimate uses maxCells as the upper bound"): throws `RangeError`
 * unless `maxCells`, `topN` and `perDepartureDateBest` (when set) are non-negative integers and
 * the distinct in-space `alwaysInclude` cells number at most `maxCells`, so the result never
 * exceeds `maxCells` even for a policy read back from storage without zod.
 *
 * Stride (step 5, "advancing past `alwaysInclude` members rather than losing a slot"): it walks
 * the cells not already chosen, `m = maxCells − |alwaysInclude|`, `k = max(1, floor(remaining / m))`,
 * taking remaining[0], remaining[k], … up to `m` cells, so it takes `min(m, remaining)` cells. It
 * ignores `perDepartureDateBest`, which belongs to steps 3–4.
 *
 * why: `alwaysInclude` members not in `cells` are left out. At execution start a relative window
 * may have slid past them (spec §6.1: "dropped with a note, not an error"); the engine records
 * them in `DefinitionSnapshot.droppedAlwaysInclude` by comparing the policy with the result.
 */
export function selectCandidates(
  policy: VerificationPolicy,
  cells: Cell[],
  discovery: Map<string, RollUp>,
  hasDiscoveryProvider: boolean,
): Array<{ cell: CellKey; reason: SelectionReason }> {
  const { maxCells, topN, perDepartureDateBest: pdb, priceCeilingPence: ceiling } = policy;
  if (!isCount(maxCells)) throw new RangeError(`maxCells must be a non-negative integer, got ${maxCells}`);
  if (!isCount(topN)) throw new RangeError(`topN must be a non-negative integer, got ${topN}`);
  if (pdb !== undefined && !isCount(pdb)) {
    throw new RangeError(`perDepartureDateBest must be a non-negative integer, got ${pdb}`);
  }
  const inSpace = new Set(cells.map(cellKeyString));
  const included = new Set(policy.alwaysInclude.map(cellKeyString).filter((k) => inSpace.has(k)));
  if (included.size > maxCells) {
    throw new RangeError(
      `alwaysInclude has ${included.size} distinct cells in the space; maxCells is ${maxCells}`,
    );
  }

  const out: Array<{ cell: CellKey; reason: SelectionReason }> = [];
  const chosen = new Set<string>();
  const perDate = new Map<string, number>();
  const take = (cell: CellKey, reason: SelectionReason) => {
    chosen.add(cellKeyString(cell));
    perDate.set(cell.departureDate, (perDate.get(cell.departureDate) ?? 0) + 1);
    const { origin, destination, departureDate, returnDate } = cell;
    out.push({ cell: { origin, destination, departureDate, returnDate }, reason });
  };

  for (const cell of policy.alwaysInclude) {
    const key = cellKeyString(cell);
    if (inSpace.has(key) && !chosen.has(key)) take(cell, 'always_include');
  }

  if (!hasDiscoveryProvider) {
    const m = maxCells - out.length;
    // why: m is never negative (alwaysInclude ≤ maxCells is enforced above); m = 0 adds nothing.
    if (m === 0) return out;
    const remaining = cells.filter((c) => !chosen.has(cellKeyString(c)));
    const k = Math.max(1, Math.floor(remaining.length / m));
    for (const cell of remaining.filter((_, j) => j % k === 0).slice(0, m)) take(cell, 'stride');
    return out;
  }

  const ranked = cells
    .flatMap((cell, i) => {
      const r = discovery.get(cellKeyString(cell));
      if (r?.status !== 'priced') return [];
      if (r.minPence === null) {
        throw new Error(`priced discovery roll-up without minPence for ${cellKeyString(cell)}`);
      }
      return [{ cell, i, minPence: r.minPence }];
    })
    .sort((a, b) => a.minPence - b.minPence || a.i - b.i);

  const fits = (cell: CellKey) =>
    out.length < maxCells && (pdb === undefined || (perDate.get(cell.departureDate) ?? 0) < pdb);

  let topAdded = 0;
  for (const { cell, minPence } of ranked) {
    const free = !chosen.has(cellKeyString(cell)) && fits(cell);
    if (topAdded < topN) {
      // step 3
      if (free) {
        take(cell, 'top_n');
        topAdded += 1;
      }
      continue;
    }
    // step 4
    if (ceiling === undefined) break;
    if (free && minPence <= ceiling) take(cell, 'ceiling');
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @gmt/core exec vitest run test/selection/select.test.ts`
Expected: PASS, 34 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: candidate selection with ceiling walk and stride fallback (spec §6.7)"
```

### Task 1.8: Barrel, no-`Date` guard, thresholds and mutation gate

**Files:**
- Create: `packages/core/test/wp1-barrel.test.ts`, `packages/core/test/wp1-no-date.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: every name in "Interfaces produced", from `@gmt/core`.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/wp1-barrel.test.ts`:

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
  // why: spreading the namespace into a plain record lets the test index it by name without a cast.
  const exported: Record<string, unknown> = { ...core };
  it.each(WP1_FUNCTIONS)('exports %s', (name) => {
    expect(typeof exported[name]).toBe('function');
  });
});
```

`packages/core/test/wp1-no-date.test.ts` (spec §6.1 "never `Date`-local arithmetic", enforced on the source text so a later edit cannot slip a `Date` in):

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

Run: `pnpm --filter @gmt/core exec vitest run test/wp1-barrel.test.ts test/wp1-no-date.test.ts`
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

Run: `pnpm --filter @gmt/core test && pnpm --filter @gmt/core mutate`
Expected: every core test passes (WP0's plus 219 from WP1) with coverage 100% statements, branches, functions and lines and no `ERROR: Coverage for …` line, then the `test:tz` part of `test` passes under all four zones; Stryker, with WP0's configuration unchanged, lists `src/selection/select.ts` and `src/coverage/rollUp.ts` each at ≥ 80% and prints `Final mutation score of … is greater than or equal to break threshold 80` (scratch: 96.32% on the two files).

- [ ] **Step 5: Commit**

```bash
git add packages/core && git commit -m "wp01: barrel exports and no-Date guard"
```

## Pinned review-focus tests

- **Review focus 1, operator types a lowercase or metropolitan IATA code (`lhr`, `LON`, `NYC`)**: Task 1.4, `describe('review focus 1: lowercase and metropolitan codes')` in `packages/core/test/space/validate.test.ts`:
  - Upstream, `iataSchema.parse('lhr')` is `'LHR'` and `iataSchema.parse(' lgw ')` is `'LGW'`; `'LHRX'` is rejected. Codes reach `validateSearchSpace` upper-case.
  - `validateSearchSpace` accepts the schema-produced `LHR`, `LGW`.
  - It upper-cases nothing itself: a lowercase code that bypassed the schema (passed as a widened `string[]` under `// @ts-expect-error`) yields exactly `{ field: 'origins.0', message: 'lhr is not a three-letter upper-case IATA code' }`.
  - `origins: ['LON']` yields `{ field: 'origins.0', message: 'LON is a city code; use one of LGW, LHR' }`, and `destinations: ['JFK', 'NYC']` yields `{ field: 'destinations.1', message: 'NYC is a city code; use one of EWR, JFK' }`, listing what `lookup.airportsOfMetro` returns (sorted by code, as WP3's `AirportsRepo` returns it).
  - `destinations: ['XYZ']` yields `{ field: 'destinations.0', message: 'XYZ is not in the airports table' }`.
  - A code that is both an airport and a metro code (`AAA`) is accepted, because existence is checked first.

## Definition of done

Run from the repository root on the `wp/01-core-space-coverage-selection` branch:

| Command | Expected |
|---|---|
| `pnpm --filter @gmt/core test` | PASS; coverage 100% statements, branches, functions, lines for `packages/core/src/**`; no `ERROR: Coverage for …` line; then `test:tz` PASS under `TZ=Europe/London`, `UTC`, `America/Los_Angeles`, `Asia/Tokyo` |
| `pnpm --filter @gmt/core mutate` | exit 0; `select.ts` and `rollUp.ts` each ≥ 80% in the table; `Final mutation score of … is greater than or equal to break threshold 80` |
| `pnpm lint` | `biome check .` reports no errors |
| `pnpm -r typecheck` | exit 0, including core's tests through WP0's `tsconfig.test.json` (every `@ts-expect-error` consumed) |
| `node scripts/check-boundaries.mjs` | exit 0 (no `@gmt/*` import and no `process.env` under `packages/core/src/`) |
| `pnpm test` | every package green at its thresholds |
| `grep -rnE '\bDate\b' packages/core/src/dates packages/core/src/space packages/core/src/coverage packages/core/src/selection` | only doc-comment lines (the no-`Date` test strips comments and passes) |
| `grep -rnE '\b(LHR\|LGW\|JFK\|EWR\|LON\|NYC)\b' packages/core/src/dates packages/core/src/space packages/core/src/coverage packages/core/src/selection` | no output (airport codes appear only in tests; the repository-wide rule stays with `scripts/check-boundaries.mjs`) |
| `grep -rnE '\bas [A-Za-z({\[]' packages/core/src/dates packages/core/src/space packages/core/src/coverage packages/core/src/selection packages/core/test` | only `as const`, `import * as`, and prose inside test names or comments |

## Open questions

None.
