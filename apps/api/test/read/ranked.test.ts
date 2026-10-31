// Spec revision 55 §8.1, §10: `rankedPairsFor` is the board's ranking (the date-pairs route decoded and ranked by
// core's `rankDatePairs`), departed date pairs left out, the journey limit applied.
import { asIsoDateTime, rankDatePairs } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { rankedPairsFor } from '../../src/read/ranked.js';
import { currentSpace } from '../../src/read/space.js';
import { datesOf, seedDatesWorld } from '../helpers/dates.js';
import { EWR, exampleDefinitionInput, JFK, LGW, LHR, SMALL_WINDOW } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const FOUR = { origins: [LHR, LGW], destinations: [JFK, EWR], window: SMALL_WINDOW };

async function world() {
  h = await createHarness();
  const x = h;
  const def = x.ports.repos.definitions.create(exampleDefinitionInput(FOUR));
  seedDatesWorld(x, def, () => true);
  return { x, def };
}

describe('rankedPairsFor (revision 55 §8.1, §10)', () => {
  it("equals the board's ranked rows for the same data, with each figure's airport pair and source", async () => {
    const { x, def } = await world();
    const board = rankDatePairs((await datesOf(x, def.id)).pairs, x.clock.now());
    const ranked = rankedPairsFor(x.ports, {
      definitionId: def.id,
      space: currentSpace(def, x.clock.todayLondon()),
      cabin: def.cabin,
      maxJourneyMinutes: null,
      now: x.clock.now(),
    });
    expect(ranked.length).toBeGreaterThan(1);
    expect(ranked).toEqual(
      board.map((p) => ({
        departureDate: p.departureDate,
        returnDate: p.returnDate,
        origin: p.figure?.origin,
        destination: p.figure?.destination,
        pricePence: p.figure?.price.pricePence,
        providerId: p.figure?.price.provenance.providerId,
        sourceKind: p.figure?.price.provenance.sourceKind,
      })),
    );
  });

  it('applies the journey limit as the board does, and leaves out date pairs departing on or before today in London', async () => {
    const { x, def } = await world();
    const q = {
      definitionId: def.id,
      space: currentSpace(def, x.clock.todayLondon()),
      cabin: def.cabin,
      now: x.clock.now(),
    };
    const limited = rankedPairsFor(x.ports, { ...q, maxJourneyMinutes: 600 });
    const board = rankDatePairs((await datesOf(x, def.id, '?maxJourneyMinutes=600')).pairs, x.clock.now());
    expect(limited.map((p) => [p.departureDate, p.returnDate, p.pricePence])).toEqual(
      board.map((p) => [p.departureDate, p.returnDate, p.figure?.price.pricePence]),
    );
    const all = rankedPairsFor(x.ports, { ...q, maxJourneyMinutes: null });
    const firstDay = all.map((p) => p.departureDate).sort()[0];
    if (firstDay === undefined) throw new Error('no ranked pairs');
    // why: the clock moved to the first departure day: every pair leaving that day is now departed
    x.clock.set(asIsoDateTime(`${firstDay}T12:00:00.000Z`));
    const later = rankedPairsFor(x.ports, { ...q, maxJourneyMinutes: null });
    expect(later.length).toBeLessThan(all.length);
    expect(later.every((p) => p.departureDate > firstDay)).toBe(true);
    expect(
      rankedPairsFor(x.ports, { ...q, definitionId: 'no-such-definition', maxJourneyMinutes: null }),
    ).toEqual([]);
  });
});
