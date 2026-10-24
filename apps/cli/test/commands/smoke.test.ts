import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { scriptedAsk, stubHttp, testIo } from '../support/deps.js';
import { machine } from '../support/machine.js';

const ENV = '/Users/op/.config/get-me-there/app.env';
const PASS = 'smoke-test-password-0123';
function world(
  plan: unknown,
  opts: { tty?: boolean; answers?: Array<string | boolean>; ledgered?: number } = {},
) {
  const posts: unknown[] = [];
  const http = stubHttp({
    'GET /api/tools/smoke/plan': () => ({ status: 200, body: plan }),
    'POST /api/tools/smoke': (r) => {
      const body = JSON.parse(r.body ?? '{}');
      posts.push({ body, headers: r.headers });
      return body.dryRun === true
        ? {
            status: 200,
            body: {
              exitCode: 0,
              summary: 'dry run',
              lines: [
                `SearchApi credits already ledgered to tool runs in this budget window: ${opts.ledgered ?? 2}`,
              ],
              fixturesWritten: [],
            },
          }
        : {
            status: 200,
            body: { exitCode: 0, summary: 'smoke ok', lines: ['provenance: live'], fixturesWritten: [] },
          };
    },
  });
  const ask = scriptedAsk(opts.answers ?? ['yes']);
  const m = machine({ http, ask, io: testIo({ tty: opts.tty ?? true }) });
  m.fs.file(ENV, `PORT="3000"\nAPP_BASIC_AUTH_USER="operator"\nAPP_BASIC_AUTH_PASS="${PASS}"\n`, 0o600);
  return { ...m, http, posts, ask };
}
const SA = { calendar: 1, itinerary: 3, trialLeft: null };
const ARGS = ['smoke', '--from', 'LHR', '--to', 'JFK'];

describe('gmt smoke (spec §13: it states its spend before posting)', () => {
  it.each([
    [
      { searchApi: SA, travelpayouts: null, camoufox: null },
      ['SearchApi: up to 4 calls (calendar 1, itinerary 3)'],
    ],
    [
      { searchApi: { ...SA, trialLeft: 37 }, travelpayouts: null, camoufox: null },
      ['SearchApi: up to 4 calls (calendar 1, itinerary 3; trial: 37 left)'],
    ],
    [
      { searchApi: null, travelpayouts: { freeCalls: 2 }, camoufox: null },
      ['Travelpayouts: up to 2 free calls'],
    ],
    [
      { searchApi: null, travelpayouts: null, camoufox: { pages: 1, scrolls: 30 } },
      ['browser provider: 1 page, up to 30 scrolls'],
    ],
    [
      { searchApi: null, travelpayouts: null, camoufox: { pages: 1, scrolls: 0 } },
      ['browser provider: 1 page'],
    ],
    [
      { searchApi: SA, travelpayouts: { freeCalls: 2 }, camoufox: { pages: 1, scrolls: 0 } },
      [
        'SearchApi: up to 4 calls (calendar 1, itinerary 3)',
        'Travelpayouts: up to 2 free calls',
        'browser provider: 1 page',
      ],
    ],
  ])('prints the plan route’s figures for %j before anything is posted', async (plan, lines) => {
    const w = world(plan);
    let postedBeforeStatement = false;
    const orig = w.ask.typed;
    w.ask.typed = async (q, word) => {
      postedBeforeStatement = w.posts.length > 0;
      return orig(q, word);
    };
    expect(await runCli(ARGS, w.deps)).toBe(0);
    for (const l of lines) expect(w.io.stdout).toContain(l);
    expect(postedBeforeStatement).toBe(false);
    expect(w.ask.asked).toEqual(['Send the smoke test now? It spends the calls above.']);
  });

  it('posts with basic auth from app.env (never argv) and the mutating-route headers, budget = ledgered + worst case', async () => {
    const w = world({ searchApi: SA, travelpayouts: null, camoufox: null }, { ledgered: 2 });
    expect(await runCli(ARGS, w.deps)).toBe(0);
    expect(w.posts).toEqual([
      {
        body: { origin: 'LHR', destination: 'JFK', budget: 4, dryRun: true },
        headers: {
          Authorization: `Basic ${Buffer.from(`operator:${PASS}`).toString('base64')}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'get-me-there',
        },
      },
      expect.objectContaining({ body: { origin: 'LHR', destination: 'JFK', budget: 6 } }),
    ]);
    expect(w.runner.calls.some((c) => c.argv.join(' ').includes(PASS))).toBe(false);
    expect(w.io.stdout).toContain('smoke ok');
  });

  it('refuses before posting when the trial has fewer credits left than the worst case, naming both', async () => {
    const w = world(
      { searchApi: { ...SA, trialLeft: 3 }, travelpayouts: null, camoufox: null },
      { answers: [] },
    );
    expect(await runCli(ARGS, w.deps)).toBe(78);
    expect(w.io.stderr).toContain('needs up to 4 SearchApi credits and the trial has 3 left');
    expect(w.posts).toEqual([]);
  });

  it('anything but a typed yes posts nothing; --yes skips the question; no terminal without --yes refuses', async () => {
    const no = world({ searchApi: SA, travelpayouts: null, camoufox: null }, { answers: ['y'] });
    expect(await runCli(ARGS, no.deps)).toBe(78);
    expect(no.posts).toEqual([]);
    const yes = world({ searchApi: SA, travelpayouts: null, camoufox: null }, { answers: [], tty: false });
    expect(await runCli([...ARGS, '--yes'], yes.deps)).toBe(0);
    expect(yes.posts).toHaveLength(2);
    const pipe = world({ searchApi: SA, travelpayouts: null, camoufox: null }, { answers: [], tty: false });
    expect(await runCli(ARGS, pipe.deps)).toBe(78);
    expect(pipe.posts).toEqual([]);
  });

  it('a route is required, and a failed smoke exits with its code', async () => {
    const w = world({ searchApi: SA, travelpayouts: null, camoufox: null });
    expect(await runCli(['smoke'], w.deps)).toBe(64);
    expect(await runCli(['smoke', '--from', 'lhr', '--to', 'JFK'], w.deps)).toBe(64);
    const none = machine({ io: testIo({ tty: true }) });
    expect(await runCli(ARGS, none.deps)).toBe(78);
  });
});
