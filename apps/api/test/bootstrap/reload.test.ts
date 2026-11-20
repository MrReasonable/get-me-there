// Settings plan ruling 6: the reloader alone. A save with nothing in flight restarts once, after the caller's turn; a
// save during runs holds the engine and restarts on the first settle that finds nothing in flight; two saves give one
// restart; a signal's close stops any restart still waiting; a check that throws is logged, never thrown into the run
// registry's settle, and checked again later so the restart it was waiting for is never lost.
import { Secret } from '@gmt/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReloader, RESTART_RETRY_MS } from '../../src/bootstrap/reload.js';
import { createLogger } from '../../src/logger.js';
import { captureLines } from '../helpers/harness.js';

function setup(o: { idle?: () => boolean } = {}) {
  const calls: string[] = [];
  let busy = true;
  const lines: string[] = [];
  const secret = new Secret('reload-test-secret-0123456789');
  const reloader = createReloader({
    idle: o.idle ?? (() => !busy),
    hold: () => calls.push('hold'),
    reload: () => calls.push('reload'),
    log: createLogger({ logLevel: 'info' }, { destination: captureLines(lines), secrets: [secret] }),
    secrets: [secret],
  });
  return { reloader, calls, lines, secret, setBusy: (b: boolean) => (busy = b) };
}

afterEach(() => {
  vi.useRealTimers();
});

/** Lets the microtask the restart is queued on run. */
const turn = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('createReloader (settings plan ruling 6)', () => {
  it('idle: answers now, holds the engine and restarts once, after the caller has answered', async () => {
    const { reloader, calls, setBusy } = setup();
    setBusy(false);
    expect(reloader.held()).toBe(false);
    expect(reloader.request()).toBe('now');
    expect(calls).toEqual(['hold']);
    await turn();
    expect(calls).toEqual(['hold', 'reload']);
    // why: the restart has begun, so nothing waits any more, but the pass stays held until it closes
    expect(reloader.pending()).toBe(false);
    expect(reloader.held()).toBe(true);
    expect(reloader.request()).toBe('now');
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold', 'reload']);
    expect(reloader.pending()).toBe(false);
  });

  it('busy: answers after-runs; two saves hold once and restart once, on the first settle with nothing in flight', async () => {
    const { reloader, calls, setBusy } = setup();
    expect(reloader.request()).toBe('after-runs');
    expect(reloader.request()).toBe('after-runs');
    expect(reloader.pending()).toBe(true);
    reloader.watch.started();
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold']);
    setBusy(false);
    reloader.watch.ended();
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold', 'reload']);
    expect(reloader.pending()).toBe(false);
  });

  it('a settle before any save restarts nothing', async () => {
    const { reloader, calls, setBusy } = setup();
    setBusy(false);
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual([]);
  });

  it("a signal's close stops a restart still waiting", async () => {
    const { reloader, calls, setBusy } = setup();
    expect(reloader.request()).toBe('after-runs');
    reloader.stop();
    expect(reloader.pending()).toBe(false);
    expect(reloader.held()).toBe(true);
    setBusy(false);
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold']);
  });

  it('a check that throws on a settle is logged, scrubbed, and never thrown', async () => {
    let fail = false;
    const { reloader, calls, lines, secret } = setup({
      idle: () => {
        if (fail) throw new Error(`database closed at ${secret.reveal()}`);
        return false;
      },
    });
    expect(reloader.request()).toBe('after-runs');
    fail = true;
    expect(() => reloader.watch.ended()).not.toThrow();
    await turn();
    expect(calls).toEqual(['hold']);
    expect(lines.join('')).toContain('restart check failed');
    expect(lines.join('')).not.toContain(secret.reveal());
    reloader.stop();
  });

  it('a check that throws on the last settle is checked again later and restarts once the check answers idle', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let state: 'busy' | 'fail' | 'idle' = 'busy';
    const { reloader, calls, lines } = setup({
      idle: () => {
        if (state === 'fail') throw new Error('database is locked');
        return state === 'idle';
      },
    });
    expect(reloader.request()).toBe('after-runs');
    state = 'fail';
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold']);
    // why: still failing at the first retry: logged again and retried again, nothing restarted
    await vi.advanceTimersByTimeAsync(RESTART_RETRY_MS);
    expect(calls).toEqual(['hold']);
    expect(lines.filter((l) => l.includes('restart check failed'))).toHaveLength(2);
    expect(reloader.pending()).toBe(true);
    state = 'idle';
    await vi.advanceTimersByTimeAsync(RESTART_RETRY_MS);
    expect(calls).toEqual(['hold', 'reload']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a retry still waiting while work is in flight restarts nothing; a signal clears it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let state: 'busy' | 'fail' = 'fail';
    const { reloader, calls } = setup({
      idle: () => {
        if (state === 'fail') throw new Error('database is locked');
        return false;
      },
    });
    expect(reloader.request()).toBe('after-runs');
    state = 'busy';
    await vi.advanceTimersByTimeAsync(RESTART_RETRY_MS);
    expect(calls).toEqual(['hold']);
    state = 'fail';
    reloader.watch.ended();
    expect(vi.getTimerCount()).toBe(1);
    reloader.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(RESTART_RETRY_MS);
    expect(calls).toEqual(['hold']);
  });

  it('a tool run inside the app holds the restart like a run, is named while it waits, and its end restarts', async () => {
    const { reloader, calls, setBusy } = setup();
    setBusy(false);
    reloader.toolStarted('Smoke test');
    expect(reloader.request()).toBe('after-runs');
    expect(reloader.tools()).toEqual(['Smoke test']);
    reloader.watch.ended();
    await turn();
    expect(calls).toEqual(['hold']);
    reloader.toolEnded();
    await turn();
    expect(calls).toEqual(['hold', 'reload']);
    expect(reloader.tools()).toEqual([]);
  });
});
