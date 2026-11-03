// The provider's keep-awake capability (spec §2 "The keep-awake lease"): POST /v1/awake under the unledgered
// `camoufox-status` id, never a ledger row; a failure is logged at warn and never thrown. msw stands in for the worker.
import { APP_INSTANCE_HEADER, WORKER_KEY_HEADER } from '@gmt/core';
import { HttpResponse, http } from 'msw/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { camoufoxProvider } from '../../src/camoufox/index.js';
import { hangUntilAborted } from '../../src/testing/network.js';
import { FLIGHT_REQUEST_SECONDS, makeKit, SENTINELS } from '../fakes.js';
import { server } from '../support/msw.js';
import { drive, useFakeTime } from '../support/time.js';

const WORKER = 'http://127.0.0.1:8090';
const AWAKE_URL = `${WORKER}/v1/awake`;
const AT = '2026-10-18T05:05:00.000Z';

function provider() {
  const made = makeKit();
  const p = camoufoxProvider({
    http: made.kit,
    log: made.log,
    clock: made.clock,
    key: SENTINELS.camoufox,
    workerUrl: WORKER,
    pointOfSale: 'GB',
    flightRequestSeconds: FLIGHT_REQUEST_SECONDS,
    appInstance: 'a'.repeat(64),
  });
  const keep = p.keepAwake;
  if (keep === undefined) throw new Error('no keepAwake');
  // why: http-kit logs its own lines about a failed attempt; these are the capability's own
  const warns = (): unknown[] =>
    made.log.lines
      .map((l): unknown => JSON.parse(l))
      .filter((l) => {
        const text = JSON.stringify(l);
        return text.includes('"level":"warn"') && text.includes('keep-awake');
      });
  return { ...made, keep, warns };
}
const signal = (): AbortSignal => new AbortController().signal;

afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
});
beforeEach(() => {
  expect.hasAssertions();
});

describe('the camoufox keep-awake capability', () => {
  it('hold posts the lease’s seconds with the key and app instance; release posts 0; no ledger row', async () => {
    useFakeTime();
    const t = provider();
    const seen: Array<{ body: unknown; key: string | null; instance: string | null }> = [];
    server.use(
      http.post(AWAKE_URL, async ({ request }) => {
        seen.push({
          body: await request.json(),
          key: request.headers.get(WORKER_KEY_HEADER),
          instance: request.headers.get(APP_INSTANCE_HEADER),
        });
        return HttpResponse.json({ held: true, until: AT, mechanism: 'caffeinate' });
      }),
    );
    await drive(t.keep.hold(300, signal()));
    await drive(t.keep.release(signal()));
    expect(seen).toEqual([
      { body: { seconds: 300 }, key: SENTINELS.camoufox.reveal(), instance: 'a'.repeat(64) },
      { body: { seconds: 0 }, key: SENTINELS.camoufox.reveal(), instance: 'a'.repeat(64) },
    ]);
    expect(t.budget.rows).toEqual([]);
    expect(t.warns()).toEqual([]);
  });
  it.each([
    ['an unreachable worker', () => HttpResponse.error()],
    ['a refused key', () => new HttpResponse(null, { status: 401 })],
    ['a refused request', () => HttpResponse.json({ kind: 'bad-request' }, { status: 400 })],
    ['an older worker without the route', () => new HttpResponse(null, { status: 404 })],
    ['an answer this build cannot read', () => HttpResponse.json({ held: 'yes' })],
  ])('%s: logged at warn, never thrown, no ledger row', async (_n, answer) => {
    useFakeTime();
    const t = provider();
    server.use(http.post(AWAKE_URL, answer));
    await expect(drive(t.keep.hold(300, signal()))).resolves.toBeUndefined();
    await expect(drive(t.keep.release(signal()))).resolves.toBeUndefined();
    expect(t.warns()).toHaveLength(2);
    expect(t.warns()[0]).toMatchObject({ msg: 'keep-awake: the browser worker did not take the lease' });
    expect(t.budget.rows).toEqual([]);
  });
  it('an abort (the app shutting down) ends the request quietly', async () => {
    useFakeTime();
    const t = provider();
    server.use(http.post(AWAKE_URL, ({ request }) => hangUntilAborted(request)));
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1000);
    await expect(drive(t.keep.hold(300, ac.signal))).resolves.toBeUndefined();
    expect(t.warns()).toEqual([]);
  });
});
