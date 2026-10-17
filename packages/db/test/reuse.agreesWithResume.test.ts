// The reuse-copy target rule and the resume rule must never drift (plan decision 57): over every status × reason ×
// attempts case, copyReused accepts a target exactly when retriedOnResume(target, manual = true) says a resume would
// fetch it again, and the query that resume runs (RESUMABLE_SQL, manual) picks the same cell.
import { fixedClock, type ProviderId } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import { MANUAL_RETRYABLE, NON_RETRYABLE, OUTCOME_STATUSES, SKIP_REASONS } from '../src/internal/enums.js';
import { CalendarPricesRepo } from '../src/repositories/calendarPrices.js';
import { CellsRepo, retriedOnResume } from '../src/repositories/cells.js';
import { at, freshDb, T0 } from './helpers/db.js';
import { calendarPrice, cell, newExecution, withNights } from './helpers/factories.js';
import { rawOutcome } from './helpers/outcomes.js';

const PROVIDER: ProviderId = 'travelpayouts';
const P = cell();
const REASONS: ReadonlyArray<string | null> = [
  null,
  'network', // a retryable error reason
  ...SKIP_REASONS,
  ...NON_RETRYABLE,
  ...MANUAL_RETRYABLE,
];
const ALL_CASES = OUTCOME_STATUSES.flatMap((status) =>
  REASONS.flatMap((reason) => [0, 2, 3].map((attempts) => ({ status, reason, attempts }))),
);

/**
 * The table's own CHECK constraints decide which status/reason pairs can exist; only those rows are cases. One
 * database serves every probe: rawOutcome overwrites the same row, and a rejected UPDATE leaves it unchanged.
 */
const probeDb = freshDb();
const probeExecution = newExecution(probeDb, fixedClock(T0)).execution.id;
new CellsRepo(probeDb, fixedClock(T0), { allowSynthetic: false }).seed(
  probeExecution,
  [withNights(P)],
  [PROVIDER],
);
const storable = (c: (typeof ALL_CASES)[number]): boolean => {
  try {
    rawOutcome(probeDb, probeExecution, P, 'discovery', PROVIDER, c);
    return true;
  } catch {
    return false;
  }
};
const CASES = ALL_CASES.filter(storable);

describe('the reuse-copy target rule agrees with retriedOnResume (plan decision 57)', () => {
  it('covers both outcomes of the rule, so the agreement is not vacuous', () => {
    const verdicts = new Set(CASES.map((c) => retriedOnResume(c, true)));
    expect(verdicts).toEqual(new Set([true, false]));
    expect(CASES.length).toBeGreaterThan(40);
  });

  it.each(CASES)('$status / $reason / attempts $attempts', ({ status, reason, attempts }) => {
    const db = freshDb();
    const clock = fixedClock(T0);
    const opts = { allowSynthetic: false };
    const cells = new CellsRepo(db, clock, opts);
    const prices = new CalendarPricesRepo(db, clock, opts);
    const { definition, execution: source } = newExecution(db, clock, { status: 'completed' });
    cells.seed(source.id, [withNights(P)], [PROVIDER]);
    cells.writeTile(source.id, PROVIDER, {
      tileIndex: 0,
      cells: [P],
      prices: [calendarPrice(P, { pricePence: 40_000, priceNativeMinor: 40_000 })],
      outcomes: [
        {
          ...P,
          status: 'priced',
          reason: null,
          lastError: null,
          fetchedAt: T0,
          minPence: 40_000,
          cabin: 'economy',
          pointOfSale: 'unknown',
          sourceKind: 'authorised-cached',
        },
      ],
      discards: 0,
    });
    const target = newExecution(db, clock, { definition }).execution.id;
    cells.seed(target, [withNights(P)], [PROVIDER]);
    const criteria = {
      pointOfSale: 'unknown',
      sourceKind: 'authorised-cached',
      newerThan: at('2026-10-14T11:00:00.000Z'),
    } as const;
    const copies = prices.reuseCandidates(
      definition.id,
      PROVIDER,
      'economy',
      'unknown',
      'authorised-cached',
      [P],
      criteria.newerThan,
    );
    // why: asked before the target is edited, so the candidate query sees only well-formed sources.
    rawOutcome(db, target, P, 'discovery', PROVIDER, { status, reason, attempts });
    const resumed = cells.resumable(target, 'discovery', PROVIDER, true).length === 1; // before a copy resolves it
    let accepted = true;
    try {
      cells.copyReused(target, PROVIDER, copies, criteria);
    } catch {
      accepted = false;
    }
    expect(accepted).toBe(retriedOnResume({ status, reason, attempts }, true));
    expect(resumed).toBe(accepted);
  });
});
