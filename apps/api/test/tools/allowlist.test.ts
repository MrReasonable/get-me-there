// Spec §5.2: the dated allowlist enumerates parameter names AND values; tests assert both. Shape is the plan's
// ParamsAllowlist, hashed like a recorded fixture and loaded through WP4's own loader (arch-010).
import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { asIata, asIsoDate } from '@gmt/core';
import {
  assertRequestAllowed,
  loadParamsAllowlist,
  type ParamsAllowlist,
  RecorderRefusedError,
} from '@gmt/providers';
import { searchApiCalendarParams, searchApiFlightsParams } from '@gmt/providers/recording';
import { loadRecorded } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import { ParamLog, paramRules, writeAllowlist } from '../../src/tools/recordParams.js';
import { runRecording } from '../helpers/recording.js';
import { tempDir, tempRecordedRoot } from '../helpers/tmp.js';

function load(root: string, provider: 'travelpayouts' | 'searchapi'): ParamsAllowlist {
  const names = readdirSync(join(root, provider)).filter((n) => /^params-\d{4}-\d{2}-\d{2}\.json$/.test(n));
  expect(names).toEqual(['params-2026-10-20.json']);
  return loadParamsAllowlist(join(root, provider, names[0] ?? ''), root);
}

const SA_COMMON = [
  'arrival_id',
  'currency',
  'departure_id',
  'engine',
  'flight_type',
  'gl',
  'hl',
  'outbound_date',
  'return_date',
  'travel_class',
  'adults',
];

// why: ruling 11: the first test records the worked example (about 2.5 s unloaded); 30 s survives a loaded runner.
describe('parameter allowlist files (spec §5.2, plan ParamsAllowlist)', { timeout: 30_000 }, () => {
  it('the recording writes allowlists WP4 loads, with the exact names and values of brief §5.4, and every recorded request passes them', async () => {
    const { root } = await runRecording();
    const tp = load(root, 'travelpayouts');
    const sa = load(root, 'searchapi');
    expect(tp.endpoints).toEqual({
      '/aviasales/v3/prices_for_dates': {
        names: ['currency', 'departure_at', 'destination', 'limit', 'one_way', 'origin', 'page'],
        values: {
          currency: ['gbp'],
          departure_at: 'any',
          destination: 'any',
          limit: ['1000'],
          one_way: ['false'],
          origin: 'any',
          page: 'any',
        },
      },
    });
    const fixedSa = {
      adults: ['1'],
      currency: ['GBP'],
      flight_type: ['round_trip'],
      gl: ['gb'],
      hl: ['en'],
      travel_class: ['business', 'economy', 'first_class', 'premium_economy'],
    };
    expect(sa.endpoints).toEqual({
      '/api/v1/search?engine=google_flights_calendar': {
        names: [
          ...SA_COMMON,
          'outbound_date_end',
          'outbound_date_start',
          'return_date_end',
          'return_date_start',
          'separate_tickets',
        ].sort(),
        values: {
          ...fixedSa,
          engine: ['google_flights_calendar'],
          separate_tickets: ['1'],
          arrival_id: 'any',
          departure_id: 'any',
          outbound_date: 'any',
          outbound_date_end: 'any',
          outbound_date_start: 'any',
          return_date: 'any',
          return_date_end: 'any',
          return_date_start: 'any',
        },
      },
      '/api/v1/search?engine=google_flights': {
        names: [
          ...SA_COMMON,
          'booking_token',
          'departure_token',
          'separate_tickets',
          'show_cheapest_flights',
          'sort_by',
          'stops',
        ].sort(),
        values: {
          ...fixedSa,
          engine: ['google_flights'],
          separate_tickets: ['1'],
          sort_by: ['price'],
          // why: sent on every google_flights step (vendor docs read 2026-10-18), so a run records the value it sent.
          show_cheapest_flights: ['true'],
          // why: ruling 8: the documented set is listed though the worked example sets no maxStops and sends none.
          stops: ['nonstop', 'one_stop_or_fewer', 'two_stops_or_fewer'],
          arrival_id: 'any',
          departure_id: 'any',
          outbound_date: 'any',
          return_date: 'any',
          booking_token: 'any',
          departure_token: 'any',
        },
      },
    });
    for (const doc of [tp, sa]) {
      for (const ep of Object.values(doc.endpoints))
        for (const banned of ['api_key', 'token', 'market', 'trip_class', 'return_at'])
          expect(ep.names).not.toContain(banned);
      expect(sa.endpoints['/api/v1/search?engine=google_flights_calendar']?.names).not.toContain('stops');
    }
    for (const f of loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates'))
      assertRequestAllowed(tp, f.endpointPath, new URL(f.request.url));
    for (const f of loadRecorded(root, 'searchapi', '/api/v1/search'))
      assertRequestAllowed(sa, f.endpointPath, new URL(f.request.url));
    // why: the tool builds its requests with the providers' builders, so every itinerary step it records asks for the
    // cheapest set, as production does; the calendar engine has no such parameter.
    const sent = loadRecorded(root, 'searchapi', '/api/v1/search').map(
      (f) => new URL(f.request.url).searchParams,
    );
    const flights = sent.filter((p) => p.get('engine') === 'google_flights');
    expect(flights.length).toBeGreaterThan(0);
    for (const p of flights) expect(p.get('show_cheapest_flights')).toBe('true');
    for (const p of sent.filter((x) => x.get('engine') === 'google_flights_calendar'))
      expect(p.has('show_cheapest_flights')).toBe(false);
  });

  it('ParamLog refuses an unlisted parameter or value before the request leaves, naming the parameter only (ts-015)', () => {
    const log = new ParamLog(paramRules());
    expect(() =>
      log.validate('google_flights', new URLSearchParams({ engine: 'google_flights', api_key: 'x' })),
    ).toThrow('parameter api_key is not in the google_flights allowlist');
    expect(() => log.validate('prices_for_dates', new URLSearchParams({ currency: 'GBP' }))).toThrow(
      'prices_for_dates: a value of currency is not allowed',
    );
    expect(() => log.validate('google_flights', new URLSearchParams({ gl: 'us' }))).toThrow(
      'google_flights: a value of gl is not allowed',
    );
    expect(() => log.validate('google_flights', new URLSearchParams({ outbound_date: '2027-3-1' }))).toThrow(
      'google_flights: outbound_date is not a iso-date',
    );
  });

  it('refuses a second allowlist for the same provider and date, and a symlink at the target (sec2-006)', () => {
    const doc: ParamsAllowlist = {
      provider: 'searchapi',
      recordedAt: asIsoDate('2026-10-20'),
      endpoints: {},
      contentSha256: '',
    };
    const { root } = tempRecordedRoot();
    writeAllowlist(root, doc);
    expect(() => writeAllowlist(root, doc)).toThrow(/EEXIST/);
    const other = tempRecordedRoot().root;
    mkdirSync(join(other, 'searchapi'));
    symlinkSync(join(tempDir(), 'elsewhere.json'), join(other, 'searchapi', 'params-2026-10-20.json'));
    expect(() => writeAllowlist(other, doc)).toThrow(/EEXIST/);
  });

  it('refuses to write outside fixtures/recorded, through a symlinked recorded root or a symlinked provider directory (sec-003)', () => {
    const doc: ParamsAllowlist = {
      provider: 'searchapi',
      recordedAt: asIsoDate('2026-10-20'),
      endpoints: {},
      contentSha256: '',
    };
    // why: the root rule is WP4's assertRecordedRoot, shared with the recorder (arch I-3)
    const elsewhere = join(tempDir(), 'elsewhere');
    mkdirSync(elsewhere);
    expect(() => writeAllowlist(elsewhere, doc)).toThrow(RecorderRefusedError);
    expect(() => writeAllowlist(elsewhere, doc)).toThrow(/must end in fixtures\/recorded/);
    expect(() => writeAllowlist(join(tempDir(), 'fixtures', 'recorded'), doc)).toThrow(/does not exist/);
    const linkedRoot = join(tempDir(), 'fixtures', 'recorded');
    mkdirSync(join(linkedRoot, '..'), { recursive: true });
    symlinkSync(tempDir(), linkedRoot);
    expect(() => writeAllowlist(linkedRoot, doc)).toThrow(/must end in fixtures\/recorded/);
    const { root } = tempRecordedRoot();
    symlinkSync(tempDir(), join(root, 'searchapi'));
    expect(() => writeAllowlist(root, doc)).toThrow(/resolves outside/);
  });
});

// why: ruling 11: records the worked example once (about 2.5 s unloaded); 30 s survives a loaded runner.
describe("record:fixtures sends the adapter's own SearchApi parameter sets (ruling 18, ca-012)", {
  timeout: 30_000,
}, () => {
  it('every SearchApi request equals what @gmt/providers builds for the same rectangle or cell', async () => {
    const { seen } = await runRecording();
    expect(seen.sa.length).toBeGreaterThan(0);
    for (const p of seen.sa) {
      const sent = Object.fromEntries(p);
      const base = { origin: asIata(sent.departure_id ?? ''), destination: asIata(sent.arrival_id ?? '') };
      const built =
        sent.engine === 'google_flights_calendar'
          ? searchApiCalendarParams(
              { ...base, cabin: 'economy' },
              {
                kind: 'rectangle',
                departFrom: asIsoDate(sent.outbound_date_start ?? ''),
                departTo: asIsoDate(sent.outbound_date_end ?? ''),
                returnFrom: asIsoDate(sent.return_date_start ?? ''),
                returnTo: asIsoDate(sent.return_date_end ?? ''),
              },
              'GB',
            )
          : searchApiFlightsParams(
              {
                ...base,
                departureDate: asIsoDate(sent.outbound_date ?? ''),
                returnDate: asIsoDate(sent.return_date ?? ''),
                cabin: 'economy',
                adults: 1,
                currency: 'GBP',
                expandTop: 1,
                bookingLinks: true,
              },
              'GB',
              sent.departure_token !== undefined
                ? { departure_token: sent.departure_token }
                : sent.booking_token !== undefined
                  ? { booking_token: sent.booking_token }
                  : undefined,
            );
      expect(sent).toEqual(built);
    }
  });
});
