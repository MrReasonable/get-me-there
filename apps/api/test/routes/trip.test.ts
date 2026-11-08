// Design 2026-11-08 §6.1 (plan Task 5): the trip route's refusals. A search that is not there (or was deleted) is 404;
// a date that is not a calendar date is the scope parser's 422; a missing date is the route wrapper's 400.
import { asIsoDate } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { errorOf } from '../helpers/contract.js';
import { exampleDefinitionInput } from '../helpers/examples.js';
import { createHarness, type Harness } from '../helpers/harness.js';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const Q = 'departureDate=2026-11-02&returnDate=2026-11-12';

async function world() {
  h = await createHarness();
  const def = h.ports.repos.definitions.create(
    exampleDefinitionInput({
      window: { kind: 'absolute', from: asIsoDate('2026-11-02'), to: asIsoDate('2026-11-05') },
    }),
  );
  return { x: h, def };
}

describe('GET /definitions/:id/trip refusals', () => {
  it('404 for an unknown search and for a deleted one', async () => {
    const { x, def } = await world();
    const unknown = await x.request(`/api/definitions/zz-missing/trip?${Q}`);
    expect(unknown.status).toBe(404);
    expect((await errorOf(unknown)).code).toBe('definition_not_found');
    x.ports.repos.definitions.softDelete(def.id);
    const deleted = await x.request(`/api/definitions/${def.id}/trip?${Q}`);
    expect(deleted.status).toBe(404);
    expect((await errorOf(deleted)).code).toBe('definition_not_found');
  });

  it.each([
    [
      'a departure that is not a calendar date',
      'departureDate=2026-13-01&returnDate=2026-11-12',
      'departureDate',
    ],
    ['a return that is not a date', 'departureDate=2026-11-02&returnDate=soon', 'returnDate'],
    ['a return before the departure', 'departureDate=2026-11-12&returnDate=2026-11-02', 'returnDate'],
  ])('422 invalid_date_pair for %s', async (_name, query, field) => {
    const { x, def } = await world();
    const res = await x.request(`/api/definitions/${def.id}/trip?${query}`);
    expect(res.status).toBe(422);
    const error = await errorOf(res);
    expect(error.code).toBe('invalid_date_pair');
    expect(error.details?.fields?.[0]?.field).toBe(field);
  });

  it("the scope's 422s inside the window: an unknown airport and a journey limit out of range", async () => {
    const { x, def } = await world();
    const airport = await x.request(`/api/definitions/${def.id}/trip?${Q}&origins=LGW`);
    expect(airport.status).toBe(422);
    expect((await errorOf(airport)).code).toBe('unknown_airport');
    const limit = await x.request(`/api/definitions/${def.id}/trip?${Q}&maxJourneyMinutes=59`);
    expect(limit.status).toBe(422);
    expect((await errorOf(limit)).code).toBe('invalid_journey_limit');
  });

  it('400 for a missing date and for a parameter the route does not take', async () => {
    const { x, def } = await world();
    expect((await x.request(`/api/definitions/${def.id}/trip?departureDate=2026-11-02`)).status).toBe(400);
    expect((await x.request(`/api/definitions/${def.id}/trip?${Q}&basis=verified`)).status).toBe(400);
  });
});
