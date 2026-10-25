import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { scriptedAsk, stubHttp, testIo } from '../support/deps.js';
import { machine } from '../support/machine.js';

const ENV = '/Users/op/.config/get-me-there/app.env';
const PASS = 'smoke-test-password-0123';
type Run = { exitCode: number; summary: string; lines: string[] };
function world(
  plan: unknown,
  opts: {
    tty?: boolean;
    answers?: Array<string | boolean>;
    ledgered?: number;
    dry?: Partial<Run>;
    run?: Partial<Run>;
  } = {},
) {
  const posts: Array<{ body: Record<string, unknown>; headers: unknown; stdoutBefore: string }> = [];
  const http = stubHttp({
    'GET /api/tools/smoke/plan': () => ({ status: 200, body: plan }),
    'POST /api/tools/smoke': (r) => {
      const body = JSON.parse(r.body ?? '{}');
      posts.push({ body, headers: r.headers, stdoutBefore: m.io.stdout });
      const base = { fixturesWritten: [], searchApiCreditsLedgered: opts.ledgered ?? 0 };
      return body.dryRun === true
        ? {
            status: 200,
            body: {
              exitCode: 0,
              summary: 'dry run: nothing sent',
              lines: [`SearchApi window (trial): 9 of 100 used (compare with the dashboard)`],
              ...base,
              ...opts.dry,
            },
          }
        : {
            status: 200,
            body: { exitCode: 0, summary: 'smoke ok', lines: ['provenance: ok'], ...base, ...opts.run },
          };
    },
  });
  const ask = scriptedAsk(opts.answers ?? ['yes']);
  const m = machine({ http, ask, io: testIo({ tty: opts.tty ?? true }) });
  m.fs.file(ENV, `PORT="3000"\nAPP_BASIC_AUTH_USER="operator"\nAPP_BASIC_AUTH_PASS="${PASS}"\n`, 0o600);
  return { ...m, http, posts, ask };
}
const SA = { calendar: 1, itinerary: 3, trialLeft: null };
const ONLY_SA = { searchApi: SA, travelpayouts: null, camoufox: null };
const ARGS = ['smoke', '--from', 'LHR', '--to', 'JFK'];
const realPosts = (w: ReturnType<typeof world>) => w.posts.filter((p) => p.body.dryRun !== true);

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
    expect(await runCli(ARGS, w.deps)).toBe(0);
    for (const l of lines) {
      expect(w.io.stdout).toContain(l);
      expect(w.posts[0]?.stdoutBefore).toContain(l);
    }
    expect(w.ask.asked).toEqual(['Send the smoke test now? It spends the calls above.']);
  });

  it('upper-cases the airports; still refuses anything but three letters (po-b1-013)', async () => {
    const w = world(ONLY_SA);
    expect(await runCli(['smoke', '--from', 'lhr', '--to', 'jfk'], w.deps)).toBe(0);
    expect(w.posts[0]?.body).toMatchObject({ origin: 'LHR', destination: 'JFK' });
    expect(await runCli(['smoke', '--from', 'LH', '--to', 'JFK'], w.deps)).toBe(64);
    expect(await runCli(['smoke', '--from', 'L1R', '--to', 'JFK'], w.deps)).toBe(64);
  });

  it('with no provider configured it refuses before any question or post, naming the no-cost source (po-b1-012)', async () => {
    const w = world({ searchApi: null, travelpayouts: null, camoufox: null }, { answers: [] });
    expect(await runCli(ARGS, w.deps)).toBe(78);
    expect(w.io.stderr).toContain('No price source is set up yet');
    expect(w.io.stderr).toContain('pnpm gmt setup --reconfigure travelpayouts');
    expect(w.posts).toEqual([]);
    expect(w.ask.asked).toEqual([]);
  });

  it('the dry run comes first and its lines are shown before the question; the real post has basic auth and budget = ledgered + worst case', async () => {
    const w = world(ONLY_SA, { ledgered: 2 });
    expect(await runCli(ARGS, w.deps)).toBe(0);
    expect(w.posts.map((p) => p.body)).toEqual([
      { origin: 'LHR', destination: 'JFK', budget: 4, dryRun: true },
      { origin: 'LHR', destination: 'JFK', budget: 6 },
    ]);
    expect(w.posts[1]?.headers).toEqual({
      Authorization: `Basic ${Buffer.from(`operator:${PASS}`).toString('base64')}`,
      'Content-Type': 'application/json',
      'X-Requested-With': 'get-me-there',
    });
    expect(w.runner.calls.some((c) => c.argv.join(' ').includes(PASS))).toBe(false);
    expect(w.posts[1]?.stdoutBefore).toContain('SearchApi window (trial): 9 of 100 used');
    expect(w.io.stdout).toContain('smoke ok');
  });

  it('with credits already ledgered to tool runs it states the running total and asks for that total (U7, cb-b1-007)', async () => {
    const w = world(ONLY_SA, { ledgered: 4 });
    expect(await runCli(ARGS, w.deps)).toBe(0);
    expect(w.posts[1]?.stdoutBefore).toContain(
      'Tool runs have already used 4 SearchApi credits in this budget window; this smoke takes that to at most 8.',
    );
    expect(w.ask.asked).toEqual([
      'Send the smoke test now, taking tool runs to at most 8 SearchApi credits?',
    ]);
  });

  it('--yes alone does not cover an earlier tool run’s credits: it needs --accept-total as well (decision 20)', async () => {
    const w = world(ONLY_SA, { ledgered: 4, answers: [], tty: false });
    expect(await runCli([...ARGS, '--yes'], w.deps)).toBe(65);
    expect(w.io.stderr).toContain('--accept-total');
    expect(realPosts(w)).toEqual([]);
    expect(await runCli([...ARGS, '--yes', '--accept-total'], w.deps)).toBe(0);
    expect(realPosts(w)).toHaveLength(1);
  });

  it('refuses before posting when the trial has fewer credits left than the worst case, naming both (65)', async () => {
    const w = world(
      { searchApi: { ...SA, trialLeft: 3 }, travelpayouts: null, camoufox: null },
      { answers: [] },
    );
    expect(await runCli(ARGS, w.deps)).toBe(65);
    expect(w.io.stderr).toContain('needs up to 4 SearchApi credits and the trial has 3 left');
    expect(w.posts).toEqual([]);
  });

  it('anything but a typed yes posts nothing real; --yes skips the question; no terminal without --yes refuses', async () => {
    const no = world(ONLY_SA, { answers: ['y'] });
    expect(await runCli(ARGS, no.deps)).toBe(78);
    expect(realPosts(no)).toEqual([]);
    const yes = world(ONLY_SA, { answers: [], tty: false });
    expect(await runCli([...ARGS, '--yes'], yes.deps)).toBe(0);
    expect(realPosts(yes)).toHaveLength(1);
    const pipe = world(ONLY_SA, { answers: [], tty: false });
    expect(await runCli(ARGS, pipe.deps)).toBe(78);
    expect(realPosts(pipe)).toEqual([]);
  });

  it('a dry run that exits non-zero stops: its lines are shown, its code returned, nothing real is posted (CodeRabbit …k7a)', async () => {
    const w = world(ONLY_SA, {
      dry: {
        exitCode: 64,
        summary: 'LON is a city code; the smoke takes one airport',
        lines: ['LON is a city code'],
      },
    });
    expect(await runCli(ARGS, w.deps)).toBe(64);
    expect(w.io.stderr).toContain('LON is a city code; the smoke takes one airport');
    expect(realPosts(w)).toEqual([]);
    expect(w.ask.asked).toEqual([]);
  });

  it('a failed smoke exits with its code (CodeRabbit …k7p); a 65 race gets the CLI’s own advice (cb-b1-012)', async () => {
    const failed = world(ONLY_SA, {
      run: { exitCode: 1, summary: 'smoke failed: a check failed', lines: ['check x: fail'] },
    });
    expect(await runCli(ARGS, failed.deps)).toBe(1);
    expect(failed.io.stdout).toContain('check x: fail');
    const empty = world(ONLY_SA, { run: { exitCode: 3, summary: 'smoke empty', lines: [] } });
    expect(await runCli(ARGS, empty.deps)).toBe(3);
    const raced = world(ONLY_SA, {
      run: { exitCode: 65, summary: 'refusing: … raise --budget only if you mean to spend more', lines: [] },
    });
    expect(await runCli(ARGS, raced.deps)).toBe(65);
    expect(raced.io.stderr).toContain(
      'another tool run spent SearchApi credits since the check; run pnpm gmt smoke again to see the new total',
    );
    expect(raced.io.stderr).not.toContain('--budget');
  });

  it('a route is required; no settings refuses', async () => {
    const w = world(ONLY_SA);
    expect(await runCli(['smoke'], w.deps)).toBe(64);
    const none = machine({ io: testIo({ tty: true }) });
    expect(await runCli(ARGS, none.deps)).toBe(78);
  });
});
