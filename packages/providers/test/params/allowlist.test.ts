import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withContentHash } from '../../src/http/recorder.js';
import {
  assertRequestAllowed,
  loadParamsAllowlist,
  ParamsNotAllowedError,
} from '../../src/params/allowlist.js';

const EP = '/api/v1/search';
const good = {
  provider: 'searchapi',
  recordedAt: '2026-10-14',
  endpoints: {
    [`${EP}?engine=google_flights`]: {
      names: ['currency', 'departure_id', 'departure_token', 'engine', 'gl'],
      values: {
        currency: ['GBP'],
        departure_id: 'any',
        departure_token: 'any',
        engine: ['google_flights'],
        gl: ['gb'],
      },
    },
    [`${EP}?engine=google_flights_calendar`]: {
      names: ['currency', 'departure_id', 'engine', 'gl'],
      values: { currency: ['GBP'], departure_id: 'any', engine: ['google_flights_calendar'], gl: ['gb'] },
    },
    '/other': { names: ['q'], values: { q: 'any' } },
  },
};
let root = '';
function write(content: unknown): string {
  root = join(mkdtempSync(join(tmpdir(), 'gmt-par-')), 'fixtures', 'recorded');
  mkdirSync(join(root, 'searchapi'), { recursive: true });
  const p = join(root, 'searchapi', 'params-2026-10-14.json');
  writeFileSync(p, JSON.stringify(content));
  return p;
}
const load = (content: unknown) => {
  const p = write(content);
  return loadParamsAllowlist(p, root);
};
const allowlist = () => load(withContentHash(good));
const url = (q: string, path = EP) => new URL(`https://www.searchapi.io${path}?${q}`);
const flights = 'engine=google_flights&gl=gb&currency=GBP&departure_id=LHR';

describe('loadParamsAllowlist (spec §5.2 dated allowlist)', () => {
  it('loads a hashed allowlist from the recorded tree, built from validated parts', () => {
    expect(allowlist()).toMatchObject({
      provider: 'searchapi',
      recordedAt: '2026-10-14',
      endpoints: { '/other': { names: ['q'], values: { q: 'any' } } },
    });
  });
  it('refuses a hand-edited file (content hash)', () => {
    expect(() => load({ ...withContentHash(good), recordedAt: '2026-10-15' })).toThrow(
      /content hash mismatch/,
    );
  });
  it('refuses names that are not strictly ascending, a value entry for an unlisted name, and a name without values', () => {
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: { [EP]: { names: ['gl', 'engine'], values: { gl: ['gb'], engine: 'any' } } },
        }),
      ),
    ).toThrow(/ascending/);
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: { [EP]: { names: ['gl'], values: { gl: ['gb'], hl: ['en'] } } },
        }),
      ),
    ).toThrow(/hl/);
    expect(() =>
      load(
        withContentHash({ ...good, endpoints: { [EP]: { names: ['gl', 'hl'], values: { gl: ['gb'] } } } }),
      ),
    ).toThrow(/hl/);
  });
  it('refuses an unknown provider and a recordedAt that is not a real date (arch-010)', () => {
    expect(() => load(withContentHash({ ...good, provider: 'kiwi' }))).toThrow(/provider/);
    expect(() => load(withContentHash({ ...good, recordedAt: '2026-13-40' }))).toThrow(/recordedAt/);
  });
  it('refuses an endpoint key that is neither <path> nor <path>?<name>=<value>', () => {
    expect(() =>
      load(
        withContentHash({ ...good, endpoints: { 'api/v1/search': { names: ['q'], values: { q: 'any' } } } }),
      ),
    ).toThrow(/endpoint key/);
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: { [`${EP}?engine=a&gl=b`]: { names: ['q'], values: { q: 'any' } } },
        }),
      ),
    ).toThrow(/endpoint key/);
  });
});

describe('assertRequestAllowed (names and values)', () => {
  it('accepts listed names with listed values, and any value where the allowlist says any', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url(flights))).not.toThrow();
  });
  it('refuses an unlisted parameter, naming it', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url(`${flights}&hl=en`))).toThrow(
      ParamsNotAllowedError,
    );
    expect(() => assertRequestAllowed(allowlist(), EP, url(`${flights}&hl=en`))).toThrow(/hl/);
  });
  it('refuses an unlisted value without echoing it', () => {
    let message = '';
    try {
      assertRequestAllowed(allowlist(), EP, url('engine=google_flights&gl=us-secret-looking-value'));
    } catch (e) {
      message = e instanceof Error ? e.message : '';
    }
    expect(message).toMatch(/gl/);
    expect(message).not.toContain('us-secret-looking-value');
  });
  it('refuses an unknown endpoint and a URL whose path is not the endpoint', () => {
    expect(() => assertRequestAllowed(allowlist(), '/nowhere', url('q=1', '/nowhere'))).toThrow(
      ParamsNotAllowedError,
    );
    expect(() =>
      assertRequestAllowed(allowlist(), EP, url('engine=google_flights', '/api/v2/search')),
    ).toThrow(/path/);
  });
});

describe('engine-discriminated keys (pie-005)', () => {
  it('uses the key whose engine matches: departure_token is allowed on google_flights and refused on the calendar engine', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url(`${flights}&departure_token=x`))).not.toThrow();
    expect(() =>
      assertRequestAllowed(
        allowlist(),
        EP,
        url('engine=google_flights_calendar&gl=gb&currency=GBP&departure_token=x'),
      ),
    ).toThrow(/departure_token/);
  });
  it('refuses a request matching no discriminated key when the path has only discriminated keys', () => {
    expect(() => assertRequestAllowed(allowlist(), EP, url('engine=google_hotels&gl=gb'))).toThrow(
      /no allowlist entry/,
    );
  });
  it('falls back to the bare <path> key when the discriminator does not match and a bare key exists', () => {
    const withBare = load(
      withContentHash({
        ...good,
        endpoints: { ...good.endpoints, [EP]: { names: ['engine'], values: { engine: ['google_hotels'] } } },
      }),
    );
    expect(() => assertRequestAllowed(withBare, EP, url('engine=google_hotels'))).not.toThrow();
  });
});

describe('one reading of the parameters for the key and the request (review I2)', () => {
  it('refuses a key whose discriminator value is not in the unreserved charset, so raw and decoded forms agree', () => {
    for (const value of ['google%20flights', 'google+flights', 'a b'])
      expect(() =>
        load(
          withContentHash({
            ...good,
            endpoints: { [`${EP}?engine=${value}`]: { names: ['engine'], values: { engine: [value] } } },
          }),
        ),
      ).toThrow(/endpoint key/);
  });
  it('refuses a discriminated entry that does not list its discriminator, or allows other values of it', () => {
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: { [`${EP}?engine=google_flights`]: { names: ['gl'], values: { gl: ['gb'] } } },
        }),
      ),
    ).toThrow(/discriminator/);
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: {
            [`${EP}?engine=google_flights`]: {
              names: ['engine'],
              values: { engine: ['google_flights', 'google_hotels'] },
            },
          },
        }),
      ),
    ).toThrow(/discriminator/);
    expect(() =>
      load(
        withContentHash({
          ...good,
          endpoints: { [`${EP}?engine=google_flights`]: { names: ['engine'], values: { engine: 'any' } } },
        }),
      ),
    ).toThrow(/discriminator/);
  });
  it('refuses a request that repeats a parameter, the discriminator included, naming the parameter only', () => {
    const repeated = url('engine=google_flights&engine=google_flights_calendar&gl=gb');
    expect(() => assertRequestAllowed(allowlist(), EP, repeated)).toThrow(ParamsNotAllowedError);
    expect(() => assertRequestAllowed(allowlist(), EP, repeated)).toThrow(/engine.*repeated/);
    expect(() => assertRequestAllowed(allowlist(), EP, url(`${flights}&gl=gb`))).toThrow(/gl.*repeated/);
  });
  it('refuses a request that more than one discriminated key matches instead of picking by sort order', () => {
    const two = load(
      withContentHash({
        ...good,
        endpoints: {
          [`${EP}?engine=google_flights`]: {
            names: ['engine', 'type'],
            values: { engine: ['google_flights'], type: ['1'] },
          },
          [`${EP}?type=1`]: { names: ['engine', 'type'], values: { engine: 'any', type: ['1'] } },
        },
      }),
    );
    expect(() => assertRequestAllowed(two, EP, url('engine=google_flights&type=1'))).toThrow(/more than one/);
  });
});
