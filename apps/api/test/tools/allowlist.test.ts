// Spec §5.2: the dated allowlist enumerates parameter names AND values; tests assert both. Shape is the plan's
// ParamsAllowlist, hashed like a recorded fixture and loaded through WP4's own loader (arch-010).
import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { asIsoDate } from '@gmt/core';
import { assertRequestAllowed, loadParamsAllowlist, type ParamsAllowlist } from '@gmt/providers';
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

describe('parameter allowlist files (spec §5.2, plan ParamsAllowlist)', () => {
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
        names: [...SA_COMMON, 'booking_token', 'departure_token', 'separate_tickets', 'sort_by'].sort(),
        values: {
          ...fixedSa,
          engine: ['google_flights'],
          separate_tickets: ['1'],
          sort_by: ['price'],
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
        for (const banned of ['api_key', 'token', 'market', 'trip_class', 'return_at', 'stops'])
          expect(ep.names).not.toContain(banned);
    }
    for (const f of loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates'))
      assertRequestAllowed(tp, f.endpointPath, new URL(f.request.url));
    for (const f of loadRecorded(root, 'searchapi', '/api/v1/search'))
      assertRequestAllowed(sa, f.endpointPath, new URL(f.request.url));
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
    expect(() => writeAllowlist(join(tempDir(), 'elsewhere'), doc)).toThrow(
      'refusing to write outside fixtures/recorded/',
    );
    const linkedRoot = join(tempDir(), 'fixtures', 'recorded');
    mkdirSync(join(linkedRoot, '..'), { recursive: true });
    symlinkSync(tempDir(), linkedRoot);
    expect(() => writeAllowlist(linkedRoot, doc)).toThrow(/resolves to .*outside fixtures\/recorded/);
    const { root } = tempRecordedRoot();
    symlinkSync(tempDir(), join(root, 'searchapi'));
    expect(() => writeAllowlist(root, doc)).toThrow(/resolves outside/);
  });
});
