import { HttpResponse, http } from 'msw/http';
import { describe, expect, it } from 'vitest';
import { TP } from '../fakes.js';
import { server } from '../support/msw.js';
import {
  ctx,
  discoveryOf,
  envelope,
  eventsOf,
  makeHarness,
  makeProvider,
  NOW,
  only,
  query,
  tileOf,
} from './harness.js';

describe('travelpayouts: empty is per capability (spec §5.2, authorised-cached)', () => {
  it('a schema-valid {"success": true, "data": [], "currency": "gbp"} leaves every covered cell for no_data: zero prices, zero noFares, no issues', async () => {
    let hits = 0;
    server.use(
      http.get(TP, () => {
        hits += 1;
        // synthetic shape: the documented envelope with no rows
        return HttpResponse.json(envelope([]));
      }),
    );
    const h = makeHarness();
    const d = discoveryOf(makeProvider(h));
    const q = query();
    const r = tileOf(await d.fetchTile(only(d.plan(q)), q, ctx()));
    expect(r).toMatchObject({
      kind: 'tile',
      index: 0,
      pointOfSale: 'unknown',
      prices: [],
      noFares: [],
      fetchedAt: NOW,
    });
    expect(r.cellIssues).toBeUndefined();
    // 11 departure days × 3 nights, all covered and none priced: WP7 records each as no_data.
    expect(r.coveredCells).toHaveLength(33);
    expect(r.notes).toEqual(['pages:1']);
    expect(hits).toBe(1);
    // one upstream attempt, ledgered under the tile's index at zero cost, finalised once (setup.ts checks none is open)
    expect(eventsOf(h, 'reserve')).toEqual([
      expect.objectContaining({
        providerId: 'travelpayouts',
        endpointPath: '/aviasales/v3/prices_for_dates',
        executionId: 'exec-1',
        tileIndex: 0,
        httpAttempt: 1,
        costMicroGbp: 0,
      }),
    ]);
    expect(eventsOf(h, 'finalise')).toEqual([expect.objectContaining({ outcome: 'ok', httpStatus: 200 })]);
  });
});
