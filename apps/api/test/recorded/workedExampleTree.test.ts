// Every predicate of the committed-tree check passes on a known-good tree recorded from the stand-ins and fails on a
// broken copy (r2-ts-002), before it ever meets the live recording; the stand-in tripwire catches a test tree
// signed as a real one (prov-wp04b-006).
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RecordedFixture } from '@gmt/providers';
import { loadRecorded, withContentHash } from '@gmt/providers/testing';
import { describe, expect, it } from 'vitest';
import { RECORDED_BY } from '../../src/tools/record.js';
import { runRecording, TEST_RECORDED_BY } from '../helpers/recording.js';
import { filesUnder } from '../helpers/tmp.js';
import { STANDIN_MARKER } from '../helpers/vendors.js';
import { checkWorkedExampleTree, holdsStandInMarker } from '../helpers/workedExampleTree.js';

const OK = { recordedBy: TEST_RECORDED_BY, standInsAllowed: true };
const q = (f: RecordedFixture, k: string): string | null => new URL(f.request.url).searchParams.get(k);

/** Rewrites one recording through `mutate`, re-hashed and renamed so only the predicate under test can object. */
function rewrite(
  root: string,
  pick: (f: RecordedFixture) => boolean,
  mutate: (json: Record<string, unknown>) => void,
): void {
  const path = filesUnder(root).find((p) => {
    if (!p.endsWith('.json') || p.endsWith('.raw.json') || p.includes('params-')) return false;
    const f = [
      ...loadRecorded(root, 'travelpayouts', '/aviasales/v3/prices_for_dates'),
      ...loadRecorded(root, 'searchapi', '/api/v1/search'),
    ].find((x) => p.endsWith(`${x.recordedAt.slice(0, 10)}-${x.contentSha256.slice(0, 12)}.json`));
    return f !== undefined && pick(f);
  });
  if (path === undefined) throw new Error('no recording matched');
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('not an object');
  const json = Object.fromEntries(Object.entries(parsed).filter(([k]) => k !== 'contentSha256'));
  mutate(json);
  const hashed = withContentHash(json);
  const recordedAt = typeof json.recordedAt === 'string' ? json.recordedAt : '';
  const next = join(dirname(path), `${recordedAt.slice(0, 10)}-${hashed.contentSha256.slice(0, 12)}.json`);
  writeFileSync(path, `${JSON.stringify(hashed, null, 2)}\n`);
  renameSync(path, next);
}

describe('checkWorkedExampleTree (the committed-tree manifest)', () => {
  it('accepts a known-good tree recorded from the stand-ins', async () => {
    const { root } = await runRecording();
    expect(checkWorkedExampleTree(root, OK)).toEqual([]);
  });

  it('rejects the stand-ins under the real signature: the signature check and the stand-in tripwire both fire (prov-wp04b-006)', async () => {
    const { root } = await runRecording();
    const problems = checkWorkedExampleTree(root, { recordedBy: RECORDED_BY, standInsAllowed: false });
    expect(problems).toContain(`recordedBy ${TEST_RECORDED_BY} on a searchapi file`);
    expect(problems).toContain(
      "a searchapi file holds the test stand-ins' marker: stand-in data in the committed tree",
    );
  });

  it('rejects a second recording session', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => f.providerId === 'travelpayouts' && f.status === 200,
      (j) => {
        j.session = '20000101T000000000Z-000000';
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain('2 recording sessions, expected one');
  });

  it("rejects a step-2 placeholder missing from step 1's body", async () => {
    const { root } = await runRecording();
    const step1 = (f: RecordedFixture): boolean =>
      q(f, 'engine') === 'google_flights' &&
      f.status === 200 &&
      q(f, 'departure_token') === null &&
      q(f, 'booking_token') === null;
    rewrite(root, step1, (j) => {
      j.body = {};
    });
    expect(checkWorkedExampleTree(root, OK)).toContain(
      "searchapi: step 2's departure_token is not in step 1's body",
    );
  });

  it('rejects a step-1 cell outside the 10–21-night band', async () => {
    const { root } = await runRecording();
    const step1 = (f: RecordedFixture): boolean =>
      q(f, 'engine') === 'google_flights' &&
      f.status === 200 &&
      q(f, 'departure_token') === null &&
      q(f, 'booking_token') === null;
    rewrite(root, step1, (j) => {
      const request = j.request;
      if (
        typeof request !== 'object' ||
        request === null ||
        !('url' in request) ||
        typeof request.url !== 'string'
      )
        throw new Error('request');
      const url = new URL(request.url);
      url.searchParams.set('return_date', '2027-03-29');
      j.request = { ...request, url: url.href };
    });
    expect(checkWorkedExampleTree(root, OK)).toContain('searchapi: step 1 is 27 nights, outside 10–21');
  });

  it('rejects a search_metadata URL on a host other than www.searchapi.io (the host allowlist applies there)', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'booking_token') !== null && f.status === 200,
      (j) => {
        j.body = {
          ...asObject(j.body),
          search_metadata: { json_endpoint: 'https://evil.example/api/v1/searches/x.json' },
        };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain(
      'search_metadata URL host evil.example under json_endpoint',
    );
  });

  it('accepts vendor body URLs on any https host: airline sites and gstatic images (ruling after the live run)', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'booking_token') !== null && f.status === 200,
      (j) => {
        j.body = {
          ...asObject(j.body),
          airline_logos: ['https://www.gstatic.com/flights/airline_logos/70px/EI.png'],
          booking_options: [
            {
              book_with: 'Aer Lingus',
              price: 603,
              booking_request: { url: 'https://www.aerlingus.com/booking?lang=en&cabin=economy' },
              baggage: { url: 'http://www.aerlingus.com/help/baggage/' },
            },
          ],
        };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toEqual([]);
  });

  it('rejects a plain-http body URL that carries a query', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'booking_token') !== null && f.status === 200,
      (j) => {
        j.body = {
          booking_options: [{ book_with: 'Aer Lingus', url: 'http://www.aerlingus.com/booking?lang=en' }],
        };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain('body URL under url is not https');
  });

  it('rejects a credential-shaped query parameter on an airline URL', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'booking_token') !== null && f.status === 200,
      (j) => {
        j.body = {
          booking_options: [
            {
              book_with: 'Aer Lingus',
              price: 603,
              booking_request: { url: 'https://www.aerlingus.com/booking?lang=en&api_key=abc12345' },
            },
          ],
        };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain(
      'body URL parameter api_key under url (www.aerlingus.com) is credential-shaped',
    );
  });

  it('the stand-in tripwire matches only the marker, never ordinary prose (r3-ts-002)', () => {
    for (const prose of ['Outstanding legroom', 'Standing room only', 'STANDIN', 'standin', 'understanding'])
      expect(holdsStandInMarker(prose), prose).toBe(false);
    expect(holdsStandInMarker(`id ${STANDIN_MARKER}-cal-1`)).toBe(true);
  });

  it.each([
    [
      'a www.google.com booking parameter holding an opaque value',
      (j: Record<string, unknown>) => {
        j.body = {
          booking_options: [
            {
              book_with: 'OTA',
              price: 573,
              booking_request: {
                url: 'https://www.google.com/travel/clk/f?tfs=CBwQAhooEgoyMDI3LTAzLTAyagcIARID',
                post_data: 'u=ota',
              },
            },
          ],
        };
      },
      'body URL parameter tfs under url (www.google.com) holds an opaque value',
    ],
    [
      'a body URL with userinfo',
      (j: Record<string, unknown>) => {
        j.body = {
          booking_options: [
            {
              book_with: 'OTA',
              price: 573,
              booking_request: { url: 'https://me:pw@www.google.com/travel/clk/f', post_data: 'u=ota' },
            },
          ],
        };
      },
      'body URL with userinfo under url',
    ],
    [
      'a search_metadata URL with a query',
      (j: Record<string, unknown>) => {
        j.body = {
          ...asObject(j.body),
          search_metadata: { request_url: 'https://www.searchapi.io/api/v1/search?engine=google_flights' },
        };
      },
      'search_metadata URL with a query under request_url',
    ],
  ] as const)('rejects %s (r3-ts-003)', async (_name, mutate, problem) => {
    const { root } = await runRecording();
    rewrite(root, (f) => q(f, 'booking_token') !== null && f.status === 200, mutate);
    expect(checkWorkedExampleTree(root, OK)).toContain(problem);
  });

  it('accepts a www.google.com booking parameter that carries a recorder placeholder (r3-ts-003)', async () => {
    const { root } = await runRecording();
    const step3 = loadRecorded(root, 'searchapi', '/api/v1/search').find(
      (f) => q(f, 'booking_token') !== null && f.status === 200,
    );
    expect(JSON.stringify(step3?.body)).toContain('booking_token=%3Cbooking_token');
    expect(checkWorkedExampleTree(root, OK)).toEqual([]);
  });

  it('rejects a request with a stops parameter (r3-ts-003)', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'engine') === 'google_flights_calendar' && f.status === 200,
      (j) => {
        const request = asObject(j.request);
        const url = new URL(String(request.url));
        url.searchParams.set('stops', '0');
        j.request = { ...request, url: url.href };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain(
      'searchapi: a stops parameter was sent (plan decision 24)',
    );
  });

  it('rejects a calendar request without separate_tickets=1 (plan decision 29: both engines)', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'engine') === 'google_flights_calendar' && f.status === 200,
      (j) => {
        const request = asObject(j.request);
        const url = new URL(String(request.url));
        url.searchParams.delete('separate_tickets');
        j.request = { ...request, url: url.href };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain(
      'searchapi: a request without separate_tickets=1 (plan decisions 24 and 29: both engines)',
    );
  });

  it('rejects a tree without the reverse tile JFK→LON (plan decision 31)', async () => {
    const { root } = await runRecording();
    rewrite(
      root,
      (f) => q(f, 'origin') === 'JFK' && f.status === 200,
      (j) => {
        const request = asObject(j.request);
        const url = new URL(String(request.url));
        url.searchParams.set('departure_at', '2027-04');
        j.request = { ...request, url: url.href };
      },
    );
    expect(checkWorkedExampleTree(root, OK)).toContain(
      'travelpayouts: no reverse tile JFK→LON 2027-03 (plan decision 31)',
    );
  });

  it('rejects a second allowlist file for a provider (r3-ts-003)', async () => {
    const { root } = await runRecording();
    copyFileSync(
      join(root, 'searchapi', 'params-2026-10-20.json'),
      join(root, 'searchapi', 'params-2026-10-21.json'),
    );
    expect(checkWorkedExampleTree(root, OK)).toContain('searchapi: 2 allowlist files, expected 1');
  });
});

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
  return Object.fromEntries(Object.entries(v));
}
