/**
 * A calendar provider of a real kind for layer-A alert tests (review TS-5, TS-16): id `travelpayouts`, sourceKind
 * `authorised-cached`, so the alert runner does not refuse its rows the way it refuses the fixture provider's. It makes
 * no HTTP call: it answers every planned tile from `priceOf`, and stands in for a cap breach by throwing core's
 * BudgetExceeded from the tile that `refuse` names — what http-kit's reservation throws in production (spec §5.3).
 * Test-only; nothing in src imports it, and the engine still runs its whole pass, status and alerts step.
 */
import {
  BudgetExceeded,
  type CellKey,
  type Clock,
  type FlightProvider,
  generateCells,
  type TilePlan,
} from '@gmt/core';

export interface RealKindProviderOptions {
  clock: Clock;
  /** The price of a cell, in pence. */
  priceOf: (cell: CellKey) => number;
  /** Called before each tile; a BudgetExceeded it returns is thrown instead of answering. */
  refuse?: (tileIndex: number) => BudgetExceeded | null;
}

/** One tile per departure date over the cells the engine asks for (q.cells on a resume), in date order. */
export function realKindProvider(o: RealKindProviderOptions): FlightProvider {
  return {
    id: 'travelpayouts',
    displayName: 'Travelpayouts (layer-A stand-in)',
    suppliedFields: ['price'],
    cabins: ['economy'],
    discovery: {
      info: { sourceKind: 'authorised-cached', provenanceNote: 'layer-A stand-in, no HTTP', maxAgeHours: 48 },
      plan(q): TilePlan[] {
        const cells: CellKey[] =
          q.cells ??
          generateCells({
            origins: [q.origin],
            destinations: [q.destination],
            departureFrom: q.departureFrom,
            departureTo: q.departureTo,
            minNights: q.minNights,
            maxNights: q.maxNights,
          });
        const byDate = new Map<string, CellKey[]>();
        for (const c of cells) byDate.set(c.departureDate, [...(byDate.get(c.departureDate) ?? []), c]);
        return [...byDate.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([, covered], index) => {
            const returns = covered.map((c) => c.returnDate).sort();
            const first = covered[0];
            if (first === undefined) throw new Error('empty tile');
            return {
              index,
              coveredCells: covered,
              request: {
                kind: 'rectangle',
                departFrom: first.departureDate,
                departTo: first.departureDate,
                returnFrom: returns[0] ?? first.returnDate,
                returnTo: returns.at(-1) ?? first.returnDate,
              },
            };
          });
      },
      async fetchTile(plan) {
        const refusal = o.refuse?.(plan.index) ?? null;
        if (refusal !== null) throw refusal;
        return {
          kind: 'tile',
          index: plan.index,
          coveredCells: plan.coveredCells,
          fetchedAt: o.clock.now(),
          pointOfSale: 'unknown',
          prices: plan.coveredCells.map((c) => ({
            ...c,
            amountMinor: o.priceOf(c),
            currency: 'GBP',
            returnDateSource: 'vendor' as const,
            vendorPriceMark: null,
          })),
          noFares: [],
          notes: [],
        };
      },
    },
    healthcheck: async () => ({ ok: true, detail: 'not probed' }),
  };
}

/** The cap breach http-kit's reservation throws when this run's free-call cap is spent. */
export function freeCallCapBreach(): BudgetExceeded {
  return new BudgetExceeded({ scope: 'execution-free-calls', cap: 5, current: 5, requested: 1 });
}

/** The cap breach of a provider's monthly call cap (no other discovery provider remains). */
export function providerMonthBreach(): BudgetExceeded {
  return new BudgetExceeded({
    scope: 'provider-month',
    cap: 5,
    current: 5,
    requested: 1,
    providerId: 'travelpayouts',
  });
}
