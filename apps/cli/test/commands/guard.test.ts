import { describe, expect, it } from 'vitest';
import { guardActiveRun } from '../../src/commands/guard.js';
import { stubHttp, testIo, testWorld } from '../support/deps.js';

// why: U1: one active-run guard for every command that stops or restarts an app (decision 80's rule)
const ACTIVE = {
  execution: {
    id: 'e1',
    definitionId: 'd1',
    definitionName: 'London to New York weekly',
    kind: 'run',
    startedAt: '2026-10-24T09:00:00.000Z',
    estimatedFinishAt: null,
  },
};
const creds = { port: 3000, user: 'operator', pass: 'p-0123456789ab' };
function world(answers: unknown[]) {
  const queue = [...answers];
  const http = stubHttp({
    'GET /api/executions/active': () => {
      const a = queue.length > 1 ? queue.shift() : queue[0];
      return a === 'error'
        ? { error: 'down' }
        : typeof a === 'number'
          ? { status: a, body: {} }
          : { status: 200, body: a };
    },
  });
  const io = testIo();
  const slept: number[] = [];
  const w = testWorld({ http, io, deps: { sleep: async (ms) => void slept.push(ms) } });
  return { ...w, http, slept };
}
const target = { label: 'the app', up: true, creds, autoResume: true };
const none = { wait: false, force: false };

describe('guardActiveRun', () => {
  it('an app that is not up is not asked', async () => {
    const w = world([ACTIVE]);
    expect(await guardActiveRun(w.deps, { ...target, up: false }, none)).toMatchObject({ ok: true });
    expect(w.http.requests).toEqual([]);
  });
  it('no run active goes ahead', async () => {
    expect(await guardActiveRun(world([{ execution: null }]).deps, target, none)).toMatchObject({ ok: true });
  });
  it('an active run refuses naming it; a 401, no answer or no credentials refuses as “cannot tell”', async () => {
    const r = await guardActiveRun(world([ACTIVE]).deps, target, none);
    expect(r).toEqual({
      ok: false,
      message:
        'a search is running in the app: London to New York weekly, started 2026-10-24T09:00:00.000Z, estimated to finish unknown; run this again when it ends, or with --wait or --force',
    });
    for (const a of [401, 'error'])
      expect(await guardActiveRun(world([a]).deps, target, none)).toMatchObject({
        ok: false,
        message: expect.stringContaining('cannot tell whether a search is running in the app'),
      });
    expect(await guardActiveRun(world([ACTIVE]).deps, { ...target, creds: null }, none)).toMatchObject({
      ok: false,
    });
  });
  it('--wait polls every 60 s until none', async () => {
    const w = world([ACTIVE, ACTIVE, { execution: null }]);
    expect(await guardActiveRun(w.deps, target, { wait: true, force: false })).toMatchObject({ ok: true });
    expect(w.slept).toEqual([60_000, 60_000]);
  });
  it('--force goes ahead after printing decision 80’s statement, for an active run or a failed read', async () => {
    for (const [a, auto, line] of [
      [ACTIVE, true, 'after the restart the app resumes it from its last checkpoint (AUTO_RESUME is on)'],
      [401, false, 'it waits for you to resume it (AUTO_RESUME is off)'],
    ] as const) {
      const w = world([a]);
      expect(
        await guardActiveRun(w.deps, { ...target, autoResume: auto }, { wait: false, force: true }),
      ).toMatchObject({ ok: true });
      expect(w.io.stdout).toContain('the app stops within 30 s');
      expect(w.io.stdout).toContain(line);
    }
  });
});
