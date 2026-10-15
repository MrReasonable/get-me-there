import { asIata, asIsoDate, type DiscoveryQuery } from '@gmt/core';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from '../support/msw.js';
import { assertEverySentAllowed, ctx, KEY, saKit } from './support/kit.js';
import { capabilities, makeProvider } from './support/provider.js';
import {
  agent,
  bookingBody,
  CELL_QUERY,
  ECHO,
  flightsBody,
  IN_1,
  OUT_A,
  ok,
  option,
  syntheticHandler,
} from './support/synthetic.js';

afterEach(() => assertEverySentAllowed());

const q: DiscoveryQuery = {
  origin: asIata('LHR'),
  destination: asIata('JFK'),
  departureFrom: asIsoDate('2026-11-02'),
  departureTo: asIsoDate('2026-11-03'),
  minNights: 10,
  maxNights: 11,
  cabin: 'economy',
  currency: 'GBP',
};

describe('the SearchApi key reaches no sink but the Authorization header (spec §5.3 sentinel test, §2 fact 8)', () => {
  it('calendar, chain, cache, ledger, logs, results and both error paths hold no trace of the key (synthetic)', async () => {
    const secret = KEY.reveal();
    server.use(
      syntheticHandler((p) => {
        if (p.get('departure_id') === 'LGW') return { status: 401, body: { error: 'Invalid API key.' } };
        if (p.get('engine') === 'google_flights_calendar')
          return ok({ ...ECHO, calendar: [{ departure: '2026-11-02', return: '2026-11-12', price: 480 }] });
        if (p.has('booking_token')) return ok(bookingBody([agent(573)]));
        if (p.has('departure_token')) return ok(flightsBody([option(IN_1, 600, { booking_token: 'b1' })]));
        return ok(flightsBody([option(OUT_A, 600, { departure_token: 'dA' })]));
      }),
    );
    const k = saKit();
    const p = makeProvider(k);
    const { discovery, verification } = capabilities(p);
    const sinks: string[] = [];
    for (const plan of discovery.plan(q))
      sinks.push(JSON.stringify(await discovery.fetchTile(plan, q, ctx())));
    // the calendar error path: a 401 tile-error, whose message becomes last_error
    const lgw = { ...q, origin: asIata('LGW') };
    for (const plan of discovery.plan(lgw)) {
      const tile = await discovery.fetchTile(plan, lgw, ctx());
      expect(tile.kind).toBe('tile-error');
      sinks.push(JSON.stringify(tile), tile.kind === 'tile-error' ? tile.error.message : '');
    }
    sinks.push(JSON.stringify(await verification.search({ ...CELL_QUERY, expandTop: 1 }, ctx())));
    const err: unknown = await verification.search({ ...CELL_QUERY, origin: asIata('LGW') }, ctx()).then(
      () => {
        throw new Error('expected the 401 to reject');
      },
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ kind: 'auth' });
    sinks.push(String(err), JSON.stringify(err), err instanceof Error ? (err.stack ?? '') : '');
    sinks.push(...k.log.lines, JSON.stringify([...k.cache.entries.entries()]));
    sinks.push(...k.events.map((e) => JSON.stringify(e.type === 'fetch' ? { ...e, headers: {} } : e)));
    for (const text of sinks) expect(text).not.toContain(secret);
    const fetches = k.events.flatMap((e) => (e.type === 'fetch' ? [e] : []));
    expect(fetches).toHaveLength(6); // 1 calendar tile + the calendar 401 + 3 chain steps + the chain 401
    for (const f of fetches) {
      expect(f.headers.authorization).toBe(`Bearer ${secret}`);
      expect(f.url).not.toContain(secret);
      expect(new URL(f.url).searchParams.has('api_key')).toBe(false);
    }
  });
});
